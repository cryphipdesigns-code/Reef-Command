const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InsightRequest = {
  mode?: string;
  question?: string;
  state?: Record<string, unknown>;
  evidence?: Record<string, EvidenceBundle>;
};

type EvidenceBundle = {
  path?: string;
  parentPath?: string;
  data_type?: string;
  label?: string;
  summary?: string;
  count?: number;
  available?: boolean;
  terminal?: boolean;
  content?: unknown;
};

const insightSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "priorities", "observations", "next_actions", "missing_data", "data_requests"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "severity", "why"],
        properties: {
          label: { type: "string" },
          severity: { type: "string", enum: ["good", "warning", "danger"] },
          why: { type: "string" },
        },
      },
    },
    observations: {
      type: "array",
      items: { type: "string" },
    },
    next_actions: {
      type: "array",
      items: { type: "string" },
    },
    missing_data: {
      type: "array",
      items: { type: "string" },
    },
    data_requests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "path", "reason", "priority"],
        properties: {
          label: { type: "string" },
          path: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 500);
  }

  let body: InsightRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const mode = body.mode || "chat";
  const question = body.question || "";
  const state = body.state || {};
  const evidence = body.evidence || {};
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-5.4";

  const promptPayload = {
    mode,
    question,
    context: state,
  };

  let insight: unknown;
  let progressiveTrace: Record<string, unknown> = {
    phase: "index",
    requested: [],
    provided: [],
  };
  try {
    const promptImageInputs = collectPromptPhotoImageInputs(evidence);
    insight = await requestStructuredInsight(
      openAiKey,
      model,
      promptPayload,
      buildInstructions("index"),
      1400,
      promptImageInputs,
    );
    const requestedEvidence = getInsightDataRequests(insight);
    const firstPassImageKeys = promptImageInputs.length ? new Set(["current_request.attachments.prompt_photos"]) : new Set<string>();
    const selectedEvidence = selectEvidenceBundles(requestedEvidence, evidence, firstPassImageKeys);
    progressiveTrace = {
      phase: selectedEvidence.length ? "followup" : "index",
      requested: requestedEvidence,
      first_pass_image_inputs_sent: promptImageInputs.length,
      provided: selectedEvidence.map((bundle) => ({
        path: bundle.path,
        data_type: bundle.data_type,
        label: bundle.label,
        reason: bundle.reason,
        priority: bundle.priority,
      })),
    };

    if (selectedEvidence.length) {
      const selectedImages = collectEvidenceImageInputs(selectedEvidence);
      const followupImages = mergeImageInputs(promptImageInputs, selectedImages);
      const textSelectedEvidence = stripImagePayloads(selectedEvidence);
      insight = await requestStructuredInsight(
        openAiKey,
        model,
        {
          mode,
          question,
          context: state,
          selected_evidence: textSelectedEvidence,
          initial_insight: insight,
        },
        buildInstructions("followup"),
        1700,
        followupImages,
      );
      progressiveTrace = {
        ...progressiveTrace,
        image_inputs_sent: followupImages.length,
        selected_image_inputs_sent: selectedImages.length,
        prompt_image_inputs_reused_in_followup: promptImageInputs.length,
      };
    }
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;
    return jsonResponse(
      {
        error: "OpenAI request failed",
        detail: error instanceof Error ? error.message : error,
      },
      status,
    );
  }

  await recordInsightRun(request.headers.get("authorization"), {
    mode,
    question,
    result: insight,
  });

  return jsonResponse({ insight, model, progressive: progressiveTrace });
});

async function requestStructuredInsight(
  openAiKey: string,
  model: string,
  promptPayload: Record<string, unknown>,
  instructions: string,
  maxOutputTokens: number,
  imageInputs: Array<Record<string, string>> = [],
) {
  const content = [
    {
      type: "input_text",
      text: JSON.stringify(promptPayload, null, 2),
    },
    ...imageInputs,
  ];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input: [
        {
          role: "user",
          content,
        },
      ],
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: "json_schema",
          name: "reef_insight",
          strict: true,
          schema: insightSchema,
        },
      },
    }),
  });

  const responseJson = await response.json();
  if (!response.ok) {
    const error = new Error(responseJson.error?.message || JSON.stringify(responseJson));
    (error as { status?: number }).status = response.status;
    throw error;
  }

  const outputText = extractOutputText(responseJson);
  try {
    return JSON.parse(outputText);
  } catch {
    return {
      headline: "Insight generated",
      summary: outputText,
      priorities: [],
      observations: [],
      next_actions: [],
      missing_data: [],
      data_requests: [],
    };
  }
}

