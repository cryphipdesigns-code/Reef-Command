(function () {
  const RC = window.RC;
  const state = RC.state;
  const $ = (id) => RC.$(id);
  const $$ = (sel, root) => RC.$$(sel, root);

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
      .map(normalizePhotoRecord)
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
        <strong>Raw Data Requests</strong>
        <ul>
          ${requests.map((request) => {
            if (typeof request === "string") return `<li>${RC.escapeHtml(request)}</li>`;
            const label = request.label || request.data_type || "Raw data";
            const priority = request.priority ? ` (${request.priority})` : "";
            const reason = request.reason ? `: ${request.reason}` : "";
            return `<li>${RC.escapeHtml(`${label}${priority}${reason}`)}</li>`;
          }).join("")}
        </ul>
      </article>
    `;
  }

  function buildRemoteInsightPayload(mode, question, previousRun = null, attachedPhotos = []) {
    const fullContext = buildInsightContext();
    const evidence = buildInsightEvidenceBundles(fullContext, attachedPhotos);
    const context = buildProgressiveInsightContext(fullContext, mode, question, evidence);
    if (previousRun) {
      context.conversationContext = summarizeInsightRunForFollowup(previousRun);
    }
    if (attachedPhotos.length) {
      context.requestAttachments = {
        photoCount: attachedPhotos.length,
        evidenceBundle: "insight_prompt_photos",
        indexPassPolicy: "Prompt-attached image bytes are sent with the first GPT pass. Stored app photos are still request-gated.",
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
      createdAt: run?.createdAt || "",
      mode: run?.mode || "",
      originalQuestion: run?.question || "",
      source: run?.source || "",
      headline: getInsightHeadline(result),
      summary: getInsightSummary(result),
      priorities,
      observations: result && typeof result === "object" && Array.isArray(result.observations) ? result.observations : [],
      nextActions: result && typeof result === "object" && Array.isArray(result.next_actions) ? result.next_actions : [],
      missingData: result && typeof result === "object" && Array.isArray(result.missing_data) ? result.missing_data : [],
      dataRequests: result && typeof result === "object" && Array.isArray(result.data_requests) ? result.data_requests : [],
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
        data_type: bundle.data_type,
        label: bundle.label,
        summary: bundle.summary,
        count: bundle.count,
        available: bundle.available,
      },
    ]));
  }

  function buildProgressiveInsightContext(fullContext, mode, question, evidence) {
    const evidenceIndex = Object.values(evidence).map((bundle) => ({
      data_type: bundle.data_type,
      label: bundle.label,
      summary: bundle.summary,
      count: bundle.count,
      available: bundle.available,
    }));
    return {
      ...fullContext,
      contextStrategy: {
        phase: "index_plus_selected_evidence",
        mode,
        question,
        approach: "Use this compact context first. Request the smallest useful evidence bundles only when they would materially change confidence or recommendations.",
        maxFollowupPasses: 1,
      },
      evidenceIndex,
      mapModel: summarizeInsightMapModel(fullContext.mapModel),
      recentWaterTests: fullContext.recentWaterTests.slice(0, mode === "trends" ? 20 : 10),
      recentEvents: selectInsightEventsForIndex(fullContext.recentEvents, mode),
      rawDataInventory: {
        ...fullContext.rawDataInventory,
        evidenceBundles: evidenceIndex,
      },
    };
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

    return {
      tank_profile: {
        data_type: "tank_profile",
        label: "Full tank profile",
        summary: "Tank profile fields, summary notes, lighting summary, targets, and active equipment.",
        count: 1,
        available: true,
        content: {
          profile: fullContext.profile,
          currentLightPhase: fullContext.currentLightPhase,
        },
      },
      equipment_details: {
        data_type: "equipment_details",
        label: "Equipment details",
        summary: `${activeEquipment.filter((item) => item.details).length}/${activeEquipment.length} active equipment records include details/specs.`,
        count: activeEquipment.length,
        available: activeEquipment.length > 0,
        content: activeEquipment,
      },
      livestock_records: {
        data_type: "livestock_records",
        label: "Livestock records",
        summary: `${fullContext.livestock.length} livestock records with health, growth, quantity, count, and placement fields.`,
        count: fullContext.livestock.length,
        available: fullContext.livestock.length > 0,
        content: {
          livestock: fullContext.livestock,
          placements: fullContext.mapModel.livestockPlacements,
        },
      },
      map_model_detail: {
        data_type: "map_model_detail",
        label: "Detailed map model",
        summary: "Full aquascape structure geometry, PAR markers, refinement annotations, and stock placements.",
        count: fullContext.mapModel.structures.length,
        available: true,
        content: fullContext.mapModel,
      },
      par_map: {
        data_type: "par_map",
        label: "PAR and light context",
        summary: `${fullContext.mapModel.parMarkers.length} PAR markers plus structure light and PAR ranges.`,
        count: fullContext.mapModel.parMarkers.length,
        available: fullContext.rawDataInventory.map.parMapAvailable,
        content: {
          parMarkers: fullContext.mapModel.parMarkers,
          structures: fullContext.mapModel.structures.map((structure) => ({
            id: structure.id,
            name: structure.name,
            light: structure.light,
            parRange: structure.parRange,
            notes: structure.notes,
          })),
          placements: fullContext.mapModel.livestockPlacements,
        },
      },
      water_tests: {
        data_type: "water_tests",
        label: "Water test history",
        summary: `${sortedTests.length} most recent water tests with timing context.`,
        count: sortedTests.length,
        available: sortedTests.length > 0,
        content: sortedTests,
      },
      feeding_logs: {
        data_type: "feeding_logs",
        label: "Feeding logs",
        summary: `${feedingLogs.length} recent feeding events.`,
        count: feedingLogs.length,
        available: feedingLogs.length > 0,
        content: feedingLogs,
      },
      maintenance_logs: {
        data_type: "maintenance_logs",
        label: "Maintenance logs",
        summary: `${maintenanceLogs.length} recent maintenance events and ${waterChangeLogs.length} water changes.`,
        count: maintenanceLogs.length + waterChangeLogs.length,
        available: maintenanceLogs.length > 0 || waterChangeLogs.length > 0,
        content: {
          maintenance: maintenanceLogs,
          waterChanges: waterChangeLogs,
        },
      },
      care_schedule: {
        data_type: "care_schedule",
        label: "Care schedule status",
        summary: `${fullContext.overdueCareTasks.length} overdue scheduled care task${fullContext.overdueCareTasks.length === 1 ? "" : "s"}. Manual-only tasks are not treated as overdue.`,
        count: fullContext.careTasks.length,
        available: true,
        content: fullContext.careTasks,
      },
      insight_prompt_photos: {
        data_type: "insight_prompt_photos",
        label: "Current prompt photos",
        summary: `${insightPromptPhotoEvidence.length} photo${insightPromptPhotoEvidence.length === 1 ? "" : "s"} attached to the current insight request. Prompt-attached image bytes are sent with the first GPT pass.`,
        count: insightPromptPhotoEvidence.length,
        available: insightPromptPhotoEvidence.length > 0,
        content: insightPromptPhotoEvidence,
      },
      lighting_images: {
        data_type: "lighting_images",
        label: "Lighting image inventory",
        summary: `${lightingEvidence.length} lighting image records. Image bytes are not included in text-only insight requests.`,
        count: lightingEvidence.length,
        available: lightingEvidence.length > 0,
        content: lightingEvidence,
      },
      livestock_photos: {
        data_type: "livestock_photos",
        label: "Livestock photo inventory",
        summary: `${livestockPhotoEvidence.reduce((total, item) => total + item.photos.length, 0)} livestock photo records. Image bytes are not included in text-only insight requests.`,
        count: livestockPhotoEvidence.reduce((total, item) => total + item.photos.length, 0),
        available: livestockPhotoEvidence.length > 0,
        content: livestockPhotoEvidence,
      },
    };
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
        data_type: "lighting_images",
        reason: "Lighting images exist, but the compact lighting summary is empty.",
        target_id: "profile.lightingPhotos",
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

    if (mode === "maintenance") {
      ["RODI replaced", "Top Carbon replaced", "Bottom Carbon replaced", "Purigen replaced", "UV bulb replaced"].forEach((label) => {
        const event = [...state.events].filter((item) => item.label === label).sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))[0];
        observations.push(`${label}: ${event ? RC.formatAge(event.happenedAt) : "not logged"}.`);
      });
      nextActions.push("Keep media changes logged as events so they can be compared against nutrient shifts.");
    }

    if (mode === "livestock") {
      const unplaced = context.activeLivestock.filter((item) => !item.zoneId && !item.mapPosition);
      if (unplaced.length) {
        priorities.push({
          label: "Unplaced livestock",
          severity: "warning",
          why: `${unplaced.length} active livestock record${unplaced.length === 1 ? "" : "s"} do not have a Map placement.`,
        });
      }
      const photographed = context.rawDataInventory.livestockPhotos;
      if (photographed.length) {
        dataRequests.push({
          label: "Livestock photos",
          data_type: "livestock_photos",
          reason: "Photos are available and may help with coral health or placement questions, though their currentness is unknown.",
          target_id: photographed.slice(0, 3).map((item) => item.id).join(","),
          priority: "low",
        });
      }
      nextActions.push("Place corals and sensitive inverts on the Map so light and PAR context can be included.");
    }

    if (mode === "trends" && state.waterTests.length < 3) {
      missingData.push("At least three water tests for trend analysis");
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
      headline: mode === "freeform" ? "Draft answer" : "Tank review",
      summary: "This local draft uses simple rules. GPT insights will use the same context with better reasoning once the Supabase function is connected.",
      priorities,
      observations,
      next_actions: nextActions,
      missing_data: [...new Set(missingData)],
      data_requests: dataRequests,
    };
  }

  async function generateInsight() {
    const mode = state.ui.insightMode || "health";
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
      mode: previousRun.mode || state.ui.insightMode || "health",
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
