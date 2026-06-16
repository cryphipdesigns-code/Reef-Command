(function (root, factory) {
  const api = factory(root.ReefRecords || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReefJournal = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function (Records) {
  const JOURNAL_TYPES = [
    {
      value: "Water Test",
      label: "Water Test",
      likelyEquipmentCategories: [],
    },
    {
      value: "Feeding / Dosing",
      label: "Feeding / Dosing",
      likelyEquipmentCategories: ["feeder"],
    },
    {
      value: "Maintenance / Water Change",
      label: "Maintenance / Water Change",
      likelyEquipmentCategories: ["sump", "ato", "skimmer", "reactor", "uv", "filtration"],
    },
    {
      value: "Equipment Change",
      label: "Equipment Change",
      likelyEquipmentCategories: ["skimmer", "sump", "refugium", "ato", "feeder", "uv", "reactor", "lighting", "filtration"],
    },
    {
      value: "Livestock Change",
      label: "Livestock Change",
      likelyEquipmentCategories: [],
    },
    {
      value: "Observation",
      label: "Observation",
      likelyEquipmentCategories: [],
    },
  ];

  function deepClone(value) {
    if (Records.deepClone) return Records.deepClone(value);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function uid() {
    return `journal_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }

  function normalizeEntryType(type) {
    const found = JOURNAL_TYPES.find((entry) => entry.value === type || entry.label === type);
    return found ? found.value : "Observation";
  }

  function getJournalType(type) {
    return JOURNAL_TYPES.find((entry) => entry.value === normalizeEntryType(type)) || JOURNAL_TYPES[JOURNAL_TYPES.length - 1];
  }

  function normalizeLinks(values) {
    return Array.isArray(values) ? [...new Set(values.filter(Boolean).map(String))] : [];
  }

  function createJournalEntry(input = {}) {
    const type = normalizeEntryType(input.type);
    return {
      id: input.id || uid(),
      type,
      occurredAt: input.occurredAt || new Date().toISOString(),
      title: input.title || getJournalType(type).label,
      summary: input.summary || "",
      severity: input.severity || "routine",
      linkedEquipment: normalizeLinks(input.linkedEquipment),
      linkedLivestock: normalizeLinks(input.linkedLivestock),
      attachments: Array.isArray(input.attachments) ? deepClone(input.attachments) : [],
      measurements: deepClone(input.measurements || {}),
      context: deepClone(input.context || {}),
      observation: deepClone(input.observation || {}),
      effects: Array.isArray(input.effects) ? deepClone(input.effects) : [],
      legacyKind: input.legacyKind || "",
      legacyId: input.legacyId || "",
      legacyRaw: deepClone(input.legacyRaw),
      createdAt: input.createdAt || new Date().toISOString(),
    };
  }

  function getRecentLinkedIds(state = {}, type, key) {
    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 120;
    const counts = new Map();
    (state.journal || [])
      .filter((entry) => entry.type === type && new Date(entry.occurredAt).getTime() >= cutoff)
      .forEach((entry) => {
        (entry[key] || []).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
      });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }

  function suggestLinkedEquipment(state = {}, type) {
    const journalType = getJournalType(type);
    const equipment = state.records?.equipment || [];
    const likely = equipment
      .filter((record) =>
        record.status !== "retired" &&
        journalType.likelyEquipmentCategories.includes(record.category),
      )
      .map((record) => record.id);
    return [...new Set([
      ...getRecentLinkedIds(state, journalType.value, "linkedEquipment"),
      ...likely,
    ])].slice(0, 8);
  }

  function suggestLinkedLivestock(state = {}, type) {
    const normalized = normalizeEntryType(type);
    if (normalized !== "Feeding / Dosing" && normalized !== "Livestock Change" && normalized !== "Observation") {
      return getRecentLinkedIds(state, normalized, "linkedLivestock").slice(0, 8);
    }
    return getRecentLinkedIds(state, normalized, "linkedLivestock").slice(0, 8);
  }

  function suggestLinksForType(state = {}, type) {
    return {
      linkedEquipment: suggestLinkedEquipment(state, type),
      linkedLivestock: suggestLinkedLivestock(state, type),
    };
  }

  function entryLinksRecord(entry = {}, recordId) {
    return (entry.linkedEquipment || []).includes(recordId) || (entry.linkedLivestock || []).includes(recordId);
  }

  function entryToLegacyWaterTest(entry = {}) {
    const measurements = entry.measurements || {};
    return {
      id: entry.legacyId || entry.id,
      measuredAt: entry.occurredAt,
      ammonia: measurements.ammonia ?? null,
      nitrite: measurements.nitrite ?? null,
      nitrate: measurements.nitrate ?? null,
      phosphate: measurements.phosphate ?? null,
      ph: measurements.ph ?? null,
      alkalinity: measurements.alkalinity ?? null,
      calcium: measurements.calcium ?? null,
      magnesium: measurements.magnesium ?? null,
      salinity: measurements.salinity || "",
      temperature: measurements.temperature || "",
      notes: entry.summary || "",
      timing: deepClone(entry.context || {}),
    };
  }

  function entryToLegacyEvent(entry = {}) {
    const raw = entry.legacyRaw || {};
    if (raw.id && raw.type) {
      return {
        ...deepClone(raw),
        id: entry.legacyId || raw.id,
        happenedAt: entry.occurredAt || raw.happenedAt,
      };
    }
    const type = entry.type === "Feeding / Dosing"
      ? "feeding"
      : entry.type === "Maintenance / Water Change" && /water change/i.test(entry.title || "")
        ? "water_change"
        : "maintenance";
    return {
      id: entry.legacyId || entry.id,
      type,
      happenedAt: entry.occurredAt,
      label: entry.title || entry.type,
      amount: raw.amount || "",
      target: raw.target || "",
      gallons: raw.gallons || "",
      percent: raw.percent || "",
      details: raw.details || entry.summary || "",
      notes: raw.notes || "",
    };
  }

  return {
    JOURNAL_TYPES,
    normalizeEntryType,
    getJournalType,
    createJournalEntry,
    suggestLinksForType,
    entryLinksRecord,
    entryToLegacyWaterTest,
    entryToLegacyEvent,
  };
});