function buildInstructions(phase: "index" | "followup") {
  const base = [
    "You are Reef Command, a careful reef-aquarium analysis assistant.",
    "Treat every request as a general reefkeeping chat inquiry. There are no user-selected categories.",
    "The app provides a compact_snapshot plus a canonical context_tree. The tree is an inverted family tree of available evidence paths.",
    "Canonical ownership matters: photos live under the object they describe, livestock placement lives under livestock records and map placement references, care logs live under care_logs, and equipment configuration/schedules live under equipment records.",
    "All LLM-facing context keys and evidence paths use lower snake_case.",
    "Livestock record paths use livestock.records.<species_or_name_slug>_<id_suffix>; equipment record paths use stable keys such as equipment.records.auto_feeder.",
    "Use compact_snapshot and context_tree first. They are intentionally small to reduce token use.",
    "When more context would materially change confidence or recommendations, request exact path values copied from context_tree in data_requests.",
    "Request the smallest useful path. Prefer a leaf or narrow child branch over a broad parent branch. Do not request everything.",
    "Limit data_requests to at most four paths and give a concrete reason for each.",
    "If compact context is sufficient, answer directly and leave data_requests empty.",
    "Pay close attention to timestamps. Relate parameter readings to light schedule phase, recent feeding, and recent water changes when that context is present.",
    "Treat map, aquascape structures, livestock placements, PAR ranges, and light levels as important placement context when relevant.",
    "Treat logs as user-entered records, not a complete audit trail. Data present can be used as evidence. Data absent means not logged or unknown; do not infer that feeding, maintenance, dosing, or other care did not happen solely because no log exists.",
    "When log absence matters, phrase it as not logged and question confidence before using it as reliable evidence.",
    "Use careTasks and overdueCareTasks as schedule-by-log status. Phrase overdue items as overdue by logged cadence, not as proof they were not performed.",
    "If the user attached current prompt photos, those images are included in this index pass. Use them directly when relevant, and do not say their image bytes are unavailable.",
    "Prefer simple, incremental reefkeeping actions. Do not recommend abrupt parameter swings.",
    "Flag detectable ammonia or nitrite as high priority, while asking the user to verify unexpected test results.",
    "Do not invent facts, species requirements, product instructions, or missing measurements. Put missing inputs in missing_data.",
    "This is husbandry support, not veterinary diagnosis. For severe livestock distress, recommend confirmation from an experienced reef professional or veterinarian.",
    "Return concise structured JSON only.",
  ];

  if (phase === "followup") {
    base.push(
      "You are now receiving selected_evidence objects whose content fulfills one or more prior path-based data_requests.",
      "Prompt-attached images may be re-sent in this follow-up pass. Treat those as current prompt photos already reviewed, not as missing.",
      "If the attached prompt photos are not diagnostic enough, say exactly what is insufficient, such as less-blue lighting, closer lesion detail, or a different angle.",
      "Use selected_evidence to refine the final answer. Keep only still-needed data_requests in the returned JSON.",
    );
  } else {
    base.push(
      "This is the index pass. If the compact snapshot and tree are sufficient, answer directly and leave data_requests empty.",
      "If they are not sufficient, still provide the best provisional structured answer and request only the smallest useful follow-up paths.",
    );
  }

  return base.join("\n");
}

function getInsightDataRequests(insight: unknown) {
  if (!insight || typeof insight !== "object") return [];
  const requests = (insight as { data_requests?: unknown }).data_requests;
  return Array.isArray(requests)
    ? requests.filter((request): request is Record<string, unknown> => Boolean(request && typeof request === "object"))
    : [];
}

function selectEvidenceBundles(
  requests: Record<string, unknown>[],
  evidence: Record<string, EvidenceBundle>,
  skipKeys = new Set<string>(),
) {
  const selected: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const request of requests) {
    for (const key of evidenceKeysForRequest(request, evidence)) {
      if (seen.has(key) || skipKeys.has(key)) continue;
      const bundle = evidence[key];
      if (!bundle || bundle.available === false) continue;
      seen.add(key);
      selected.push({
        path: bundle.path || key,
        parentPath: bundle.parentPath || "",
        data_type: bundle.data_type || key,
        label: bundle.label || key,
        summary: bundle.summary || "",
        reason: request.reason || "",
        priority: request.priority || "medium",
        content: bundle.content ?? bundle,
      });
      break;
    }
    if (selected.length >= 4) break;
  }
  return selected;
}

