(function () {
  const STORAGE_KEY = "reefCommandState.v1";
  const BACKEND_KEY = "reefCommandBackend.v1";
  const SHARED_STATE_ID = "default";

  const viewMap = {
    home: "homeView",
    tank: "tankView",
    livestock: "livestockView",
    logbook: "logbookView",
    insights: "insightsView",
  };

  const logFormMap = {
    test: "waterTestForm",
    feeding: "feedingForm",
    maintenance: "maintenanceForm",
    water_change: "waterChangeForm",
  };

  let state = normalizeState(readJson(STORAGE_KEY) || getDefaultState());
  let backendConfig = readJson(BACKEND_KEY) || {};
  let supabaseClient = null;
  let currentUser = null;
  let authSubscription = null;
  let autosaveTimer = null;
  let remoteSaveInFlight = false;
  let remoteSaveQueued = false;
  let isRemoteHydrating = false;
  let toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function getDefaultState() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      profile: {
        tankName: "Reef Tank",
        displayVolume: "",
        totalVolume: "",
        startDate: "",
        tankStyle: "",
        filtration: "",
        lightingModel: "",
        lightStart: "10:00",
        lightEnd: "20:00",
        flowSetup: "",
        targetSalinity: "1.026",
        targetTemp: "78 F",
        saltMix: "",
        dosing: "",
        proteinSkimmer: false,
        refugium: false,
        autoTopOff: false,
        notes: "",
      },
      zones: [
        {
          id: uid(),
          name: "Top rock",
          light: "High",
          flow: "High",
          parMin: "",
          parMax: "",
          notes: "",
        },
        {
          id: uid(),
          name: "Mid reef",
          light: "Medium",
          flow: "Medium",
          parMin: "",
          parMax: "",
          notes: "",
        },
        {
          id: uid(),
          name: "Sand bed",
          light: "Low",
          flow: "Low",
          parMin: "",
          parMax: "",
          notes: "",
        },
      ],
      livestock: [],
      waterTests: [],
      events: [],
      insightRuns: [],
      ui: {
        activeView: "home",
        logMode: "test",
        livestockFilter: "active",
        insightMode: "health",
      },
    };
  }

  function normalizeState(raw) {
    const base = getDefaultState();
    const next = {
      ...base,
      ...raw,
      profile: { ...base.profile, ...(raw.profile || {}) },
      ui: { ...base.ui, ...(raw.ui || {}) },
      zones: Array.isArray(raw.zones) ? raw.zones : base.zones,
      livestock: Array.isArray(raw.livestock) ? raw.livestock : [],
      waterTests: Array.isArray(raw.waterTests) ? raw.waterTests : [],
      events: Array.isArray(raw.events) ? raw.events : [],
      insightRuns: Array.isArray(raw.insightRuns) ? raw.insightRuns : [],
    };

    next.zones = next.zones.map((zone) => ({
      id: zone.id || uid(),
      name: zone.name || "Zone",
      light: zone.light || "Medium",
      flow: zone.flow || "Medium",
      parMin: zone.parMin ?? "",
      parMax: zone.parMax ?? "",
      notes: zone.notes || "",
    }));

    next.livestock = next.livestock.map((item) => {
      const category = item.category || "Other";
      const casual = isCasualStockCategory(category);
      const hasLegacyFlag = Object.prototype.hasOwnProperty.call(item, "isLegacy");
      const isLegacy = hasLegacyFlag ? Boolean(item.isLegacy) : true;
      const species = item.species || item.name || "Unknown";

      return {
        id: item.id || uid(),
        species,
        name: species,
        category,
        quantity: item.quantity ?? "",
        addedDate: item.addedDate || "",
        isLegacy,
        status: casual ? "noticed" : item.status || "active",
        zoneId: item.zoneId || "",
        notes: item.notes || "",
        health: item.health || "",
        growthTrend: item.growthTrend || "",
        growthMetric: item.growthMetric || "",
        growthNotes: item.growthNotes || "",
        removedDate: item.removedDate || "",
        outcomeReason: item.outcomeReason || "",
      };
    });

    next.waterTests = next.waterTests.map((test) => ({
      id: test.id || uid(),
      measuredAt: test.measuredAt || new Date().toISOString(),
      ammonia: normalizeNullableNumber(test.ammonia),
      nitrite: normalizeNullableNumber(test.nitrite),
      nitrate: normalizeNullableNumber(test.nitrate),
      phosphate: normalizeNullableNumber(test.phosphate),
      ph: normalizeNullableNumber(test.ph),
      alkalinity: normalizeNullableNumber(test.alkalinity),
      calcium: normalizeNullableNumber(test.calcium),
      magnesium: normalizeNullableNumber(test.magnesium),
      salinity: test.salinity || "",
      temperature: test.temperature || "",
      notes: test.notes || "",
      timing: test.timing || {},
    }));

    next.events = next.events.map((event) => ({
      id: event.id || uid(),
      type: event.type || "maintenance",
      happenedAt: event.happenedAt || new Date().toISOString(),
      label: event.label || "Event",
      amount: event.amount || "",
      target: event.target || "",
      gallons: event.gallons || "",
      percent: event.percent || "",
      details: event.details || "",
      notes: event.notes || "",
    }));

    return next;
  }

  function readJson(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.warn("Could not read local state", error);
      return null;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async function loadLocalBackendConfig() {
    if (Object.keys(backendConfig).length) return;

    const isLocalHost = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
    const configPaths = isLocalHost
      ? ["./config.local.json", "./config.json"]
      : ["./config.json"];
    for (const path of configPaths) {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) continue;
        const config = await response.json();
        if (!config.supabaseUrl || !config.supabaseAnonKey) continue;
        backendConfig = {
          supabaseUrl: config.supabaseUrl,
          supabaseAnonKey: config.supabaseAnonKey,
        };
        writeJson(BACKEND_KEY, backendConfig);
        return;
      } catch {
        // Local and deploy-time config files are optional.
      }
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    writeJson(STORAGE_KEY, state);
    scheduleRemoteSave();
  }

  function saveLocalState() {
    writeJson(STORAGE_KEY, state);
  }

  function scheduleRemoteSave(delay = 450) {
    if (!supabaseClient || isRemoteHydrating) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      pushState({ silent: true });
    }, delay);
  }

  function hasMeaningfulState(value) {
    const profile = value?.profile || {};
    const defaults = getDefaultState().profile;
    const profileChanged = Object.keys(defaults).some((key) => {
      if (key === "tankName") return Boolean(profile[key] && profile[key] !== defaults[key]);
      return String(profile[key] ?? "") !== String(defaults[key] ?? "");
    });

    return Boolean(
      profileChanged ||
        value?.livestock?.length ||
        value?.waterTests?.length ||
        value?.events?.length ||
        value?.insightRuns?.length,
    );
  }

  function uid() {
    return "id_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function normalizeNullableNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function readNumber(id) {
    return normalizeNullableNumber($(id).value);
  }

  function todayInputValue() {
    return new Date().toISOString().slice(0, 10);
  }

  function toDatetimeLocal(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 16);
  }

  function fromDatetimeLocal(value) {
    return value ? new Date(value).toISOString() : new Date().toISOString();
  }

  function formatDateTime(value) {
    if (!value) return "No date";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No date";
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatDate(value) {
    if (!value) return "No date";
    const date = new Date(value + "T00:00:00");
    if (Number.isNaN(date.getTime())) return "No date";
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function daysSince(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const diff = Date.now() - date.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  }

  function formatAge(value) {
    const days = daysSince(value);
    if (days === null) return "No date";
    if (days === 0) return "Today";
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
  }

  function formatValue(value, suffix = "") {
    if (value === null || value === undefined || value === "") return "--";
    const number = Number(value);
    if (Number.isFinite(number)) {
      const trimmed = Number.isInteger(number) ? String(number) : String(Number(number.toFixed(3)));
      return suffix ? `${trimmed} ${suffix}` : trimmed;
    }
    return String(value);
  }

  function isCasualStockCategory(category) {
    return category === "Microfauna" || category === "Noticed pest";
  }

  function isLifecycleStock(item) {
    return !isCasualStockCategory(item.category);
  }

  function formatStockDate(item) {
    if (isCasualStockCategory(item.category)) {
      return item.addedDate ? `Noticed ${formatDate(item.addedDate)}` : "Casual notice";
    }
    if (item.isLegacy || !item.addedDate) return "Legacy / add date unknown";
    return `Added ${formatDate(item.addedDate)}`;
  }

  function formatQuantity(value) {
    if (value === "" || value === null || value === undefined) return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return Number.isInteger(number) ? String(number) : String(number);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function minutesFromTime(value) {
    if (!value || !value.includes(":")) return null;
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  }

  function getLightPhase(at = new Date()) {
    const start = minutesFromTime(state.profile.lightStart);
    const end = minutesFromTime(state.profile.lightEnd);
    if (start === null || end === null || start === end) {
      return { label: "Lighting unset", isOn: null };
    }
    const date = at instanceof Date ? at : new Date(at);
    const current = date.getHours() * 60 + date.getMinutes();
    const isOn = start < end
      ? current >= start && current < end
      : current >= start || current < end;
    return { label: isOn ? "Lights on" : "Lights off", isOn };
  }

  function getLatestWaterTest() {
    return [...state.waterTests].sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0] || null;
  }

  function getLatestEvent(type) {
    return [...state.events]
      .filter((event) => event.type === type)
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))[0] || null;
  }

  function getLatestEventBefore(type, beforeIso) {
    const before = new Date(beforeIso).getTime();
    return [...state.events]
      .filter((event) => event.type === type && new Date(event.happenedAt).getTime() <= before)
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))[0] || null;
  }

  function describeTimeAfter(event, timestamp) {
    if (!event || !timestamp) return "No prior event";
    const diffHours = Math.max(0, (new Date(timestamp) - new Date(event.happenedAt)) / 3600000);
    if (diffHours < 1) return "within 1 hour";
    if (diffHours < 24) return `${Math.round(diffHours)} hours after`;
    const days = Math.round(diffHours / 24);
    return days === 1 ? "1 day after" : `${days} days after`;
  }

  function getZoneName(zoneId) {
    return state.zones.find((zone) => zone.id === zoneId)?.name || "Unplaced";
  }

  function getTimelineEntries() {
    const tests = state.waterTests.map((test) => ({
      id: test.id,
      kind: "test",
      at: test.measuredAt,
      title: "Water test",
      details: describeWaterTest(test),
      meta: `${formatDateTime(test.measuredAt)} · ${test.timing?.lightPhase || getLightPhase(test.measuredAt).label}`,
    }));

    const events = state.events.map((event) => ({
      id: event.id,
      kind: event.type,
      at: event.happenedAt,
      title: describeEventTitle(event),
      details: describeEventDetails(event),
      meta: formatDateTime(event.happenedAt),
    }));

    return [...tests, ...events].sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function describeWaterTest(test) {
    const parts = [
      test.ammonia !== null ? `Ammonia ${formatValue(test.ammonia, "ppm")}` : "",
      test.nitrite !== null ? `Nitrite ${formatValue(test.nitrite, "ppm")}` : "",
      test.nitrate !== null ? `Nitrate ${formatValue(test.nitrate, "ppm")}` : "",
      test.phosphate !== null ? `Phosphate ${formatValue(test.phosphate, "ppm")}` : "",
      test.ph !== null ? `pH ${formatValue(test.ph)}` : "",
      test.salinity ? `Salinity ${test.salinity}` : "",
      test.temperature ? `Temp ${test.temperature}` : "",
      test.alkalinity !== null ? `Alk ${formatValue(test.alkalinity, "dKH")}` : "",
      test.calcium !== null ? `Calcium ${formatValue(test.calcium, "ppm")}` : "",
      test.magnesium !== null ? `Mag ${formatValue(test.magnesium, "ppm")}` : "",
    ].filter(Boolean);
    const base = parts.length ? parts.join(" · ") : "No parameter values";
    return test.notes ? `${base} · ${test.notes}` : base;
  }

  function describeEventTitle(event) {
    if (event.type === "feeding") return `Fed ${event.label || "tank"}`;
    if (event.type === "water_change") return "Water change";
    return event.label || "Maintenance";
  }

  function describeEventDetails(event) {
    if (event.type === "feeding") {
      return [event.amount, event.target, event.notes].filter(Boolean).join(" · ") || "Feeding logged";
    }
    if (event.type === "water_change") {
      return [
        event.gallons ? `${event.gallons} gallons` : "",
        event.percent ? `${event.percent}%` : "",
        event.notes,
      ].filter(Boolean).join(" · ") || "Water change logged";
    }
    return [event.details, event.notes].filter(Boolean).join(" · ") || "Maintenance logged";
  }

  function setActiveView(viewName) {
    const next = viewMap[viewName] ? viewName : "home";
    state.ui.activeView = next;
    saveLocalState();

    Object.entries(viewMap).forEach(([key, id]) => {
      $(id).classList.toggle("active", key === next);
    });
    $$("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === next);
    });
    $("viewTitle").textContent = $(viewMap[next]).dataset.title || "Reef Command";
    window.scrollTo({ top: 0, behavior: "smooth" });
    refreshIcons();
  }

  function renderAll() {
    renderTankProfileForm();
    renderDashboard();
    renderZones();
    renderLivestock();
    renderLogMode();
    renderTimeline();
    renderInsightsContext();
    renderInsightOutput();
    renderBackendSettings();
    setActiveView(state.ui.activeView || "home");
    refreshIcons();
  }

  function renderDashboard() {
    const profile = state.profile;
    const latestTest = getLatestWaterTest();
    const latestWaterChange = getLatestEvent("water_change");
    const activeLivestock = state.livestock.filter((item) => isLifecycleStock(item) && item.status === "active");
    const activeQuantity = activeLivestock.reduce((total, item) => {
      const quantity = Number(item.quantity);
      return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
    }, 0);
    const phase = getLightPhase();

    $("homeTankName").textContent = profile.tankName || "Reef Tank";
    $("homeTankSubtitle").textContent = [
      profile.displayVolume ? `${profile.displayVolume} gal display` : "",
      profile.tankStyle,
      profile.lightingModel,
    ].filter(Boolean).join(" · ") || "No volume set";
    $("lightPhaseBadge").innerHTML = `<i data-lucide="${phase.isOn ? "sun" : "moon"}"></i><span>${escapeHtml(phase.label)}</span>`;

    $("metricAmmonia").textContent = latestTest ? formatValue(latestTest.ammonia, "ppm") : "--";
    $("metricAmmoniaMeta").textContent = latestTest ? formatAge(latestTest.measuredAt) : "No test yet";
    $("metricNitrate").textContent = latestTest ? formatValue(latestTest.nitrate, "ppm") : "--";
    $("metricNitrateMeta").textContent = latestTest ? formatAge(latestTest.measuredAt) : "No test yet";
    $("metricWaterChange").textContent = latestWaterChange ? formatAge(latestWaterChange.happenedAt) : "--";
    $("metricWaterChangeMeta").textContent = latestWaterChange ? describeEventDetails(latestWaterChange) : "No event yet";
    $("metricLivestock").textContent = String(activeQuantity);
    $("metricLivestockMeta").textContent = `${activeLivestock.length} active records`;

    renderRiskStrip();
    renderHomeTimeline();
    renderHomeInsightBrief();
    refreshIcons();
  }

  function renderRiskStrip() {
    const risks = [];
    const latestTest = getLatestWaterTest();
    const latestWaterChange = getLatestEvent("water_change");

    if (!latestTest) {
      risks.push({ tone: "warning", label: "No water test logged" });
    } else {
      const testAge = daysSince(latestTest.measuredAt);
      if (testAge > 7) risks.push({ tone: "warning", label: "Water test is over 7 days old" });
      if (latestTest.ammonia !== null && latestTest.ammonia > 0.05) {
        risks.push({ tone: "danger", label: "Ammonia detected" });
      }
      if (latestTest.nitrite !== null && latestTest.nitrite > 0.05) {
        risks.push({ tone: "danger", label: "Nitrite detected" });
      }
      if (latestTest.nitrate !== null && latestTest.nitrate > 30) {
        risks.push({ tone: "warning", label: "Nitrate elevated" });
      }
    }

    if (!latestWaterChange) {
      risks.push({ tone: "warning", label: "No water change logged" });
    } else if (daysSince(latestWaterChange.happenedAt) > 21) {
      risks.push({ tone: "warning", label: "Water change over 21 days ago" });
    }

    if (!risks.length) risks.push({ tone: "good", label: "No obvious alerts" });

    $("riskStrip").innerHTML = risks
      .map((risk) => `<span class="risk-chip" data-tone="${risk.tone}">${escapeHtml(risk.label)}</span>`)
      .join("");
  }

  function renderHomeTimeline() {
    const entries = getTimelineEntries().slice(0, 4);
    $("homeTimeline").innerHTML = entries.length
      ? entries.map(renderTimelineEntry).join("")
      : `<div class="empty-state">No logs yet.</div>`;
  }

  function renderHomeInsightBrief() {
    const latest = state.insightRuns[0];
    if (!latest) {
      $("homeInsightBrief").innerHTML = `<div class="empty-state">No insights generated yet.</div>`;
      return;
    }
    $("homeInsightBrief").innerHTML = renderInsightCompact(latest.result, latest.source);
  }

  function renderTankProfileForm() {
    $$("[data-profile]").forEach((input) => {
      const key = input.dataset.profile;
      const value = state.profile[key];
      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else {
        input.value = value ?? "";
      }
    });
  }

  function updateProfileFromForm() {
    $$("[data-profile]").forEach((input) => {
      const key = input.dataset.profile;
      state.profile[key] = input.type === "checkbox" ? input.checked : input.value;
    });
    saveState();
    $("profileSavedStatus").textContent = "Saved";
    renderDashboard();
    renderInsightsContext();
  }

  function renderZones() {
    const zoneList = $("zoneList");
    zoneList.innerHTML = state.zones.length
      ? state.zones.map((zone) => `
        <article class="data-card">
          <div class="data-card-header">
            <div class="data-card-title">
              <strong>${escapeHtml(zone.name)}</strong>
              <p class="card-meta">${escapeHtml(zone.light)} light · ${escapeHtml(zone.flow)} flow${zone.parMin || zone.parMax ? ` · PAR ${escapeHtml(zone.parMin || "?")} - ${escapeHtml(zone.parMax || "?")}` : ""}</p>
            </div>
            <span class="category-pill">Zone</span>
          </div>
          ${zone.notes ? `<p class="card-meta">${escapeHtml(zone.notes)}</p>` : ""}
          <div class="card-actions">
            <button class="mini-button danger" type="button" data-zone-delete="${zone.id}">Delete</button>
          </div>
        </article>
      `).join("")
      : `<div class="empty-state">No placement zones.</div>`;

    const options = [
      `<option value="">Unplaced</option>`,
      ...state.zones.map((zone) => `<option value="${zone.id}">${escapeHtml(zone.name)}</option>`),
    ].join("");
    $("livestockZone").innerHTML = options;
  }

  function renderLivestock() {
    const activeCount = state.livestock.filter((item) => isLifecycleStock(item) && item.status === "active").length;
    const casualCount = state.livestock.filter((item) => isCasualStockCategory(item.category)).length;
    $("livestockCountPill").textContent = `${activeCount} active · ${casualCount} noticed`;
    $$("[data-livestock-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.livestockFilter === state.ui.livestockFilter);
    });

    const filter = state.ui.livestockFilter;
    const items = state.livestock.filter((item) => {
      if (filter === "all") return true;
      if (filter === "active") return isLifecycleStock(item) && item.status === "active";
      if (filter === "inactive") return isLifecycleStock(item) && item.status !== "active";
      return item.category === filter;
    });

    $("livestockList").innerHTML = items.length
      ? items.map(renderLivestockCard).join("")
      : `<div class="empty-state">No livestock records.</div>`;
  }

  function renderLivestockCard(item) {
    const casual = isCasualStockCategory(item.category);
    const quantity = formatQuantity(item.quantity);
    const healthParts = [
      item.health ? `Health: ${item.health}` : "",
      item.growthTrend ? `Growth: ${item.growthTrend}` : "",
      item.growthMetric ? `Metric: ${item.growthMetric}` : "",
    ].filter(Boolean);
    const outcome = !casual && item.status !== "active"
      ? `<p class="card-meta">${escapeHtml(item.status)}${item.removedDate ? ` on ${escapeHtml(formatDate(item.removedDate))}` : ""}${item.outcomeReason ? ` · ${escapeHtml(item.outcomeReason)}` : ""}</p>`
      : "";
    return `
      <article class="data-card">
        <div class="data-card-header">
          <div class="data-card-title">
            <strong>${escapeHtml(item.species)}</strong>
            <p class="card-meta">${escapeHtml(item.category)}${quantity ? ` · Qty ${escapeHtml(quantity)}` : ""}</p>
          </div>
          <span class="category-pill">${escapeHtml(casual ? "noticed" : item.status)}</span>
        </div>
        <p class="card-meta">${escapeHtml(formatStockDate(item))} · ${escapeHtml(getZoneName(item.zoneId))}</p>
        ${healthParts.length ? `<p class="card-meta">${escapeHtml(healthParts.join(" · "))}</p>` : ""}
        ${item.notes ? `<p class="card-meta">${escapeHtml(item.notes)}</p>` : ""}
        ${item.growthNotes ? `<p class="card-meta">${escapeHtml(item.growthNotes)}</p>` : ""}
        ${outcome}
        <div class="card-actions">
          <button class="mini-button" type="button" data-livestock-action="edit" data-id="${item.id}">Edit</button>
          ${!casual && item.status === "active" ? `
            <button class="mini-button danger" type="button" data-livestock-action="deceased" data-id="${item.id}">Deceased</button>
            <button class="mini-button" type="button" data-livestock-action="moved" data-id="${item.id}">Moved</button>
          ` : !casual ? `
            <button class="mini-button good" type="button" data-livestock-action="restore" data-id="${item.id}">Restore</button>
          ` : ""}
          <button class="mini-button danger" type="button" data-livestock-action="delete" data-id="${item.id}">Delete</button>
        </div>
      </article>
    `;
  }

  function renderLogMode() {
    const mode = state.ui.logMode || "test";
    $$("[data-log-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.logMode === mode);
    });
    Object.entries(logFormMap).forEach(([key, formId]) => {
      $(formId).classList.toggle("active", key === mode);
    });
    seedLogDates();
    updateTestTimingPill();
  }

  function renderTimeline() {
    const entries = getTimelineEntries();
    $("logTimeline").innerHTML = entries.length
      ? entries.map(renderTimelineEntry).join("")
      : `<div class="empty-state">No timeline entries.</div>`;
  }

  function renderTimelineEntry(entry) {
    return `
      <article class="timeline-item" data-kind="${entry.kind}">
        <div class="timeline-head">
          <div>
            <strong>${escapeHtml(entry.title)}</strong>
            <p class="timeline-meta">${escapeHtml(entry.meta)}</p>
          </div>
          <button class="mini-button danger" type="button" data-delete-entry="${entry.kind}:${entry.id}">Delete</button>
        </div>
        <p class="timeline-details">${escapeHtml(entry.details)}</p>
      </article>
    `;
  }

  function seedLogDates() {
    ["testMeasuredAt", "feedingAt", "maintenanceAt", "waterChangeAt"].forEach((id) => {
      if ($(id) && !$(id).value) $(id).value = toDatetimeLocal();
    });
  }

  function updateTestTimingPill() {
    const measuredAt = $("testMeasuredAt").value ? fromDatetimeLocal($("testMeasuredAt").value) : new Date().toISOString();
    const phase = getLightPhase(measuredAt).label;
    $("testTimingPill").textContent = phase;
  }

  function renderInsightsContext() {
    const context = buildInsightContext();
    $("contextCountPill").textContent = `${context.recentWaterTests.length + context.recentEvents.length} logs`;
    $("contextSummary").innerHTML = [
      { label: "Tank", value: state.profile.displayVolume ? `${state.profile.displayVolume} gal` : "No volume" },
      { label: "Stock", value: `${context.activeLivestock.length} active` },
      { label: "Latest Test", value: context.latestWaterTest ? formatAge(context.latestWaterTest.measuredAt) : "None" },
      { label: "Water Change", value: context.latestWaterChange ? formatAge(context.latestWaterChange.happenedAt) : "None" },
    ].map((tile) => `
      <div class="context-tile">
        <span>${escapeHtml(tile.label)}</span>
        <strong>${escapeHtml(tile.value)}</strong>
      </div>
    `).join("");
  }

  function renderInsightOutput() {
    const latest = state.insightRuns[0];
    if (!latest) {
      $("insightOutput").innerHTML = `<div class="empty-state">No result yet.</div>`;
      $("insightSourcePill").textContent = supabaseClient ? "GPT ready" : "Local";
      return;
    }
    $("insightSourcePill").textContent = latest.source === "gpt" ? "GPT" : "Local";
    $("insightOutput").innerHTML = renderInsightResult(latest.result);
  }

  function renderInsightCompact(result, source) {
    if (typeof result === "string") {
      return `<article class="insight-card"><strong>${source === "gpt" ? "GPT" : "Local"} insight</strong><p>${escapeHtml(result)}</p></article>`;
    }
    return `
      <article class="insight-card">
        <strong>${escapeHtml(result.headline || "Latest insight")}</strong>
        <p>${escapeHtml(result.summary || "No summary.")}</p>
      </article>
    `;
  }

  function renderInsightResult(result) {
    if (typeof result === "string") {
      return `<article class="insight-card"><p>${escapeHtml(result)}</p></article>`;
    }

    const priorities = Array.isArray(result.priorities) ? result.priorities : [];
    const observations = Array.isArray(result.observations) ? result.observations : [];
    const nextActions = Array.isArray(result.next_actions) ? result.next_actions : [];
    const missingData = Array.isArray(result.missing_data) ? result.missing_data : [];

    return `
      <article class="insight-card">
        <strong>${escapeHtml(result.headline || "Tank summary")}</strong>
        <p>${escapeHtml(result.summary || "No summary.")}</p>
      </article>
      ${priorities.map((priority) => `
        <article class="insight-card" data-tone="${escapeHtml(priority.severity || "warning")}">
          <strong>${escapeHtml(priority.label || "Priority")}</strong>
          <p>${escapeHtml(priority.why || "")}</p>
        </article>
      `).join("")}
      ${renderInsightList("Observations", observations)}
      ${renderInsightList("Next Actions", nextActions)}
      ${renderInsightList("Missing Data", missingData)}
    `;
  }

  function renderInsightList(title, items) {
    if (!items.length) return "";
    return `
      <article class="insight-card">
        <strong>${escapeHtml(title)}</strong>
        <ul>
          ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
    `;
  }

  function buildInsightContext() {
    const recentWaterTests = [...state.waterTests]
      .sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))
      .slice(0, 30);
    const recentEvents = [...state.events]
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))
      .slice(0, 50);
    const latestWaterTest = recentWaterTests[0] || null;
    const latestWaterChange = getLatestEvent("water_change");
    const latestFeeding = getLatestEvent("feeding");

    return {
      generatedAt: new Date().toISOString(),
      profile: state.profile,
      zones: state.zones,
      livestock: state.livestock,
      activeLivestock: state.livestock.filter((item) => isLifecycleStock(item) && item.status === "active"),
      recentWaterTests,
      recentEvents,
      latestWaterTest,
      latestWaterChange,
      latestFeeding,
      currentLightPhase: getLightPhase().label,
      derived: latestWaterTest
        ? {
            latestTestLightPhase: latestWaterTest.timing?.lightPhase || getLightPhase(latestWaterTest.measuredAt).label,
            latestTestAfterWaterChange: describeTimeAfter(getLatestEventBefore("water_change", latestWaterTest.measuredAt), latestWaterTest.measuredAt),
            latestTestAfterFeeding: describeTimeAfter(getLatestEventBefore("feeding", latestWaterTest.measuredAt), latestWaterTest.measuredAt),
          }
        : {},
    };
  }

  function generateLocalInsight(mode, question) {
    const context = buildInsightContext();
    const priorities = [];
    const observations = [];
    const nextActions = [];
    const missingData = [];
    const latest = context.latestWaterTest;

    if (!context.profile.displayVolume) missingData.push("Display volume");
    if (!context.profile.filtration) missingData.push("Filtration type");
    if (!context.profile.lightingModel) missingData.push("Lighting model");
    if (!context.zones.length) missingData.push("Placement zones");
    if (!latest) missingData.push("Recent water test");

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

      observations.push(`Latest test was taken ${context.derived.latestTestAfterWaterChange} the last water change.`);
      observations.push(`Latest test was taken ${context.derived.latestTestAfterFeeding} the last feeding.`);
      observations.push(`Lighting phase at the latest test: ${context.derived.latestTestLightPhase}.`);
    }

    const waterChangeAge = context.latestWaterChange ? daysSince(context.latestWaterChange.happenedAt) : null;
    if (waterChangeAge !== null && waterChangeAge > 21) {
      priorities.push({
        label: "Water change cadence",
        severity: "warning",
        why: `The last logged water change was ${waterChangeAge} days ago.`,
      });
    }

    if (mode === "maintenance") {
      ["RODI replaced", "Carbon replaced", "Purigen replaced"].forEach((label) => {
        const event = [...state.events].filter((item) => item.label === label).sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))[0];
        observations.push(`${label}: ${event ? formatAge(event.happenedAt) : "not logged"}.`);
      });
      nextActions.push("Keep media changes logged as events so they can be compared against nutrient shifts.");
    }

    if (mode === "livestock") {
      const unplaced = context.activeLivestock.filter((item) => !item.zoneId);
      if (unplaced.length) {
        priorities.push({
          label: "Unplaced livestock",
          severity: "warning",
          why: `${unplaced.length} active livestock record${unplaced.length === 1 ? "" : "s"} do not have a placement zone.`,
        });
      }
      nextActions.push("Assign corals and sensitive inverts to zones so light and flow context can be included.");
    }

    if (mode === "trends" && state.waterTests.length < 3) {
      missingData.push("At least three water tests for trend analysis");
    }

    if (question) observations.push(`User question: ${question}`);

    if (!priorities.length) {
      priorities.push({
        label: "No urgent local alerts",
        severity: "good",
        why: "The local rule check did not find detectable ammonia, detectable nitrite, or stale core logs.",
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
    };
  }

  async function generateInsight() {
    const mode = state.ui.insightMode || "health";
    const question = $("insightQuestion").value.trim();
    const button = $("generateInsightButton");
    button.disabled = true;
    button.textContent = "Generating";

    try {
      let result;
      let source = "local";
      if (supabaseClient) {
        const response = await supabaseClient.functions.invoke("generate-insights", {
          body: {
            mode,
            question,
            state: buildInsightContext(),
          },
        });
        if (response.error) throw response.error;
        result = response.data?.insight || response.data?.text || response.data;
        source = "gpt";
      } else {
        result = generateLocalInsight(mode, question);
      }

      state.insightRuns.unshift({
        id: uid(),
        createdAt: new Date().toISOString(),
        mode,
        question,
        source,
        result,
      });
      state.insightRuns = state.insightRuns.slice(0, 20);
      saveState();
      renderInsightOutput();
      renderHomeInsightBrief();
      showToast(source === "gpt" ? "GPT insight generated." : "Local insight generated.");
    } catch (error) {
      console.error(error);
      const fallback = generateLocalInsight(mode, question);
      state.insightRuns.unshift({
        id: uid(),
        createdAt: new Date().toISOString(),
        mode,
        question,
        source: "local",
        result: fallback,
      });
      saveState();
      renderInsightOutput();
      renderHomeInsightBrief();
      showToast("GPT unavailable. Local insight generated.");
    } finally {
      button.disabled = false;
      button.innerHTML = `<i data-lucide="sparkles"></i>Generate`;
      refreshIcons();
    }
  }

  function renderBackendSettings() {
    $("backendUrl").value = backendConfig.supabaseUrl || "";
    $("backendAnonKey").value = backendConfig.supabaseAnonKey || "";
    updateBackendStatus();
  }

  function updateBackendStatus(message) {
    if (message) {
      $("backendStatus").textContent = message;
      return;
    }
    if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) {
      $("backendStatus").textContent = "Local mode";
    } else if (currentUser) {
      $("backendStatus").textContent = `Auto sync on · signed in as ${currentUser.email || currentUser.id}`;
    } else {
      $("backendStatus").textContent = "Auto sync is on.";
    }
  }

  async function initBackend() {
    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }
    supabaseClient = null;
    currentUser = null;

    if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey || !window.supabase) {
      updateBackendStatus();
      return;
    }

    supabaseClient = window.supabase.createClient(
      backendConfig.supabaseUrl,
      backendConfig.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );

    const sessionResponse = await supabaseClient.auth.getSession();
    currentUser = sessionResponse.data?.session?.user || null;
    const subscription = supabaseClient.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      updateBackendStatus();
      renderInsightOutput();
    });
    authSubscription = subscription.data?.subscription || null;
    updateBackendStatus();
    renderInsightOutput();
    await pullState({ silent: true, startup: true });
  }

  async function saveBackendSettings() {
    backendConfig = {
      supabaseUrl: $("backendUrl").value.trim(),
      supabaseAnonKey: $("backendAnonKey").value.trim(),
    };
    writeJson(BACKEND_KEY, backendConfig);
    await initBackend();
    showToast("Backend saved.");
  }

  function ensureBackend() {
    if (!supabaseClient) {
      showToast("Add Supabase settings first.");
      return false;
    }
    return true;
  }

  async function sendMagicLink() {
    if (!supabaseClient) {
      showToast("Add Supabase settings first.");
      return;
    }
    const email = $("authEmail").value.trim();
    if (!email) {
      showToast("Enter an email.");
      return;
    }
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href.split("#")[0],
      },
    });
    if (error) {
      console.error(error);
      showToast("Could not send link.");
      return;
    }
    showToast("Magic link sent.");
  }

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    currentUser = null;
    updateBackendStatus();
    showToast("Signed out.");
  }

  async function pushState(options = {}) {
    if (!ensureBackend()) return;
    if (remoteSaveInFlight) {
      remoteSaveQueued = true;
      return;
    }
    remoteSaveInFlight = true;
    const { error } = await supabaseClient
      .from("reef_shared_state")
      .upsert(
        {
          id: SHARED_STATE_ID,
          data: state,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    remoteSaveInFlight = false;
    if (error) {
      console.error(error);
      if (!options.silent) showToast("Sync failed.");
      return;
    }
    updateBackendStatus(
      options.silent
        ? `Autosaved at ${new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}.`
        : "Synced.",
    );
    if (!options.silent) showToast("Synced.");
    if (remoteSaveQueued) {
      remoteSaveQueued = false;
      scheduleRemoteSave(50);
    }
  }

  async function pullState(options = {}) {
    if (!ensureBackend()) return;
    const { data, error } = await supabaseClient
      .from("reef_shared_state")
      .select("data, updated_at")
      .eq("id", SHARED_STATE_ID)
      .maybeSingle();
    if (error) {
      console.error(error);
      if (!options.silent) showToast("Pull failed.");
      return;
    }
    if (!data?.data) {
      if (options.startup) {
        await pushState({ silent: true });
      } else if (!options.silent) {
        showToast("No remote state yet.");
      }
      return;
    }

    const remoteState = normalizeState(data.data);
    const localTime = new Date(state.updatedAt || 0).getTime();
    const remoteTime = new Date(remoteState.updatedAt || data.updated_at || 0).getTime();
    const localHasData = hasMeaningfulState(state);
    const remoteHasData = hasMeaningfulState(remoteState);
    if (options.startup && localHasData && (!remoteHasData || localTime > remoteTime)) {
      await pushState({ silent: true });
      return;
    }
    if (options.startup && !remoteHasData && localHasData) {
      await pushState({ silent: true });
      return;
    }
    if (options.startup && !remoteHasData && !localHasData) {
      return;
    }

    isRemoteHydrating = true;
    state = remoteState;
    writeJson(STORAGE_KEY, state);
    isRemoteHydrating = false;
    renderAll();
    if (!options.silent) showToast("Pulled from Supabase.");
  }

  function addZone(event) {
    event.preventDefault();
    const name = $("zoneName").value.trim();
    if (!name) {
      showToast("Zone needs a name.");
      return;
    }
    state.zones.push({
      id: uid(),
      name,
      light: $("zoneLight").value,
      flow: $("zoneFlow").value,
      parMin: $("zoneParMin").value,
      parMax: $("zoneParMax").value,
      notes: $("zoneNotes").value.trim(),
    });
    $("zoneForm").reset();
    $("zoneLight").value = "Medium";
    $("zoneFlow").value = "Medium";
    saveState();
    renderZones();
    renderInsightsContext();
    showToast("Zone added.");
  }

  function getLivestockFormData() {
    const species = $("livestockSpecies").value.trim();
    const category = $("livestockCategory").value;
    const addedDate = $("livestockAdded").value;
    const isLegacy = $("livestockLegacy").checked || (!addedDate && !isCasualStockCategory(category));
    const casual = isCasualStockCategory(category);

    return {
      species,
      name: species,
      category,
      quantity: $("livestockQuantity").value,
      addedDate,
      isLegacy: casual ? false : isLegacy,
      status: casual ? "noticed" : "active",
      zoneId: $("livestockZone").value,
      notes: $("livestockNotes").value.trim(),
      health: $("livestockHealth").value,
      growthTrend: $("livestockGrowthTrend").value,
      growthMetric: $("livestockGrowthMetric").value.trim(),
      growthNotes: $("livestockGrowthNotes").value.trim(),
    };
  }

  function resetLivestockForm() {
    $("livestockForm").reset();
    $("livestockEditId").value = "";
    $("livestockFormTitle").textContent = "Add Stock";
    $("livestockSubmitButton").innerHTML = `<i data-lucide="plus"></i>Add`;
    $("cancelLivestockEditButton").hidden = true;
    refreshIcons();
  }

  function startLivestockEdit(id) {
    const item = state.livestock.find((entry) => entry.id === id);
    if (!item) return;
    $("livestockEditId").value = item.id;
    $("livestockSpecies").value = item.species || item.name || "";
    $("livestockCategory").value = item.category || "Other";
    $("livestockQuantity").value = item.quantity ?? "";
    $("livestockAdded").value = item.addedDate || "";
    $("livestockLegacy").checked = Boolean(item.isLegacy);
    $("livestockZone").value = item.zoneId || "";
    $("livestockNotes").value = item.notes || "";
    $("livestockHealth").value = item.health || "";
    $("livestockGrowthTrend").value = item.growthTrend || "";
    $("livestockGrowthMetric").value = item.growthMetric || "";
    $("livestockGrowthNotes").value = item.growthNotes || "";
    $("livestockFormTitle").textContent = "Edit Stock";
    $("livestockSubmitButton").innerHTML = `<i data-lucide="save"></i>Save`;
    $("cancelLivestockEditButton").hidden = false;
    $("livestockForm").scrollIntoView({ behavior: "smooth", block: "start" });
    refreshIcons();
  }

  function addLivestock(event) {
    event.preventDefault();
    const formData = getLivestockFormData();
    if (!formData.species) return;
    const editId = $("livestockEditId").value;
    const existing = editId ? state.livestock.find((item) => item.id === editId) : null;

    if (existing) {
      Object.assign(existing, {
        ...formData,
        status: isCasualStockCategory(formData.category) ? "noticed" : existing.status === "noticed" ? "active" : existing.status,
      });
    } else {
      state.livestock.push({
        id: uid(),
        ...formData,
        removedDate: "",
        outcomeReason: "",
      });
    }

    resetLivestockForm();
    saveState();
    renderLivestock();
    renderDashboard();
    renderInsightsContext();
    showToast(existing ? "Stock updated." : "Stock added.");
  }

  function addWaterTest(event) {
    event.preventDefault();
    const measuredAt = fromDatetimeLocal($("testMeasuredAt").value);
    const previousWaterChange = getLatestEventBefore("water_change", measuredAt);
    const previousFeeding = getLatestEventBefore("feeding", measuredAt);
    const test = {
      id: uid(),
      measuredAt,
      ammonia: readNumber("testAmmonia"),
      nitrite: readNumber("testNitrite"),
      nitrate: readNumber("testNitrate"),
      phosphate: readNumber("testPhosphate"),
      ph: readNumber("testPh"),
      salinity: $("testSalinity").value.trim(),
      temperature: $("testTemp").value.trim(),
      alkalinity: readNumber("testAlk"),
      calcium: readNumber("testCalcium"),
      magnesium: readNumber("testMagnesium"),
      notes: $("testNotes").value.trim(),
      timing: {
        lightPhase: getLightPhase(measuredAt).label,
        afterWaterChange: describeTimeAfter(previousWaterChange, measuredAt),
        afterFeeding: describeTimeAfter(previousFeeding, measuredAt),
      },
    };

    const hasValues = Object.entries(test).some(([key, value]) => {
      if (["id", "measuredAt", "timing"].includes(key)) return false;
      return value !== null && value !== "";
    });
    if (!hasValues) {
      showToast("Add at least one value.");
      return;
    }

    state.waterTests.push(test);
    $("waterTestForm").reset();
    seedLogDates();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast("Water test saved.");
  }

  function addFeeding(event) {
    event.preventDefault();
    state.events.push({
      id: uid(),
      type: "feeding",
      happenedAt: fromDatetimeLocal($("feedingAt").value),
      label: $("feedingFood").value,
      amount: $("feedingAmount").value.trim(),
      target: $("feedingTarget").value.trim(),
      notes: $("feedingNotes").value.trim(),
    });
    $("feedingForm").reset();
    seedLogDates();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast("Feeding saved.");
  }

  function addMaintenance(event) {
    event.preventDefault();
    state.events.push({
      id: uid(),
      type: "maintenance",
      happenedAt: fromDatetimeLocal($("maintenanceAt").value),
      label: $("maintenanceType").value,
      details: $("maintenanceDetails").value.trim(),
    });
    $("maintenanceForm").reset();
    seedLogDates();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast("Maintenance saved.");
  }

  function addWaterChange(event) {
    event.preventDefault();
    state.events.push({
      id: uid(),
      type: "water_change",
      happenedAt: fromDatetimeLocal($("waterChangeAt").value),
      label: "Water change",
      gallons: $("waterChangeGallons").value,
      percent: $("waterChangePercent").value,
      notes: $("waterChangeNotes").value.trim(),
    });
    $("waterChangeForm").reset();
    seedLogDates();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast("Water change saved.");
  }

  function handleDocumentClick(event) {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      setActiveView(viewButton.dataset.view);
      return;
    }

    const viewLink = event.target.closest("[data-view-link]");
    if (viewLink) {
      setActiveView(viewLink.dataset.viewLink);
      return;
    }

    const quickLog = event.target.closest("[data-open-log]");
    if (quickLog) {
      state.ui.logMode = quickLog.dataset.openLog;
      saveLocalState();
      setActiveView("logbook");
      renderLogMode();
      return;
    }

    const logMode = event.target.closest("[data-log-mode]");
    if (logMode) {
      state.ui.logMode = logMode.dataset.logMode;
      saveLocalState();
      renderLogMode();
      return;
    }

    const livestockFilter = event.target.closest("[data-livestock-filter]");
    if (livestockFilter) {
      state.ui.livestockFilter = livestockFilter.dataset.livestockFilter;
      saveLocalState();
      renderLivestock();
      return;
    }

    const insightMode = event.target.closest("[data-insight-mode]");
    if (insightMode) {
      state.ui.insightMode = insightMode.dataset.insightMode;
      $$("[data-insight-mode]").forEach((button) => {
        button.classList.toggle("active", button === insightMode);
      });
      $("insightModePill").textContent = insightMode.textContent.trim();
      saveLocalState();
      return;
    }

    const zoneDelete = event.target.closest("[data-zone-delete]");
    if (zoneDelete) {
      const id = zoneDelete.dataset.zoneDelete;
      state.zones = state.zones.filter((zone) => zone.id !== id);
      state.livestock.forEach((item) => {
        if (item.zoneId === id) item.zoneId = "";
      });
      saveState();
      renderZones();
      renderLivestock();
      renderInsightsContext();
      showToast("Zone deleted.");
      return;
    }

    const livestockAction = event.target.closest("[data-livestock-action]");
    if (livestockAction) {
      updateLivestockStatus(livestockAction.dataset.id, livestockAction.dataset.livestockAction);
      return;
    }

    const deleteEntry = event.target.closest("[data-delete-entry]");
    if (deleteEntry) {
      deleteTimelineEntry(deleteEntry.dataset.deleteEntry);
    }
  }

  function updateLivestockStatus(id, action) {
    const item = state.livestock.find((entry) => entry.id === id);
    if (!item) return;
    if (action === "edit") {
      startLivestockEdit(id);
      return;
    }
    if (action === "delete") {
      state.livestock = state.livestock.filter((entry) => entry.id !== id);
    } else if (action === "restore") {
      item.status = "active";
      item.removedDate = "";
      item.outcomeReason = "";
    } else if (action === "deceased") {
      item.status = "deceased";
      item.removedDate = todayInputValue();
      item.outcomeReason = window.prompt("Suspected cause or note?", item.outcomeReason || "") || "";
    } else if (action === "moved") {
      item.status = "moved";
      item.removedDate = todayInputValue();
      item.outcomeReason = window.prompt("Moved where?", item.outcomeReason || "") || "";
    }
    saveState();
    renderLivestock();
    renderDashboard();
    renderInsightsContext();
    showToast("Livestock updated.");
  }

  function deleteTimelineEntry(key) {
    const [kind, id] = key.split(":");
    if (kind === "test") {
      state.waterTests = state.waterTests.filter((test) => test.id !== id);
    } else {
      state.events = state.events.filter((event) => event.id !== id);
    }
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast("Entry deleted.");
  }

  function deleteLastEntry() {
    const latest = getTimelineEntries()[0];
    if (!latest) {
      showToast("No entries to delete.");
      return;
    }
    deleteTimelineEntry(`${latest.kind}:${latest.id}`);
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);
    $$("[data-profile]").forEach((input) => {
      input.addEventListener("input", updateProfileFromForm);
      input.addEventListener("change", updateProfileFromForm);
    });
    $("zoneForm").addEventListener("submit", addZone);
    $("livestockForm").addEventListener("submit", addLivestock);
    $("cancelLivestockEditButton").addEventListener("click", resetLivestockForm);
    $("waterTestForm").addEventListener("submit", addWaterTest);
    $("feedingForm").addEventListener("submit", addFeeding);
    $("maintenanceForm").addEventListener("submit", addMaintenance);
    $("waterChangeForm").addEventListener("submit", addWaterChange);
    $("testMeasuredAt").addEventListener("change", updateTestTimingPill);
    $("generateInsightButton").addEventListener("click", generateInsight);
    $("saveBackendButton").addEventListener("click", saveBackendSettings);
    $("sendMagicLinkButton").addEventListener("click", sendMagicLink);
    $("signOutButton").addEventListener("click", signOut);
    $("pullStateButton").addEventListener("click", pullState);
    $("pushStateButton").addEventListener("click", pushState);
    $("clearMistakeButton").addEventListener("click", deleteLastEntry);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        pushState({ silent: true });
      }
    });
  }

  function initInsightMode() {
    $$("[data-insight-mode]").forEach((button) => {
      const active = button.dataset.insightMode === state.ui.insightMode;
      button.classList.toggle("active", active);
      if (active) $("insightModePill").textContent = button.textContent.trim();
    });
  }

  async function init() {
    await loadLocalBackendConfig();
    bindEvents();
    seedLogDates();
    initInsightMode();
    renderAll();
    await initBackend();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.warn("Service worker registration failed", error);
      });
    });
  }

  init();
})();
