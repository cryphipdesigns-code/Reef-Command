(function () {
  const RC = window.RC;
  const state = RC.state;
  const $ = (id) => RC.$(id);
  const $$ = (sel, root) => RC.$$(sel, root);
  const INSIGHT_CHAT_MODE = "chat";
  const PARAMETER_FIELDS = [
    { key: "ammonia", label: "Ammonia", unit: "ppm" },
    { key: "nitrite", label: "Nitrite", unit: "ppm" },
    { key: "nitrate", label: "Nitrate", unit: "ppm" },
    { key: "phosphate", label: "Phosphate", unit: "ppm" },
    { key: "ph", label: "pH", unit: "" },
    { key: "salinity", label: "Salinity", unit: "" },
    { key: "temperature", label: "Temperature", unit: "" },
    { key: "alkalinity", label: "Alkalinity", unit: "dKH" },
    { key: "calcium", label: "Calcium", unit: "ppm" },
    { key: "magnesium", label: "Magnesium", unit: "ppm" },
  ];

  function renderHomeInsightBrief() {
    const latest = state.insightRuns[0];
    if (!latest) {
      $("homeInsightBrief").innerHTML = `<div class="empty-state">No insights generated yet.</div>`;
      return;
    }
    $("homeInsightBrief").innerHTML = renderInsightCompact(latest.result, latest.source);
  }

  function renderInsightsContext() {
    const context = buildInsightContext();
    $("contextCountPill").textContent = `${context.recentWaterTests.length + context.recentEvents.length} logs`;
    $("contextSummary").innerHTML = [
      { label: "Tank", value: state.profile.displayVolume ? `${state.profile.displayVolume} gal` : "No volume" },
      { label: "Stock", value: `${context.activeLivestock.length} active` },
      { label: "Latest Test", value: context.latestWaterTest ? RC.formatAge(context.latestWaterTest.measuredAt) : "None" },
      { label: "Water Change", value: context.latestWaterChange ? RC.formatAge(context.latestWaterChange.happenedAt) : "None" },
    ].map((tile) => `
      <div class="context-tile">
        <span>${RC.escapeHtml(tile.label)}</span>
        <strong>${RC.escapeHtml(tile.value)}</strong>
      </div>
    `).join("");
  }

  function renderInsightOutput() {
    const latest = state.insightRuns[0];
    if (!latest) {
      $("insightOutput").innerHTML = `<div class="empty-state">No result yet.</div>`;
      $("insightSourcePill").textContent = RC.supabaseClient ? "GPT ready" : "Local";
      return;
    }
    $("insightSourcePill").textContent = latest.source === "gpt" ? "GPT" : "Local";
    $("insightOutput").innerHTML = state.insightRuns
      .slice(0, 10)
      .map((run, index) => renderInsightRun(run, index))
      .join("");
  }

  function renderInsightCompact(result, source) {
    if (typeof result === "string") {
      return `<article class="insight-card"><strong>${source === "gpt" ? "GPT" : "Local"} insight</strong><p>${RC.escapeHtml(result)}</p></article>`;
    }
    return `
      <article class="insight-card">
        <strong>${RC.escapeHtml(result.headline || "Latest insight")}</strong>
        <p>${RC.escapeHtml(result.summary || "No summary.")}</p>
      </article>
    `;
  }

  function renderInsightRun(run, index) {
    const title = getInsightRunTitle(run);
    return `
      <details class="insight-run"${index === 0 ? " open" : ""}>
        <summary>
          <span>
            <strong>${RC.escapeHtml(title)}</strong>
            <small>${RC.escapeHtml([RC.formatDateTime(run.createdAt), run.source === "gpt" ? "GPT" : "Local", run.mode].filter(Boolean).join(" · "))}</small>
          </span>
          <i data-lucide="chevron-down"></i>
        </summary>
        <div class="insight-run-body">
          ${run.question ? `<article class="insight-card"><strong>Question</strong><p>${RC.escapeHtml(run.question)}</p></article>` : ""}
          ${renderInsightRunPhotos(run)}
          ${renderInsightResult(run.result)}
          ${renderInsightFollowupForm(run)}
          ${renderInsightDebug(run)}
        </div>
      </details>
    `;
  }

  function renderInsightRunPhotos(run) {
    const photos = (Array.isArray(run?.photos) ? run.photos : [])
      .map(RC.normalizePhotoRecord)
      .filter(Boolean);
    if (!photos.length) return "";
    return `
      <article class="insight-card">
        <strong>Attached Photos</strong>
        <div class="stock-photo-grid" data-count="${Math.min(photos.length, 4)}">
          ${photos.slice(0, 4).map((photo, index) => `
            <img src="${RC.escapeHtml(RC.getPhotoSrc(photo))}" alt="${RC.escapeHtml(`Insight photo ${index + 1}`)}" />
          `).join("")}
        </div>
        ${photos.length > 4 ? `<p>${photos.length - 4} more photo${photos.length - 4 === 1 ? "" : "s"}</p>` : ""}
      </article>
    `;
  }

  function renderInsightFollowupForm(run) {
    const runId = run?.id || "";
    return `
      <article class="insight-card insight-followup" data-insight-followup-form="${RC.escapeHtml(runId)}">
        <strong>Follow Up</strong>
        <label>
          Detail / Question
          <textarea
            data-insight-followup-text
            rows="3"
            placeholder="Add a missing detail or ask a follow-up"
          ></textarea>
        </label>
        <button class="secondary-button" type="button" data-insight-followup="${RC.escapeHtml(runId)}">
          <i data-lucide="message-square-plus"></i>
          Send Follow-Up
        </button>
        <details class="collapsible-field photo-field insight-followup-photo-field" data-insight-followup-photo-field="${RC.escapeHtml(runId)}">
          <summary>
            <span>
              <i data-lucide="image-plus"></i>
              Add Photo
            </span>
            <i data-lucide="chevron-down"></i>
          </summary>
          <div class="collapsible-content">
            <label>
              Upload Photo
              <input data-insight-followup-photo="${RC.escapeHtml(runId)}" type="file" accept="image/*" multiple />
            </label>
            <div class="photo-preview" data-photo-kind="insight-followup" data-insight-followup-photo-preview="${RC.escapeHtml(runId)}" data-insight-run-id="${RC.escapeHtml(runId)}" hidden></div>
          </div>
        </details>
      </article>
    `;
  }

  function getInsightRunTitle(run) {
    const question = String(run?.question || "").trim();
    if (question) return shortenText(run.parentInsightId ? `Follow-up: ${question}` : question, 72);
    const summary = getInsightSummary(run?.result);
    if (summary) return shortenText(summary, 72);
    return shortenText(getInsightHeadline(run?.result), 72);
  }

  function shortenText(value, maxLength = 72) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
  }

  function getInsightHeadline(result) {
    if (typeof result === "string") return "Insight";
    return result?.headline || "Tank summary";
  }

  function getInsightSummary(result) {
    if (typeof result === "string") return result;
    return result?.summary || "";
  }

  function renderInsightResult(result) {
    if (typeof result === "string") {
      return `<article class="insight-card"><p>${RC.escapeHtml(result)}</p></article>`;
    }

    const priorities = Array.isArray(result.priorities) ? result.priorities : [];
    const observations = Array.isArray(result.observations) ? result.observations : [];
    const nextActions = Array.isArray(result.next_actions) ? result.next_actions : [];
    const missingData = Array.isArray(result.missing_data) ? result.missing_data : [];
    const dataRequests = Array.isArray(result.data_requests) ? result.data_requests : [];

    return `
      <article class="insight-card">
        <strong>${RC.escapeHtml(result.headline || "Tank summary")}</strong>
        <p>${RC.escapeHtml(result.summary || "No summary.")}</p>
      </article>
      ${priorities.map((priority) => `
        <article class="insight-card" data-tone="${RC.escapeHtml(priority.severity || "warning")}">
          <strong>${RC.escapeHtml(priority.label || "Priority")}</strong>
          <p>${RC.escapeHtml(priority.why || "")}</p>
        </article>
      `).join("")}
      ${renderInsightList("Observations", observations)}
      ${renderInsightList("Next Actions", nextActions)}
      ${renderInsightRequests(dataRequests)}
      ${renderInsightList("Missing Data", missingData)}
    `;
  }

  function renderInsightDebug(run) {
    if (!run.debug) return "";
    return `
      <details class="insight-debug">
        <summary>
          <span>Data Sent</span>
          <i data-lucide="chevron-down"></i>
        </summary>
        <pre>${RC.escapeHtml(JSON.stringify(run.debug, null, 2))}</pre>
      </details>
    `;
  }

  function renderInsightList(title, items) {
    if (!items.length) return "";
    return `
      <article class="insight-card">
        <strong>${RC.escapeHtml(title)}</strong>
        <ul>
          ${items.map((item) => `<li>${RC.escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
    `;
  }

  function renderInsightRequests(requests) {
    if (!requests.length) return "";
    return `
      <article class="insight-card">
        <strong>Data Requests</strong>
        <ul>
          ${requests.map((request) => {
            if (typeof request === "string") return `<li>${RC.escapeHtml(request)}</li>`;
            const label = request.label || request.path || request.data_type || "More context";
            const priority = request.priority ? ` (${request.priority})` : "";
            const path = request.path ? ` — ${request.path}` : "";
            const reason = request.reason ? `: ${request.reason}` : "";
            return `<li>${RC.escapeHtml(`${label}${priority}${path}${reason}`)}</li>`;
          }).join("")}
        </ul>
      </article>
    `;
  }

  function buildRemoteInsightPayload(mode, question, previousRun = null, attachedPhotos = []) {
    const fullContext = buildInsightContext();
    const evidence = buildInsightEvidenceBundles(fullContext, attachedPhotos);
    const context = buildProgressiveInsightContext(fullContext, question, evidence, attachedPhotos);
    if (previousRun) {
      context.conversation_context = summarizeInsightRunForFollowup(previousRun);
    }
    if (attachedPhotos.length) {
      context.request_attachments = {
        photo_count: attachedPhotos.length,
        evidence_path: "current_request.attachments.prompt_photos",
        index_pass_policy: "Prompt-attached image bytes are sent with the first GPT pass. Stored app photos are still request-gated.",
      };
    }
    return {
      context,
      evidence,
    };
  }

  function omitMapFlowLayer(layers = {}) {
    const { flow: _flow, ...rest } = layers || {};
    return rest;
  }

  function summarizeInsightRunForFollowup(run) {
    const result = run?.result;
    const priorities = result && typeof result === "object" && Array.isArray(result.priorities)
      ? result.priorities.map((priority) => ({
          label: priority.label || "",
          severity: priority.severity || "",
          why: priority.why || "",
        }))
      : [];
    return {
      id: run?.id || "",
      created_at: run?.createdAt || "",
      mode: run?.mode || "",
      original_question: run?.question || "",
      source: run?.source || "",
      headline: getInsightHeadline(result),
      summary: getInsightSummary(result),
      priorities,
      observations: result && typeof result === "object" && Array.isArray(result.observations) ? result.observations : [],
      next_actions: result && typeof result === "object" && Array.isArray(result.next_actions) ? result.next_actions : [],
      missing_data: result && typeof result === "object" && Array.isArray(result.missing_data) ? result.missing_data : [],
      data_requests: result && typeof result === "object" && Array.isArray(result.data_requests) ? result.data_requests : [],
    };
  }

  function buildInsightDebugPayload(payload, progressive = null, error = "") {
    return {
      generatedAt: new Date().toISOString(),
      firstPassContextSentToGpt: payload.context,
      evidenceAvailableToFunction: summarizeEvidenceBundlesForDebug(payload.evidence),
      selectedEvidenceSentToGpt: progressive?.provided || [],
      progressive,
      error,
    };
  }

  function summarizeEvidenceBundlesForDebug(evidence) {
    return Object.fromEntries(Object.entries(evidence || {}).map(([key, bundle]) => [
      key,
      {
        path: bundle.path || key,
        parentPath: bundle.parentPath || "",
        label: bundle.label,
        summary: bundle.summary,
        count: bundle.count,
        available: bundle.available,
        terminal: Boolean(bundle.terminal),
      },
    ]));
  }

  function buildProgressiveInsightContext(fullContext, question, evidence, attachedPhotos = []) {
    return {
      generated_at: fullContext.generatedAt,
      context_strategy: {
        phase: "tree_index_plus_selected_evidence",
        mode: INSIGHT_CHAT_MODE,
        question,
        approach: "Use the compact snapshot and evidence tree first. Request only the smallest specific paths needed to answer well.",
        request_format: "Return data_requests with exact path values copied from context_tree.",
        request_limit: 4,
        path_policy: "Prefer one branch deeper at a time. Do not request an entire parent branch when a child path is enough.",
        max_followup_passes: 1,
      },
      canonical_ownership: {
        photos: "Photos live under the object they describe. Livestock photos are under livestock record paths; lighting images are under lighting; prompt photos are under current_request.attachments.",
        placement: "Livestock placement lives under livestock records and is also referenced from map.livestock_placements.",
        overlap: "Care events are canonical under care_logs. Equipment schedules/configuration are canonical under equipment records; care logs can reference equipment.",
      },
      path_conventions: {
        naming_style: "All evidence paths use lower snake_case.",
        equipment_records: "equipment.records.<equipment_key> uses stable snake_case equipment keys such as auto_feeder and uv_sterilizer.",
        livestock_records: "livestock.records.<species_or_name_slug>_<id_suffix> combines a readable slug with a short id suffix for stability.",
        request_paths: "Copy path values exactly from context_tree when requesting more evidence.",
      },
      compact_snapshot: buildCompactInsightSnapshot(fullContext, attachedPhotos),
      context_tree: buildEvidenceTreeIndex(evidence),
    };
  }

  function buildCompactInsightSnapshot(fullContext, attachedPhotos = []) {
    const latest = fullContext.latestWaterTest;
    const activeEquipment = fullContext.profile.equipment || [];
    const activeLivestock = fullContext.activeLivestock || [];
    return {
      tank: {
        name: fullContext.profile.tankName || "Reef Tank",
        display_volume: fullContext.profile.displayVolume || "",
        total_volume: fullContext.profile.totalVolume || "",
        start_date: fullContext.profile.startDate || "",
        style: fullContext.profile.tankStyle || "",
        current_light_phase: fullContext.currentLightPhase,
      },
      parameters: {
        latest_test_at: latest?.measuredAt || "",
        latest_readings: latest ? summarizeWaterTest(latest) : null,
        water_test_count: state.waterTests.length,
      },
      livestock: {
        active_count: activeLivestock.length,
        total_count: fullContext.livestock.length,
        photo_record_count: fullContext.rawDataInventory.livestockPhotos.length,
        placed_count: fullContext.rawDataInventory.map.placedLivestockCount,
      },
      care_logs: summarizeCareLogInventory(fullContext.rawDataInventory.logs),
      equipment: {
        active_count: activeEquipment.length,
        active_labels: activeEquipment.map((item) => item.label),
        details_count: fullContext.rawDataInventory.equipment.detailsCount,
        uv_sterilizer_schedule_available: fullContext.rawDataInventory.equipment.uvScheduleAvailable,
        auto_feeder_schedule_available: Boolean(activeEquipment.find((item) => item.key === "autoFeeder")?.schedule),
      },
      lighting: {
        model: fullContext.profile.lightingContext.model,
        photoperiod: fullContext.profile.lightingContext.photoperiod,
        summary_available: Boolean(fullContext.profile.lightingContext.summary),
        image_count: fullContext.profile.lightingImageCount,
      },
      map: summarizeMapInventory(fullContext.rawDataInventory.map),
      current_request: {
        attached_photo_count: attachedPhotos.length,
      },
    };
  }

  function summarizeCareLogInventory(logs = {}) {
    return {
      water_test_count: logs.waterTestCount || 0,
      feeding_count: logs.feedingCount || 0,
      maintenance_count: logs.maintenanceCount || 0,
      water_change_count: logs.waterChangeCount || 0,
      scheduled_care_task_count: logs.scheduledCareTaskCount || 0,
      overdue_care_task_count: logs.overdueCareTaskCount || 0,
    };
  }

  function summarizeMapInventory(map = {}) {
    return {
      model_available: Boolean(map.modelAvailable),
      model_version: map.modelVersion || 1,
      structure_count: map.structureCount || 0,
      livestock_placement_count: map.placedLivestockCount || 0,
      par_marker_count: map.parMarkerCount || 0,
      refinement_annotation_count: map.refinementAnnotationCount || 0,
      reference_image_count: map.referenceImageCount || 0,
      par_markers_available: Boolean(map.parMapAvailable),
    };
  }

  function summarizeWaterTest(test) {
    if (!test) return null;
    return Object.fromEntries(PARAMETER_FIELDS.map(({ key }) => [key, test[key] ?? null]));
  }

  function buildEvidenceTreeIndex(evidence) {
    const root = {
      path: "reef_context",
      label: "Reef Command context",
      summary: "Canonical tree of app data available for progressive disclosure.",
      children: [],
    };
    const nodes = { reef_context: root };
    Object.values(evidence || {}).forEach((bundle) => {
      const path = bundle.path || "";
      if (!path) return;
      const parts = path.split(".");
      let currentPath = "";
      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}.${part}` : part;
        if (!nodes[currentPath]) {
          const parentPath = index ? parts.slice(0, index).join(".") : "reef_context";
          const node = {
            path: currentPath,
            label: titleFromPathSegment(part),
            summary: "",
            count: 0,
            available: true,
            terminal: false,
            children: [],
          };
          nodes[currentPath] = node;
          nodes[parentPath]?.children.push(node);
        }
      });
      const node = nodes[path];
      Object.assign(node, {
        label: bundle.label || node.label,
        summary: bundle.summary || node.summary,
        count: bundle.count || 0,
        available: bundle.available !== false,
        terminal: Boolean(bundle.terminal),
      });
    });
    sortEvidenceTree(root);
    return root;
  }

  function sortEvidenceTree(node) {
    if (!node?.children?.length) return;
    node.children.sort((a, b) => a.path.localeCompare(b.path));
    node.children.forEach(sortEvidenceTree);
  }

  function titleFromPathSegment(segment) {
    return String(segment || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function summarizeInsightMapModel(mapModel) {
    return {
      dimensions: mapModel.dimensions,
      coordinateSystem: mapModel.coordinateSystem,
      calibration: mapModel.calibration,
      structures: (mapModel.structures || []).map((structure) => ({
        id: structure.id,
        name: structure.name,
        type: structure.type,
        position: structure.position,
        size: structure.size,
        light: structure.light,
        parRange: structure.parRange,
        notes: structure.notes,
      })),
      parMarkers: mapModel.parMarkers,
      refinementAnnotationCount: mapModel.refinementAnnotations?.length || 0,
      livestockPlacements: mapModel.livestockPlacements,
      layers: omitMapFlowLayer(mapModel.layers),
      geometryIncluded: false,
      detailBundle: "map_model_detail",
    };
  }

  function selectInsightEventsForIndex(events, mode) {
    if (mode === "maintenance") {
      return events
        .filter((event) => event.type === "maintenance" || event.type === "water_change")
        .slice(0, 30);
    }
    if (mode === "trends") {
      return events
        .filter((event) => event.type === "feeding" || event.type === "maintenance" || event.type === "water_change")
        .slice(0, 30);
    }
    return events.slice(0, 20);
  }

  function buildInsightEvidenceBundles(fullContext, attachedPhotos = []) {
    const sortedTests = [...state.waterTests]
      .sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))
      .slice(0, 90);
    const sortedEvents = [...state.events]
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))
      .slice(0, 120);
    const feedingLogs = sortedEvents.filter((event) => event.type === "feeding");
    const maintenanceLogs = sortedEvents.filter((event) => event.type === "maintenance");
    const waterChangeLogs = sortedEvents.filter((event) => event.type === "water_change");
    const activeEquipment = RC.getEquipmentProfiles().filter((item) => item.active);
    const lightingEvidence = RC.getLightingPhotos().map((photo, index) =>
      buildPhotoEvidenceRecord(photo, `lighting-${index}`, "Lighting schedule image"),
    );
    const livestockPhotoEvidence = state.livestock
      .map((item) => ({
        id: item.id,
        species: item.species || item.name || "Unknown",
        category: item.category || "Other",
        status: item.status || "",
        photos: RC.getLivestockPhotos(item).map((photo, index) =>
          buildPhotoEvidenceRecord(photo, `${item.id}-${index}`, `${item.species || "Stock"} photo ${index + 1}`),
        ),
      }))
      .filter((item) => item.photos.length);
    const insightPromptPhotoEvidence = attachedPhotos
      .map((photo, index) => buildPhotoEvidenceRecord(photo, `insight-prompt-${index}`, `Prompt photo ${index + 1}`, { includeDataUrl: true }))
      .filter((photo) => photo.imageUrl || photo.inlineImageAvailable);

    const evidence = {};
    const add = (path, label, summary, content, options = {}) => {
      evidence[path] = {
        path,
        parentPath: getParentPath(path),
        label,
        summary,
        count: options.count ?? inferEvidenceCount(content),
        available: options.available ?? true,
        terminal: options.terminal ?? true,
        content,
      };
    };

    add("tank", "Tank", "Tank identity, age, volume, operating targets, and notes.", {
      identity: pickKeys(fullContext.profile, ["tankName", "tankStyle", "startDate"]),
      volume: pickKeys(fullContext.profile, ["displayVolume", "totalVolume"]),
      currentLightPhase: fullContext.currentLightPhase,
    }, { terminal: false });
    add("tank.profile", "Tank Profile", "Tank name, style, volume, start date, and summary notes.", {
      identity: pickKeys(fullContext.profile, ["tankName", "tankStyle", "startDate"]),
      volume: pickKeys(fullContext.profile, ["displayVolume", "totalVolume"]),
      tankSummary: fullContext.profile.tankSummary || "",
    });
    add("tank.operating_targets", "Operating Targets", "Salinity, temperature, salt, dosing, and profile notes.", {
      targetSalinity: fullContext.profile.targetSalinity || "",
      targetTemp: fullContext.profile.targetTemp || "",
      saltMix: fullContext.profile.saltMix || "",
      dosing: fullContext.profile.dosing || "",
      notes: fullContext.profile.notes || "",
    });

    add("parameters", "Parameters", `${sortedTests.length} water test record${sortedTests.length === 1 ? "" : "s"} available.`, {
      latest: fullContext.latestWaterTest ? summarizeWaterTest(fullContext.latestWaterTest) : null,
      testCount: state.waterTests.length,
    }, { count: state.waterTests.length, available: sortedTests.length > 0, terminal: false });
    add("parameters.latest", "Latest Readings", "Latest water test values and timing context.", fullContext.latestWaterTest, {
      count: fullContext.latestWaterTest ? 1 : 0,
      available: Boolean(fullContext.latestWaterTest),
    });
    add("parameters.testing_cadence", "Testing Cadence", "Water-test count and recency summary.", {
      totalCount: state.waterTests.length,
      latestMeasuredAt: fullContext.latestWaterTest?.measuredAt || "",
      latestAge: fullContext.latestWaterTest ? RC.formatAge(fullContext.latestWaterTest.measuredAt) : "",
      recentSampleDates: sortedTests.slice(0, 12).map((test) => test.measuredAt),
    }, { count: state.waterTests.length, available: sortedTests.length > 0 });
    add("parameters.full_test_records", "Full Test Records", "Most recent raw water test records with timing context.", sortedTests, {
      count: sortedTests.length,
      available: sortedTests.length > 0,
    });
    add("parameters.trends", "Parameter Trends", "Per-parameter time series branches for logged water tests.", {
      parameters: PARAMETER_FIELDS.map(({ key, label, unit }) => ({
        path: `parameters.trends.${pathSegment(key)}`,
        key,
        label,
        unit,
        count: buildParameterSeries(sortedTests, key).length,
      })),
    }, {
      count: PARAMETER_FIELDS.length,
      available: sortedTests.length > 0,
      terminal: false,
    });
    PARAMETER_FIELDS.forEach(({ key, label, unit }) => {
      const series = buildParameterSeries(sortedTests, key);
      add(`parameters.trends.${pathSegment(key)}`, `${label} Trend`, `${series.length} logged ${label}${unit ? ` ${unit}` : ""} value${series.length === 1 ? "" : "s"}.`, {
        parameter: key,
        label,
        unit,
        series,
        summary: summarizeParameterSeries(series),
      }, {
        count: series.length,
        available: series.length > 0,
      });
    });

    const placementById = new Map(fullContext.mapModel.livestockPlacements.map((placement) => [placement.id, placement]));
    const livestockIndex = fullContext.livestock.map((item) => ({
      id: item.id,
      species: item.species || item.name || "Unknown",
      category: item.category || "Other",
      status: item.status || "",
      health: item.health || "",
      growthTrend: item.growthTrend || "",
      photoCount: item.photoCount || 0,
      placementAvailable: Boolean(placementById.get(item.id)?.coordinateInches),
      path: `livestock.records.${livestockPathSegment(item)}`,
    }));
    add("livestock", "Livestock", `${fullContext.activeLivestock.length} active lifecycle livestock; ${fullContext.livestock.length} total records.`, {
      activeCount: fullContext.activeLivestock.length,
      totalCount: fullContext.livestock.length,
      categoryCounts: countBy(fullContext.livestock, (item) => item.category || "Other"),
      statusCounts: countBy(fullContext.livestock, (item) => item.status || "unknown"),
    }, { count: fullContext.livestock.length, available: fullContext.livestock.length > 0, terminal: false });
    add("livestock.records", "Livestock Records", "Individual livestock record branches with identity, health, growth, placement, photos, and related logs.", {
      indexPath: "livestock.records.index",
      recordCount: livestockIndex.length,
    }, {
      count: livestockIndex.length,
      available: livestockIndex.length > 0,
      terminal: false,
    });
    add("livestock.records.index", "Livestock Record Index", "Compact list of livestock identities, status, photo availability, and record paths.", livestockIndex, {
      count: livestockIndex.length,
      available: livestockIndex.length > 0,
    });
    fullContext.livestock.forEach((item) => {
      const original = state.livestock.find((entry) => entry.id === item.id) || item;
      const recordPath = `livestock.records.${livestockPathSegment(item)}`;
      const placement = placementById.get(item.id) || null;
      const photos = RC.getLivestockPhotos(original).map((photo, index) =>
        buildPhotoEvidenceRecord(photo, `${item.id}-${index}`, `${item.species || item.name || "Stock"} photo ${index + 1}`),
      );
      add(recordPath, item.species || item.name || "Livestock Record", "Individual livestock identity, status, health, growth, notes, placement, and photo availability.", {
        ...item,
        placement,
        photoCount: photos.length,
      }, { terminal: false });
      add(`${recordPath}.placement`, `${item.species || item.name || "Livestock"} Placement`, "Zone and map placement for this livestock record.", placement, {
        count: placement ? 1 : 0,
        available: Boolean(placement),
      });
      add(`${recordPath}.photos`, `${item.species || item.name || "Livestock"} Photos`, `${photos.length} stored photo record${photos.length === 1 ? "" : "s"} for this livestock item.`, photos, {
        count: photos.length,
        available: photos.length > 0,
      });
      add(`${recordPath}.related_logs`, `${item.species || item.name || "Livestock"} Related Logs`, "Care logs whose label, target, or notes mention this livestock item.", getRelatedLogsForLivestock(item, sortedEvents), {
        available: true,
      });
    });

    const autoFeeder = activeEquipment.find((item) => item.key === "autoFeeder") || null;
    add("care_logs", "Care Logs", "Feeding, water-change, maintenance, and care task history.", {
      counts: fullContext.rawDataInventory.logs,
      latestFeeding: fullContext.latestFeeding,
      latestWaterChange: fullContext.latestWaterChange,
    }, { terminal: false });
    add("care_logs.feeding", "Feeding Logs", `${feedingLogs.length} recent feeding event${feedingLogs.length === 1 ? "" : "s"}.`, {
      summary: summarizeEvents(feedingLogs),
      relatedEquipmentRefs: autoFeeder ? ["equipment.records.auto_feeder"] : [],
    }, { count: feedingLogs.length, available: feedingLogs.length > 0, terminal: false });
    add("care_logs.feeding.recent_events", "Recent Feeding Events", "Recent feeding log entries.", feedingLogs.slice(0, 30), {
      count: feedingLogs.length,
      available: feedingLogs.length > 0,
    });
    add("care_logs.feeding.full_events", "Full Feeding Events", "All retained feeding log entries.", feedingLogs, {
      count: feedingLogs.length,
      available: feedingLogs.length > 0,
    });
    add("care_logs.water_changes", "Water Changes", `${waterChangeLogs.length} recent water-change event${waterChangeLogs.length === 1 ? "" : "s"}.`, {
      summary: summarizeEvents(waterChangeLogs),
    }, { count: waterChangeLogs.length, available: waterChangeLogs.length > 0, terminal: false });
    add("care_logs.water_changes.recent_events", "Recent Water Changes", "Recent water-change entries.", waterChangeLogs.slice(0, 30), {
      count: waterChangeLogs.length,
      available: waterChangeLogs.length > 0,
    });
    add("care_logs.water_changes.full_events", "Full Water Changes", "All retained water-change entries.", waterChangeLogs, {
      count: waterChangeLogs.length,
      available: waterChangeLogs.length > 0,
    });
    add("care_logs.maintenance", "Maintenance Logs", `${maintenanceLogs.length} recent maintenance event${maintenanceLogs.length === 1 ? "" : "s"}.`, {
      summary: summarizeEvents(maintenanceLogs),
    }, { count: maintenanceLogs.length, available: maintenanceLogs.length > 0, terminal: false });
    add("care_logs.maintenance.recent_events", "Recent Maintenance Events", "Recent maintenance log entries.", maintenanceLogs.slice(0, 30), {
      count: maintenanceLogs.length,
      available: maintenanceLogs.length > 0,
    });
    add("care_logs.maintenance.full_events", "Full Maintenance Events", "All retained maintenance log entries.", maintenanceLogs, {
      count: maintenanceLogs.length,
      available: maintenanceLogs.length > 0,
    });
    add("care_logs.care_tasks.schedule_status", "Care Task Schedule Status", "Logged cadence and overdue status for scheduled care tasks.", fullContext.careTasks, {
      count: fullContext.careTasks.length,
      available: fullContext.careTasks.length > 0,
    });

    const equipment = RC.getEquipmentProfiles();
    add("equipment", "Equipment", `${activeEquipment.length} active equipment record${activeEquipment.length === 1 ? "" : "s"}.`, {
      activeCount: activeEquipment.length,
      activeLabels: activeEquipment.map((item) => item.label),
      detailCount: activeEquipment.filter((item) => item.details).length,
    }, { count: equipment.length, available: equipment.length > 0, terminal: false });
    add("equipment.records", "Equipment Records", "Individual equipment branches with status, added date, details, and schedules.", {
      recordCount: equipment.length,
      activeCount: activeEquipment.length,
      indexPath: "equipment.records.index",
    }, {
      count: equipment.length,
      available: equipment.length > 0,
      terminal: false,
    });
    add("equipment.records.index", "Equipment Record Index", "Compact list of equipment status, date, details, and schedule availability.", equipment.map((item) => ({
      key: item.key,
      path: `equipment.records.${pathSegment(item.key)}`,
      label: item.label,
      active: item.active,
      status: item.status,
      hasDetails: Boolean(item.details),
      hasSchedule: Boolean(item.schedule),
    })), { count: equipment.length, available: equipment.length > 0 });
    equipment.forEach((item) => {
      const recordPath = `equipment.records.${pathSegment(item.key)}`;
      add(recordPath, item.label, "Individual equipment status, date, details, and schedule reference.", item, {
        count: 1,
        available: true,
        terminal: false,
      });
      add(`${recordPath}.details`, `${item.label} Details`, "Detailed notes/specs for this equipment record.", item.details || "", {
        count: item.details ? 1 : 0,
        available: Boolean(item.details),
      });
      if (item.schedule) {
        add(`${recordPath}.schedule`, `${item.label} Schedule`, "Schedule/configuration for this equipment record.", item.schedule, {
          count: 1,
          available: true,
        });
      }
    });

    add("lighting", "Lighting", "Lighting model, photoperiod, summary notes, and lighting images.", fullContext.profile.lightingContext, {
      terminal: false,
    });
    add("lighting.schedule_summary", "Lighting Schedule Summary", "Model, photoperiod, and summarized lighting notes.", fullContext.profile.lightingContext);
    add("lighting.images", "Lighting Images", `${lightingEvidence.length} stored lighting image record${lightingEvidence.length === 1 ? "" : "s"}.`, lightingEvidence, {
      count: lightingEvidence.length,
      available: lightingEvidence.length > 0,
    });

    add("map", "Map", "Tank dimensions, aquascape, PAR markers, livestock placements, and geometry detail.", summarizeInsightMapModel(fullContext.mapModel), {
      terminal: false,
    });
    add("map.tank_dimensions", "Map Tank Dimensions", "Mapped tank dimensions and coordinate system.", {
      dimensions: fullContext.mapModel.dimensions,
      coordinateSystem: fullContext.mapModel.coordinateSystem,
      calibration: fullContext.mapModel.calibration,
    });
    add("map.structures", "Aquascape Structures", "Mapped rock/aquascape structures with light and PAR context.", fullContext.mapModel.structures.map((structure) => ({
      id: structure.id,
      name: structure.name,
      type: structure.type,
      position: structure.position,
      size: structure.size,
      light: structure.light,
      parRange: structure.parRange,
      notes: structure.notes,
    })), {
      count: fullContext.mapModel.structures.length,
      available: fullContext.mapModel.structures.length > 0,
    });
    add("map.par_markers", "PAR Markers", "PAR marker values and coordinates.", fullContext.mapModel.parMarkers, {
      count: fullContext.mapModel.parMarkers.length,
      available: fullContext.mapModel.parMarkers.length > 0,
    });
    add("map.livestock_placements", "Map Livestock Placements", "Map placement coordinates for livestock records.", fullContext.mapModel.livestockPlacements, {
      count: fullContext.mapModel.livestockPlacements.length,
      available: fullContext.mapModel.livestockPlacements.length > 0,
    });
    add("map.geometry_detail", "Map Geometry Detail", "Full aquascape geometry, refinement annotations, and structure detail.", fullContext.mapModel, {
      count: fullContext.mapModel.structures.length,
      available: true,
    });

    add("current_request", "Current Request", "Current question and its attachments.", {
      attachedPhotoCount: insightPromptPhotoEvidence.length,
    }, { count: insightPromptPhotoEvidence.length, available: true, terminal: false });
    add("current_request.attachments", "Current Request Attachments", "Files attached to the current question.", {
      promptPhotoCount: insightPromptPhotoEvidence.length,
    }, { count: insightPromptPhotoEvidence.length, available: insightPromptPhotoEvidence.length > 0, terminal: false });
    add("current_request.attachments.prompt_photos", "Current Prompt Photos", `${insightPromptPhotoEvidence.length} photo${insightPromptPhotoEvidence.length === 1 ? "" : "s"} attached to the current insight request.`, insightPromptPhotoEvidence, {
      count: insightPromptPhotoEvidence.length,
      available: insightPromptPhotoEvidence.length > 0,
    });

    return evidence;
  }

  function getParentPath(path) {
    const parts = String(path || "").split(".");
    parts.pop();
    return parts.join(".");
  }

  function inferEvidenceCount(content) {
    if (Array.isArray(content)) return content.length;
    if (content && typeof content === "object") return Object.keys(content).length;
    return content ? 1 : 0;
  }

  function pickKeys(source, keys) {
    return Object.fromEntries(keys.map((key) => [key, source?.[key] ?? ""]));
  }

  function pathSegment(value) {
    return String(value || "item")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      || "item";
  }

  function livestockPathSegment(item) {
    const name = pathSegment(item.species || item.name || "livestock").slice(0, 36);
    const id = pathSegment(item.id || "").slice(-8);
    return [name || "livestock", id].filter(Boolean).join("_");
  }

  function countBy(items, getKey) {
    return items.reduce((counts, item) => {
      const key = getKey(item) || "unknown";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  function buildParameterSeries(tests, key) {
    return tests
      .map((test) => ({
        measuredAt: test.measuredAt,
        value: test[key] ?? "",
        notes: test.notes || "",
        timing: test.timing || {},
      }))
      .filter((entry) => entry.value !== null && entry.value !== "");
  }

  function summarizeParameterSeries(series) {
    const values = series.map((entry) => Number(entry.value)).filter(Number.isFinite);
    return {
      count: series.length,
      latest: series[0] || null,
      previous: series[1] || null,
      numericMin: values.length ? Math.min(...values) : null,
      numericMax: values.length ? Math.max(...values) : null,
    };
  }

  function summarizeEvents(events) {
    return {
      count: events.length,
      latest: events[0] || null,
      recentLabels: events.slice(0, 8).map((event) => [event.label, RC.formatDateTime(event.happenedAt)].filter(Boolean).join(" · ")),
    };
  }

  function getRelatedLogsForLivestock(item, events) {
    const terms = [item.species, item.name].filter(Boolean).map((value) => String(value).toLowerCase());
    if (!terms.length) return [];
    return events.filter((event) => {
      const text = [event.label, event.target, event.notes, event.details].filter(Boolean).join(" ").toLowerCase();
      return terms.some((term) => term && text.includes(term));
    });
  }

  function buildPhotoEvidenceRecord(photo, id, label, options = {}) {
    const normalized = RC.normalizePhotoRecord(photo);
    const publicUrl = normalized?.path ? RC.getStoragePublicUrl(normalized.path) : "";
    const dataUrl = options.includeDataUrl && normalized?.dataUrl ? normalized.dataUrl : "";
    return {
      id,
      label,
      storagePath: normalized?.path || "",
      publicUrl,
      dataUrl,
      imageUrl: publicUrl || dataUrl,
      inlineImageAvailable: Boolean(normalized?.dataUrl),
      imageBytesAvailableToFunction: Boolean(dataUrl),
      sentAsImage: false,
    };
  }

  function buildInsightContext() {
    const recentWaterTests = [...state.waterTests]
      .sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))
      .slice(0, 30);
    const recentEvents = [...state.events]
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))
      .slice(0, 50);
    const latestWaterTest = recentWaterTests[0] || null;
    const latestWaterChange = RC.getLatestEvent("water_change");
    const latestFeeding = RC.getLatestEvent("feeding");
    const { lightingPhotoDataUrl, lightingPhoto, lightingPhotos, ...profile } = state.profile;
    const lightingImageCount = RC.getLightingPhotos().length;
    const equipment = RC.getEquipmentProfiles();
    const activeEquipment = equipment.filter((item) => item.active);
    const careTasks = RC.getCareTaskStatuses();
    const livestockPhotoInventory = [];
    const livestock = state.livestock.map((item) => {
      const { photoDataUrl, photos, ...safeItem } = item;
      const photoCount = RC.getLivestockPhotos(item).length;
      if (photoCount) {
        livestockPhotoInventory.push({
          id: item.id,
          species: item.species || item.name || "Unknown",
          category: item.category || "Other",
          status: item.status || "",
          photoCount,
          currentness: "unknown",
        });
      }
      return {
        ...safeItem,
        photoCount,
        hasPhoto: photoCount > 0,
      };
    });
    const mapPlacements = RC.Map.getLivestockMapPlacements().map((placement) => ({
      id: placement.id,
      species: placement.species,
      category: placement.category,
      zone: placement.zone || "",
      structureId: placement.structure?.id || "",
      structureName: placement.structure?.name || "",
      coordinateInches: placement.anchor
        ? {
            x: Number(placement.anchor.x.toFixed(2)),
            y: Number(placement.anchor.y.toFixed(2)),
            z: Number(placement.anchor.z.toFixed(2)),
          }
        : null,
      health: placement.health,
      growth: placement.growth,
      source: placement.manual ? "manual" : placement.anchor ? "zone_estimate" : "unplaced",
    }));
    const parMarkers = (state.map.parMarkers || []).map((marker) => ({
      id: marker.id,
      value: marker.value,
      note: marker.note || "",
      measuredAt: marker.measuredAt || "",
      structureId: marker.structureId || "",
      structureName: marker.structureId ? RC.Map.getMapStructureName(marker.structureId) : "",
      coordinateInches: {
        x: Number(Number(marker.x).toFixed(2)),
        y: Number(Number(marker.y).toFixed(2)),
        z: Number(Number(marker.z).toFixed(2)),
      },
    }));
    const refinementAnnotations = RC.Map.getMap2RefinementAnnotationsForCurrentGeometry().map((annotation) => ({
      id: annotation.id,
      structureId: annotation.structureId || "",
      structureName: annotation.structureId ? RC.Map.getMapStructureName(annotation.structureId) : annotation.structureName || "",
      shape: annotation.shape,
      action: annotation.action,
      direction: annotation.direction,
      strength: annotation.strength,
      radiusInches: annotation.radius,
      geometryBase: annotation.geometryBase || "",
      note: annotation.note || "",
      pointCount: annotation.points?.length || 0,
      localPoints: (annotation.points || []).map((point) => ({
        x: Number(Number(point.x).toFixed(2)),
        y: Number(Number(point.y).toFixed(2)),
        z: Number(Number(point.z).toFixed(2)),
      })),
    }));
    const mapModel = {
      dimensions: state.map.dimensions,
      coordinateSystem: {
        x: "left/right across front glass",
        y: "front/back depth; negative is front glass, positive is back glass",
        z: "vertical inches from tank bottom",
      },
      calibration: {
        source: "five-rock outline-driven mesh from traced front/top/right silhouettes, calibrated with 3 inch cards and the 2 inch in-tank ruler",
        referenceImageCount: 28,
        rawReferenceImagesStoredInApp: false,
      },
      structures: state.map.structures.map((structure) => {
        const option5SideRock = structure.id === "left-rock" || structure.id === "right-rock";
        return {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          position: { x: structure.x, y: structure.y, z: structure.z },
          size: { width: structure.width, depth: structure.depth, height: structure.height },
          geometry: {
            method: option5SideRock ? "option-5-silhouette-refined-map2-base" : undefined,
            footprint: structure.footprint,
            bottomProfile: structure.bottomProfile,
            frontProfile: structure.frontProfile,
            sideProfile: structure.sideProfile,
            heightPoints: structure.heightPoints,
            ridges: structure.ridges,
            depressions: structure.depressions,
            troughs: structure.troughs,
            edgeSoftness: structure.edgeSoftness,
            edgeFloor: structure.edgeFloor,
            reliefMin: structure.reliefMin,
            reliefMax: structure.reliefMax,
            meshResolution: structure.meshResolution,
            surfaceNoise: structure.surfaceNoise,
            cragStrength: structure.cragStrength,
            scanHeightStrength: option5SideRock ? undefined : structure.scanHeightStrength,
            scanHeightContrast: option5SideRock ? undefined : structure.scanHeightContrast,
            scanHeightInvert: option5SideRock ? undefined : structure.scanHeightInvert,
            terraceStrength: structure.terraceStrength,
            terraceBands: structure.terraceBands,
            scanHeightMap: !option5SideRock && structure.scanHeightMap
              ? {
                  rows: structure.scanHeightMap.rows,
                  columns: structure.scanHeightMap.columns,
                  source: structure.scanHeightMap.source,
                }
              : null,
          },
          light: structure.light,
          parRange: { min: structure.parMin, max: structure.parMax },
          notes: structure.notes,
        };
      }),
      parMarkers,
      refinementAnnotations,
      livestockPlacements: mapPlacements,
      layers: omitMapFlowLayer(state.map.layers),
    };

    return {
      generatedAt: new Date().toISOString(),
      profile: {
        ...profile,
        equipment: activeEquipment,
        lightingImageCount,
        hasLightingScreenshot: lightingImageCount > 0,
        lightingContext: {
          model: state.profile.lightingModel || "",
          photoperiod: {
            lightsOn: state.profile.lightStart || "",
            lightsOff: state.profile.lightEnd || "",
          },
          summary: state.profile.lightingSummary || "",
          sourceImageCount: lightingImageCount,
        },
      },
      zones: state.zones.map(({ flow: _flow, ...zone }) => zone),
      mapModel,
      livestock,
      activeLivestock: livestock.filter((item) => RC.isLifecycleStock(item) && item.status === "active"),
      recentWaterTests,
      recentEvents,
      latestWaterTest,
      latestWaterChange,
      latestFeeding,
      careTasks,
      overdueCareTasks: careTasks.filter((task) => task.overdue),
      currentLightPhase: RC.getLightPhase().label,
      rawDataInventory: {
        lighting: {
          imageCount: lightingImageCount,
          summaryAvailable: Boolean(state.profile.lightingSummary),
          canRequestRawImages: lightingImageCount > 0,
        },
        livestockPhotos: livestockPhotoInventory,
        map: {
          modelAvailable: true,
          modelVersion: state.map.modelVersion || 1,
          structureCount: state.map.structures.length,
          placedLivestockCount: mapPlacements.filter((placement) => placement.coordinateInches).length,
          parMarkerCount: parMarkers.length,
          refinementAnnotationCount: refinementAnnotations.length,
          referenceImageCount: 18,
          canRequestRawReferenceImages: false,
          parMapAvailable: parMarkers.length > 0 || state.zones.some((zone) => zone.parMin || zone.parMax),
        },
        logs: {
          waterTestCount: state.waterTests.length,
          feedingCount: state.events.filter((event) => event.type === "feeding").length,
          maintenanceCount: state.events.filter((event) => event.type === "maintenance").length,
          waterChangeCount: state.events.filter((event) => event.type === "water_change").length,
          scheduledCareTaskCount: careTasks.filter((task) => !task.manualOnly).length,
          overdueCareTaskCount: careTasks.filter((task) => task.overdue).length,
        },
        equipment: {
          activeCount: activeEquipment.length,
          datedCount: activeEquipment.filter((item) => item.addedDate && !item.isLegacy).length,
          legacyCount: activeEquipment.filter((item) => item.isLegacy).length,
          detailsCount: activeEquipment.filter((item) => item.details).length,
          uvScheduleAvailable: Boolean(equipment.find((item) => item.key === "uvSterilizer" && item.active)?.schedule),
        },
      },
      derived: latestWaterTest
        ? {
            latestTestLightPhase: latestWaterTest.timing?.lightPhase || RC.getLightPhase(latestWaterTest.measuredAt).label,
            latestTestAfterWaterChange: RC.describeTimeAfter(RC.getLatestEventBefore("water_change", latestWaterTest.measuredAt), latestWaterTest.measuredAt),
            latestTestAfterFeeding: RC.describeTimeAfter(RC.getLatestEventBefore("feeding", latestWaterTest.measuredAt), latestWaterTest.measuredAt),
          }
        : {},
    };
  }

  function generateLocalInsight(mode, question, previousRun = null) {
    const context = buildInsightContext();
    const priorities = [];
    const observations = [];
    const nextActions = [];
    const missingData = [];
    const dataRequests = [];
    const latest = context.latestWaterTest;
    const overdueCareTasks = Array.isArray(context.overdueCareTasks) ? context.overdueCareTasks : [];

    observations.push("Logged events are evidence of occurrence, but absent logs are unknown and should not be treated as proof that feeding, maintenance, or other care did not happen.");
    if (previousRun) {
      observations.push(`Follow-up to ${RC.formatDateTime(previousRun.createdAt)} insight: ${getInsightHeadline(previousRun.result)}.`);
    }

    if (!context.profile.displayVolume) missingData.push("Display volume");
    if (!context.profile.filtration) missingData.push("Filtration type");
    if (!context.profile.lightingModel) missingData.push("Lighting model");
    if (!context.profile.hasLightingScreenshot) missingData.push("Lighting screenshot or intensity schedule");
    if (context.profile.uvSterilizer && !context.profile.uvSchedule) missingData.push("UV schedule");
    if (context.profile.lightingImageCount && !context.profile.lightingSummary) {
      missingData.push("Lighting summary from schedule images");
      dataRequests.push({
        label: "Lighting schedule images",
        path: "lighting.images",
        reason: "Lighting images exist, but the compact lighting summary is empty.",
        priority: "medium",
      });
    }
    if (
      context.activeLivestock.length &&
      !context.mapModel.livestockPlacements.some((placement) => placement.coordinateInches)
    ) {
      missingData.push("Map stock placements");
    }
    if (!latest) missingData.push("Recent water test");
    overdueCareTasks.forEach((task) => {
      priorities.push({
        label: task.overdueLabel || `${task.label} overdue`,
        severity: "warning",
        why: task.lastAt
          ? `${task.label} was last logged ${RC.formatAge(task.lastAt)}; the planned cadence is every ${task.intervalDays} days.`
          : `${task.label} has no logged completion yet. This means not logged, not necessarily not done.`,
      });
    });

    if (latest) {
      if (latest.ammonia !== null && latest.ammonia > 0.05) {
        priorities.push({
          label: "Ammonia detected",
          severity: "danger",
          why: "Any detectable ammonia is worth verifying quickly, especially if livestock behavior changed.",
        });
        nextActions.push("Retest ammonia, verify the kit result, and avoid large new additions until the reading is explained.");
      }
      if (latest.nitrite !== null && latest.nitrite > 0.05) {
        priorities.push({
          label: "Nitrite detected",
          severity: "danger",
          why: "Nitrite can indicate the biofilter is not keeping up or a recent disruption occurred.",
        });
      }
      if (latest.nitrate !== null && latest.nitrate > 30) {
        priorities.push({
          label: "Nitrate elevated",
          severity: "warning",
          why: "Nitrate above 30 ppm can be acceptable in some systems, but the trend matters for coral response and algae pressure.",
        });
        nextActions.push("Compare nitrate against feeding volume and the timing of the most recent water change.");
      }

      observations.push(`Latest test vs last logged water change: ${context.derived.latestTestAfterWaterChange}.`);
      observations.push(`Latest test vs last logged feeding: ${context.derived.latestTestAfterFeeding}.`);
      observations.push(`Lighting phase at the latest test: ${context.derived.latestTestLightPhase}.`);
    }

    const waterChangeAge = context.latestWaterChange ? RC.daysSince(context.latestWaterChange.happenedAt) : null;
    if (waterChangeAge !== null && waterChangeAge > 21) {
      priorities.push({
        label: "Water change cadence",
        severity: "warning",
        why: `The last logged water change was ${waterChangeAge} days ago.`,
      });
    }

    if (question) observations.push(`User question: ${question}`);

    if (!priorities.length) {
      priorities.push({
        label: "No urgent local alerts",
        severity: "good",
        why: "The local rule check did not find detectable ammonia or nitrite in logged tests. Unlogged care is unknown, not assumed absent.",
      });
    }
    if (!nextActions.length) {
      nextActions.push("Log the next water test with a timestamp and keep feeding and water changes in the same timeline.");
    }

    return {
      headline: "Draft answer",
      summary: "This local draft uses simple rules. GPT insights will use the same context with better reasoning once the Supabase function is connected.",
      priorities,
      observations,
      next_actions: nextActions,
      missing_data: [...new Set(missingData)],
      data_requests: dataRequests,
    };
  }

  async function generateInsight() {
    const mode = INSIGHT_CHAT_MODE;
    const question = $("insightQuestion").value.trim();
    await runInsightRequest({
      mode,
      question,
      attachedPhotos: RC.getPendingInsightPhotos(),
      clearAttachedPhotos: RC.clearPendingInsightPhotos,
      button: $("generateInsightButton"),
      loadingText: "Generating",
      idleHtml: `<i data-lucide="sparkles"></i>Generate`,
    });
  }

  async function generateFollowupInsight(runId = "", trigger = null) {
    const previousRun = state.insightRuns.find((run) => run.id === runId) || state.insightRuns[0];
    if (!previousRun) {
      RC.showToast("Generate an insight first.");
      return;
    }
    const form = trigger?.closest?.("[data-insight-followup-form]") || RC.getInsightFollowupForm(previousRun.id);
    const textarea = form?.querySelector("[data-insight-followup-text]");
    const question = (textarea?.value || "").trim();
    const attachedPhotos = RC.getPendingInsightFollowupPhotos(previousRun.id);
    if (!question && !attachedPhotos.length) {
      RC.showToast("Add a follow-up detail, question, or photo.");
      return;
    }
    await runInsightRequest({
      mode: previousRun.mode || INSIGHT_CHAT_MODE,
      question,
      previousRun,
      attachedPhotos,
      clearAttachedPhotos: () => RC.clearPendingInsightFollowupPhotos(previousRun.id),
      button: trigger,
      loadingText: "Sending",
      idleHtml: `<i data-lucide="message-square-plus"></i>Send Follow-Up`,
    });
    if (textarea) textarea.value = "";
  }

  async function storeInsightRun({ mode, question, previousRun, source, result, debug }, attachedPhotos, clearAttachedPhotos) {
    const id = RC.uid();
    let photos = [];
    try {
      photos = await RC.prepareInsightPhotosForSave(id, attachedPhotos);
    } catch (error) {
      console.warn("Could not store insight photos", error);
      photos = attachedPhotos;
    }

    state.insightRuns.unshift({
      id,
      createdAt: new Date().toISOString(),
      mode,
      question,
      parentInsightId: previousRun?.id || "",
      source,
      result,
      debug,
      photos,
    });
    state.insightRuns = state.insightRuns.slice(0, 20);
    if (clearAttachedPhotos) clearAttachedPhotos();
    RC.saveState();
    renderInsightOutput();
    renderHomeInsightBrief();
  }

  async function runInsightRequest({ mode, question, previousRun = null, attachedPhotos = [], clearAttachedPhotos = null, button, loadingText, idleHtml }) {
    if (button) {
      button.disabled = true;
      button.textContent = loadingText;
    }
    const payload = buildRemoteInsightPayload(mode, question, previousRun, attachedPhotos);

    try {
      let result;
      let source = "local";
      let debug;
      if (RC.supabaseClient) {
        const response = await RC.supabaseClient.functions.invoke("generate-insights", {
          body: {
            mode,
            question,
            state: payload.context,
            evidence: payload.evidence,
          },
        });
        if (response.error) throw response.error;
        result = response.data?.insight || response.data?.text || response.data;
        debug = buildInsightDebugPayload(payload, response.data?.progressive || null);
        source = "gpt";
      } else {
        result = generateLocalInsight(mode, question, previousRun);
        debug = buildInsightDebugPayload(payload, { phase: "local", requested: [], provided: [] });
      }

      await storeInsightRun({
        mode,
        question,
        previousRun,
        source,
        result,
        debug,
      }, attachedPhotos, clearAttachedPhotos);
      RC.showToast(source === "gpt" ? "GPT insight generated." : "Local insight generated.");
    } catch (error) {
      console.error(error);
      const fallback = generateLocalInsight(mode, question, previousRun);
      await storeInsightRun({
        mode,
        question,
        previousRun,
        source: "local",
        result: fallback,
        debug: buildInsightDebugPayload(payload, { phase: "fallback", requested: [], provided: [] }, error?.message || String(error || "")),
      }, attachedPhotos, clearAttachedPhotos);
      RC.showToast("GPT unavailable. Local insight generated.");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = idleHtml;
      }
      RC.refreshIcons();
    }
  }

  window.RC.Insights = {
    renderInsightOutput, renderInsightsContext, renderHomeInsightBrief,
    generateInsight, generateFollowupInsight,
  };
})();