function evidenceKeysForRequest(
  request: Record<string, unknown> = {},
  evidence: Record<string, EvidenceBundle> = {},
) {
  const requestedPath = normalizePathString(request.path);
  const promptPhotoKeys = shouldPrioritizePromptPhotos(request, evidence)
    ? ["current_request.attachments.prompt_photos"]
    : [];
  const pathKeys = evidenceKeysForPath(requestedPath, evidence);
  if (pathKeys.length) return [...promptPhotoKeys, ...pathKeys];

  const dataType = String(request.data_type || "");
  const aliases: Record<string, string[]> = {
    tank_profile: ["tank.profile", "tank.operating_targets"],
    equipment_details: ["equipment.records", "tank.profile"],
    map_model_detail: ["map.geometry_detail"],
    par_map: ["map.par_markers", "map.structures"],
    livestock_records: ["livestock.records.index"],
    livestock_photos: ["livestock.records"],
    lighting_images: ["lighting.images"],
    insight_prompt_photos: ["current_request.attachments.prompt_photos"],
    water_tests: ["parameters.full_test_records"],
    feeding_logs: ["care_logs.feeding.recent_events"],
    maintenance_logs: ["care_logs.maintenance.recent_events"],
    water_change_logs: ["care_logs.water_changes.recent_events"],
    care_schedule: ["care_logs.care_tasks.schedule_status"],
    map_reference_images: ["map.geometry_detail"],
  };
  return [...promptPhotoKeys, ...(aliases[dataType] || [])];
}

function evidenceKeysForPath(path: string, evidence: Record<string, EvidenceBundle>) {
  if (!path) return [];
  if (evidence[path]) return [path];
  const prefix = `${path}.`;
  return Object.keys(evidence)
    .filter((key) => key.startsWith(prefix))
    .sort((a, b) => a.length - b.length)
    .slice(0, 4);
}

function normalizePathString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function shouldPrioritizePromptPhotos(
  request: Record<string, unknown>,
  evidence: Record<string, EvidenceBundle>,
) {
  const promptPhotos = evidence["current_request.attachments.prompt_photos"];
  if (!promptPhotos || promptPhotos.available === false || !promptPhotos.count) return false;
  const dataType = String(request.data_type || "");
  const requestedPath = normalizePathString(request.path);
  if (requestedPath === "current_request.attachments.prompt_photos") return false;
  if (dataType === "insight_prompt_photos") return false;

  const requestText = [
    request.label,
    request.path,
    request.reason,
    request.target_id,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    requestText.includes("current") ||
    requestText.includes("prompt") ||
    requestText.includes("attached") ||
    requestText.includes("image bytes") ||
    requestText.includes("photo") ||
    requestText.includes("picture")
  );
}

function collectEvidenceImageInputs(selectedEvidence: Array<Record<string, unknown>>) {
  const images: Array<Record<string, string>> = [];
  const seen = new Set<string>();

  const visit = (value: unknown) => {
    if (images.length >= 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    const imageUrl = firstString(record.dataUrl, record.imageUrl, record.publicUrl);
    if (imageUrl && !seen.has(imageUrl)) {
      seen.add(imageUrl);
      images.push({
        type: "input_image",
        image_url: imageUrl,
        detail: "auto",
      });
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(selectedEvidence);
  return images;
}

function mergeImageInputs(...groups: Array<Array<Record<string, string>>>) {
  const images: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const image of group) {
      const key = image.image_url || JSON.stringify(image);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      images.push(image);
      if (images.length >= 6) return images;
    }
  }
  return images;
}

function collectPromptPhotoImageInputs(evidence: Record<string, EvidenceBundle>) {
  const promptPhotos = evidence["current_request.attachments.prompt_photos"];
  if (!promptPhotos || promptPhotos.available === false || !promptPhotos.count) return [];
  return collectEvidenceImageInputs([
    {
      path: promptPhotos.path || "current_request.attachments.prompt_photos",
      data_type: promptPhotos.data_type || "insight_prompt_photos",
      label: promptPhotos.label || "Current prompt photos",
      content: promptPhotos.content ?? promptPhotos,
    },
  ]);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function stripImagePayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImagePayloads);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (key === "dataUrl" && typeof entry === "string" && entry.startsWith("data:image/")) {
        return [key, "[image bytes sent separately]"];
      }
      return [key, stripImagePayloads(entry)];
    }),
  );
}

function extractOutputText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;

  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const text = (contentItem as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }

  return "";
}

async function recordInsightRun(
  authorizationHeader: string | null,
  payload: { mode: string; question: string; result: unknown },
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorizationHeader || !supabaseUrl || !serviceRoleKey) return;

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorizationHeader,
      apikey: serviceRoleKey,
    },
  });

  if (!userResponse.ok) return;
  const user = await userResponse.json();
  if (!user?.id) return;

  await fetch(`${supabaseUrl}/rest/v1/reef_insight_runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: user.id,
      mode: payload.mode,
      question: payload.question,
      result: payload.result,
    }),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
