(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReefRecords = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const SCHEMA_VERSION = 2;

  const EQUIPMENT_TEMPLATES = [
    {
      key: "filtration",
      label: "Filtration",
      category: "filtration",
      source: "profile",
      fields: ["filtration", "filtrationDetails"],
    },
    {
      key: "lighting",
      label: "Lighting",
      category: "lighting",
      source: "profile",
      fields: ["lightingModel", "lightingSummary", "lightStart", "lightEnd", "lightingPhotos"],
      photoField: "lightingPhotos",
    },
    {
      key: "proteinSkimmer",
      label: "Protein skimmer",
      category: "skimmer",
      flag: "proteinSkimmer",
      dateKey: "proteinSkimmerAddedDate",
      legacyKey: "proteinSkimmerLegacy",
      detailsKey: "proteinSkimmerDetails",
    },
    {
      key: "sump",
      label: "Sump",
      category: "sump",
      flag: "sump",
      dateKey: "sumpAddedDate",
      legacyKey: "sumpLegacy",
      detailsKey: "sumpDetails",
    },
    {
      key: "refugium",
      label: "Refugium",
      category: "refugium",
      flag: "refugium",
      dateKey: "refugiumAddedDate",
      legacyKey: "refugiumLegacy",
      detailsKey: "refugiumDetails",
    },
    {
      key: "autoTopOff",
      label: "Auto top-off",
      category: "ato",
      flag: "autoTopOff",
      dateKey: "autoTopOffAddedDate",
      legacyKey: "autoTopOffLegacy",
      detailsKey: "autoTopOffDetails",
    },
    {
      key: "autoFeeder",
      label: "Auto feeder",
      category: "feeder",
      flag: "autoFeeder",
      dateKey: "autoFeederAddedDate",
      legacyKey: "autoFeederLegacy",
      detailsKey: "autoFeederDetails",
      scheduleKey: "autoFeederSchedule",
    },
    {
      key: "uvSterilizer",
      label: "UV sterilizer",
      category: "uv",
      flag: "uvSterilizer",
      dateKey: "uvSterilizerAddedDate",
      legacyKey: "uvSterilizerLegacy",
      detailsKey: "uvSterilizerDetails",
      scheduleKey: "uvSchedule",
    },
    {
      key: "gfoReactor",
      label: "GFO reactor",
      category: "reactor",
      flag: "gfoReactor",
      dateKey: "gfoReactorAddedDate",
      legacyKey: "gfoReactorLegacy",
      detailsKey: "gfoReactorDetails",
      media: "GFO",
    },
    {
      key: "carbonReactor",
      label: "Carbon reactor",
      category: "reactor",
      flag: "carbonReactor",
      dateKey: "carbonReactorAddedDate",
      legacyKey: "carbonReactorLegacy",
      detailsKey: "carbonReactorDetails",
      media: "Carbon",
    },
  ];

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function nowIso(options = {}) {
    return options.now || new Date().toISOString();
  }

  function slug(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "record";
  }

  function stableEquipmentId(key) {
    return `equipment_${slug(key)}`;
  }

  function compactObject(value) {
    return Object.fromEntries(
      Object.entries(value || {}).filter(([, entry]) => {
        if (Array.isArray(entry)) return entry.length > 0;
        return entry !== "" && entry !== null && entry !== undefined;
      }),
    );
  }

  function normalizePhotos(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(deepClone);
    return value ? [deepClone(value)] : [];
  }

  function isCasualStockCategory(category) {
    return category === "Microfauna" || category === "Noticed pest";
  }

  function normalizeLivestockStatus(status, category) {
    const value = String(status || "").toLowerCase();
    if (value === "deceased" || value === "dead") return "deceased";
    if (["removed", "moved", "sold", "traded", "given away", "lost"].includes(value)) return "removed";
    if (value === "noticed" || isCasualStockCategory(category)) return "alive";
    return "alive";
  }

  function lifecycleStatusLabel(status) {
    if (status === "deceased") return "Deceased";
    if (status === "removed") return "Removed";
    return "Alive";
  }

  function equipmentHasData(template, profile = {}) {
    if (template.flag && Boolean(profile[template.flag])) return true;
    const keys = [
      template.dateKey,
      template.legacyKey,
      template.detailsKey,
      template.scheduleKey,
      ...(template.fields || []),
    ].filter(Boolean);
    return keys.some((key) => {
      const value = profile[key];
      if (Array.isArray(value)) return value.length > 0;
      return value !== "" && value !== null && value !== undefined && value !== false;
    });
  }

  function pickLegacyEquipmentPayload(template, profile = {}) {
    const keys = [
      template.flag,
      template.dateKey,
      template.legacyKey,
      template.detailsKey,
      template.scheduleKey,
      ...(template.fields || []),
    ].filter(Boolean);
    return Object.fromEntries(keys.map((key) => [key, deepClone(profile[key])]));
  }

  function buildEquipmentDetails(template, profile = {}) {
    if (template.key === "filtration") {
      return compactObject({
        system: profile.filtration || "",
        details: profile.filtrationDetails || "",
      });
    }
    if (template.key === "lighting") {
      return compactObject({
        model: profile.lightingModel || "",
        summary: profile.lightingSummary || "",
        lightStart: profile.lightStart || "",
        lightEnd: profile.lightEnd || "",
      });
    }
    return compactObject({
      details: profile[template.detailsKey] || "",
      schedule: template.scheduleKey ? profile[template.scheduleKey] || "" : "",
      media: template.media || "",
    });
  }

  function buildEquipmentRecord(template, profile = {}, options = {}) {
    const active = template.flag ? Boolean(profile[template.flag]) : equipmentHasData(template, profile);
    const addedAt = template.dateKey ? profile[template.dateKey] || "" : "";
    const photos = template.photoField ? normalizePhotos(profile[template.photoField]) : [];
    return {
      id: stableEquipmentId(template.key),
      recordType: "equipment",
      category: template.category,
      templateKey: template.key,
      name: template.label,
      status: active ? "active" : "retired",
      addedAt,
      retiredAt: "",
      notes: template.detailsKey ? String(profile[template.detailsKey] || "") : "",
      photos,
      details: buildEquipmentDetails(template, profile),
      isLegacy: template.legacyKey ? Boolean(profile[template.legacyKey]) : false,
      legacyRaw: pickLegacyEquipmentPayload(template, profile),
      createdAt: addedAt || nowIso(options),
      updatedAt: nowIso(options),
    };
  }

  function buildEquipmentFoundingEntry(record, options = {}) {
    const hasKnownDate = Boolean(record.addedAt);
    return {
      id: `journal_found_${record.id}`,
      type: "Equipment Change",
      occurredAt: hasKnownDate ? new Date(`${record.addedAt}T00:00:00`).toISOString() : nowIso(options),
      title: hasKnownDate ? `${record.name} added` : `${record.name} setup captured`,
      summary: record.notes || record.details?.details || "",
      severity: "routine",
      linkedEquipment: [record.id],
      linkedLivestock: [],
      attachments: normalizePhotos(record.photos),
      effects: [
        {
          recordId: record.id,
          fields: compactObject({
            status: record.status,
            addedAt: record.addedAt,
            retiredAt: record.retiredAt,
          }),
        },
      ],
      legacyKind: "equipment_setup",
      legacyRaw: deepClone(record.legacyRaw),
      isEstimatedTime: !hasKnownDate,
      createdAt: nowIso(options),
    };
  }

  function normalizeLivestockPhotos(item = {}) {
    return normalizePhotos([
      ...(Array.isArray(item.photos) ? item.photos : []),
      item.photoDataUrl,
      item.photo,
    ].filter(Boolean));
  }

  function buildLivestockRecord(item = {}, options = {}) {
    const id = item.id || `livestock_${slug(item.species || item.name)}_${slug(nowIso(options))}`;
    const category = item.category || "Other";
    const status = normalizeLivestockStatus(item.status, category);
    const species = item.species || item.name || "Unknown";
    const casual = isCasualStockCategory(category) || item.status === "noticed";
    return {
      ...deepClone(item),
      id,
      recordType: "livestock",
      category,
      species,
      name: species,
      status,
      statusLabel: lifecycleStatusLabel(status),
      addedAt: item.addedDate || item.addedAt || "",
      retiredAt: item.removedDate || item.retiredAt || "",
      notes: item.notes || "",
      photos: normalizeLivestockPhotos(item),
      casual,
      details: {
        quantity: item.quantity ?? "",
        currentCount: item.currentCount ?? "",
        trackingUnit: item.trackingUnit || "",
        zoneId: item.zoneId || "",
        initialHealth: item.health || "",
        growthTrend: item.growthTrend || "",
        growthNotes: item.growthNotes || item.growthMetric || "",
        outcomeReason: item.outcomeReason || "",
      },
      legacyStatus: item.status || "",
      legacyRaw: deepClone(item),
      createdAt: item.addedDate || nowIso(options),
      updatedAt: nowIso(options),
    };
  }

  function buildLivestockSetupEntries(record, options = {}) {
    const entries = [];
    const hasKnownDate = Boolean(record.addedAt);
    entries.push({
      id: `journal_setup_${record.id}`,
      type: "Livestock Change",
      occurredAt: hasKnownDate ? new Date(`${record.addedAt}T00:00:00`).toISOString() : nowIso(options),
      title: hasKnownDate ? `${record.name} added` : `${record.name} setup captured`,
      summary: record.details?.outcomeReason || "",
      severity: "routine",
      linkedEquipment: [],
      linkedLivestock: [record.id],
      attachments: normalizePhotos(record.photos),
      effects: [
        {
          recordId: record.id,
          fields: compactObject({
            status: record.status,
            addedAt: record.addedAt,
            retiredAt: record.retiredAt,
            currentCount: record.details?.currentCount,
          }),
        },
      ],
      legacyKind: "livestock_setup",
      legacyRaw: deepClone(record.legacyRaw),
      isEstimatedTime: !hasKnownDate,
      createdAt: nowIso(options),
    });

    if (record.details?.initialHealth) {
      entries.push({
        id: `journal_health_${record.id}`,
        type: "Observation",
        occurredAt: hasKnownDate ? new Date(`${record.addedAt}T00:00:00`).toISOString() : nowIso(options),
        title: `${record.name} health noted`,
        summary: `Health: ${record.details.initialHealth}`,
        severity: "routine",
        linkedEquipment: [],
        linkedLivestock: [record.id],
        attachments: [],
        observation: {
          health: record.details.initialHealth,
          growthTrend: record.details.growthTrend || "",
        },
        effects: [
          {
            recordId: record.id,
            fields: compactObject({
              currentHealth: record.details.initialHealth,
              growthTrend: record.details.growthTrend,
            }),
          },
        ],
        legacyKind: "livestock_health",
        legacyRaw: deepClone(record.legacyRaw),
        isEstimatedTime: !hasKnownDate,
        createdAt: nowIso(options),
      });
    }

    const notes = Array.isArray(record.legacyRaw?.noteLog) ? record.legacyRaw.noteLog : [];
    notes.forEach((note, index) => {
      if (!note?.text) return;
      entries.push({
        id: note.id ? `journal_note_${note.id}` : `journal_note_${record.id}_${index}`,
        type: "Observation",
        occurredAt: note.at || nowIso(options),
        title: `${record.name} note`,
        summary: String(note.text || ""),
        severity: "routine",
        linkedEquipment: [],
        linkedLivestock: [record.id],
        attachments: [],
        observation: {},
        effects: [],
        legacyKind: "livestock_note",
        legacyRaw: deepClone(note),
        isEstimatedTime: !note.at,
        createdAt: nowIso(options),
      });
    });

    return entries;
  }

  function waterTestToJournal(test = {}, options = {}) {
    return {
      id: `journal_water_test_${test.id || slug(test.measuredAt)}`,
      type: "Water Test",
      occurredAt: test.measuredAt || nowIso(options),
      title: "Water test",
      summary: test.notes || "",
      severity: "routine",
      linkedEquipment: [],
      linkedLivestock: [],
      attachments: [],
      measurements: {
        ammonia: test.ammonia,
        nitrite: test.nitrite,
        nitrate: test.nitrate,
        phosphate: test.phosphate,
        ph: test.ph,
        alkalinity: test.alkalinity,
        calcium: test.calcium,
        magnesium: test.magnesium,
        salinity: test.salinity,
        temperature: test.temperature,
      },
      context: deepClone(test.timing || {}),
      effects: [],
      legacyKind: "water_test",
      legacyId: test.id || "",
      legacyRaw: deepClone(test),
      createdAt: nowIso(options),
    };
  }

  function eventTypeToJournalType(event = {}) {
    if (event.type === "feeding") return "Feeding / Dosing";
    if (event.type === "water_change") return "Maintenance / Water Change";
    if (event.type === "maintenance" && /equipment|skimmer|pump|uv|gfo|carbon|reactor|filter/i.test(event.label || "")) {
      return "Equipment Change";
    }
    return "Maintenance / Water Change";
  }

  function eventToJournal(event = {}, options = {}) {
    const type = eventTypeToJournalType(event);
    return {
      id: `journal_event_${event.id || slug(event.happenedAt)}`,
      type,
      occurredAt: event.happenedAt || nowIso(options),
      title: event.type === "feeding"
        ? `Fed ${event.label || "tank"}`
        : event.type === "water_change"
          ? "Water change"
          : event.label || "Maintenance",
      summary: [event.amount, event.target, event.gallons ? `${event.gallons} gallons` : "", event.percent ? `${event.percent}%` : "", event.details, event.notes]
        .filter(Boolean)
        .join(" · "),
      severity: "routine",
      linkedEquipment: [],
      linkedLivestock: [],
      attachments: [],
      measurements: {},
      effects: [],
      legacyKind: event.type || "event",
      legacyId: event.id || "",
      legacyRaw: deepClone(event),
      createdAt: nowIso(options),
    };
  }

  function dedupeById(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
      const id = entry?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function buildMigrationArtifacts(raw = {}, options = {}) {
    const profile = raw.profile || {};
    const equipment = EQUIPMENT_TEMPLATES
      .filter((template) => equipmentHasData(template, profile))
      .map((template) => buildEquipmentRecord(template, profile, options));
    const livestock = (Array.isArray(raw.livestock) ? raw.livestock : [])
      .map((item) => buildLivestockRecord(item, options));
    const equipmentJournal = equipment.map((record) => buildEquipmentFoundingEntry(record, options));
    const livestockJournal = livestock.flatMap((record) => buildLivestockSetupEntries(record, options));
    const waterTestJournal = (Array.isArray(raw.waterTests) ? raw.waterTests : [])
      .map((test) => waterTestToJournal(test, options));
    const eventJournal = (Array.isArray(raw.events) ? raw.events : [])
      .map((event) => eventToJournal(event, options));

    return {
      records: {
        equipment,
        livestock,
      },
      journal: dedupeById([
        ...equipmentJournal,
        ...livestockJournal,
        ...waterTestJournal,
        ...eventJournal,
      ]).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)),
    };
  }

  function normalizeJournalEntry(entry = {}, options = {}) {
    return {
      id: entry.id || `journal_${slug(entry.type)}_${slug(entry.occurredAt || nowIso(options))}`,
      type: entry.type || "Observation",
      occurredAt: entry.occurredAt || entry.happenedAt || entry.measuredAt || nowIso(options),
      title: entry.title || entry.label || entry.type || "Journal entry",
      summary: entry.summary || entry.details || entry.notes || "",
      severity: entry.severity || "routine",
      linkedEquipment: Array.isArray(entry.linkedEquipment) ? entry.linkedEquipment : [],
      linkedLivestock: Array.isArray(entry.linkedLivestock) ? entry.linkedLivestock : [],
      attachments: normalizePhotos(entry.attachments || entry.photos || []),
      measurements: deepClone(entry.measurements || {}),
      context: deepClone(entry.context || {}),
      observation: deepClone(entry.observation || {}),
      effects: Array.isArray(entry.effects) ? deepClone(entry.effects) : [],
      legacyKind: entry.legacyKind || "",
      legacyId: entry.legacyId || "",
      legacyRaw: deepClone(entry.legacyRaw),
      isEstimatedTime: Boolean(entry.isEstimatedTime),
      createdAt: entry.createdAt || nowIso(options),
    };
  }

  function normalizeV2State(raw = {}, options = {}) {
    const artifacts = buildMigrationArtifacts(raw, options);
    const records = raw.records || {};
    const equipment = Array.isArray(records.equipment)
      ? records.equipment.map((record) => ({ ...record, recordType: "equipment" }))
      : artifacts.records.equipment;
    const livestock = Array.isArray(records.livestock)
      ? records.livestock.map((record) => ({ ...record, recordType: "livestock" }))
      : artifacts.records.livestock;
    const journal = Array.isArray(raw.journal)
      ? raw.journal.map((entry) => normalizeJournalEntry(entry, options))
      : artifacts.journal.map((entry) => normalizeJournalEntry(entry, options));

    return {
      ...raw,
      version: Math.max(Number(raw.version || 0), SCHEMA_VERSION),
      schemaVersion: SCHEMA_VERSION,
      records: {
        equipment,
        livestock,
      },
      journal: dedupeById(journal).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)),
      legacyRaw: raw.legacyRaw || null,
    };
  }

  function migrateToRecordJournalState(raw = {}, options = {}) {
    if (Number(raw.schemaVersion || raw.version || 0) >= SCHEMA_VERSION && raw.records && raw.journal) {
      return normalizeV2State(raw, options);
    }

    const artifacts = buildMigrationArtifacts(raw, options);
    return normalizeV2State({
      ...raw,
      version: SCHEMA_VERSION,
      schemaVersion: SCHEMA_VERSION,
      records: artifacts.records,
      journal: artifacts.journal,
      legacyRaw: deepClone(raw),
      migration: {
        migratedAt: nowIso(options),
        fromVersion: raw.version || 1,
        equipmentRecordCount: artifacts.records.equipment.length,
        livestockRecordCount: artifacts.records.livestock.length,
        journalEntryCount: artifacts.journal.length,
      },
    }, options);
  }

  function getRecordHistory(state = {}, recordId) {
    if (!recordId) return [];
    return (Array.isArray(state.journal) ? state.journal : [])
      .filter((entry) =>
        (entry.linkedEquipment || []).includes(recordId) ||
        (entry.linkedLivestock || []).includes(recordId),
      )
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  }

  function foldRecord(record = {}, history = []) {
    const current = deepClone(record);
    history
      .slice()
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt))
      .forEach((entry) => {
        (entry.effects || [])
          .filter((effect) => effect.recordId === record.id)
          .forEach((effect) => Object.assign(current, deepClone(effect.fields || {})));
        if (entry.type === "Observation" && (entry.linkedLivestock || []).includes(record.id)) {
          if (entry.observation?.health) current.currentHealth = entry.observation.health;
          if (entry.observation?.growthTrend) current.growthTrend = entry.observation.growthTrend;
        }
      });

    if (record.recordType === "livestock") {
      current.currentHealth = current.currentHealth || record.details?.initialHealth || record.health || "";
      current.statusLabel = lifecycleStatusLabel(current.status);
    }
    return current;
  }

  function getCurrentRecord(state = {}, record) {
    return foldRecord(record, getRecordHistory(state, record.id));
  }

  function getAllRecords(state = {}) {
    return [
      ...(state.records?.equipment || []),
      ...(state.records?.livestock || []),
    ];
  }

  return {
    SCHEMA_VERSION,
    EQUIPMENT_TEMPLATES,
    deepClone,
    isCasualStockCategory,
    normalizeLivestockStatus,
    lifecycleStatusLabel,
    stableEquipmentId,
    buildMigrationArtifacts,
    buildLivestockRecord,
    buildEquipmentRecord,
    migrateToRecordJournalState,
    normalizeV2State,
    normalizeJournalEntry,
    getRecordHistory,
    foldRecord,
    getCurrentRecord,
    getAllRecords,
  };
});
