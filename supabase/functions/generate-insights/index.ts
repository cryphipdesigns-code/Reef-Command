const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InsightRequest = {
  mode?: string;
  question?: string;
  state?: Record<string, unknown>;
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
        required: ["label", "data_type", "reason", "target_id", "priority"],
        properties: {
          label: { type: "string" },
          data_type: {
            type: "string",
            enum: [
              "lighting_images",
              "livestock_photos",
              "map_reference_images",
              "par_map",
              "water_tests",
              "feeding_logs",
              "maintenance_logs",
              "other",
            ],
          },
          reason: { type: "string" },
          target_id: { type: "string" },
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

  const mode = body.mode || "health";
  const question = body.question || "";
  const state = body.state || {};
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-5.4";

  const promptPayload = {
    mode,
    question,
    context: state,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: buildInstructions(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(promptPayload, null, 2),
            },
          ],
        },
      ],
      max_output_tokens: 1400,
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
    return jsonResponse(
      {
        error: "OpenAI request failed",
        detail: responseJson.error?.message || responseJson,
      },
      response.status,
    );
  }

  const outputText = extractOutputText(responseJson);
  let insight: unknown;
  try {
    insight = JSON.parse(outputText);
  } catch {
    insight = {
      headline: "Insight generated",
      summary: outputText,
      priorities: [],
      observations: [],
      next_actions: [],
      missing_data: [],
      data_requests: [],
    };
  }

  await recordInsightRun(request.headers.get("authorization"), {
    mode,
    question,
    result: insight,
  });

  return jsonResponse({ insight, model });
});

function buildInstructions() {
  return [
    "You are Reef Command, a careful reef-aquarium analysis assistant.",
    "Use the provided tank profile, livestock, placement zones, water tests, feeding, maintenance, and water-change logs.",
    "Pay close attention to timestamps. Relate parameter readings to light schedule phase, recent feeding, and recent water changes when that context is present.",
    "Treat mapModel, aquascape structures, livestock placements, PAR ranges, light levels, and flow levels as important placement context.",
    "When mapModel is present, use its coordinate system and structure notes to reason about coral placement, shading, high-light shelf areas, sand-bed areas, and flow exposure.",
    "The phase-1 context may include rawDataInventory. This is a manifest of raw evidence the app can provide later, such as lighting screenshots, livestock photos, map references, PAR maps, and detailed logs.",
    "Do not ask for raw data by default. If raw evidence would materially improve the answer, add a data_requests item that names the smallest useful evidence bundle and explains why.",
    "For coral health questions, consider whether non-current livestock photos, lighting schedule images, PAR map/model data, or recent parameter logs would materially change confidence. If so, request them.",
    "For lighting-sensitive questions, request lighting_images only when the summarized lighting context is insufficient and raw lighting images are available.",
    "Prefer simple, incremental reefkeeping actions. Do not recommend abrupt parameter swings.",
    "Flag detectable ammonia or nitrite as high priority, while asking the user to verify unexpected test results.",
    "Do not invent facts, species requirements, product instructions, or missing measurements. Put missing inputs in missing_data.",
    "This is husbandry support, not veterinary diagnosis. For severe livestock distress, recommend confirmation from an experienced reef professional or veterinarian.",
    "Return concise structured JSON only.",
  ].join("\n");
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
