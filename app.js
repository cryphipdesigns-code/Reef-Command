(function () {
  const STORAGE_KEY = "reefCommandState.v1";
  const BACKEND_KEY = "reefCommandBackend.v1";
  const PRE_PULL_BACKUP_KEY = "reefCommandState.beforeRemotePull.v1";
  const PRE_RECORD_JOURNAL_BACKUP_KEY = "reefCommandState.beforeRecordJournal.v1";
  const PRIVATE_STATE_TABLE = "reef_app_state";
  const PHOTO_BUCKET = "reef-photos";
  const PHOTO_PLACEHOLDER_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const PRIVATE_STARTUP_TIMEOUT_MS = 12000;
  const LOCAL_PHOTO_DATA_URL_LIMIT = 2_750_000;
  const RECORDS = window.ReefRecords || {};
  const JOURNAL = window.ReefJournal || {};
  const STATE_SCHEMA_VERSION = RECORDS.SCHEMA_VERSION || 2;
  const MAP2_REFINEMENT_SHAPES = ["navigate", "point", "line", "area"];
  const MAP2_REFINEMENT_ACTIONS = ["raise", "depress", "flatten", "cut-back", "smooth", "ridge"];
  const MAP2_REFINEMENT_DIRECTIONS = ["surface", "top-bottom", "left-right", "front-back"];
  const MAP2_REFINEMENT_STRENGTHS = ["light", "medium", "strong"];
  const MAP2_RIGHT_ROCK_OPTION5_REFINEMENT_BASE = "right-rock-option5";

  const viewMap = {
    home: "homeView",
    tank: "tankView",
    map: "mapView",
    livestock: "livestockView",
    logbook: "logbookView",
    insights: "insightsView",
  };

  const EQUIPMENT_FIELDS = [
    { key: "proteinSkimmer", label: "Protein skimmer", dateKey: "proteinSkimmerAddedDate", legacyKey: "proteinSkimmerLegacy", detailsKey: "proteinSkimmerDetails" },
    { key: "sump", label: "Sump", dateKey: "sumpAddedDate", legacyKey: "sumpLegacy", detailsKey: "sumpDetails" },
    { key: "refugium", label: "Refugium", dateKey: "refugiumAddedDate", legacyKey: "refugiumLegacy", detailsKey: "refugiumDetails" },
    { key: "autoTopOff", label: "Auto top-off", dateKey: "autoTopOffAddedDate", legacyKey: "autoTopOffLegacy", detailsKey: "autoTopOffDetails" },
    { key: "autoFeeder", label: "Auto feeder", dateKey: "autoFeederAddedDate", legacyKey: "autoFeederLegacy", detailsKey: "autoFeederDetails", scheduleKey: "autoFeederSchedule" },
    { key: "uvSterilizer", label: "UV", dateKey: "uvSterilizerAddedDate", legacyKey: "uvSterilizerLegacy", detailsKey: "uvSterilizerDetails", scheduleKey: "uvSchedule" },
    { key: "gfoReactor", label: "GFO reactor", dateKey: "gfoReactorAddedDate", legacyKey: "gfoReactorLegacy", detailsKey: "gfoReactorDetails" },
    { key: "carbonReactor", label: "Carbon reactor", dateKey: "carbonReactorAddedDate", legacyKey: "carbonReactorLegacy", detailsKey: "carbonReactorDetails" },
  ];

  const CARE_TASKS = [
    { key: "water_change", label: "Water change", source: "event_type", type: "water_change", intervalDays: 7, overdueLabel: "Water change overdue" },
    { key: "water_test", label: "Water test", source: "water_test", intervalDays: 7, overdueLabel: "Water test overdue" },
    { key: "top_carbon", label: "Top carbon", source: "maintenance_label", labelMatch: "Top Carbon replaced", intervalDays: 28, overdueLabel: "Top carbon overdue" },
    { key: "bottom_carbon", label: "Bottom carbon", source: "maintenance_label", labelMatch: "Bottom Carbon replaced", intervalDays: 28, overdueLabel: "Bottom carbon overdue" },
    { key: "uv_bulb", label: "UV bulb", source: "maintenance_label", labelMatch: "UV bulb replaced", intervalDays: null, overdueLabel: "UV bulb replacement due" },
  ];

  const initialStoredState = readJson(STORAGE_KEY);
  snapshotPreMigrationState(initialStoredState);
  let state = normalizeState(initialStoredState || getDefaultState());
  let backendConfig = readJson(BACKEND_KEY) || {};
  let supabaseClient = null;
  let currentUser = null;
  let privateStateReady = false;
  let localOnlyMode = false;
  let authSubscription = null;
  let autosaveTimer = null;
  let remoteSaveInFlight = false;
  let remoteSaveQueued = false;
  let lastRemoteUpdatedAt = "";
  let isRemoteHydrating = false;
  let lastLocalCacheWarningAt = 0;
  let toastTimer = null;
  let pendingConfirmResolve = null;
  let pendingLivestockPhotos = [];
  let editingLivestockId = "";
  let tankProfileEditing = false;
  let pendingInsightPhotos = [];
  let pendingInsightFollowupPhotos = [];
  let pendingInsightFollowupRunId = "";
  const signedPhotoUrls = new Map();
  const signedPhotoUrlRequests = new Set();
  let signedPhotoRenderTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function getLidarHeightMap(key) {
    const map = window.REEF_LIDAR_HEIGHTMAPS?.[key];
    if (!map || !Array.isArray(map.values)) return null;
    return {
      rows: map.rows,
      columns: map.columns,
      axis: map.axis,
      source: map.source,
      values: map.values,
    };
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function getDefaultState() {
    return {
      version: STATE_SCHEMA_VERSION,
      schemaVersion: STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      profile: {
        tankName: "Reef Tank",
        displayVolume: "",
        totalVolume: "",
        startDate: "",
        tankStyle: "",
        filtration: "",
        filtrationDetails: "",
        lightingModel: "",
        lightingSummary: "",
        lightingPhotos: [],
        lightingPhoto: null,
        lightingPhotoDataUrl: "",
        lightStart: "10:00",
        lightEnd: "20:00",
        targetSalinity: "1.026",
        targetTemp: "78 F",
        saltMix: "",
        dosing: "",
        tankSummary: "",
        proteinSkimmer: false,
        proteinSkimmerAddedDate: "",
        proteinSkimmerLegacy: false,
        proteinSkimmerDetails: "",
        sump: false,
        sumpAddedDate: "",
        sumpLegacy: false,
        sumpDetails: "",
        refugium: false,
        refugiumAddedDate: "",
        refugiumLegacy: false,
        refugiumDetails: "",
        autoTopOff: false,
        autoTopOffAddedDate: "",
        autoTopOffLegacy: false,
        autoTopOffDetails: "",
        autoFeeder: false,
        autoFeederAddedDate: "",
        autoFeederLegacy: false,
        autoFeederDetails: "",
        autoFeederSchedule: "",
        uvSterilizer: false,
        uvSterilizerAddedDate: "",
        uvSterilizerLegacy: false,
        uvSterilizerDetails: "",
        uvSchedule: "",
        gfoReactor: false,
        gfoReactorAddedDate: "",
        gfoReactorLegacy: false,
        gfoReactorDetails: "",
        carbonReactor: false,
        carbonReactorAddedDate: "",
        carbonReactorLegacy: false,
        carbonReactorDetails: "",
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
      records: {
        equipment: [],
        livestock: [],
      },
      journal: [],
      legacyRaw: null,
      insightRuns: [],
      map: getDefaultMap(),
      ui: {
        activeView: "home",
        logMode: "test",
        livestockFilter: "active",
        insightMode: "chat",
        mapTool: "navigate",
        selectedMapStockId: "",
        map2FocusStructureId: "tank",
        map2NavTool: "rotate",
        map2RefinementShape: "navigate",
        map2RefinementAction: "raise",
        map2RefinementDirection: "surface",
        map2RefinementStrength: "medium",
        map2RefinementRadius: 0.8,
        map2RefinementNote: "",
        map2RefinementOverlayVisible: true,
        map2RefinementOverlayOpacity: 0.35,
      },
    };
  }

  function getDefaultMap() {
    return {
      modelVersion: 21,
      dimensions: {
        width: 30,
        depth: 12,
        height: 18,
        sandDepth: 1.3,
        waterline: 16.4,
        scaleReference: "3 inch sticky-note cards plus 2 inch in-tank ruler for right rock",
        calibrationNotes: "Five-rock mesh. Right rock and shelf use LiDAR heightmaps with silhouette constraint; left rock uses Option 5 silhouette-refined geometry; front rocks use legacy profile geometry.",
      },
      view: "front",
      layers: {
        par: true,
        livestock: true,
        flow: false,
        equipment: false,
        trace: true,
      },
      parMarkers: [],
      refinementAnnotations: [],
      structures: [
        {
          id: "left-rock",
          name: "Left rock",
          type: "profile-rock",
          x: -10.35,
          y: 1.05,
          z: 1.3,
          width: 7.8,
          depth: 10.8,
          height: 5.2,
          touchesBackGlass: true,
          footprint: [[-4.1, -3.5], [-3.65, -5.2], [-2.4, -5.95], [-1.05, -5.55], [0.8, -5.85], [2.25, -4.9], [3.25, -3.0], [3.35, -0.82], [3.15, 1.2], [2.55, 2.75], [1.85, 4.12], [0.65, 4.85], [-1.35, 4.75], [-2.65, 3.88], [-3.45, 2.35], [-3.9, 0.45]],
          frontProfile: [[-3.95, 0.8], [-3.35, 1.7], [-2.65, 2.65], [-1.65, 3.85], [-0.45, 4.95], [0.75, 4.72], [1.75, 3.65], [2.7, 2.55], [3.35, 1.08]],
          sideProfile: [[-5.95, 0.12], [-5.15, 0.28], [-4.2, 0.85], [-2.4, 2.15], [-0.65, 3.55], [1.35, 4.65], [3.15, 4.92], [4.85, 3.55]],
          heightPoints: [
            { x: -2.2, y: -1.4, h: 0.32, r: 1.35 },
            { x: -0.4, y: 0.25, h: 0.55, r: 1.7 },
            { x: 1.25, y: 1.6, h: 0.34, r: 1.2 },
          ],
          ridges: [
            { from: [-2.8, -1.15], to: [2.0, 1.55], h: 0.34, r: 0.7 },
          ],
          depressions: [
            { x: 2.15, y: -1.85, h: 0.3, r: 0.8 },
          ],
          edgeSoftness: 1.45,
          edgeFloor: 0.28,
          frontTaperDepth: 5.2,
          frontFloor: 0.16,
          frontSkirtLift: 0.92,
          sideSkirtLift: 0.82,
          surfaceNoise: 0.045,
          light: "Low-Medium",
          flow: "Medium",
          parMin: 45,
          parMax: 120,
          notes: "Back-glass-touching left rock. Option 5 silhouette-refined base geometry with broad PAR-relevant mass, ready for manual geometry-note refinement.",
        },
        {
          id: "front-left-rock",
          name: "Front left rock",
          type: "profile-rock",
          x: -3.35,
          y: -4.35,
          z: 1.3,
          width: 5.2,
          depth: 2.8,
          height: 2.0,
          footprint: [[-2.55, -1.05], [-1.65, -1.35], [-0.35, -1.22], [1.35, -0.92], [2.35, -0.25], [2.55, 0.68], [1.35, 1.18], [-0.15, 1.32], [-1.55, 0.98], [-2.42, 0.28]],
          frontProfile: [[-2.55, 0.42], [-1.65, 1.05], [-0.45, 1.6], [0.85, 1.42], [1.85, 0.9], [2.55, 0.45]],
          sideProfile: [[-1.35, 0.18], [-0.45, 1.2], [0.42, 1.55], [1.32, 0.72]],
          heightPoints: [
            { x: -0.95, y: -0.2, h: 0.22, r: 0.8 },
            { x: 0.55, y: 0.1, h: 0.18, r: 0.75 },
          ],
          ridges: [
            { from: [-1.55, -0.18], to: [1.45, 0.25], h: 0.18, r: 0.42 },
          ],
          depressions: [],
          edgeSoftness: 0.95,
          edgeFloor: 0.22,
          frontTaperDepth: 2.6,
          frontFloor: 0.16,
          frontSkirtLift: 0.9,
          sideSkirtLift: 0.82,
          surfaceNoise: 0.04,
          light: "Low",
          flow: "Low-Medium",
          parMin: 35,
          parMax: 85,
          notes: "Low front sandbed rock below the shelf, separated from the left rock by visible sand.",
        },
        {
          id: "front-right-rock",
          name: "Front right rock",
          type: "profile-rock",
          x: 2.75,
          y: -4.25,
          z: 1.3,
          width: 5.4,
          depth: 3.2,
          height: 2.7,
          footprint: [[-2.75, -1.25], [-1.55, -1.55], [0.4, -1.38], [2.0, -0.82], [2.65, 0.18], [2.38, 1.15], [1.25, 1.55], [-0.45, 1.35], [-1.9, 0.82], [-2.65, -0.18]],
          frontProfile: [[-2.75, 0.7], [-1.8, 1.35], [-0.5, 2.18], [0.75, 2.35], [1.75, 1.75], [2.65, 0.82]],
          sideProfile: [[-1.55, 0.22], [-0.55, 1.85], [0.48, 2.25], [1.55, 1.05]],
          heightPoints: [
            { x: -0.8, y: -0.2, h: 0.22, r: 0.82 },
            { x: 0.75, y: 0.15, h: 0.28, r: 0.85 },
          ],
          ridges: [
            { from: [-1.4, -0.35], to: [1.5, 0.3], h: 0.22, r: 0.44 },
          ],
          depressions: [],
          edgeSoftness: 0.98,
          edgeFloor: 0.22,
          frontTaperDepth: 2.7,
          frontFloor: 0.16,
          frontSkirtLift: 0.9,
          sideSkirtLift: 0.82,
          surfaceNoise: 0.04,
          light: "Low",
          flow: "Medium",
          parMin: 30,
          parMax: 70,
          notes: "Front sandbed rock under the shelf opening, separate from the right rock with a sand gap.",
        },
        {
          id: "right-rock",
          name: "Right rock",
          type: "profile-rock",
          x: 10.35,
          y: 1.1,
          z: 1.3,
          width: 8.3,
          depth: 10.9,
          height: 5.05,
          touchesBackGlass: true,
          footprint: [[-4.18, -2.85], [-3.92, -3.78], [-3.1, -4.55], [-2.18, -5.2], [-1.18, -4.78], [-0.45, -5.55], [0.34, -5.08], [1.02, -5.62], [1.95, -4.85], [3.08, -4.72], [3.88, -3.85], [4.32, -2.62], [3.82, -1.45], [4.18, -0.18], [3.82, 1.18], [4.12, 2.6], [3.48, 3.85], [2.35, 4.62], [1.02, 4.85], [0.24, 4.32], [-0.84, 4.72], [-1.56, 3.98], [-2.42, 4.12], [-3.12, 3.25], [-3.82, 2.12], [-4.22, 0.72], [-3.62, -0.45], [-4.3, -1.55]],
          frontProfile: [[-4.05, 0.6], [-3.45, 1.15], [-2.72, 2.55], [-1.7, 3.18], [-0.55, 3.42], [0.55, 4.15], [1.35, 5.0], [2.35, 4.7], [3.28, 3.25], [3.95, 1.1]],
          sideProfile: [[-5.55, 0.1], [-4.62, 0.9], [-3.45, 1.95], [-2.18, 3.05], [-0.72, 3.95], [0.7, 4.85], [2.45, 4.62], [3.75, 3.8], [5.05, 3.1]],
          heightPoints: [
            { x: -3.35, y: -1.05, h: 0.88, r: 0.82 },
            { x: -2.48, y: 2.62, h: 0.62, r: 0.92 },
            { x: -1.06, y: -4.48, h: 0.72, r: 0.76 },
            { x: 0.55, y: 3.58, h: 0.72, r: 1.0 },
            { x: 1.18, y: -0.35, h: 1.02, r: 0.9 },
            { x: 2.72, y: -4.32, h: 0.48, r: 0.7 },
            { x: 2.82, y: 2.95, h: 0.42, r: 0.82 },
          ],
          ridges: [
            { from: [-3.62, -0.72], to: [-1.2, -0.12], h: 0.46, r: 0.42 },
            { from: [-1.08, 0.3], to: [1.72, 0.42], h: 0.52, r: 0.48 },
            { from: [-2.82, 2.55], to: [0.65, 3.28], h: 0.42, r: 0.5 },
            { from: [-1.62, -4.62], to: [0.92, -3.18], h: 0.34, r: 0.42 },
            { from: [1.22, -3.92], to: [3.22, -4.28], h: 0.34, r: 0.46 },
            { from: [0.18, 0.48], to: [2.62, 1.12], h: 0.3, r: 0.44 },
          ],
          depressions: [
            { x: -0.28, y: -0.62, h: 0.92, r: 0.7 },
            { x: -3.02, y: 0.9, h: 0.66, r: 0.56 },
            { x: -2.52, y: -2.52, h: 0.86, r: 0.7 },
            { x: 2.22, y: -1.22, h: 0.76, r: 0.68 },
            { x: 0.35, y: -4.62, h: 0.42, r: 0.58 },
            { x: 1.22, y: -2.32, h: 0.64, r: 0.76 },
            { x: 2.92, y: -0.18, h: 0.52, r: 0.58 },
            { x: -2.86, y: 3.35, h: 0.44, r: 0.58 },
          ],
          troughs: [
            { from: [-3.72, 2.15], to: [-3.2, 0.78], h: 0.56, r: 0.36 },
            { from: [-3.12, 0.6], to: [-2.55, -2.42], h: 0.76, r: 0.4 },
            { from: [-2.82, -3.42], to: [-1.12, -4.52], h: 0.68, r: 0.42 },
            { from: [-0.6, 2.35], to: [-0.45, -1.5], h: 0.72, r: 0.38 },
            { from: [-0.22, -2.55], to: [2.55, -3.82], h: 0.7, r: 0.42 },
            { from: [2.32, -3.92], to: [2.22, -1.48], h: 0.64, r: 0.38 },
            { from: [-2.25, 1.18], to: [0.15, -0.28], h: 0.46, r: 0.36 },
            { from: [0.12, -0.9], to: [1.82, -2.72], h: 0.52, r: 0.4 },
            { from: [1.52, 1.42], to: [3.02, -0.32], h: 0.46, r: 0.38 },
          ],
          reliefMin: 0.46,
          reliefMax: 1.28,
          meshResolution: 1.8,
          edgeSoftness: 0.82,
          edgeFloor: 0.2,
          frontTaperDepth: 4.7,
          frontFloor: 0.3,
          frontSkirtLift: 0.82,
          sideSkirtLift: 0.72,
          surfaceNoise: 0.15,
          cragStrength: 0.16,
          scanHeightStrength: 0.88,
          scanHeightContrast: 1.18,
          scanHeightFloor: 0.18,
          scanHeightCeiling: 1.1,
          scanHeightInvert: false,
          terraceStrength: 0.18,
          terraceBands: 10,
          scanHeightMap: getLidarHeightMap("rightRock"),
          light: "Low-Medium",
          flow: "Medium-High",
          parMin: 55,
          parMax: 135,
          notes: "Back-glass-touching right rock. LiDAR heightmap drives surface topology (swap-corrected 41×41 grid, 88% weight), silhouette profiles constrain the envelope.",
        },
        {
          id: "center-shelf",
          name: "Shelf rock",
          type: "profile-rock",
          x: 0.15,
          y: 1.35,
          z: 6.75,
          width: 13.8,
          depth: 10.6,
          height: 6.6,
          touchesBackGlass: true,
          footprint: [[-6.85, -2.85], [-5.95, -4.25], [-4.65, -5.25], [-3.2, -5.6], [-2.0, -4.85], [-0.5, -3.85], [0.7, -3.95], [2.0, -4.95], [3.75, -5.45], [5.25, -4.05], [6.75, -1.65], [6.7, 0.35], [6.45, 1.85], [5.15, 3.05], [3.25, 3.75], [1.2, 4.3], [-0.75, 4.55], [-2.8, 4.28], [-4.65, 3.65], [-6.05, 2.65], [-6.9, 1.08]],
          bottomProfile: [[-6.85, 0.0], [-5.55, 0.32], [-4.35, 0.08], [-3.25, 0.72], [-2.15, 0.45], [-1.05, 0.88], [0.0, 0.55], [1.05, 0.7], [2.0, 0.42], [3.05, 0.62], [4.2, 0.18], [5.45, 0.38], [6.7, 0.0]],
          frontProfile: [[-6.85, 1.0], [-5.9, 2.55], [-4.65, 4.0], [-3.45, 5.1], [-2.0, 5.45], [-0.65, 4.75], [0.35, 5.75], [1.65, 5.35], [2.95, 5.05], [4.25, 4.2], [5.45, 2.85], [6.7, 1.2]],
          sideProfile: [[-5.6, 0.18], [-4.65, 0.55], [-3.35, 1.35], [-2.15, 2.45], [-1.05, 2.85], [0.8, 4.85], [2.35, 5.75], [3.65, 5.2], [4.55, 3.8]],
          heightPoints: [
            { x: -4.4, y: -0.55, h: 0.35, r: 1.25 },
            { x: -2.45, y: 0.25, h: 0.52, r: 1.35 },
            { x: 0.35, y: 1.0, h: 0.58, r: 1.5 },
            { x: 2.55, y: 0.55, h: 0.46, r: 1.2 },
            { x: 4.75, y: 0.25, h: 0.25, r: 0.95 },
          ],
          ridges: [
            { from: [-5.35, -0.55], to: [5.2, 0.62], h: 0.4, r: 0.7 },
            { from: [-3.25, 1.55], to: [3.4, 2.3], h: 0.28, r: 0.58 },
          ],
          depressions: [
            { x: 1.75, y: -1.25, h: 0.25, r: 0.85 },
            { x: -3.15, y: -1.35, h: 0.22, r: 0.82 },
          ],
          edgeSoftness: 1.55,
          edgeFloor: 0.3,
          frontTaperDepth: 5.2,
          frontFloor: 0.18,
          frontSkirtLift: 0.86,
          sideSkirtLift: 0.76,
          surfaceNoise: 0.04,
          cragStrength: 0.06,
          scanHeightStrength: 0.78,
          scanHeightContrast: 1.08,
          scanHeightFloor: 0.2,
          scanHeightCeiling: 1.08,
          scanHeightMap: getLidarHeightMap("shelf"),
          terraceStrength: 0.16,
          terraceBands: 9,
          light: "Medium-High",
          flow: "High",
          parMin: 130,
          parMax: 260,
          notes: "Raised shelf rock, anchored to the back glass with a broad irregular top outline and open sand below. Version 20 uses the front/back-corrected shelf LiDAR OBJ top envelope for elevation reference.",
        },
      ],
    };
  }

  function normalizeState(raw) {
    const base = getDefaultState();
    const rawProfile = raw?.profile || {};
    const sourceSchemaVersion = Number(raw?.schemaVersion || raw?.version || 1);
    const next = {
      ...base,
      ...raw,
      version: raw?.version || base.version,
      schemaVersion: raw?.schemaVersion || sourceSchemaVersion,
      profile: { ...base.profile, ...rawProfile },
      ui: { ...base.ui, ...(raw.ui || {}) },
      zones: Array.isArray(raw.zones) ? raw.zones : base.zones,
      livestock: Array.isArray(raw.livestock) ? raw.livestock : [],
      waterTests: Array.isArray(raw.waterTests) ? raw.waterTests : [],
      events: Array.isArray(raw.events) ? raw.events : [],
      records: raw.records || base.records,
      journal: Array.isArray(raw.journal) ? raw.journal : base.journal,
      legacyRaw: raw.legacyRaw || null,
      insightRuns: Array.isArray(raw.insightRuns) ? raw.insightRuns : [],
      map: normalizeMap(raw.map, base.map),
    };
    next.ui.livestockFilter = normalizeLivestockFilter(next.ui.livestockFilter);
    normalizeLightingModel(next);

    const lightingPhotos = normalizePhotoArray([
      ...(Array.isArray(next.profile.lightingPhotos) ? next.profile.lightingPhotos : []),
      next.profile.lightingPhoto,
      next.profile.lightingPhotoDataUrl,
    ]);
    next.profile.lightingPhotos = lightingPhotos;
    next.profile.lightingPhoto = lightingPhotos[0] || null;
    next.profile.lightingPhotoDataUrl = lightingPhotos.find((photo) => photo.dataUrl)?.dataUrl || "";
    migrateLegacyRefugiumToSump(next.profile, rawProfile);
    normalizeEquipmentProfile(next.profile, rawProfile, { migrateLegacy: true });

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
      const photos = normalizePhotoList(item);
      const noteLog = normalizeLivestockNoteLog(item);

      return {
        id: item.id || uid(),
        species,
        name: species,
        category,
        quantity: item.quantity ?? "",
        currentCount: item.currentCount ?? "",
        trackingUnit: item.trackingUnit || "",
        addedDate: item.addedDate || "",
        isLegacy,
        status: normalizeLivestockLifecycleStatus(item.status, category),
        casual,
        zoneId: item.zoneId || "",
        notes: "",
        noteLog,
        health: item.health || "",
        growthTrend: item.growthTrend || "",
        growthNotes: item.growthNotes || item.growthMetric || "",
        photos,
        photoDataUrl: photos.find((photo) => photo.dataUrl)?.dataUrl || "",
        mapPosition: normalizeMapPosition(item.mapPosition),
        mapMarkerHidden: Boolean(item.mapMarkerHidden),
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

    if (RECORDS.migrateToRecordJournalState) {
      const migrated = RECORDS.migrateToRecordJournalState(next);
      if (!raw?.schemaVersion || Number(raw.schemaVersion) < STATE_SCHEMA_VERSION) {
        migrated.legacyRaw = RECORDS.deepClone ? RECORDS.deepClone(raw) : raw;
      }
      normalizeLightingModel(migrated);
      archiveLightingImages(migrated);
      return migrated;
    }

    archiveLightingImages(next);
    return next;
  }

  function normalizeLightingModel(targetState) {
    const profile = targetState?.profile || {};
    if (String(profile.lightingModel || "").trim() === "Radon XR15") {
      profile.lightingModel = "Radion XR15";
    }
    const lightingRecord = (targetState?.records?.equipment || [])
      .find((record) => record.templateKey === "lighting" || record.category === "lighting");
    if (String(lightingRecord?.details?.model || "").trim() === "Radon XR15") {
      lightingRecord.details.model = "Radion XR15";
    }
  }

  function archiveLightingImages(targetState) {
    const profile = targetState?.profile || {};
    const lightingRecord = (targetState?.records?.equipment || [])
      .find((record) => record.templateKey === "lighting" || record.category === "lighting");
    const activePhotos = normalizePhotoArray([
      ...(Array.isArray(profile.lightingPhotos) ? profile.lightingPhotos : []),
      profile.lightingPhoto,
      profile.lightingPhotoDataUrl,
      ...(Array.isArray(lightingRecord?.photos) ? lightingRecord.photos : []),
    ]);
    const existingLegacy = targetState?.legacyRaw && typeof targetState.legacyRaw === "object"
      ? targetState.legacyRaw
      : {};
    const archivedPhotos = normalizePhotoArray([
      ...(Array.isArray(existingLegacy.lighting?.sourcePhotos) ? existingLegacy.lighting.sourcePhotos : []),
      ...(Array.isArray(existingLegacy.lightingSourcePhotos) ? existingLegacy.lightingSourcePhotos : []),
      ...(Array.isArray(existingLegacy.profile?.lightingPhotos) ? existingLegacy.profile.lightingPhotos : []),
      existingLegacy.profile?.lightingPhoto,
      existingLegacy.profile?.lightingPhotoDataUrl,
      ...(Array.isArray(lightingRecord?.legacyRaw?.sourcePhotos) ? lightingRecord.legacyRaw.sourcePhotos : []),
      ...(Array.isArray(lightingRecord?.legacyRaw?.lightingPhotos) ? lightingRecord.legacyRaw.lightingPhotos : []),
      ...activePhotos,
    ]);

    profile.lightingPhotos = [];
    profile.lightingPhoto = null;
    profile.lightingPhotoDataUrl = "";

    if (lightingRecord) {
      lightingRecord.photos = [];
      if (!lightingRecord.legacyRaw || typeof lightingRecord.legacyRaw !== "object") {
        lightingRecord.legacyRaw = {};
      }
      if (archivedPhotos.length) {
        lightingRecord.legacyRaw.sourcePhotos = archivedPhotos;
      }
    }

    if (!archivedPhotos.length) return;
    if (!targetState.legacyRaw || typeof targetState.legacyRaw !== "object") {
      targetState.legacyRaw = {};
    }
    if (!targetState.legacyRaw.lighting || typeof targetState.legacyRaw.lighting !== "object") {
      targetState.legacyRaw.lighting = {};
    }
    targetState.legacyRaw.lighting.sourcePhotos = archivedPhotos;
    targetState.legacyRaw.lighting.sourceArchivedReason = "Lighting screenshots are retained only as legacy source material; Lighting Details is canonical.";
  }

  function migrateLegacyRefugiumToSump(profile, sourceProfile = {}) {
    const hasSumpData = ["sump", "sumpAddedDate", "sumpLegacy", "sumpDetails"].some((key) =>
      Object.prototype.hasOwnProperty.call(sourceProfile, key),
    );
    if (hasSumpData) return;
    if (!sourceProfile.refugium && !sourceProfile.refugiumAddedDate && !sourceProfile.refugiumDetails) return;

    profile.sump = Boolean(sourceProfile.refugium);
    profile.sumpAddedDate = sourceProfile.refugiumAddedDate || "";
    profile.sumpLegacy = Boolean(sourceProfile.refugiumLegacy);
    profile.sumpDetails = sourceProfile.refugiumDetails || "";
    profile.refugium = false;
    profile.refugiumAddedDate = "";
    profile.refugiumLegacy = false;
    profile.refugiumDetails = "";
  }

  function normalizeEquipmentProfile(profile, sourceProfile = {}, options = {}) {
    EQUIPMENT_FIELDS.forEach(({ key, dateKey, legacyKey, detailsKey }) => {
      const active = Boolean(profile[key]);
      const addedDate = String(profile[dateKey] || "");
      const sourceHadLegacy = Object.prototype.hasOwnProperty.call(sourceProfile, legacyKey);
      const migratedLegacy = Boolean(options.migrateLegacy && active && !sourceHadLegacy && !addedDate);
      profile[key] = active;
      profile[legacyKey] = active ? Boolean(migratedLegacy || profile[legacyKey]) : false;
      profile[dateKey] = active && !profile[legacyKey] ? addedDate : "";
      profile[detailsKey] = String(profile[detailsKey] || "");
    });
    profile.autoFeederSchedule = String(profile.autoFeederSchedule || "");
    profile.uvSchedule = String(profile.uvSchedule || "");
  }

  function normalizeMap(raw = {}, defaults = getDefaultMap()) {
    const source = raw && typeof raw === "object" ? raw : {};
    const defaultDimensions = defaults.dimensions;
    const sourceVersion = Number(source.modelVersion || 0);
    const defaultVersion = Number(defaults.modelVersion || 1);
    const shouldMigrateStructures = sourceVersion < defaultVersion;
    const dimensions = {
      width: positiveNumber(source.dimensions?.width, defaultDimensions.width),
      depth: positiveNumber(source.dimensions?.depth, defaultDimensions.depth),
      height: positiveNumber(source.dimensions?.height, defaultDimensions.height),
      sandDepth: nonNegativeNumber(source.dimensions?.sandDepth, defaultDimensions.sandDepth),
      waterline: nonNegativeNumber(source.dimensions?.waterline, defaultDimensions.waterline),
      scaleReference: shouldMigrateStructures ? defaultDimensions.scaleReference : source.dimensions?.scaleReference || defaultDimensions.scaleReference,
      calibrationNotes: shouldMigrateStructures ? defaultDimensions.calibrationNotes : source.dimensions?.calibrationNotes || defaultDimensions.calibrationNotes,
    };

    dimensions.sandDepth = Math.min(dimensions.sandDepth, dimensions.height - 0.5);
    dimensions.waterline = Math.min(Math.max(dimensions.waterline, dimensions.sandDepth + 0.5), dimensions.height);

    const defaultLayers = defaults.layers;
    const layers = {
      par: shouldMigrateStructures ? defaultLayers.par : source.layers?.par ?? defaultLayers.par,
      livestock: shouldMigrateStructures ? defaultLayers.livestock : source.layers?.livestock ?? defaultLayers.livestock,
      flow: shouldMigrateStructures ? defaultLayers.flow : source.layers?.flow ?? defaultLayers.flow,
      equipment: shouldMigrateStructures ? defaultLayers.equipment : source.layers?.equipment ?? defaultLayers.equipment,
      trace: shouldMigrateStructures ? defaultLayers.trace : source.layers?.trace ?? defaultLayers.trace,
    };

    const structureSource = !shouldMigrateStructures && Array.isArray(source.structures) && source.structures.length
      ? source.structures
      : defaults.structures;

    return {
      modelVersion: defaultVersion,
      dimensions,
      view: shouldMigrateStructures ? defaults.view : source.view || defaults.view,
      layers,
      parMarkers: normalizeParMarkers(source.parMarkers || defaults.parMarkers),
      refinementAnnotations: normalizeMap2RefinementAnnotations(source.refinementAnnotations || defaults.refinementAnnotations),
      structures: structureSource.map((structure, index) =>
        normalizeMapStructure(structure, defaults.structures[index] || defaults.structures[0]),
      ),
    };
  }

  function normalizeMapStructure(structure = {}, fallback = {}) {
    return {
      id: structure.id || fallback.id || uid(),
      name: structure.name || fallback.name || "Reef structure",
      type: structure.type || fallback.type || "mound",
      x: finiteNumber(structure.x, fallback.x || 0),
      y: finiteNumber(structure.y, fallback.y || 0),
      z: nonNegativeNumber(structure.z, fallback.z || 0),
      width: positiveNumber(structure.width, fallback.width || 3),
      depth: positiveNumber(structure.depth, fallback.depth || 3),
      height: positiveNumber(structure.height, fallback.height || 2),
      touchesBackGlass: Boolean(structure.touchesBackGlass ?? fallback.touchesBackGlass ?? false),
      light: structure.light || fallback.light || "Medium",
      flow: structure.flow || fallback.flow || "Medium",
      parMin: nonNegativeNumber(structure.parMin, fallback.parMin || 0),
      parMax: nonNegativeNumber(structure.parMax, fallback.parMax || 0),
      footprint: normalizePointPairs(structure.footprint, fallback.footprint),
      heightPoints: normalizeHeightPoints(structure.heightPoints, fallback.heightPoints),
      ridges: normalizeRidges(structure.ridges, fallback.ridges),
      depressions: normalizeHeightPoints(structure.depressions, fallback.depressions),
      troughs: normalizeRidges(structure.troughs, fallback.troughs),
      bottomProfile: normalizePointPairs(structure.bottomProfile, fallback.bottomProfile),
      frontProfile: normalizePointPairs(structure.frontProfile, fallback.frontProfile),
      sideProfile: normalizePointPairs(structure.sideProfile, fallback.sideProfile),
      reliefMin: positiveNumber(structure.reliefMin, fallback.reliefMin || 0.9),
      reliefMax: positiveNumber(structure.reliefMax, fallback.reliefMax || 1.06),
      meshResolution: positiveNumber(structure.meshResolution, fallback.meshResolution || 1),
      scanHeightMap: normalizeScanHeightMap(structure.scanHeightMap, fallback.scanHeightMap),
      scanHeightStrength: clamp(0, 1, finiteNumber(structure.scanHeightStrength, fallback.scanHeightStrength || 0)),
      scanHeightContrast: positiveNumber(structure.scanHeightContrast, fallback.scanHeightContrast || 1),
      scanHeightFloor: clamp(0, 1, finiteNumber(structure.scanHeightFloor, fallback.scanHeightFloor || 0.12)),
      scanHeightCeiling: positiveNumber(structure.scanHeightCeiling, fallback.scanHeightCeiling || 1),
      scanHeightInvert: Boolean(structure.scanHeightInvert ?? fallback.scanHeightInvert ?? false),
      terraceStrength: clamp(0, 1, finiteNumber(structure.terraceStrength, fallback.terraceStrength || 0)),
      terraceBands: positiveNumber(structure.terraceBands, fallback.terraceBands || 6),
      scanMeshAsset: normalizeScanMeshAsset(structure.scanMeshAsset, fallback.scanMeshAsset),
      scanMeshVerticalScale: positiveNumber(structure.scanMeshVerticalScale, fallback.scanMeshVerticalScale || 1),
      scanMeshFlipX: Boolean(structure.scanMeshFlipX ?? fallback.scanMeshFlipX ?? false),
      scanMeshFlipY: Boolean(structure.scanMeshFlipY ?? fallback.scanMeshFlipY ?? false),
      scanMeshFlipZ: Boolean(structure.scanMeshFlipZ ?? fallback.scanMeshFlipZ ?? false),
      scanMeshSwapXY: Boolean(structure.scanMeshSwapXY ?? fallback.scanMeshSwapXY ?? false),
      scanMeshAxisOrder: normalizeScanMeshAxisOrder(structure.scanMeshAxisOrder, fallback.scanMeshAxisOrder),
      edgeSoftness: positiveNumber(structure.edgeSoftness, fallback.edgeSoftness || 0.65),
      edgeFloor: positiveNumber(structure.edgeFloor, fallback.edgeFloor || 0.4),
      frontTaperDepth: nonNegativeNumber(structure.frontTaperDepth, fallback.frontTaperDepth || 0),
      frontFloor: positiveNumber(structure.frontFloor, fallback.frontFloor || 1),
      frontSkirtLift: nonNegativeNumber(structure.frontSkirtLift, fallback.frontSkirtLift || 0),
      sideSkirtLift: nonNegativeNumber(structure.sideSkirtLift, fallback.sideSkirtLift || 0),
      surfaceNoise: nonNegativeNumber(structure.surfaceNoise, fallback.surfaceNoise || 0.14),
      cragStrength: nonNegativeNumber(structure.cragStrength, fallback.cragStrength || 0),
      notes: structure.notes || fallback.notes || "",
    };
  }

  function normalizeScanHeightMap(value, fallback) {
    const source = value && typeof value === "object" ? value : fallback;
    if (!source || typeof source !== "object" || !Array.isArray(source.values)) return null;
    const rows = Math.max(2, Math.round(Number(source.rows) || source.values.length || 0));
    const columns = Math.max(2, Math.round(Number(source.columns) || source.values[0]?.length || 0));
    if (!rows || !columns || source.values.length < rows) return null;
    const values = source.values.slice(0, rows).map((row) =>
      Array.isArray(row)
        ? row.slice(0, columns).map((entry) => clamp(0, 1, finiteNumber(entry, 0)))
        : [],
    );
    if (values.some((row) => row.length < columns)) return null;
    return {
      rows,
      columns,
      axis: source.axis || "",
      source: source.source || "",
      values,
    };
  }

  function normalizeScanMeshAsset(value, fallback) {
    const source = value && typeof value === "object" ? value : fallback;
    if (!source || typeof source !== "object" || !source.url) return null;
    return {
      url: source.url,
      source: source.source || "",
    };
  }

  function normalizeScanMeshAxisOrder(value, fallback) {
    const source = Array.isArray(value) ? value : fallback;
    if (!Array.isArray(source) || source.length !== 3) return [0, 1, 2];
    const order = source.map((entry) => Math.round(Number(entry)));
    const unique = new Set(order);
    return order.every((entry) => entry >= 0 && entry <= 2) && unique.size === 3 ? order : [0, 1, 2];
  }

  function normalizePointPairs(value, fallback = []) {
    const source = Array.isArray(value) && value.length ? value : fallback;
    return Array.isArray(source)
      ? source
          .map((point) => Array.isArray(point) && point.length >= 2 ? [finiteNumber(point[0], 0), finiteNumber(point[1], 0)] : null)
          .filter(Boolean)
      : [];
  }

  function normalizeHeightPoints(value, fallback = []) {
    const source = Array.isArray(value) && value.length ? value : fallback;
    return Array.isArray(source)
      ? source.map((point) => ({
          x: finiteNumber(point.x, 0),
          y: finiteNumber(point.y, 0),
          h: nonNegativeNumber(point.h, 0),
          r: positiveNumber(point.r, 1),
        }))
      : [];
  }

  function normalizeRidges(value, fallback = []) {
    const source = Array.isArray(value) && value.length ? value : fallback;
    return Array.isArray(source)
      ? source
          .map((ridge) => ({
            from: normalizePointPairs([ridge.from], [[0, 0]])[0],
            to: normalizePointPairs([ridge.to], [[0, 0]])[0],
            h: nonNegativeNumber(ridge.h, 0),
            r: positiveNumber(ridge.r, 1),
          }))
          .filter((ridge) => ridge.from && ridge.to)
      : [];
  }

  function normalizeMapPosition(value) {
    if (!value || typeof value !== "object") return null;
    const x = finiteNumber(value.x, NaN);
    const y = finiteNumber(value.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const z = finiteNumber(value.z, NaN);
    return {
      x,
      y,
      z: Number.isFinite(z) ? z : null,
      structureId: value.structureId || "",
      placedAt: value.placedAt || "",
    };
  }

  function normalizeParMarkers(value = []) {
    return Array.isArray(value)
      ? value
          .map((marker) => {
            const position = normalizeMapPosition(marker);
            if (!position) return null;
            return {
              ...position,
              id: marker.id || uid(),
              value: marker.value ?? "",
              note: marker.note || "",
              measuredAt: marker.measuredAt || "",
            };
          })
          .filter(Boolean)
      : [];
  }

  function normalizeMap2RefinementAnnotations(value = []) {
    return Array.isArray(value)
      ? value
          .map((annotation) => {
            if (!annotation || typeof annotation !== "object") return null;
            const shape = MAP2_REFINEMENT_SHAPES.includes(annotation.shape) && annotation.shape !== "navigate"
              ? annotation.shape
              : "point";
            const points = Array.isArray(annotation.points)
              ? annotation.points.map(normalizeMap2RefinementPoint).filter(Boolean)
              : [];
            const minimumPoints = shape === "area" ? 3 : shape === "line" ? 2 : 1;
            if (points.length < minimumPoints) return null;
            return {
              id: annotation.id || uid(),
              createdAt: annotation.createdAt || new Date().toISOString(),
              structureId: annotation.structureId || "",
              structureName: annotation.structureName || annotation.structureId || "",
              shape,
              action: MAP2_REFINEMENT_ACTIONS.includes(annotation.action) ? annotation.action : "raise",
              direction: MAP2_REFINEMENT_DIRECTIONS.includes(annotation.direction) ? annotation.direction : "surface",
              strength: MAP2_REFINEMENT_STRENGTHS.includes(annotation.strength) ? annotation.strength : "medium",
              radius: positiveNumber(annotation.radius, 0.8),
              geometryBase: typeof annotation.geometryBase === "string" ? annotation.geometryBase : "",
              note: annotation.note || "",
              points,
            };
          })
          .filter(Boolean)
      : [];
  }

  function normalizeMap2RefinementPoint(point) {
    if (!point || typeof point !== "object") return null;
    const x = finiteNumber(point.x, NaN);
    const y = finiteNumber(point.y, NaN);
    const z = finiteNumber(point.z, NaN);
    if (![x, y, z].every(Number.isFinite)) return null;
    const targetX = finiteNumber(point.targetX, NaN);
    const targetY = finiteNumber(point.targetY, NaN);
    return {
      x,
      y,
      z,
      ...(Number.isFinite(targetX) ? { targetX } : {}),
      ...(Number.isFinite(targetY) ? { targetY } : {}),
    };
  }

  function normalizeRockLobes(value, fallback = []) {
    const source = Array.isArray(value) && value.length ? value : fallback;
    return Array.isArray(source)
      ? source.map((lobe) => ({
          x: finiteNumber(lobe.x, 0),
          y: finiteNumber(lobe.y, 0),
          z: nonNegativeNumber(lobe.z, 0.5),
          rx: positiveNumber(lobe.rx, 0.8),
          ry: positiveNumber(lobe.ry, 0.8),
          rz: positiveNumber(lobe.rz, 0.6),
          rot: finiteNumber(lobe.rot, 0),
          tiltX: finiteNumber(lobe.tiltX, 0),
          tiltY: finiteNumber(lobe.tiltY, 0),
        }))
      : [];
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number > 0 ? number : fallback;
  }

  function nonNegativeNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number >= 0 ? number : fallback;
  }

  function clamp(min, max, value) {
    return Math.max(min, Math.min(max, value));
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

  function writeJson(key, value, options = {}) {
    let serialized = "";
    try {
      serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      console.warn(`Could not write ${key}`, error);
      if (isQuotaExceededError(error)) {
        if (reclaimLocalStorageSpace(key) && tryWriteSerializedJson(key, serialized)) {
          return true;
        }
        if (key === STORAGE_KEY && supabaseClient && currentUser) {
          const cacheValue = createRemoteBackedLocalCache(value);
          if (cacheValue !== value && tryWriteSerializedJson(key, JSON.stringify(cacheValue))) {
            return true;
          }
        }
        handleLocalCacheQuota(key, options);
      }
      return false;
    }
  }

  function tryWriteSerializedJson(key, serialized) {
    try {
      localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      console.warn(`Could not retry local write for ${key}`, error);
      return false;
    }
  }

  function reclaimLocalStorageSpace(targetKey) {
    const disposableKeys = [PRE_PULL_BACKUP_KEY, PRE_RECORD_JOURNAL_BACKUP_KEY].filter((key) => key !== targetKey);
    let reclaimed = false;
    disposableKeys.forEach((key) => {
      try {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
          reclaimed = true;
        }
      } catch (error) {
        console.warn(`Could not remove local cache backup ${key}`, error);
      }
    });
    return reclaimed;
  }

  function createRemoteBackedLocalCache(value) {
    if (!supabaseClient || !currentUser || !value || typeof value !== "object") return value;
    return stripInlinePhotoData(value);
  }

  function stripInlinePhotoData(value, seen = new WeakMap()) {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const arrayCopy = [];
      seen.set(value, arrayCopy);
      value.forEach((entry, index) => {
        arrayCopy[index] = stripInlinePhotoData(entry, seen);
      });
      return arrayCopy;
    }

    const objectCopy = {};
    seen.set(value, objectCopy);
    Object.entries(value).forEach(([key, entry]) => {
      if (isInlinePhotoDataField(key, entry)) {
        objectCopy[key] = "";
      } else {
        objectCopy[key] = stripInlinePhotoData(entry, seen);
      }
    });
    return objectCopy;
  }

  function isInlinePhotoDataField(key, value) {
    if (typeof value !== "string" || !value.startsWith("data:")) return false;
    return key === "dataUrl" || key === "photoDataUrl" || key === "lightingPhotoDataUrl" || value.startsWith("data:image/");
  }

  function handleLocalCacheQuota(key, options = {}) {
    if (key !== STORAGE_KEY) return;
    if (supabaseClient && currentUser) {
      updateBackendStatus("Private sync on. Local cache is full, so this device will reload from Supabase.");
      return;
    }
    if (options.silentQuota) return;
    const now = Date.now();
    if (now - lastLocalCacheWarningAt < 60_000) return;
    lastLocalCacheWarningAt = now;
    showToast("This device's local cache is full. Sign in before adding more photos.");
  }

  function snapshotPreMigrationState(raw) {
    if (!raw || Number(raw.schemaVersion || 1) >= STATE_SCHEMA_VERSION) return;
    try {
      if (localStorage.getItem(PRE_RECORD_JOURNAL_BACKUP_KEY)) return;
      localStorage.setItem(PRE_RECORD_JOURNAL_BACKUP_KEY, JSON.stringify({
        backedUpAt: new Date().toISOString(),
        schemaVersion: raw.schemaVersion || raw.version || 1,
        state: raw,
      }));
    } catch (error) {
      console.warn("Could not snapshot pre-record/journal state", error);
    }
  }

  function isQuotaExceededError(error) {
    return (
      error?.name === "QuotaExceededError" ||
      error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error?.code === 22 ||
      error?.code === 1014
    );
  }

  function hasValidBackendConfig(config) {
    return Boolean(config?.supabaseUrl && config?.supabaseAnonKey);
  }

  function isLocalDevelopmentHost() {
    return ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  }

  async function disableLocalInstallShell() {
    if (!isLocalDevelopmentHost() || !("serviceWorker" in navigator)) return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith("reef-command")).map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.warn("Could not clear local app shell", error);
    }
  }

  function enableInstallShell() {
    if (isLocalDevelopmentHost()) return;
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement("link");
      manifest.rel = "manifest";
      manifest.href = "./manifest.webmanifest";
      document.head.appendChild(manifest);
    }
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js").catch((error) => {
          console.warn("Service worker registration failed", error);
        });
      });
    }
  }

  function normalizePhotoRecord(photo) {
    if (!photo) return null;
    if (typeof photo === "string") {
      return {
        id: uid(),
        path: "",
        dataUrl: photo,
        createdAt: new Date().toISOString(),
      };
    }

    const path = photo.path || photo.storagePath || "";
    const dataUrl = photo.dataUrl || (typeof photo.url === "string" && photo.url.startsWith("data:") ? photo.url : "");
    if (!path && !dataUrl) return null;
    return {
      id: photo.id || photoIdFromPath(path) || uid(),
      path,
      dataUrl,
      createdAt: photo.createdAt || new Date().toISOString(),
    };
  }

  function normalizePhotoArray(values) {
    const photos = [];
    const seen = new Set();
    const addPhoto = (photo) => {
      const normalized = normalizePhotoRecord(photo);
      if (!normalized) return;
      const key = normalized.path || normalized.dataUrl;
      if (!key || seen.has(key)) return;
      seen.add(key);
      photos.push(normalized);
    };

    values.filter(Boolean).forEach(addPhoto);
    return photos;
  }

  function normalizePhotoList(item) {
    const values = [];
    if (Array.isArray(item.photos)) {
      values.push(...item.photos);
    }
    values.push(item.photoDataUrl);
    return normalizePhotoArray(values);
  }

  function getLivestockPhotos(item) {
    return normalizePhotoList(item);
  }

  function normalizeLivestockNoteLog(item = {}) {
    const entries = Array.isArray(item.noteLog)
      ? item.noteLog
          .map((note) => ({
            id: note.id || uid(),
            at: note.at || "",
            text: String(note.text || "").trim(),
            isLegacy: Boolean(note.isLegacy),
          }))
          .filter((note) => note.text)
      : [];
    const legacyNote = String(item.notes || "").trim();
    if (legacyNote && !entries.some((note) => note.text === legacyNote)) {
      entries.push({
        id: uid(),
        at: item.noteLoggedAt || "",
        text: legacyNote,
        isLegacy: true,
      });
    }
    return entries.sort((a, b) => {
      const aTime = new Date(a.at || 0).getTime();
      const bTime = new Date(b.at || 0).getTime();
      return bTime - aTime;
    });
  }

  function createLivestockNoteEntry(text) {
    return {
      id: uid(),
      at: new Date().toISOString(),
      text: text.trim(),
      isLegacy: false,
    };
  }

  function getLightingPhotos() {
    return [];
  }

  function setLightingPhotos(photos) {
    const normalized = normalizePhotoArray(photos);
    state.profile.lightingPhotos = normalized;
    state.profile.lightingPhoto = normalized[0] || null;
    state.profile.lightingPhotoDataUrl = normalized.find((photo) => photo.dataUrl)?.dataUrl || "";
    const lightingRecord = getOrCreateLightingRecord();
    lightingRecord.photos = normalized;
    archiveLightingImages(state);
  }

  function getEquipmentRecordByTemplate(templateKey) {
    return (state.records?.equipment || []).find((record) => record.templateKey === templateKey) || null;
  }

  function getCurrentRecord(record) {
    return RECORDS.getCurrentRecord ? RECORDS.getCurrentRecord(state, record) : record;
  }

  function getRecordHistory(recordId) {
    return RECORDS.getRecordHistory ? RECORDS.getRecordHistory(state, recordId) : [];
  }

  function getLivestockRecord(id) {
    return (state.records?.livestock || []).find((record) => record.id === id) || null;
  }

  function getLivestockItems() {
    return (state.records?.livestock || []).map(livestockItemFromRecord);
  }

  function livestockItemFromRecord(record) {
    const current = getCurrentRecord(record);
    const legacy = record.legacyRaw || {};
    const details = {
      ...(legacy.details || {}),
      ...(record.details || {}),
      ...(current.details || {}),
    };
    const species = current.species || current.name || legacy.species || legacy.name || "Unknown";
    return {
      ...legacy,
      ...record,
      ...current,
      id: record.id,
      species,
      name: species,
      category: current.category || legacy.category || "Other",
      quantity: details.quantity ?? current.quantity ?? legacy.quantity ?? "",
      currentCount: current.currentCount ?? details.currentCount ?? legacy.currentCount ?? "",
      trackingUnit: details.trackingUnit || current.trackingUnit || legacy.trackingUnit || "",
      addedDate: current.addedAt || current.addedDate || legacy.addedDate || "",
      isLegacy: Boolean(current.isLegacy ?? legacy.isLegacy),
      status: normalizeLivestockLifecycleStatus(current.status || legacy.status, current.category || legacy.category),
      casual: Boolean(current.casual || legacy.casual || isCasualStockCategory(current.category || legacy.category)),
      zoneId: details.zoneId || current.zoneId || legacy.zoneId || "",
      initialHealth: details.initialHealth || legacy.health || "",
      health: current.currentHealth || details.initialHealth || legacy.health || "",
      growthTrend: current.growthTrend || details.growthTrend || legacy.growthTrend || "",
      growthNotes: current.growthNotes || details.growthNotes || legacy.growthNotes || "",
      photos: normalizePhotoArray(current.photos || record.photos || legacy.photos || []),
      photoDataUrl: "",
      mapPosition: current.mapPosition || legacy.mapPosition || null,
      mapMarkerHidden: Boolean(current.mapMarkerHidden ?? legacy.mapMarkerHidden),
      removedDate: current.retiredAt || legacy.removedDate || "",
      outcomeReason: details.outcomeReason || current.outcomeReason || legacy.outcomeReason || "",
    };
  }

  function syncLegacyLivestockFromRecords() {
    state.livestock = getLivestockItems();
  }

  function updateLivestockPlacement(id, fields = {}) {
    const record = getLivestockRecord(id);
    if (!record) return null;
    if (Object.prototype.hasOwnProperty.call(fields, "mapPosition")) {
      record.mapPosition = normalizeMapPosition(fields.mapPosition);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "mapMarkerHidden")) {
      record.mapMarkerHidden = Boolean(fields.mapMarkerHidden);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "zoneId")) {
      record.details ||= {};
      record.details.zoneId = fields.zoneId || "";
    }
    record.updatedAt = new Date().toISOString();
    if (record.legacyRaw) {
      if (Object.prototype.hasOwnProperty.call(fields, "mapPosition")) {
        record.legacyRaw.mapPosition = record.mapPosition;
      }
      if (Object.prototype.hasOwnProperty.call(fields, "mapMarkerHidden")) {
        record.legacyRaw.mapMarkerHidden = record.mapMarkerHidden;
      }
      if (Object.prototype.hasOwnProperty.call(fields, "zoneId")) {
        record.legacyRaw.zoneId = record.details?.zoneId || "";
      }
    }
    syncLegacyLivestockFromRecords();
    return livestockItemFromRecord(record);
  }

  function hasJournalSource() {
    return Array.isArray(state.journal) && state.journal.length > 0;
  }

  function getWaterTestsFromJournal() {
    const tests = (state.journal || [])
      .filter((entry) => entry.type === "Water Test" || entry.legacyKind === "water_test")
      .map((entry) => JOURNAL.entryToLegacyWaterTest ? JOURNAL.entryToLegacyWaterTest(entry) : null)
      .filter(Boolean)
      .sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt));
    if (tests.length || hasJournalSource()) return tests;
    return [...(state.waterTests || [])].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt));
  }

  function isCareJournalEntry(entry = {}) {
    if (entry.legacyKind === "water_test") return false;
    if (["feeding", "maintenance", "water_change"].includes(entry.legacyKind)) return true;
    if (["equipment_setup", "livestock_setup", "livestock_health", "livestock_note"].includes(entry.legacyKind)) return false;
    return ["Feeding / Dosing", "Maintenance / Water Change", "Equipment Change"].includes(entry.type);
  }

  function getEventsFromJournal() {
    const events = (state.journal || [])
      .filter(isCareJournalEntry)
      .map((entry) => JOURNAL.entryToLegacyEvent ? JOURNAL.entryToLegacyEvent(entry) : null)
      .filter(Boolean)
      .sort((a, b) => new Date(a.happenedAt) - new Date(b.happenedAt));
    if (events.length || hasJournalSource()) return events;
    return [...(state.events || [])].sort((a, b) => new Date(a.happenedAt) - new Date(b.happenedAt));
  }

  function syncLegacyLogsFromJournal() {
    state.waterTests = getWaterTestsFromJournal();
    state.events = getEventsFromJournal();
  }

  function getOrCreateLightingRecord() {
    state.records ||= { equipment: [], livestock: [] };
    state.records.equipment ||= [];
    let record = getEquipmentRecordByTemplate("lighting");
    if (!record) {
      record = {
        id: RECORDS.stableEquipmentId ? RECORDS.stableEquipmentId("lighting") : "equipment_lighting",
        recordType: "equipment",
        category: "lighting",
        templateKey: "lighting",
        name: "Lighting",
        status: "active",
        addedAt: "",
        retiredAt: "",
        notes: "",
        photos: [],
        details: {
          model: state.profile.lightingModel || "",
          summary: state.profile.lightingSummary || "",
          lightStart: state.profile.lightStart || "",
          lightEnd: state.profile.lightEnd || "",
        },
        legacyRaw: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.records.equipment.push(record);
    }
    return record;
  }

  function photoIdFromPath(path) {
    if (!path) return "";
    const file = path.split("/").pop() || "";
    return file.replace(/\.[^.]+$/, "");
  }

  function getPhotoSrc(photo) {
    const normalized = normalizePhotoRecord(photo);
    if (!normalized) return "";
    if (normalized.dataUrl) return normalized.dataUrl;
    if (normalized.path) return getStoragePublicUrl(normalized.path);
    return "";
  }

  function getStoragePublicUrl(path) {
    if (!path) return "";
    const cached = signedPhotoUrls.get(path);
    if (cached?.url && cached.expiresAt > Date.now()) {
      return cached.url;
    }
    if (supabaseClient && currentUser) {
      ensureSignedPhotoUrl(path);
    }
    return PHOTO_PLACEHOLDER_SRC;
  }

  async function ensureSignedPhotoUrl(path) {
    if (!path || signedPhotoUrlRequests.has(path) || !supabaseClient || !currentUser) return;
    signedPhotoUrlRequests.add(path);
    try {
      const { data, error } = await supabaseClient.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(path, 3600);
      if (error) throw error;
      if (data?.signedUrl) {
        signedPhotoUrls.set(path, {
          url: data.signedUrl,
          expiresAt: Date.now() + 55 * 60 * 1000,
        });
        scheduleSignedPhotoRender();
      }
    } catch (error) {
      console.warn("Could not create signed photo URL", error);
    } finally {
      signedPhotoUrlRequests.delete(path);
    }
  }

  function scheduleSignedPhotoRender() {
    clearTimeout(signedPhotoRenderTimer);
    signedPhotoRenderTimer = setTimeout(() => {
      renderAll();
    }, 80);
  }

  function clearSignedPhotoUrls() {
    signedPhotoUrls.clear();
    signedPhotoUrlRequests.clear();
  }

  function cleanPathSegment(value) {
    return String(value || "item")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item";
  }

  function isCurrentUserStoragePath(path) {
    return Boolean(currentUser?.id && path?.split("/")[0] === currentUser.id);
  }

  async function loadLocalBackendConfig() {
    if (hasValidBackendConfig(backendConfig) && backendConfig.authRedirectUrl) return;

    const configPaths = isLocalDevelopmentHost()
      ? ["./config.local.json", "./config.json"]
      : ["./config.json"];
    for (const path of configPaths) {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) continue;
        const config = await response.json();
        if (!config.supabaseUrl || !config.supabaseAnonKey) continue;
        if (hasValidBackendConfig(backendConfig)) {
          const nextConfig = {
            ...backendConfig,
            authRedirectUrl: config.authRedirectUrl || backendConfig.authRedirectUrl || "",
          };
          if (nextConfig.authRedirectUrl !== backendConfig.authRedirectUrl) {
            backendConfig = nextConfig;
            writeJson(BACKEND_KEY, backendConfig);
          }
          return;
        }
        backendConfig = {
          supabaseUrl: config.supabaseUrl,
          supabaseAnonKey: config.supabaseAnonKey,
          authRedirectUrl: config.authRedirectUrl || "",
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
    syncLegacyLivestockFromRecords();
    syncLegacyLogsFromJournal();
    scheduleRemoteSave();
    const cached = writeJson(STORAGE_KEY, state);
    if (!cached && supabaseClient && currentUser && !isRemoteHydrating) {
      scheduleRemoteSave(50);
    }
  }

  function saveLocalState() {
    syncLegacyLivestockFromRecords();
    syncLegacyLogsFromJournal();
    const cached = writeJson(STORAGE_KEY, state, { silentQuota: true });
    if (!cached && supabaseClient && currentUser && !isRemoteHydrating) {
      scheduleRemoteSave(50);
    }
  }

  function scheduleRemoteSave(delay = 450) {
    if (!supabaseClient || !currentUser || isRemoteHydrating) return;
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
      if (Array.isArray(defaults[key])) return Array.isArray(profile[key]) && profile[key].length > 0;
      return String(profile[key] ?? "") !== String(defaults[key] ?? "");
    });
    const customZones = Array.isArray(value?.zones) && value.zones.some((zone) => {
      const defaultNames = ["Top rock", "Mid reef", "Sand bed"];
      return !defaultNames.includes(zone.name) || zone.parMin || zone.parMax || zone.notes;
    });
    const customMapDimensions = (() => {
      const dimensions = value?.map?.dimensions || {};
      const defaults = getDefaultMap().dimensions;
      return ["width", "depth", "height", "sandDepth", "waterline"].some((key) =>
        String(dimensions[key] ?? "") !== String(defaults[key] ?? ""),
      );
    })();

    return Boolean(
      profileChanged ||
        customZones ||
        customMapDimensions ||
        value?.map?.parMarkers?.length ||
        value?.livestock?.length ||
        value?.waterTests?.length ||
        value?.events?.length ||
        value?.records?.equipment?.length ||
        value?.records?.livestock?.length ||
        value?.journal?.length ||
        value?.insightRuns?.length,
    );
  }

  function countLegacySharedPhotoPaths(value) {
    if (Array.isArray(value)) {
      return value.reduce((total, item) => total + countLegacySharedPhotoPaths(item), 0);
    }
    if (!value || typeof value !== "object") return 0;
    return Object.entries(value).reduce((total, [key, entry]) => {
      if ((key === "path" || key === "storagePath") && typeof entry === "string" && entry.startsWith("shared/")) {
        return total + 1;
      }
      return total + countLegacySharedPhotoPaths(entry);
    }, 0);
  }

  function getStateDataScore(value) {
    const profile = value?.profile || {};
    const profileFields = [
      "displayVolume",
      "totalVolume",
      "startDate",
      "tankStyle",
      "filtration",
      "filtrationDetails",
      "lightingModel",
      "lightingSummary",
      "saltMix",
      "dosing",
      "tankSummary",
      "uvSchedule",
      "notes",
    ].filter((key) => String(profile[key] || "").trim()).length;
    const equipmentFlags = EQUIPMENT_FIELDS.filter(({ key }) => Boolean(profile[key])).length;
    const equipmentDetails = EQUIPMENT_FIELDS.filter(({ detailsKey }) => String(profile[detailsKey] || "").trim()).length;
    const lightingPhotos = Array.isArray(profile.lightingPhotos) ? profile.lightingPhotos.length : 0;
    const zoneDetails = Array.isArray(value?.zones)
      ? value.zones.filter((zone) => zone.parMin || zone.parMax || zone.notes).length
      : 0;
    const score = {
      livestock: Array.isArray(value?.livestock) ? value.livestock.length : 0,
      waterTests: Array.isArray(value?.waterTests) ? value.waterTests.length : 0,
      events: Array.isArray(value?.events) ? value.events.length : 0,
      equipmentRecords: Array.isArray(value?.records?.equipment) ? value.records.equipment.length : 0,
      livestockRecords: Array.isArray(value?.records?.livestock) ? value.records.livestock.length : 0,
      journal: Array.isArray(value?.journal) ? value.journal.length : 0,
      insightRuns: Array.isArray(value?.insightRuns) ? value.insightRuns.length : 0,
      profileFields,
      equipmentFlags,
      equipmentDetails,
      lightingPhotos,
      zoneDetails,
      parMarkers: Array.isArray(value?.map?.parMarkers) ? value.map.parMarkers.length : 0,
    };
    score.core =
      score.livestock +
      score.waterTests +
      score.events +
      score.equipmentRecords +
      score.livestockRecords +
      score.journal +
      score.insightRuns +
      score.profileFields +
      score.equipmentFlags +
      score.equipmentDetails +
      score.lightingPhotos +
      score.zoneDetails;
    score.total = score.core + score.parMarkers;
    return score;
  }

  function shouldProtectRemoteState(remoteState, localState) {
    const remoteLegacyPhotoPaths = countLegacySharedPhotoPaths(remoteState);
    const localLegacyPhotoPaths = countLegacySharedPhotoPaths(localState);
    if (localLegacyPhotoPaths > remoteLegacyPhotoPaths) return true;

    const remoteScore = getStateDataScore(remoteState);
    const localScore = getStateDataScore(localState);
    return (
      remoteScore.core >= localScore.core + 3 ||
      (remoteScore.livestock > localScore.livestock && remoteScore.core > localScore.core)
    );
  }

  function timestampMs(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function localStateNewerThanRemote(localState, remoteState, remoteUpdatedAt) {
    const localTime = timestampMs(localState?.updatedAt);
    const remoteStateTime = timestampMs(remoteState?.updatedAt);
    const remoteRowTime = timestampMs(remoteUpdatedAt);
    const remoteTime = remoteStateTime || remoteRowTime;
    return Boolean(localTime && remoteTime && localTime > remoteTime + 250);
  }

  function remoteChangedSinceKnown(updatedAt) {
    if (!updatedAt || !lastRemoteUpdatedAt) return false;
    const remoteTime = new Date(updatedAt).getTime();
    const knownTime = new Date(lastRemoteUpdatedAt).getTime();
    if (!Number.isFinite(remoteTime) || !Number.isFinite(knownTime)) {
      return updatedAt !== lastRemoteUpdatedAt;
    }
    return Math.abs(remoteTime - knownTime) > 1000;
  }

  function getPayloadSchemaVersion(value) {
    return Number(value?.schemaVersion || value?.version || 1);
  }

  function hasUnsupportedSchema(value) {
    const version = getPayloadSchemaVersion(value);
    return Number.isFinite(version) && version > STATE_SCHEMA_VERSION;
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
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
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

  function normalizeLivestockLifecycleStatus(status, category) {
    if (RECORDS.normalizeLivestockStatus) return RECORDS.normalizeLivestockStatus(status, category);
    const value = String(status || "").toLowerCase();
    if (value === "deceased") return "deceased";
    if (["removed", "moved", "sold", "traded", "given away", "lost"].includes(value)) return "removed";
    return "alive";
  }

  function livestockStatusLabel(status) {
    if (status === "deceased") return "Deceased";
    if (status === "removed") return "Removed";
    return "Alive";
  }

  function isAliveStock(item) {
    return normalizeLivestockLifecycleStatus(item.status, item.category) === "alive";
  }

  function normalizeLivestockFilter(filter) {
    const normalized = filter === "inactive" ? "deceased" : filter === "active" ? "alive" : filter;
    const filters = ["alive", "all", "Coral", "Fish", "inverts", "Microfauna", "Noticed pest", "deceased", "removed"];
    return filters.includes(normalized) ? normalized : "alive";
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

  function formatEquipmentAdded(item) {
    if (!item.active) return "Not installed";
    if (item.isLegacy || !item.addedDate) return "Legacy / add date unknown";
    return `Added ${formatDate(item.addedDate)}`;
  }

  function getEquipmentProfiles(profile = state.profile) {
    if (state.records?.equipment?.length) {
      return state.records.equipment.map((record) => {
        const current = getCurrentRecord(record);
        return {
          key: current.templateKey || current.id,
          id: current.id,
          label: current.name,
          category: current.category,
          active: current.status !== "retired",
          addedDate: current.addedAt || "",
          retiredAt: current.retiredAt || "",
          isLegacy: Boolean(current.isLegacy),
          details: current.details?.details || current.details?.summary || current.notes || "",
          schedule: current.details?.schedule || current.details?.lightStart || "",
          status: current.status === "retired"
            ? `Retired${current.retiredAt ? ` ${formatDate(current.retiredAt)}` : ""}`
            : current.addedAt ? `Added ${formatDate(current.addedAt)}` : "Active",
        };
      });
    }
    return EQUIPMENT_FIELDS.map(({ key, label, dateKey, legacyKey, detailsKey, scheduleKey }) => ({
      key,
      label,
      active: Boolean(profile[key]),
      addedDate: profile[dateKey] || "",
      isLegacy: Boolean(profile[key] && profile[legacyKey]),
      details: profile[detailsKey] || "",
      schedule: scheduleKey ? profile[scheduleKey] || "" : "",
      status: formatEquipmentAdded({
        active: Boolean(profile[key]),
        addedDate: profile[dateKey] || "",
        isLegacy: Boolean(profile[key] && profile[legacyKey]),
      }),
    }));
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

  function requestConfirmation(options = {}) {
    const dialog = $("confirmDialog");
    if (!dialog || typeof dialog.showModal !== "function") {
      return Promise.resolve(window.confirm(options.message || "Are you sure?"));
    }
    $("confirmTitle").textContent = options.title || "Confirm";
    $("confirmMessage").textContent = options.message || "Are you sure?";
    $("confirmActionButton").textContent = options.confirmLabel || "Confirm";
    if (pendingConfirmResolve) {
      pendingConfirmResolve(false);
      pendingConfirmResolve = null;
    }
    return new Promise((resolve) => {
      pendingConfirmResolve = resolve;
      dialog.showModal();
    });
  }

  function closeConfirmation(confirmed) {
    const resolve = pendingConfirmResolve;
    pendingConfirmResolve = null;
    const dialog = $("confirmDialog");
    if (dialog?.open) dialog.close();
    if (resolve) resolve(Boolean(confirmed));
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Could not read image."));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load image."));
      image.src = src;
    });
  }

  async function compressImageFile(file, maxDimension = 1000, quality = 0.82) {
    if (!file || !file.type.startsWith("image/")) {
      throw new Error("Choose an image file.");
    }

    const source = await readFileAsDataUrl(file);
    const image = await loadImage(source);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  function getPhotoDataUrlBytes(value) {
    if (Array.isArray(value)) {
      return value.reduce((total, item) => total + getPhotoDataUrlBytes(item), 0);
    }
    if (!value || typeof value !== "object") return 0;
    return Object.entries(value).reduce((total, [key, entry]) => {
      if (key === "dataUrl" && typeof entry === "string") return total + entry.length;
      return total + getPhotoDataUrlBytes(entry);
    }, 0);
  }

  function canStoreLocalPhoto(dataUrl) {
    if (supabaseClient && currentUser) return true;
    return getPhotoDataUrlBytes(state) + getPhotoDataUrlBytes({
      pendingLivestockPhotos,
      pendingInsightPhotos,
      pendingInsightFollowupPhotos,
    }) + String(dataUrl || "").length <= LOCAL_PHOTO_DATA_URL_LIMIT;
  }

  function createPendingPhoto(dataUrl) {
    return {
      id: uid(),
      path: "",
      dataUrl,
      createdAt: new Date().toISOString(),
    };
  }

  function getPhotoStoragePaths(photos) {
    return photos
      .map((photo) => normalizePhotoRecord(photo)?.path || "")
      .filter(Boolean);
  }

  async function uploadPhotoRecord(photo, folder, ownerId) {
    const normalized = normalizePhotoRecord(photo);
    if (!normalized || !normalized.dataUrl || !supabaseClient || !currentUser) return normalized;

    const blob = await dataUrlToBlob(normalized.dataUrl);
    const path = isCurrentUserStoragePath(normalized.path) ? normalized.path : [
      currentUser.id,
      cleanPathSegment(folder),
      cleanPathSegment(ownerId),
      `${cleanPathSegment(normalized.id)}.jpg`,
    ].join("/");
    const { error } = await supabaseClient.storage
      .from(PHOTO_BUCKET)
      .upload(path, blob, {
        cacheControl: "31536000",
        contentType: "image/jpeg",
        upsert: true,
      });
    if (error) throw error;
    return {
      id: normalized.id,
      path,
      dataUrl: "",
      createdAt: normalized.createdAt,
    };
  }

  async function preparePhotosForSave(ownerId, photos) {
    const saved = [];
    for (const photo of photos) {
      const normalized = normalizePhotoRecord(photo);
      if (!normalized) continue;
      saved.push(await uploadPhotoRecord(normalized, "livestock", ownerId));
    }
    return saved;
  }

  async function prepareInsightPhotosForSave(runId, photos) {
    const saved = [];
    for (const photo of photos) {
      const normalized = normalizePhotoRecord(photo);
      if (!normalized) continue;
      saved.push(supabaseClient && currentUser ? await uploadPhotoRecord(normalized, "insights", runId) : normalized);
    }
    return saved;
  }

  async function removeStoragePaths(paths) {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length || !supabaseClient || !currentUser) return;
    const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove(uniquePaths);
    if (error) console.warn("Could not remove stored photos", error);
  }

  async function processImageFiles(files, options) {
    const saved = [];
    const failed = [];
    let storageLimited = false;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const label = options.label || "image";
      try {
        showToast(`Processing ${label} ${index + 1} of ${files.length}.`);
        const dataUrl = await compressImageFile(file, options.maxDimension, options.quality);
        if (!canStoreLocalPhoto(dataUrl)) {
          storageLimited = true;
          throw new Error("Local photo storage limit reached.");
        }
        const pendingPhoto = createPendingPhoto(dataUrl);
        saved.push(await options.savePhoto(pendingPhoto));
      } catch (error) {
        console.error("Image processing failed", file?.name || index + 1, error);
        failed.push(file?.name || `${label} ${index + 1}`);
      }
    }

    return { saved, failed, storageLimited };
  }

  function showImageSaveResult(savedCount, failedCount, label, storageLimited = false) {
    if (savedCount && failedCount) {
      showToast(storageLimited
        ? `${savedCount} ${label}${savedCount === 1 ? "" : "s"} saved. Local photo storage is full.`
        : `${savedCount} ${label}${savedCount === 1 ? "" : "s"} saved, ${failedCount} skipped.`);
    } else if (savedCount) {
      showToast(`${savedCount} ${label}${savedCount === 1 ? "" : "s"} saved.`);
    } else if (storageLimited) {
      showToast("Local photo storage is full. Sign in or remove local photos.");
    } else {
      showToast(`No ${label}s saved. Try JPEG, PNG, or WebP.`);
    }
  }

  function renderPhotoPreview(previewRef, photoValue, altText) {
    const preview = typeof previewRef === "string" ? $(previewRef) : previewRef;
    if (!preview) return;
    const previewId = preview.id || "";
    const photos = (Array.isArray(photoValue) ? photoValue : photoValue ? [photoValue] : [])
      .map(normalizePhotoRecord)
      .filter(Boolean);
    if (!photos.length) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }

    const kind = preview.dataset.photoKind || (previewId === "insightPhotoPreview"
        ? "insight"
        : previewId === "insightFollowupPhotoPreview"
          ? "insight-followup"
          : "livestock");
    const runId = preview.dataset.insightRunId || "";
    preview.hidden = false;

    preview.innerHTML = `
      <div class="photo-preview-grid">
        ${photos.map((photo, index) => `
          <article class="photo-preview-item">
            <img src="${escapeHtml(getPhotoSrc(photo))}" alt="${escapeHtml(`${altText} ${index + 1}`)}" />
            <button class="mini-button danger" type="button" data-remove-photo="${kind}" data-photo-index="${index}"${runId ? ` data-insight-run-id="${escapeHtml(runId)}"` : ""}>Remove</button>
          </article>
        `).join("")}
      </div>
    `;
  }

  async function handlePhotoInput(event, target) {
    const input = event.target;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    input.disabled = true;
    try {
      if (target === "insight" || target === "insight-followup") {
        const result = await processImageFiles(files, {
          label: "insight photo",
          maxDimension: 1200,
          quality: 0.78,
          savePhoto: (photo) => photo,
        });
        if (result.saved.length) {
          if (target === "insight-followup") {
            const runId = input.dataset.insightFollowupPhoto || "";
            if (runId && pendingInsightFollowupRunId && pendingInsightFollowupRunId !== runId) {
              clearPendingInsightFollowupPhotos(pendingInsightFollowupRunId);
            }
            pendingInsightFollowupRunId = runId;
            pendingInsightFollowupPhotos = [...pendingInsightFollowupPhotos, ...result.saved];
            renderPhotoPreview(getInsightFollowupPhotoPreview(runId), pendingInsightFollowupPhotos, "Follow-up insight photo");
          } else {
            pendingInsightPhotos = [...pendingInsightPhotos, ...result.saved];
            renderPhotoPreview("insightPhotoPreview", pendingInsightPhotos, "Insight photo");
          }
        }
        showImageSaveResult(result.saved.length, result.failed.length, "insight photo", result.storageLimited);
      } else {
        const result = await processImageFiles(files, {
          label: "photo",
          maxDimension: 1100,
          quality: 0.78,
          savePhoto: (photo) => photo,
        });
        if (result.saved.length) {
          pendingLivestockPhotos = [...pendingLivestockPhotos, ...result.saved];
          renderActiveLivestockPhotoPreview();
        }
        showImageSaveResult(result.saved.length, result.failed.length, "photo", result.storageLimited);
      }
    } catch (error) {
      console.error(error);
      showToast(error.message || "Photo could not be saved.");
    } finally {
      input.disabled = false;
      input.value = "";
    }
  }

  function minutesFromTime(value) {
    if (!value || !value.includes(":")) return null;
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  }

  function getLightPhase(at = new Date()) {
    const lightingRecord = getEquipmentRecordByTemplate("lighting");
    const start = minutesFromTime(lightingRecord?.details?.lightStart || state.profile.lightStart);
    const end = minutesFromTime(lightingRecord?.details?.lightEnd || state.profile.lightEnd);
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
    return [...getWaterTestsFromJournal()].sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0] || null;
  }

  function getLatestEvent(type) {
    return [...getEventsFromJournal()]
      .filter((event) => event.type === type)
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))[0] || null;
  }

  function getLatestEventBefore(type, beforeIso) {
    const before = new Date(beforeIso).getTime();
    return [...getEventsFromJournal()]
      .filter((event) => event.type === type && new Date(event.happenedAt).getTime() <= before)
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))[0] || null;
  }

  function getLatestMaintenanceByLabel(label) {
    return [...getEventsFromJournal()]
      .filter((event) => event.type === "maintenance" && event.label === label)
      .sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt))[0] || null;
  }

  function getCareTaskLastDate(task) {
    if (task.source === "water_test") return getLatestWaterTest()?.measuredAt || "";
    if (task.source === "event_type") return getLatestEvent(task.type)?.happenedAt || "";
    if (task.source === "maintenance_label") return getLatestMaintenanceByLabel(task.labelMatch)?.happenedAt || "";
    return "";
  }

  function getCareTaskStatus(task) {
    const lastAt = getCareTaskLastDate(task);
    const lastAgeDays = daysSince(lastAt);
    const intervalDays = Number(task.intervalDays);
    const scheduled = Number.isFinite(intervalDays) && intervalDays > 0;
    const dueInDays = scheduled && lastAgeDays !== null ? intervalDays - lastAgeDays : null;
    const overdue = scheduled && (lastAgeDays === null || lastAgeDays > intervalDays);
    const dueSoon = scheduled && !overdue && dueInDays !== null && dueInDays <= 1;
    return {
      key: task.key,
      label: task.label,
      source: task.source,
      type: task.type,
      labelMatch: task.labelMatch,
      lastAt,
      lastAgeDays,
      intervalDays: scheduled ? intervalDays : null,
      dueInDays,
      overdue,
      dueSoon,
      manualOnly: !scheduled,
      status: overdue ? "overdue" : dueSoon ? "due_soon" : scheduled ? "current" : "manual",
      overdueLabel: task.overdueLabel,
    };
  }

  function getCareTaskStatuses() {
    return CARE_TASKS.map(getCareTaskStatus);
  }

  function describeTimeAfter(event, timestamp) {
    if (!event || !timestamp) return "No prior logged event";
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
    if (Array.isArray(state.journal) && state.journal.length) {
      return state.journal
        .filter((entry) => !["equipment_setup", "livestock_setup", "livestock_health", "livestock_note"].includes(entry.legacyKind))
        .map((entry) => ({
          id: entry.id,
          kind: "journal",
          at: entry.occurredAt,
          title: entry.title || entry.type || "Journal entry",
          details: describeJournalEntry(entry),
          meta: [formatDateTime(entry.occurredAt), entry.type]
            .filter(Boolean)
            .join(" · "),
        }))
        .sort((a, b) => new Date(b.at) - new Date(a.at));
    }

    const tests = getWaterTestsFromJournal().map((test) => ({
      id: test.id,
      kind: "test",
      at: test.measuredAt,
      title: "Water test",
      details: describeWaterTest(test),
      meta: `${formatDateTime(test.measuredAt)} · ${test.timing?.lightPhase || getLightPhase(test.measuredAt).label}`,
    }));

    const events = getEventsFromJournal().map((event) => ({
      id: event.id,
      kind: event.type,
      at: event.happenedAt,
      title: describeEventTitle(event),
      details: describeEventDetails(event),
      meta: formatDateTime(event.happenedAt),
    }));

    return [...tests, ...events].sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function describeJournalEntry(entry) {
    if (entry.type === "Water Test" && entry.measurements) {
      const measurements = entry.measurements || {};
      return describeWaterTest({
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
      });
    }
    const links = [
      ...(entry.linkedEquipment || []).map((id) => (state.records?.equipment || []).find((record) => record.id === id)?.name || ""),
      ...(entry.linkedLivestock || []).map((id) => (state.records?.livestock || []).find((record) => record.id === id)?.name || ""),
    ].filter(Boolean);
    return [entry.summary, links.length ? `Related: ${links.join(", ")}` : ""].filter(Boolean).join(" · ") || entry.type || "Journal entry";
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
    if (next === "map") {
      requestAnimationFrame(() => window.RC.Map.renderReefMap2({ rebuild: true }));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    refreshIcons();
  }

  function renderAll() {
    syncLegacyLivestockFromRecords();
    syncLegacyLogsFromJournal();
    renderTankProfileForm();
    renderDashboard();
    renderZones();
    window.RC.Map?.renderMapSettings?.();
    window.RC.Map?.renderMap2Settings?.();
    window.RC.Map?.renderMapSummaries?.();
    window.RC.Map?.renderMapMarkerControls?.();
    syncLivestockDateControls();
    renderLivestock();
    renderPhotoLibrary();
    renderLogMode();
    renderTimeline();
    window.RC.Insights?.renderInsightsContext?.();
    window.RC.Insights?.renderInsightOutput?.();
    renderBackendSettings();
    setActiveView(state.ui.activeView || "home");
    refreshIcons();
  }

  function renderDashboard() {
    const profile = state.profile;
    const latestTest = getLatestWaterTest();
    const latestWaterChange = getLatestEvent("water_change");
    const activeLivestock = getLivestockItems().filter((item) => isLifecycleStock(item) && isAliveStock(item));
    const activeQuantity = activeLivestock.reduce((total, item) => {
      const rawQuantity = item.currentCount !== "" && item.currentCount !== null && item.currentCount !== undefined
        ? item.currentCount
        : item.quantity;
      const quantity = Number(rawQuantity);
      return total + (Number.isFinite(quantity) && rawQuantity !== "" ? Math.max(0, quantity) : 1);
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
    $("metricLivestockMeta").textContent = `${activeLivestock.length} alive items`;

    renderRiskStrip();
    renderHomeTimeline();
    window.RC.Insights.renderHomeInsightBrief();
    refreshIcons();
  }

  function renderRiskStrip() {
    const risks = [];
    const latestTest = getLatestWaterTest();
    const careStatuses = getCareTaskStatuses();

    if (latestTest) {
      if (latestTest.ammonia !== null && latestTest.ammonia > 0.05) {
        risks.push({ tone: "danger", label: "Ammonia detected", action: "test", help: "Log a follow-up water test" });
      }
      if (latestTest.nitrite !== null && latestTest.nitrite > 0.05) {
        risks.push({ tone: "danger", label: "Nitrite detected", action: "test", help: "Log a follow-up water test" });
      }
      if (latestTest.nitrate !== null && latestTest.nitrate > 30) {
        risks.push({ tone: "warning", label: "Nitrate elevated", action: "test", help: "Log a follow-up water test" });
      }
    }

    careStatuses
      .filter((task) => task.overdue)
      .forEach((task) => risks.push({
        tone: "warning",
        label: task.lastAt ? task.overdueLabel : `${task.label} not logged`,
        action: getCareTaskLogMode(task),
        help: `Log ${task.label.toLowerCase()}`,
      }));
    careStatuses
      .filter((task) => task.dueSoon)
      .forEach((task) => risks.push({
        tone: "warning",
        label: `${task.label} due soon`,
        action: getCareTaskLogMode(task),
        help: `Log ${task.label.toLowerCase()}`,
      }));

    if (!risks.length) risks.push({ tone: "good", label: "No obvious alerts" });

    $("riskStrip").innerHTML = risks
      .map((risk) => risk.action
        ? `<button class="risk-chip" data-tone="${risk.tone}" data-open-log="${escapeHtml(risk.action)}" type="button" title="${escapeHtml(risk.help || "Open Journal")}">${escapeHtml(risk.label)}</button>`
        : `<span class="risk-chip" data-tone="${risk.tone}">${escapeHtml(risk.label)}</span>`)
      .join("");
  }

  function getCareTaskLogMode(task) {
    if (task.source === "water_test") return "test";
    if (task.key === "water_change" || task.type === "water_change") return "water_change";
    return "maintenance";
  }

  function renderHomeTimeline() {
    const entries = getTimelineEntries().slice(0, 4);
    $("homeTimeline").innerHTML = entries.length
      ? entries.map(renderTimelineEntry).join("")
      : `<div class="empty-state">No logs yet.</div>`;
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
    renderEquipmentRecords();
    renderTankProfileMode();
  }

  function renderTankProfileMode() {
    $$("[data-profile]").forEach((input) => {
      input.disabled = !tankProfileEditing;
    });
    const editButton = $("editTankProfileButton");
    const saveButton = $("saveTankProfileButton");
    const cancelButton = $("cancelTankProfileButton");
    if (editButton) editButton.hidden = tankProfileEditing;
    if (saveButton) saveButton.hidden = !tankProfileEditing;
    if (cancelButton) cancelButton.hidden = !tankProfileEditing;
    if ($("profileSavedStatus")) $("profileSavedStatus").textContent = tankProfileEditing ? "Editing" : "Saved";
  }

  function startTankProfileEdit() {
    tankProfileEditing = true;
    renderTankProfileMode();
    $("tankProfileForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    refreshIcons();
  }

  function cancelTankProfileEdit() {
    tankProfileEditing = false;
    renderTankProfileForm();
  }

  function updateProfileFromForm(event) {
    event?.preventDefault?.();
    $$("[data-profile]").forEach((input) => {
      const key = input.dataset.profile;
      state.profile[key] = input.type === "checkbox" ? input.checked : input.value;
    });
    tankProfileEditing = false;
    saveState();
    $("profileSavedStatus").textContent = "Saved";
    renderTankProfileMode();
    renderDashboard();
    renderPhotoLibrary();
    window.RC.Insights?.renderInsightsContext?.();
    showToast("Tank profile saved.");
  }

  function equipmentCategoryLabel(category) {
    const labels = {
      filtration: "Filtration",
      lighting: "Lighting",
      skimmer: "Skimmer",
      sump: "Sump",
      refugium: "Refugium",
      ato: "ATO",
      feeder: "Feeder",
      uv: "UV",
      reactor: "Reactor",
      flow: "Flow",
      other: "Other",
    };
    return labels[category] || category || "Equipment";
  }

  function equipmentCategoryOptions(selected = "") {
    return ["filtration","lighting","skimmer","sump","refugium","ato","feeder","uv","reactor","flow","other"]
      .map((v) => `<option value="${v}"${selected === v ? " selected" : ""}>${equipmentCategoryLabel(v)}</option>`)
      .join("");
  }

  function equipmentDetailsText(record = {}) {
    const item = record || {};
    return item.details?.details || item.details?.summary || item.details?.model || "";
  }

  function equipmentScheduleText(record = {}) {
    const item = record || {};
    return item.details?.schedule || item.details?.lightStart || "";
  }

  function dateInputValue(value) {
    return String(value || "").slice(0, 10);
  }

  function renderReadonlyEquipmentField(label, value, options = {}) {
    const className = options.wide ? ` class="wide-field"` : "";
    const normalized = value || "";
    const control = options.multiline
      ? `<textarea rows="${options.rows || 3}" disabled>${escapeHtml(normalized)}</textarea>`
      : `<input type="${options.type || "text"}" value="${escapeHtml(normalized)}" disabled />`;
    return `<label${className}>${escapeHtml(label)}${control}</label>`;
  }

  function renderReadonlyEquipmentSelect(label, value) {
    return `
      <label>${escapeHtml(label)}
        <select disabled>
          <option>${escapeHtml(value || "")}</option>
        </select>
      </label>
    `;
  }

  function renderReadonlyEquipmentFields(record) {
    const status = record.status === "retired" ? "retired" : "active";
    return `
      <div class="field-grid equipment-readonly-grid">
        ${renderReadonlyEquipmentField("Name", record.name || "Equipment")}
        ${renderReadonlyEquipmentSelect("Type", equipmentCategoryLabel(record.category))}
        ${renderReadonlyEquipmentSelect("Status", status === "retired" ? "Retired" : "Active")}
        ${renderReadonlyEquipmentField("Added", dateInputValue(record.addedAt), { type: "date" })}
        ${status === "retired" ? renderReadonlyEquipmentField("Retired", dateInputValue(record.retiredAt), { type: "date" }) : ""}
        ${renderReadonlyEquipmentField("Schedule", equipmentScheduleText(record))}
        ${renderReadonlyEquipmentField("Details", equipmentDetailsText(record), { wide: true, multiline: true, rows: 3 })}
        ${renderReadonlyEquipmentField("Notes", record.notes || "", { wide: true, multiline: true, rows: 2 })}
      </div>
    `;
  }

  function renderEquipmentRecords() {
    const list = $("equipmentRecordList");
    if (!list) return;
    const records = [...(state.records?.equipment || [])]
      .map((record) => getCurrentRecord(record))
      .sort((a, b) => {
        if (a.status === b.status) return String(a.name || "").localeCompare(String(b.name || ""));
        return a.status === "active" ? -1 : 1;
      });

    const addingCard = state.ui?.addingEquipmentRecord ? renderEquipmentRecordCardEdit(null) : "";
    const cards = records.length
      ? records.map(renderEquipmentRecordCard).join("")
      : (addingCard ? "" : `<div class="empty-state">No equipment setup yet.</div>`);
    list.innerHTML = addingCard + cards;
    refreshIcons();
  }

  function renderEquipmentRecordCard(record) {
    if (state.ui?.editingEquipmentId === record.id) {
      return renderEquipmentRecordCardEdit(record);
    }
    const history = getRecordHistory(record.id);
    const status = record.status === "retired" ? "retired" : "active";
    const dates = [
      record.addedAt ? `Added ${formatDate(record.addedAt)}` : "",
      status === "retired" && record.retiredAt ? `Retired ${formatDate(record.retiredAt)}` : "",
    ].filter(Boolean).join(" · ");
    return `
      <details class="data-card record-card" data-equipment-record="${escapeHtml(record.id)}">
        <summary class="data-card-header">
          <div class="data-card-title">
            <strong>${escapeHtml(record.name || "Equipment")}</strong>
            <p class="card-meta">${escapeHtml([equipmentCategoryLabel(record.category), dates].filter(Boolean).join(" · "))}</p>
          </div>
          <div class="record-card-summary-aside">
            <span class="category-pill${status === "retired" ? " pill-muted" : ""}">${status === "retired" ? "Retired" : "Active"}</span>
          </div>
        </summary>
        <div class="record-card-body">
          ${renderReadonlyEquipmentFields(record)}
        </div>
        ${renderRecordHistoryList(history, { showEmpty: false })}
        <div class="card-actions">
          <button class="mini-button icon-mini-button" type="button" title="Edit" data-equipment-action="edit" data-id="${escapeHtml(record.id)}">
            <i data-lucide="pencil"></i>
          </button>
          <button class="mini-button" type="button" data-record-journal="equipment:${escapeHtml(record.id)}">Add Journal Entry</button>
        </div>
      </details>
    `;
  }

  function renderEquipmentRecordCardEdit(record) {
    const id = record?.id || "";
    const status = record?.status || "active";
    const showRetiredAt = status === "retired";
    const sel = (opt, val) => opt === val ? " selected" : "";
    return `
      <div class="data-card record-card record-card-editing" data-equipment-record="${escapeHtml(id)}">
        <form id="equipmentSetupForm" class="field-grid">
          <input id="equipmentRecordId" type="hidden" value="${escapeHtml(id)}" />
          <label>Name
            <input id="equipmentRecordName" type="text" required value="${escapeHtml(record?.name || "")}" />
          </label>
          <label>Type
            <select id="equipmentRecordCategory">${equipmentCategoryOptions(record?.category || "other")}</select>
          </label>
          <label>Status
            <select id="equipmentRecordStatus">
              <option value="active"${sel(status, "active")}>Active</option>
              <option value="retired"${sel(status, "retired")}>Retired</option>
            </select>
          </label>
          <label>Added
            <input id="equipmentRecordAddedAt" type="date" value="${escapeHtml(record?.addedAt || "")}" />
          </label>
          <label class="equipment-retired-field"${showRetiredAt ? "" : " hidden"}>
            Retired
            <input id="equipmentRecordRetiredAt" type="date" value="${escapeHtml(record?.retiredAt || "")}"${showRetiredAt ? "" : " disabled"} />
          </label>
          <label>Schedule
            <input id="equipmentRecordSchedule" type="text" value="${escapeHtml(equipmentScheduleText(record))}" />
          </label>
          <label class="wide-field">Details
            <textarea id="equipmentRecordDetails" rows="3">${escapeHtml(equipmentDetailsText(record))}</textarea>
          </label>
          <label class="wide-field">Notes
            <textarea id="equipmentRecordNotes" rows="2">${escapeHtml(record?.notes || "")}</textarea>
          </label>
          <div class="form-actions wide-field">
            <button class="primary-button" type="submit"><i data-lucide="save"></i> Save</button>
            <button class="secondary-button" type="button" data-equipment-action="cancel">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function humanizeKey(key) {
    return String(key || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function renderRecordHistoryList(history, options = {}) {
    if (!history.length) {
      return options.showEmpty ? `<div class="record-history-empty card-meta muted">No journal history yet.</div>` : "";
    }
    const entries = history.slice().reverse().map((entry) => `
      <div class="record-history-entry">
        <span class="record-history-date">${escapeHtml(formatDateTime(entry.occurredAt))}</span>
        <span class="record-history-title">${escapeHtml(entry.title || entry.type)}</span>
      </div>
    `).join("");
    return `
      <details class="record-history-panel">
        <summary>
          <span>History (${history.length})</span>
          <i data-lucide="chevron-down"></i>
        </summary>
        <div class="record-history-list">${entries}</div>
      </details>
    `;
  }

  function resetEquipmentSetup() {
    state.ui ||= {};
    state.ui.editingEquipmentId = null;
    state.ui.addingEquipmentRecord = false;
    renderEquipmentRecords();
  }

  function syncEquipmentRetiredDateControl() {
    const statusInput = $("equipmentRecordStatus");
    const retiredField = document.querySelector(".equipment-retired-field");
    const retiredInput = $("equipmentRecordRetiredAt");
    if (!statusInput || !retiredField || !retiredInput) return;
    const isRetired = statusInput.value === "retired";
    retiredField.hidden = !isRetired;
    retiredInput.disabled = !isRetired;
    if (!isRetired) retiredInput.value = "";
  }

  function startEquipmentSetup(id = "") {
    state.ui ||= {};
    if (id) {
      state.ui.editingEquipmentId = id;
      state.ui.addingEquipmentRecord = false;
    } else {
      state.ui.editingEquipmentId = null;
      state.ui.addingEquipmentRecord = true;
    }
    renderEquipmentRecords();
    requestAnimationFrame(() => {
      syncEquipmentRetiredDateControl();
      $("equipmentSetupForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function getEquipmentSetupFormData() {
    const detailsText = $("equipmentRecordDetails").value.trim();
    const schedule = $("equipmentRecordSchedule").value.trim();
    const status = $("equipmentRecordStatus").value;
    return {
      id: $("equipmentRecordId").value || `equipment_${uid()}`,
      recordType: "equipment",
      category: $("equipmentRecordCategory").value,
      templateKey: "",
      name: $("equipmentRecordName").value.trim(),
      status,
      addedAt: $("equipmentRecordAddedAt").value,
      retiredAt: status === "retired" ? $("equipmentRecordRetiredAt")?.value || "" : "",
      notes: $("equipmentRecordNotes").value.trim(),
      photos: [],
      details: {
        details: detailsText,
        schedule,
      },
      legacyRaw: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function addJournalEntry(entry) {
    state.journal ||= [];
    const normalized = JOURNAL.createJournalEntry ? JOURNAL.createJournalEntry(entry) : {
      id: entry.id || uid(),
      occurredAt: entry.occurredAt || new Date().toISOString(),
      type: entry.type || "Observation",
      title: entry.title || entry.type || "Journal entry",
      summary: entry.summary || "",
      linkedEquipment: entry.linkedEquipment || [],
      linkedLivestock: entry.linkedLivestock || [],
      effects: entry.effects || [],
    };
    state.journal = state.journal.filter((item) => item.id !== normalized.id);
    state.journal.push(normalized);
    state.journal.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
    return normalized;
  }

  function saveEquipmentSetup(event) {
    event.preventDefault();
    const formData = getEquipmentSetupFormData();
    if (!formData.name) {
      showToast("Equipment needs a name.");
      return;
    }
    state.records ||= { equipment: [], livestock: [] };
    state.records.equipment ||= [];
    const existing = state.records.equipment.find((record) => record.id === formData.id);
    if (existing) {
      Object.assign(existing, {
        ...formData,
        photos: existing.photos || [],
        templateKey: existing.templateKey || formData.templateKey,
        legacyRaw: existing.legacyRaw || {},
        createdAt: existing.createdAt || formData.createdAt,
        updatedAt: new Date().toISOString(),
      });
    } else {
      state.records.equipment.push(formData);
      addJournalEntry({
        id: `journal_found_${formData.id}`,
        type: "Equipment Change",
        occurredAt: formData.addedAt ? new Date(`${formData.addedAt}T00:00:00`).toISOString() : new Date().toISOString(),
        title: `${formData.name} added`,
        summary: "",
        linkedEquipment: [formData.id],
        effects: [
          {
            recordId: formData.id,
            fields: {
              status: formData.status,
              addedAt: formData.addedAt,
              retiredAt: formData.retiredAt,
            },
          },
        ],
      });
    }
    state.ui ||= {};
    state.ui.editingEquipmentId = null;
    state.ui.addingEquipmentRecord = false;
    saveState();
    renderEquipmentRecords();
    window.RC.Insights?.renderInsightsContext?.();
    showToast(existing ? "Equipment setup updated." : "Equipment added.");
  }

  function renderZones() {
    const zoneList = $("zoneList");
    if (zoneList) {
      zoneList.innerHTML = state.zones.length
        ? state.zones.map((zone) => `
          <article class="data-card">
            <div class="data-card-header">
              <div class="data-card-title">
                <strong>${escapeHtml(zone.name)}</strong>
                <p class="card-meta">${escapeHtml(zone.light)} light${zone.parMin || zone.parMax ? ` · PAR ${escapeHtml(zone.parMin || "?")} - ${escapeHtml(zone.parMax || "?")}` : ""}</p>
              </div>
              <span class="category-pill">Zone</span>
            </div>
            ${zone.notes ? `<p class="card-meta">${escapeHtml(zone.notes)}</p>` : ""}
            <div class="card-actions">
              <button class="mini-button danger" type="button" data-zone-delete="${zone.id}">Delete</button>
            </div>
          </article>
        `).join("")
        : `<div class="empty-state">No legacy placement records.</div>`;
    }

    const options = [
      `<option value="">Unplaced</option>`,
      ...state.zones.map((zone) => `<option value="${zone.id}">${escapeHtml(zone.name)}</option>`),
    ].join("");
    if ($("livestockZone")) $("livestockZone").innerHTML = options;
  }

  function renderLivestock() {
    const livestockItems = getLivestockItems();
    const activeCount = livestockItems.filter((item) => isLifecycleStock(item) && isAliveStock(item)).length;
    const deceasedCount = livestockItems.filter((item) => isLifecycleStock(item) && item.status === "deceased").length;
    const removedCount = livestockItems.filter((item) => isLifecycleStock(item) && item.status === "removed").length;
    const casualCount = livestockItems.filter((item) => item.casual || isCasualStockCategory(item.category)).length;
    $("livestockCountPill").textContent = `${activeCount} alive · ${casualCount} casual${deceasedCount ? ` · ${deceasedCount} deceased` : ""}${removedCount ? ` · ${removedCount} removed` : ""}`;
    state.ui.livestockFilter = normalizeLivestockFilter(state.ui.livestockFilter);
    const formShell = $("livestockFormShell");
    if (formShell) formShell.hidden = Boolean(editingLivestockId);
    $$("[data-livestock-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.livestockFilter === state.ui.livestockFilter);
    });

    const filter = state.ui.livestockFilter;
    const items = livestockItems.filter((item) => isLivestockVisibleForFilter(item, filter));

    $("livestockList").innerHTML = items.length
      ? items.map(renderLivestockCard).join("")
      : `<div class="empty-state">No livestock items.</div>`;
    renderActiveLivestockPhotoPreview();
    refreshIcons();
  }

  function isLivestockVisibleForFilter(item, filter) {
    if (filter === "deceased") return isLifecycleStock(item) && item.status === "deceased";
    if (filter === "removed") return isLifecycleStock(item) && item.status === "removed";
    if (item.status === "deceased" || item.status === "removed") return false;
    if (filter === "all") return true;
    if (filter === "alive") return isLifecycleStock(item) && isAliveStock(item);
    if (filter === "inverts") return item.category === "Invert" || item.category === "Cleanup crew";
    return item.category === filter;
  }

  function renderLivestockCard(item) {
    const casual = isCasualStockCategory(item.category);
    const editing = editingLivestockId === item.id;
    const inactive = !casual && !isAliveStock(item);
    const quantityAdded = formatQuantity(item.quantity);
    const currentCount = formatQuantity(item.currentCount);
    const countParts = [
      item.trackingUnit ? `Unit ${item.trackingUnit}` : "",
      quantityAdded ? `Qty added ${quantityAdded}` : "",
      currentCount ? `Current ${currentCount}` : "",
    ].filter(Boolean);
    const photos = getLivestockPhotos(item);
    const currentHealth = item.health || "";
    const wellnessParts = [
      currentHealth ? `Current health: ${currentHealth}` : "",
      item.growthTrend ? `Growth: ${item.growthTrend}` : "",
    ].filter(Boolean);
    const history = getRecordHistory(item.id);
    const outcome = !casual && !isAliveStock(item)
      ? `<p class="card-meta">${escapeHtml(livestockStatusLabel(item.status))}${item.removedDate ? ` on ${escapeHtml(formatDate(item.removedDate))}` : ""}${item.outcomeReason ? ` · ${escapeHtml(item.outcomeReason)}` : ""}</p>`
      : "";
    return `
      <article class="data-card livestock-card${editing ? " is-editing" : ""}${inactive ? " is-inactive" : ""}" data-livestock-card="${escapeHtml(item.id)}">
        <div class="data-card-header">
          <div class="data-card-title">
            <strong>${escapeHtml(item.species)}</strong>
            <p class="card-meta">${escapeHtml([item.category, ...countParts].join(" · "))}</p>
          </div>
          <span class="category-pill">${escapeHtml(casual ? "Casual" : livestockStatusLabel(item.status))}</span>
        </div>
        ${editing ? renderLivestockInlineEditForm(item) : `
          <p class="card-meta">${escapeHtml(formatStockDate(item))}</p>
          ${wellnessParts.length ? `<p class="card-meta">${escapeHtml(wellnessParts.join(" · "))}</p>` : ""}
          ${renderStockPhotoGrid(item, photos)}
          ${renderRecordHistoryList(history)}
          ${outcome}
          <div class="card-actions">
            <button class="mini-button" type="button" data-record-journal="livestock:${escapeHtml(item.id)}">Add Journal Entry</button>
            <button class="mini-button icon-mini-button" type="button" title="Edit setup" data-livestock-action="edit" data-id="${escapeHtml(item.id)}">
              <i data-lucide="pencil"></i>
            </button>
            <details class="card-menu">
              <summary class="mini-button">More</summary>
              <div class="card-menu-actions">
                ${!casual && isAliveStock(item) ? `
                  <button class="mini-button danger" type="button" data-livestock-action="deceased" data-id="${escapeHtml(item.id)}">Mark Deceased</button>
                  <button class="mini-button" type="button" data-livestock-action="removed" data-id="${escapeHtml(item.id)}">Mark Removed</button>
                ` : !casual ? `
                  <button class="mini-button good" type="button" data-livestock-action="restore" data-id="${escapeHtml(item.id)}">Restore</button>
                ` : ""}
                <button class="mini-button danger" type="button" data-livestock-action="delete" data-id="${escapeHtml(item.id)}">Delete</button>
              </div>
            </details>
          </div>
        `}
      </article>
    `;
  }

  function renderLivestockInlineEditForm(item) {
    const casual = isCasualStockCategory(item.category);
    const hideDate = !casual && item.isLegacy;
    return `
      <form class="embedded-form livestock-inline-form" data-livestock-inline-form data-id="${escapeHtml(item.id)}">
        <div class="field-grid">
          <label>
            Species / Item
            <input name="species" type="text" value="${escapeHtml(item.species || item.name || "")}" required />
          </label>
          <label>
            Category
            <select name="category">
              ${renderLivestockSelectOptions([
                ["Fish", "Fish"],
                ["Coral", "Coral"],
                ["Invert", "Invert"],
                ["Cleanup crew", "Cleanup crew"],
                ["Microfauna", "Microfauna"],
                ["Noticed pest", "Noticed pest"],
                ["Macroalgae", "Macroalgae"],
                ["Other", "Other"],
              ], item.category || "Other")}
            </select>
          </label>
          <label>
            Quantity Added
            <input name="quantity" type="number" min="0" step="1" value="${escapeHtml(item.quantity ?? "")}" />
          </label>
          <label>
            Current Count
            <input name="currentCount" type="number" min="0" step="1" value="${escapeHtml(item.currentCount ?? "")}" />
          </label>
          <label>
            Tracking Unit
            <select name="trackingUnit">
              ${renderLivestockSelectOptions([
                ["", "Select"],
                ["Specimen", "Specimen"],
                ["Colony", "Colony"],
                ["Frag", "Frag"],
                ["Head", "Head"],
                ["Polyp", "Polyp"],
                ["Mushroom", "Mushroom"],
                ["Mouth", "Mouth"],
                ["Branch", "Branch"],
                ["Patch", "Patch"],
                ["Other", "Other"],
              ], item.trackingUnit || "")}
            </select>
          </label>
          <label data-inline-livestock-date-field ${hideDate ? "hidden" : ""}>
            <span data-inline-livestock-date-label>${casual ? "First Noticed" : "Date Added"}</span>
            <input name="addedDate" type="date" value="${escapeHtml(item.addedDate || "")}" ${hideDate ? "disabled" : ""} />
          </label>
          <label>
            Initial Health
            <select name="health">
              ${renderLivestockSelectOptions([
                ["", "Not tracked"],
                ["Thriving", "Thriving"],
                ["Stable", "Stable"],
                ["Struggling", "Struggling"],
                ["Declining", "Declining"],
                ["Unknown", "Unknown"],
              ], item.initialHealth || "")}
            </select>
          </label>
          <label class="wide-field">
            Add Note
            <input name="noteText" type="text" placeholder="Saved with timestamp" />
          </label>
        </div>
        <div class="photo-field">
          <label>
            Photos
            <input id="livestockInlinePhotoInput" type="file" accept="image/*" multiple />
          </label>
          <div id="livestockInlinePhotoPreview" class="photo-preview" hidden></div>
        </div>
        <div class="toggle-row" data-inline-livestock-legacy-row ${casual ? "hidden" : ""}>
          <label class="check-label">
            <input name="isLegacy" type="checkbox" ${item.isLegacy ? "checked" : ""} ${casual ? "disabled" : ""} />
            Legacy / add date unknown
          </label>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit">
            <i data-lucide="save"></i>
            Save
          </button>
          <button class="secondary-button" type="button" data-livestock-action="cancel-edit" data-id="${escapeHtml(item.id)}">
            Cancel
          </button>
        </div>
      </form>
    `;
  }

  function renderLivestockSelectOptions(options, selectedValue) {
    return options.map(([value, label]) => `
      <option value="${escapeHtml(value)}"${String(value) === String(selectedValue) ? " selected" : ""}>${escapeHtml(label)}</option>
    `).join("");
  }

  function getLivestockPhotoPreviewId() {
    return editingLivestockId ? "livestockInlinePhotoPreview" : "livestockPhotoPreview";
  }

  function renderActiveLivestockPhotoPreview() {
    renderPhotoPreview(getLivestockPhotoPreviewId(), pendingLivestockPhotos, "Stock photo");
  }

  function renderStockPhotoGrid(item, photos) {
    if (!photos.length) return "";
    return `
      <div class="stock-photo-grid" data-count="${Math.min(photos.length, 4)}">
        ${photos.slice(0, 4).map((photo, index) => `
          <img src="${escapeHtml(getPhotoSrc(photo))}" alt="${escapeHtml(`${item.species} photo ${index + 1}`)}" />
        `).join("")}
      </div>
      ${photos.length > 1 ? `<p class="card-meta">${photos.length} photos</p>` : ""}
    `;
  }

  function getPhotoLibraryItems() {
    const photos = [];
    getLivestockItems().forEach((item) => {
      const itemPhotos = getLivestockPhotos(item);
      itemPhotos.forEach((photo, index) => {
        photos.push({
          id: `${item.id}-${index}`,
          title: item.species || "Stock photo",
          subtitle: [
            item.category,
            formatStockDate(item),
            itemPhotos.length > 1 ? `Photo ${index + 1}` : "",
          ].filter(Boolean).join(" · "),
          src: getPhotoSrc(photo),
        });
      });
    });
    return photos;
  }

  function renderPhotoLibrary() {
    const library = $("photoLibrary");
    if (!library) return;
    const photos = getPhotoLibraryItems();
    const section = $("photoLibrarySection");
    if (section) section.hidden = photos.length === 0;
    $("photoCountPill").textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;
    library.innerHTML = photos.map((photo) => `
        <article class="photo-tile">
          <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.title)}" />
          <strong>${escapeHtml(photo.title)}</strong>
          <span>${escapeHtml(photo.subtitle)}</span>
        </article>
      `).join("");
  }

  function renderLogMode() {
    seedLogDates();
    renderJournalTypeFields();
    renderJournalRecordPickers();
    renderJournalLivestockFields();
  }

  function renderJournalTypeFields() {
    const type = $("journalEntryType")?.value || "Observation";
    if ($("journalEntryHint")) $("journalEntryHint").textContent = type;
    $$("[data-journal-fields]").forEach((element) => {
      const visible = element.dataset.journalFields === type;
      element.hidden = !visible;
      element.querySelectorAll?.("input, select, textarea, button").forEach((input) => {
        input.disabled = !visible;
      });
    });
    updateTestTimingPill();
    renderJournalLivestockFields();
  }

  function renderJournalRecordPickers() {
    const equipmentPicker = $("journalLinkedEquipment");
    const livestockPicker = $("journalLinkedLivestock");
    if (!equipmentPicker || !livestockPicker) return;
    const pending = state.ui.pendingJournalLink || {};
    const selectedEquipment = new Set([
      ...getSelectedOptions(equipmentPicker),
      ...(pending.recordType === "equipment" ? [pending.recordId] : []),
    ].filter(Boolean));
    const selectedLivestock = new Set([
      ...getSelectedOptions(livestockPicker),
      ...(pending.recordType === "livestock" ? [pending.recordId] : []),
    ].filter(Boolean));

    equipmentPicker.innerHTML = (state.records?.equipment || [])
      .map((record) => getCurrentRecord(record))
      .map((record) => `
        <label class="checkbox-label" data-link-group="equipment" data-link-category="${escapeHtml(record.category || "other")}" data-link-search="${escapeHtml([
          record.name,
          equipmentCategoryLabel(record.category),
          record.category,
          record.status,
        ].filter(Boolean).join(" ").toLowerCase())}">
          <input type="checkbox" name="linkedEquipment" value="${escapeHtml(record.id)}"${selectedEquipment.has(record.id) ? " checked" : ""}>
          <span class="checkbox-label-text">
            <span>${escapeHtml(record.name || record.id)}</span>
            <small>${escapeHtml([equipmentCategoryLabel(record.category), record.status === "retired" ? "Retired" : "Active"].filter(Boolean).join(" · "))}</small>
          </span>
        </label>
      `).join("");
    livestockPicker.innerHTML = (state.records?.livestock || [])
      .map(livestockItemFromRecord)
      .map((item) => `
        <label class="checkbox-label" data-link-group="${escapeHtml(journalLivestockLinkGroup(item))}" data-link-category="${escapeHtml(item.category || "Other")}" data-link-search="${escapeHtml([
          item.species,
          item.name,
          item.category,
          item.trackingUnit,
          item.status,
        ].filter(Boolean).join(" ").toLowerCase())}">
          <input type="checkbox" name="linkedLivestock" value="${escapeHtml(item.id)}"${selectedLivestock.has(item.id) ? " checked" : ""}>
          <span class="checkbox-label-text">
            <span>${escapeHtml(item.name || item.species || item.id)}</span>
            <small>${escapeHtml([item.category, livestockStatusLabel(item.status)].filter(Boolean).join(" · "))}</small>
          </span>
        </label>
      `).join("");
    applyJournalLinkFilters();
    renderJournalLivestockFields();
  }

  function journalLivestockLinkGroup(item = {}) {
    if (item.category === "Fish") return "fish";
    if (item.category === "Coral") return "corals";
    if (item.category === "Invert" || item.category === "Cleanup crew") return "inverts";
    return "other";
  }

  function normalizeJournalLinkFilter(filter) {
    return ["equipment", "fish", "corals", "inverts", "other"].includes(filter)
      ? filter
      : "equipment";
  }

  function getJournalLinkFilter() {
    state.ui ||= {};
    state.ui.journalLinkFilter = normalizeJournalLinkFilter(state.ui.journalLinkFilter);
    return state.ui.journalLinkFilter;
  }

  function setJournalLinkFilter(filter) {
    state.ui ||= {};
    state.ui.journalLinkFilter = normalizeJournalLinkFilter(filter);
    saveLocalState();
    applyJournalLinkFilters();
  }

  function renderJournalLivestockFields() {
    const type = $("journalEntryType")?.value || "Observation";
    const selectedLivestockIds = getSelectedOptions($("journalLinkedLivestock"));
    const selectedEquipmentIds = getSelectedOptions($("journalLinkedEquipment"));
    const selectedLivestock = selectedLivestockIds
      .map((id) => getLivestockRecord(id))
      .filter(Boolean)
      .map(livestockItemFromRecord);

    $$("[data-journal-progressive-field]").forEach((element) => {
      const role = element.dataset.journalProgressiveField || "";
      const visible = shouldShowJournalProgressiveField(role, type, selectedLivestock, selectedEquipmentIds);
      element.hidden = !visible;
      element.querySelectorAll?.("input, select, textarea, button").forEach((input) => {
        input.disabled = !visible;
        if (!visible) clearJournalInput(input);
      });
    });

    const relatedShell = $("journalRelatedShell");
    const equipmentLinks = document.querySelector("[data-journal-progressive-field='equipmentLinks']");
    const livestockLinks = document.querySelector("[data-journal-progressive-field='livestockLinks']");
    const visibleLinks = [equipmentLinks, livestockLinks].filter((element) => element && !element.hidden);
    if (relatedShell) relatedShell.hidden = visibleLinks.length === 0;
    const relatedCount = (equipmentLinks && !equipmentLinks.hidden ? getSelectedOptions($("journalLinkedEquipment")).length : 0)
      + (livestockLinks && !livestockLinks.hidden ? getSelectedOptions($("journalLinkedLivestock")).length : 0);
    if ($("journalRelatedHint")) {
      $("journalRelatedHint").textContent = relatedCount
        ? `${relatedCount} linked`
        : visibleLinks.length ? "Optional" : "";
    }
    applyJournalLinkFilters();
    renderJournalRecordUpdatePanel(selectedLivestockIds, selectedEquipmentIds);
  }

  function shouldShowJournalProgressiveField(role, type, selectedLivestock, selectedEquipmentIds = []) {
    const hasLinks = selectedLivestock.length > 0 || selectedEquipmentIds.length > 0;
    if (role === "livestockStatus") return false;
    if (role === "title") return false;
    if (role === "relatedLinks") return true;
    if (role === "equipmentLinks") return true;
    if (role === "livestockLinks") return true;
    if (role === "recordUpdates") return hasLinks;
    return true;
  }

  function getEquipmentRecord(id) {
    return (state.records?.equipment || []).find((record) => record.id === id) || null;
  }

  function renderJournalRecordUpdatePanel(livestockIds = [], equipmentIds = []) {
    const panel = $("journalRecordUpdatePanel");
    if (!panel) return;
    const livestockCards = livestockIds
      .map((id) => getLivestockRecord(id))
      .filter(Boolean)
      .map(livestockItemFromRecord)
      .map(renderJournalLivestockUpdateCard);
    const equipmentCards = equipmentIds
      .map((id) => getEquipmentRecord(id))
      .filter(Boolean)
      .map((record) => getCurrentRecord(record))
      .map(renderJournalEquipmentUpdateCard);
    const cards = [...equipmentCards, ...livestockCards];
    panel.hidden = cards.length === 0;
    panel.innerHTML = cards.join("");
    syncJournalRecordUpdateControls();
  }

  function renderJournalLivestockUpdateCard(item) {
    const status = normalizeLivestockLifecycleStatus(item.status, item.category);
    const inactive = status !== "alive";
    return `
      <section class="journal-record-update-card" data-journal-livestock-update="${escapeHtml(item.id)}">
        <div class="journal-record-update-heading">
          <strong>${escapeHtml(item.species || item.name || "Livestock")}</strong>
          <span class="category-pill">${escapeHtml(livestockStatusLabel(status))}</span>
        </div>
        <div class="field-grid compact-update-grid">
          <label>Species / Item
            <input data-update-field="species" type="text" value="${escapeHtml(item.species || item.name || "")}" />
          </label>
          <label>Category
            <select data-update-field="category">
              ${renderLivestockSelectOptions([
                ["Fish", "Fish"],
                ["Coral", "Coral"],
                ["Invert", "Invert"],
                ["Cleanup crew", "Cleanup crew"],
                ["Microfauna", "Microfauna"],
                ["Noticed pest", "Noticed pest"],
                ["Macroalgae", "Macroalgae"],
                ["Other", "Other"],
              ], item.category || "Other")}
            </select>
          </label>
          <label>Status
            <select data-update-field="status" data-journal-livestock-status>
              ${renderLivestockSelectOptions([
                ["alive", "Alive"],
                ["deceased", "Deceased"],
                ["removed", "Removed"],
              ], status)}
            </select>
          </label>
          <label data-journal-livestock-retired-field${inactive ? "" : " hidden"}>Date
            <input data-update-field="retiredAt" type="date" value="${escapeHtml(item.removedDate || "")}"${inactive ? "" : " disabled"} />
          </label>
          <label>Current Count
            <input data-update-field="currentCount" type="number" min="0" step="1" value="${escapeHtml(item.currentCount ?? "")}" />
          </label>
          <label>Tracking Unit
            <select data-update-field="trackingUnit">
              ${renderLivestockSelectOptions([
                ["", "Select"],
                ["Specimen", "Specimen"],
                ["Colony", "Colony"],
                ["Frag", "Frag"],
                ["Head", "Head"],
                ["Polyp", "Polyp"],
                ["Mushroom", "Mushroom"],
                ["Mouth", "Mouth"],
                ["Branch", "Branch"],
                ["Patch", "Patch"],
                ["Other", "Other"],
              ], item.trackingUnit || "")}
            </select>
          </label>
          <label>Health
            <select data-update-field="health">
              ${renderLivestockSelectOptions([
                ["", "Not tracked"],
                ["Thriving", "Thriving"],
                ["Stable", "Stable"],
                ["Struggling", "Struggling"],
                ["Declining", "Declining"],
                ["Unknown", "Unknown"],
              ], item.health || item.initialHealth || "")}
            </select>
          </label>
          <label>Growth
            <select data-update-field="growthTrend">
              ${renderLivestockSelectOptions([
                ["", "Not tracked"],
                ["Growing", "Growing"],
                ["Stable", "Stable"],
                ["Receding", "Receding"],
                ["Melting", "Melting"],
                ["Unknown", "Unknown"],
              ], item.growthTrend || "")}
            </select>
          </label>
          <label class="wide-field">Growth Notes
            <input data-update-field="growthNotes" type="text" value="${escapeHtml(item.growthNotes || "")}" />
          </label>
          <label class="wide-field" data-journal-livestock-retired-field${inactive ? "" : " hidden"}>Reason
            <input data-update-field="outcomeReason" type="text" value="${escapeHtml(item.outcomeReason || "")}"${inactive ? "" : " disabled"} />
          </label>
        </div>
      </section>
    `;
  }

  function renderJournalEquipmentUpdateCard(record) {
    const status = record.status === "retired" ? "retired" : "active";
    const retired = status === "retired";
    return `
      <section class="journal-record-update-card" data-journal-equipment-update="${escapeHtml(record.id)}">
        <div class="journal-record-update-heading">
          <strong>${escapeHtml(record.name || "Equipment")}</strong>
          <span class="category-pill${retired ? " pill-muted" : ""}">${retired ? "Retired" : "Active"}</span>
        </div>
        <div class="field-grid compact-update-grid">
          <label>Name
            <input data-update-field="name" type="text" value="${escapeHtml(record.name || "")}" />
          </label>
          <label>Type
            <select data-update-field="category">
              ${equipmentCategoryOptions(record.category || "other")}
            </select>
          </label>
          <label>Status
            <select data-update-field="status" data-journal-equipment-status>
              <option value="active"${status === "active" ? " selected" : ""}>Active</option>
              <option value="retired"${status === "retired" ? " selected" : ""}>Retired</option>
            </select>
          </label>
          <label data-journal-equipment-retired-field${retired ? "" : " hidden"}>Retired
            <input data-update-field="retiredAt" type="date" value="${escapeHtml(dateInputValue(record.retiredAt))}"${retired ? "" : " disabled"} />
          </label>
          <label>Schedule
            <input data-update-field="schedule" type="text" value="${escapeHtml(equipmentScheduleText(record))}" />
          </label>
          <label class="wide-field">Details
            <textarea data-update-field="details" rows="3">${escapeHtml(equipmentDetailsText(record))}</textarea>
          </label>
          <label class="wide-field">Notes
            <textarea data-update-field="notes" rows="2">${escapeHtml(record.notes || "")}</textarea>
          </label>
        </div>
      </section>
    `;
  }

  function syncJournalRecordUpdateControls() {
    $$("[data-journal-livestock-update]").forEach((card) => {
      const status = card.querySelector("[data-journal-livestock-status]")?.value || "alive";
      const inactive = status !== "alive";
      card.querySelectorAll("[data-journal-livestock-retired-field]").forEach((field) => {
        field.hidden = !inactive;
        field.querySelectorAll("input, select, textarea").forEach((input) => {
          input.disabled = !inactive;
          if (!inactive) input.value = "";
        });
      });
    });
    $$("[data-journal-equipment-update]").forEach((card) => {
      const status = card.querySelector("[data-journal-equipment-status]")?.value || "active";
      const retired = status === "retired";
      card.querySelectorAll("[data-journal-equipment-retired-field]").forEach((field) => {
        field.hidden = !retired;
        field.querySelectorAll("input, select, textarea").forEach((input) => {
          input.disabled = !retired;
          if (!retired) input.value = "";
        });
      });
    });
  }

  function isGrowthTrackedStock(item) {
    return /coral|macroalgae/i.test([item?.category, item?.species, item?.name].filter(Boolean).join(" "));
  }

  function clearJournalInput(input) {
    if (!input) return;
    if (input.tagName === "SELECT" && input.multiple) {
      Array.from(input.options || []).forEach((option) => {
        option.selected = false;
      });
    } else if (input.type === "checkbox" || input.type === "radio") {
      input.checked = false;
    } else {
      input.value = "";
    }
  }

  function getSelectedOptions(element) {
    if (!element) return [];
    if (element.tagName === "SELECT") {
      return Array.from(element.selectedOptions || []).map((option) => option.value).filter(Boolean);
    }
    return Array.from(element.querySelectorAll("input[type='checkbox']:checked")).map((cb) => cb.value).filter(Boolean);
  }

  function applyJournalLinkFilters() {
    const activeFilter = getJournalLinkFilter();
    const query = String($("journalLinkSearch")?.value || "").trim().toLowerCase();
    let visible = 0;
    let totalInFilter = 0;
    let selected = 0;
    const rows = $$("[data-link-group]");
    $$("[data-journal-link-filter]").forEach((button) => {
      const active = button.dataset.journalLinkFilter === activeFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    rows.forEach((row) => {
      const checked = Boolean(row.querySelector("input[type='checkbox']")?.checked);
      if (checked) selected += 1;
      const matchesGroup = row.dataset.linkGroup === activeFilter;
      if (matchesGroup) totalInFilter += 1;
      const searchText = row.dataset.linkSearch || row.textContent || "";
      const matchesSearch = !query || searchText.includes(query);
      const show = matchesGroup && matchesSearch;
      row.hidden = !show;
      if (show) visible += 1;
    });
    [
      ["journalLinkedEquipment", "equipmentLinks"],
      ["journalLinkedLivestock", "livestockLinks"],
    ].forEach(([pickerId, role]) => {
      const section = document.querySelector(`[data-journal-progressive-field="${role}"]`);
      const sectionRows = $$(".checkbox-label", $(pickerId) || document.createElement("div"));
      if (section) section.hidden = sectionRows.every((row) => row.hidden);
    });
    if ($("journalLinkFilterHint")) {
      $("journalLinkFilterHint").textContent = rows.length
        ? `${visible}/${totalInFilter}${selected ? ` · ${selected} selected` : ""}`
        : "";
    }
  }

  function journalUpdateValue(card, field) {
    return card.querySelector(`[data-update-field="${field}"]`)?.value?.trim?.() || "";
  }

  function normalizedJournalValue(value) {
    return String(value ?? "").trim();
  }

  function journalValuesMatch(currentValue, nextValue) {
    return normalizedJournalValue(currentValue) === normalizedJournalValue(nextValue);
  }

  function setChangedJournalField(fields, key, currentValue, nextValue) {
    if (journalValuesMatch(currentValue, nextValue)) return false;
    fields[key] = nextValue;
    return true;
  }

  function getJournalRecordUpdateEffects(linkedLivestock = [], linkedEquipment = [], occurredAt = new Date().toISOString()) {
    const effects = [
      ...linkedEquipment.map((recordId) => buildJournalEquipmentUpdateEffect(recordId)),
      ...linkedLivestock.map((recordId) => buildJournalLivestockUpdateEffect(recordId, occurredAt)),
    ].filter(Boolean);
    const names = effects.map((effect) => effect.label).filter(Boolean);
    const title = names.length === 1
      ? `${names[0]} changed`
      : names.length > 1 ? `${names.length} items changed` : "";
    return {
      effects: effects.map(({ label: _label, ...effect }) => effect),
      title,
    };
  }

  function buildJournalLivestockUpdateEffect(recordId, occurredAt) {
    const record = getLivestockRecord(recordId);
    const card = $$("[data-journal-livestock-update]")
      .find((element) => element.getAttribute("data-journal-livestock-update") === recordId);
    if (!record || !card) return null;
    const current = getCurrentRecord(record);
    const item = livestockItemFromRecord(record);
    const species = journalUpdateValue(card, "species") || item.species || item.name || "Livestock";
    const category = journalUpdateValue(card, "category") || item.category || "Other";
    const status = normalizeLivestockLifecycleStatus(journalUpdateValue(card, "status") || item.status, category);
    const inactive = status !== "alive";
    const retiredAt = inactive
      ? journalUpdateValue(card, "retiredAt") || occurredAt.slice(0, 10)
      : "";
    const currentCount = journalUpdateValue(card, "currentCount");
    const trackingUnit = journalUpdateValue(card, "trackingUnit");
    const health = journalUpdateValue(card, "health");
    const growthTrend = journalUpdateValue(card, "growthTrend");
    const growthNotes = journalUpdateValue(card, "growthNotes");
    const outcomeReason = inactive ? journalUpdateValue(card, "outcomeReason") : "";
    const currentDetails = {
      ...(record.details || {}),
      ...(current.details || {}),
    };
    const fields = {};
    const detailChanges = {};
    if (!journalValuesMatch(item.species || item.name, species)) {
      fields.species = species;
      fields.name = species;
    }
    if (setChangedJournalField(fields, "category", item.category, category)) {
      fields.casual = isCasualStockCategory(category);
    }
    setChangedJournalField(fields, "status", normalizeLivestockLifecycleStatus(item.status, item.category), status);
    setChangedJournalField(fields, "retiredAt", item.removedDate || current.retiredAt || "", retiredAt);
    if (setChangedJournalField(fields, "currentCount", item.currentCount, currentCount)) {
      detailChanges.currentCount = currentCount;
    }
    if (!journalValuesMatch(item.trackingUnit, trackingUnit)) {
      detailChanges.trackingUnit = trackingUnit;
    }
    setChangedJournalField(fields, "currentHealth", item.health, health);
    if (setChangedJournalField(fields, "growthTrend", item.growthTrend, growthTrend)) {
      detailChanges.growthTrend = growthTrend;
    }
    if (setChangedJournalField(fields, "growthNotes", item.growthNotes, growthNotes)) {
      detailChanges.growthNotes = growthNotes;
    }
    if (setChangedJournalField(fields, "outcomeReason", item.outcomeReason, outcomeReason)) {
      detailChanges.outcomeReason = outcomeReason;
    }
    if (Object.keys(detailChanges).length) {
      fields.details = { ...currentDetails, ...detailChanges };
    }
    if (!Object.keys(fields).length) return null;
    return {
      label: species,
      recordId,
      fields,
    };
  }

  function buildJournalEquipmentUpdateEffect(recordId) {
    const record = getEquipmentRecord(recordId);
    const current = record ? getCurrentRecord(record) : null;
    const card = $$("[data-journal-equipment-update]")
      .find((element) => element.getAttribute("data-journal-equipment-update") === recordId);
    if (!record || !current || !card) return null;
    const name = journalUpdateValue(card, "name") || current.name || "Equipment";
    const category = journalUpdateValue(card, "category") || current.category || "other";
    const status = journalUpdateValue(card, "status") === "retired" ? "retired" : "active";
    const detailsText = journalUpdateValue(card, "details");
    const schedule = journalUpdateValue(card, "schedule");
    const notes = journalUpdateValue(card, "notes");
    const currentDetails = {
      ...(record.details || {}),
      ...(current.details || {}),
    };
    const fields = {};
    const detailChanges = {};
    setChangedJournalField(fields, "name", current.name, name);
    setChangedJournalField(fields, "category", current.category, category);
    setChangedJournalField(fields, "status", current.status === "retired" ? "retired" : "active", status);
    setChangedJournalField(fields, "retiredAt", dateInputValue(current.retiredAt), status === "retired" ? journalUpdateValue(card, "retiredAt") : "");
    setChangedJournalField(fields, "notes", current.notes, notes);
    if (!journalValuesMatch(equipmentDetailsText(current), detailsText)) {
      detailChanges.details = detailsText;
    }
    if (!journalValuesMatch(equipmentScheduleText(current), schedule)) {
      detailChanges.schedule = schedule;
    }
    if (Object.keys(detailChanges).length) {
      fields.details = { ...currentDetails, ...detailChanges };
    }
    if (!Object.keys(fields).length) return null;
    return {
      label: name,
      recordId,
      fields,
    };
  }

  function applyJournalLinkEffects(entry) {
    if (!entry) return;
    syncLegacyLivestockFromRecords();
  }

  function addJournalEntryFromForm(event) {
    event.preventDefault();
    let saved = false;
    let type = "Observation";
    let legacyRaw = null;
    try {
      type = $("journalEntryType").value;
      const linkedEquipment = getSelectedOptions($("journalLinkedEquipment"));
      const linkedLivestock = getSelectedOptions($("journalLinkedLivestock"));
      const status = $("journalLivestockStatus").value;
      const occurredAt = fromDatetimeLocal($("journalOccurredAt").value);
      const effects = [];
      const measurements = {};
      const context = {};
      const manualTitle = $("journalTitle").value.trim();
      let title = manualTitle || type;
      let summary = $("journalSummary").value.trim();
      let legacyKind = "";
      let legacyId = "";
      if (status) {
        linkedLivestock.forEach((recordId) => effects.push({
          recordId,
          fields: {
            status,
            retiredAt: status === "alive" ? "" : occurredAt.slice(0, 10),
          },
        }));
      }
      const recordUpdates = getJournalRecordUpdateEffects(linkedLivestock, linkedEquipment, occurredAt);
      effects.push(...recordUpdates.effects);
      if (!manualTitle && recordUpdates.title) title = recordUpdates.title;
      if (type === "Water Test") {
        const previousWaterChange = getLatestEventBefore("water_change", occurredAt);
        const previousFeeding = getLatestEventBefore("feeding", occurredAt);
        Object.assign(measurements, {
          ammonia: readNumber("testAmmonia"),
          nitrite: readNumber("testNitrite"),
          nitrate: readNumber("testNitrate"),
          phosphate: readNumber("testPhosphate"),
          ph: readNumber("testPh"),
          alkalinity: readNumber("testAlk"),
          calcium: readNumber("testCalcium"),
          magnesium: readNumber("testMagnesium"),
          salinity: $("testSalinity").value.trim(),
          temperature: $("testTemp").value.trim(),
        });
        Object.assign(context, {
          lightPhase: getLightPhase(occurredAt).label,
          afterWaterChange: describeTimeAfter(previousWaterChange, occurredAt),
          afterFeeding: describeTimeAfter(previousFeeding, occurredAt),
        });
        legacyId = uid();
        legacyKind = "water_test";
        legacyRaw = {
          id: legacyId,
          measuredAt: occurredAt,
          ...measurements,
          notes: summary,
          timing: context,
        };
        title = manualTitle || "Water test";
      } else if (type === "Feeding") {
        legacyId = uid();
        legacyKind = "feeding";
        legacyRaw = {
          id: legacyId,
          type: "feeding",
          happenedAt: occurredAt,
          label: $("feedingFood").value,
          amount: $("feedingAmount").value.trim(),
          target: $("feedingTarget").value.trim(),
          notes: summary,
        };
        title = manualTitle || `Fed ${legacyRaw.label || "tank"}`;
        summary = [legacyRaw.amount, legacyRaw.target, summary].filter(Boolean).join(" · ");
      } else if (type === "Water Change") {
        const gallons = $("waterChangeGallons").value;
        const percent = $("waterChangePercent").value;
        legacyId = uid();
        legacyKind = "water_change";
        legacyRaw = {
          id: legacyId,
          type: "water_change",
          happenedAt: occurredAt,
          label: "Water change",
          gallons,
          percent,
          notes: summary,
        };
        title = manualTitle || "Water change";
        summary = [gallons ? `${gallons} gallons` : "", percent ? `${percent}%` : "", summary].filter(Boolean).join(" · ");
      } else if (type === "Maintenance") {
        const maintenanceType = $("maintenanceType").value;
        legacyId = uid();
        legacyKind = "maintenance";
        legacyRaw = {
          id: legacyId,
          type: "maintenance",
          happenedAt: occurredAt,
          label: maintenanceType,
          details: "",
          notes: summary,
        };
        title = manualTitle || maintenanceType || "Maintenance";
      }
      const entry = addJournalEntry({
        type,
        occurredAt,
        title,
        summary,
        linkedEquipment,
        linkedLivestock,
        measurements,
        context,
        effects,
        legacyKind,
        legacyId,
        legacyRaw,
      });
      applyJournalLinkEffects(entry);
      state.ui.pendingJournalLink = null;
      state.ui.activeView = "logbook";
      $("journalEntryForm").reset();
      seedLogDates();
      saveState();
      saved = true;
      renderAll();
      setActiveView("logbook");
      const shell = $("journalEntryShell");
      if (shell) shell.open = false;
      if (type === "Water Test" && legacyRaw) {
        const alerts = getWaterTestAlerts(legacyRaw);
        if (alerts.length) {
          showToast(`Saved. Warning: ${alerts[0]}${alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ""}`);
          return;
        }
      }
      showToast("Journal entry saved.");
    } catch (error) {
      console.error(error);
      if (saved) {
        state.ui.activeView = "logbook";
        saveLocalState();
        setActiveView("logbook");
        showToast("Journal entry saved, but the screen refresh hit a snag.");
        return;
      }
      showToast("Journal entry could not be saved. Try again.");
    }
  }

  function renderTimeline() {
    const entries = getTimelineEntries();
    $("logTimeline").innerHTML = entries.length
      ? entries.map(renderTimelineEntry).join("")
      : `<div class="empty-state">No timeline entries.</div>`;
  }

  function renderTimelineEntry(entry) {
    const actions = `<button class="mini-button danger" type="button" data-delete-entry="${entry.kind}:${entry.id}">Delete</button>`;
    return `
      <article class="timeline-item" data-kind="${entry.kind}">
        <div class="timeline-head">
          <div>
            <strong>${escapeHtml(entry.title)}</strong>
            <p class="timeline-meta">${escapeHtml(entry.meta)}</p>
          </div>
          <div class="card-actions">
            ${actions}
          </div>
        </div>
        <p class="timeline-details">${escapeHtml(entry.details)}</p>
      </article>
    `;
  }

  function renderParameterTrends() {
    const container = $("paramTrendsContent");
    if (!container) return;

    const PARAMS = [
      { key: "ammonia", label: "Ammonia", unit: "ppm", decimals: 2 },
      { key: "nitrite", label: "Nitrite", unit: "ppm", decimals: 2 },
      { key: "nitrate", label: "Nitrate", unit: "ppm", decimals: 1 },
      { key: "phosphate", label: "Phosphate", unit: "ppm", decimals: 2 },
      { key: "ph", label: "pH", unit: "", decimals: 2 },
      { key: "alkalinity", label: "Alkalinity", unit: "dKH", decimals: 1 },
      { key: "calcium", label: "Calcium", unit: "ppm", decimals: 0 },
      { key: "magnesium", label: "Magnesium", unit: "ppm", decimals: 0 },
    ];

    const tests = getWaterTestsFromJournal()
      .filter((t) => t.measuredAt)
      .sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt))
      .slice(-90);

    const charts = PARAMS.map(({ key, label, unit, decimals }) => {
      const points = tests
        .filter((t) => t[key] !== null && t[key] !== undefined)
        .map((t) => ({ at: t.measuredAt, value: t[key] }));
      if (points.length < 2) return "";
      return renderMiniChart(label, unit, decimals, points);
    }).filter(Boolean);

    container.innerHTML = charts.length
      ? `<div class="param-trends-grid">${charts.join("")}</div>`
      : `<div class="empty-state">No parameter data yet. Log water tests to see trends.</div>`;
    refreshIcons();
  }

  function renderMiniChart(label, unit, decimals, points) {
    const W = 220, H = 80, PAD = { top: 6, right: 8, bottom: 22, left: 36 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const xScale = (i) => PAD.left + (i / (points.length - 1)) * plotW;
    const yScale = (v) => PAD.top + plotH - ((v - min) / range) * plotH;

    const polyline = points.map((p, i) => `${xScale(i).toFixed(1)},${yScale(p.value).toFixed(1)}`).join(" ");
    const latest = points[points.length - 1].value;
    const latestLabel = unit ? `${latest.toFixed(decimals)} ${unit}` : latest.toFixed(decimals);

    const xDates = [points[0], points[points.length - 1]].map((p, i) => {
      const x = i === 0 ? PAD.left : PAD.left + plotW;
      const d = new Date(p.at);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
      return `<text x="${x}" y="${H - 4}" text-anchor="${i === 0 ? "start" : "end"}" class="chart-axis-label">${escapeHtml(dateStr)}</text>`;
    }).join("");

    const yLabels = [min, max].map((v, i) => {
      const y = i === 0 ? PAD.top + plotH : PAD.top;
      return `<text x="${PAD.left - 4}" y="${y + (i === 0 ? 0 : 4)}" text-anchor="end" class="chart-axis-label">${v.toFixed(decimals)}</text>`;
    }).join("");

    return `
      <div class="param-chart">
        <div class="param-chart-header">
          <span class="param-chart-label">${escapeHtml(label)}</span>
          <span class="param-chart-latest">${escapeHtml(latestLabel)}</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" class="param-chart-svg" aria-label="${escapeHtml(label)} trend chart">
          <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" class="chart-axis" />
          <line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" class="chart-axis" />
          <polyline points="${polyline}" class="chart-line" fill="none" />
          <circle cx="${xScale(points.length - 1).toFixed(1)}" cy="${yScale(latest).toFixed(1)}" r="3" class="chart-dot" />
          ${yLabels}
          ${xDates}
        </svg>
      </div>
    `;
  }

  function seedLogDates() {
    ["journalOccurredAt"].forEach((id) => {
      if ($(id) && !$(id).value) $(id).value = toDatetimeLocal();
    });
  }

  function updateTestTimingPill() {
    const pill = $("testTimingPill");
    if (!pill) return;
    const measuredAt = $("journalOccurredAt")?.value ? fromDatetimeLocal($("journalOccurredAt").value) : new Date().toISOString();
    const phase = getLightPhase(measuredAt).label;
    pill.textContent = phase;
  }


  function renderBackendSettings() {
    if (!$("backendUrl") || !$("backendAnonKey")) {
      updateBackendStatus();
      return;
    }
    $("backendUrl").value = backendConfig.supabaseUrl || "";
    $("backendAnonKey").value = backendConfig.supabaseAnonKey || "";
    updateBackendStatus();
  }

  function setPrivateAccessStatus(message) {
    const status = $("privateAuthStatus");
    if (status) status.textContent = message;
  }

  function updatePrivateAccessGate(message) {
    const backendAvailable = Boolean(supabaseClient);
    const loadingPrivateState = backendAvailable && currentUser && !privateStateReady;
    const locked = backendAvailable && !localOnlyMode && (!currentUser || loadingPrivateState);
    document.body.classList.toggle("private-locked", locked);
    $("appShell")?.setAttribute("aria-hidden", String(locked));
    const email = $("privateAuthEmail");
    const password = $("privateAuthPassword");
    const submit = $("privateAuthSubmit");
    const magicButton = $("privateMagicLinkButton");
    if (email) {
      email.disabled = !locked || loadingPrivateState || !backendAvailable;
      if (!email.value && currentUser?.email) email.value = currentUser.email;
    }
    if (password) {
      password.disabled = !locked || loadingPrivateState || !backendAvailable;
    }
    if (submit) {
      submit.disabled = !locked || loadingPrivateState || !backendAvailable;
      submit.textContent = loadingPrivateState
        ? "Loading..."
        : backendAvailable ? "Sign In" : "Sync Unavailable";
    }
    if (magicButton) {
      magicButton.disabled = !locked || loadingPrivateState || !backendAvailable;
      magicButton.textContent = "Send Magic Link";
    }
    if (message) {
      setPrivateAccessStatus(message);
    } else if (!backendAvailable || localOnlyMode) {
      setPrivateAccessStatus("Local mode. Data stays on this device.");
    } else if (loadingPrivateState) {
      setPrivateAccessStatus("Loading private reef data...");
    } else if (currentUser) {
      setPrivateAccessStatus(`Signed in as ${currentUser.email || currentUser.id}.`);
    } else {
      setPrivateAccessStatus("Sign in with your password, or send a magic link.");
    }
  }

  function updateBackendStatus(message) {
    const status = $("backendStatus");
    if (!status) return;
    if (message) {
      status.textContent = message;
      return;
    }
    if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) {
      status.textContent = "Local mode";
    } else if (currentUser) {
      status.textContent = `Private sync on · signed in as ${currentUser.email || currentUser.id}`;
    } else {
      status.textContent = "Sign in for private sync.";
    }
  }

  async function initBackend() {
    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }
    supabaseClient = null;
    currentUser = null;
    privateStateReady = false;
    localOnlyMode = false;

    if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey || !window.supabase) {
      localOnlyMode = true;
      privateStateReady = true;
      updateBackendStatus();
      updatePrivateAccessGate("Local mode. Data stays on this device.");
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
      const previousUserId = currentUser?.id || "";
      currentUser = session?.user || null;
      clearSignedPhotoUrls();
      if (!currentUser) {
        privateStateReady = false;
      } else if (currentUser.id !== previousUserId) {
        privateStateReady = false;
      }
      updateBackendStatus();
      updatePrivateAccessGate(currentUser && !privateStateReady ? "Loading private reef data..." : undefined);
      window.RC.Insights?.renderInsightOutput?.();
      if (currentUser && currentUser.id !== previousUserId) {
        loadPrivateStateForSession();
      }
    });
    authSubscription = subscription.data?.subscription || null;
    updateBackendStatus();
    updatePrivateAccessGate(currentUser ? "Loading private reef data..." : undefined);
    window.RC.Insights?.renderInsightOutput?.();
    if (currentUser) {
      await loadPrivateStateForSession();
    } else {
      privateStateReady = false;
      updatePrivateAccessGate();
    }
  }

  async function migrateInlinePhotosToStorage() {
    if (!supabaseClient || !currentUser) return;
    let changed = false;

    try {
      for (const record of state.records?.livestock || []) {
        const item = livestockItemFromRecord(record);
        const photos = getLivestockPhotos(item);
        if (!photos.some((photo) => photo.dataUrl)) continue;
        const uploadedPhotos = await preparePhotosForSave(item.id, photos);
        record.photos = uploadedPhotos;
        record.legacyRaw ||= {};
        record.legacyRaw.photos = uploadedPhotos;
        record.legacyRaw.photoDataUrl = "";
        record.updatedAt = new Date().toISOString();
        changed = true;
      }

      if (!changed) return;
      saveState();
      renderAll();
      showToast("Photos moved to Supabase Storage.");
    } catch (error) {
      console.error(error);
      showToast("Some photos still need storage upload.");
    }
  }

  function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  }

  async function loadPrivateStateForSession() {
    if (!supabaseClient || !currentUser) {
      privateStateReady = false;
      updatePrivateAccessGate();
      return;
    }

    privateStateReady = false;
    updatePrivateAccessGate("Loading private reef data...");

    try {
      await withTimeout(
        pullState({ silent: true, startup: true }),
        PRIVATE_STARTUP_TIMEOUT_MS,
        "Private sync",
      );
    } catch (error) {
      console.error("Private sync startup failed:", error);
      updateBackendStatus("Private sync load failed; showing cached data.");
      showToast("Private sync is slow. Showing cached data.");
    } finally {
      privateStateReady = true;
      updatePrivateAccessGate();
      renderAll();
    }

    migrateInlinePhotosToStorage().catch((error) => {
      console.error("Photo migration failed:", error);
      showToast("Some photos still need storage upload.");
    });
  }

  async function saveBackendSettings() {
    backendConfig = {
      supabaseUrl: $("backendUrl")?.value.trim() || "",
      supabaseAnonKey: $("backendAnonKey")?.value.trim() || "",
      authRedirectUrl: backendConfig.authRedirectUrl || "",
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
    if (!currentUser) {
      showToast("Sign in for private sync.");
      return false;
    }
    return true;
  }

  function cleanAuthRedirectUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value, window.location.href);
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      parsed.hash = "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function getMagicLinkRedirectUrl() {
    const configured = cleanAuthRedirectUrl(backendConfig.authRedirectUrl);
    if (configured) return configured;

    try {
      const current = new URL(window.location.href);
      if (!["http:", "https:"].includes(current.protocol)) return "";
      current.hash = "";
      [
        "access_token",
        "code",
        "error",
        "error_code",
        "error_description",
        "expires_at",
        "expires_in",
        "refresh_token",
        "token_type",
        "type",
      ].forEach((key) => current.searchParams.delete(key));
      return current.href;
    } catch {
      return "";
    }
  }

  function isRedirectAuthError(error) {
    const message = [error?.message, error?.msg, error?.code, error?.error_code]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return message.includes("redirect") || message.includes("not allowed");
  }

  function describeMagicLinkError(error) {
    const code = String(error?.code || error?.error_code || "").toLowerCase();
    const message = String(error?.message || error?.msg || "").trim();
    if (isRedirectAuthError(error)) {
      return "Supabase rejected this return URL. Add it in Auth redirect URLs or set authRedirectUrl in config.json.";
    }
    if (code === "email_address_not_authorized") {
      return "Supabase can only email organization members until custom SMTP is configured.";
    }
    if (code.includes("email") && code.includes("invalid")) {
      return "Supabase rejected that email address.";
    }
    if (code === "over_email_send_rate_limit") {
      return "Too many sign-in links were sent to this email. Wait a while and try again.";
    }
    if (code === "over_request_rate_limit") {
      return "Too many sign-in attempts from this device. Wait a few minutes and try again.";
    }
    if (code.includes("rate") || /rate|too many/i.test(message)) {
      return "Too many sign-in emails were requested. Wait a minute and try again.";
    }
    if (code === "otp_disabled") {
      return "Supabase email OTP / magic-link sign-in is disabled for this project.";
    }
    if (code === "email_provider_disabled") {
      return "Supabase email sign-in is disabled for this project.";
    }
    if (code === "signup_disabled" || code.includes("signup") || /signups? disabled/i.test(message)) {
      return "This email is not registered for Reef Command.";
    }
    if (code === "request_timeout") {
      return "Supabase took too long to send the link. Try again in a moment.";
    }
    if (code === "unexpected_failure" && /sign-?in link/i.test(message)) {
      return "Supabase could not send the link. Check Auth logs; default SMTP only emails Supabase organization members.";
    }
    if (/cannot send a sign-?in link/i.test(message)) {
      return "Supabase could not send the link. Check Auth logs; default SMTP only emails Supabase organization members.";
    }
    return message ? `Could not send sign-in link: ${message}` : "Could not send sign-in link.";
  }

  async function requestMagicLink(email, redirectUrl) {
    const options = {};
    if (redirectUrl) options.emailRedirectTo = redirectUrl;
    return supabaseClient.auth.signInWithOtp({ email, options });
  }

  function setPrivateAuthBusy(label = "") {
    const busy = Boolean(label);
    const email = $("privateAuthEmail");
    const password = $("privateAuthPassword");
    const submit = $("privateAuthSubmit");
    const magicButton = $("privateMagicLinkButton");
    if (email) email.disabled = busy;
    if (password) password.disabled = busy;
    if (submit) {
      submit.disabled = busy;
      submit.textContent = busy ? label : "Sign In";
    }
    if (magicButton) {
      magicButton.disabled = busy;
      magicButton.textContent = label === "Sending..." ? "Sending..." : "Send Magic Link";
    }
  }

  function describePasswordSignInError(error) {
    const code = String(error?.code || error?.error_code || "").toLowerCase();
    const message = String(error?.message || error?.msg || "").trim();
    if (code === "invalid_credentials") {
      return "Could not sign in with that email and password.";
    }
    if (code === "email_not_confirmed") {
      return "That email still needs confirmation before password sign-in.";
    }
    if (code === "over_request_rate_limit") {
      return "Too many sign-in attempts from this device. Wait a few minutes and try again.";
    }
    return message ? `Could not sign in: ${message}` : "Could not sign in.";
  }

  async function signInWithPassword() {
    if (!supabaseClient) {
      setPrivateAccessStatus("Private sync is not configured.");
      showToast("Private sync is not configured.");
      return;
    }
    const email = ($("authEmail")?.value || $("privateAuthEmail")?.value || "").trim();
    const password = ($("privateAuthPassword")?.value || "").trim();
    if (!email) {
      setPrivateAccessStatus("Enter your email.");
      showToast("Enter an email.");
      return;
    }
    if (!password) {
      setPrivateAccessStatus("Enter your password, or use magic link.");
      showToast("Enter your password.");
      return;
    }

    setPrivateAuthBusy("Signing in...");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    setPrivateAuthBusy("");

    if (error) {
      console.error(error);
      setPrivateAccessStatus(describePasswordSignInError(error));
      showToast("Could not sign in.");
      return;
    }

    if ($("privateAuthPassword")) $("privateAuthPassword").value = "";
    currentUser = data?.user || data?.session?.user || currentUser;
    privateStateReady = false;
    updateBackendStatus();
    updatePrivateAccessGate("Loading private reef data...");
    showToast("Signed in.");
    await loadPrivateStateForSession();
  }

  async function sendMagicLink() {
    if (!supabaseClient) {
      setPrivateAccessStatus("Private sync is not configured.");
      showToast("Private sync is not configured.");
      return;
    }
    const email = ($("authEmail")?.value || $("privateAuthEmail")?.value || "").trim();
    if (!email) {
      setPrivateAccessStatus("Enter your email.");
      showToast("Enter an email.");
      return;
    }
    setPrivateAuthBusy("Sending...");
    let redirectUrl = getMagicLinkRedirectUrl();
    let fallbackToProjectUrl = false;
    let { error } = await requestMagicLink(email, redirectUrl);
    if (error && redirectUrl && isRedirectAuthError(error)) {
      console.warn("Magic-link redirect URL rejected; retrying with Supabase Site URL.", error);
      setPrivateAccessStatus("Return URL rejected. Trying the Supabase project URL...");
      fallbackToProjectUrl = true;
      redirectUrl = "";
      ({ error } = await requestMagicLink(email, redirectUrl));
    }
    setPrivateAuthBusy("");
    if (error) {
      console.error(error);
      setPrivateAccessStatus(describeMagicLinkError(error));
      showToast("Could not send link.");
      return;
    }
    setPrivateAccessStatus(
      fallbackToProjectUrl
        ? "Magic link sent. It will open the Supabase project URL."
        : "Magic link sent. Open it to unlock Reef Command.",
    );
    showToast("Magic link sent.");
  }

  function handlePrivateAuthSubmit(event) {
    event.preventDefault();
    if (($("privateAuthPassword")?.value || "").trim()) {
      signInWithPassword();
    } else {
      sendMagicLink();
    }
  }

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    currentUser = null;
    privateStateReady = false;
    localOnlyMode = false;
    clearSignedPhotoUrls();
    updateBackendStatus();
    updatePrivateAccessGate("Signed out.");
    showToast("Signed out.");
  }

  async function pushState(options = {}) {
    if (!ensureBackend()) return;
    if (!hasMeaningfulState(state) && !options.allowEmpty) {
      if (!options.silent) showToast("Nothing to sync yet.");
      return;
    }
    if (!options.force && !options.allowEmpty) {
      const { data: remoteRow, error: remoteReadError } = await supabaseClient
        .from(PRIVATE_STATE_TABLE)
        .select("data, updated_at")
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (!remoteReadError && hasUnsupportedSchema(remoteRow?.data)) {
        updateBackendStatus("Remote data uses a newer schema. Update Reef Command before syncing.");
        if (!options.silent) showToast("Update Reef Command before syncing.");
        return;
      }
      if (
        !remoteReadError &&
        remoteRow?.data &&
        lastRemoteUpdatedAt &&
        remoteRow.updated_at &&
        remoteChangedSinceKnown(remoteRow.updated_at) &&
        !localStateNewerThanRemote(state, remoteRow.data, remoteRow.updated_at)
      ) {
        writeJson(PRE_PULL_BACKUP_KEY, {
          backedUpAt: new Date().toISOString(),
          reason: "remote-changed-before-push",
          state,
        });
        isRemoteHydrating = true;
        Object.assign(state, normalizeState(remoteRow.data));
        saveLocalState();
        isRemoteHydrating = false;
        lastRemoteUpdatedAt = remoteRow.updated_at;
        renderAll();
        updateBackendStatus("Remote changed on another device; local cache was backed up and refreshed.");
        if (!options.silent) showToast("Remote changed. Refreshed from private sync.");
        return;
      }
      if (
        !remoteReadError &&
        remoteRow?.data &&
        shouldProtectRemoteState(remoteRow.data, state) &&
        !localStateNewerThanRemote(state, remoteRow.data, remoteRow.updated_at)
      ) {
        isRemoteHydrating = true;
        Object.assign(state, normalizeState(remoteRow.data));
        saveLocalState();
        isRemoteHydrating = false;
        lastRemoteUpdatedAt = remoteRow.updated_at || lastRemoteUpdatedAt;
        renderAll();
        updateBackendStatus("Remote data protected; local stale state was refreshed.");
        if (!options.silent) showToast("Refreshed from remote data.");
        return;
      }
    }
    if (remoteSaveInFlight) {
      remoteSaveQueued = true;
      return;
    }
    remoteSaveInFlight = true;
    const remoteUpdatedAt = new Date().toISOString();
    const { error } = await supabaseClient
      .from(PRIVATE_STATE_TABLE)
      .upsert(
        {
          user_id: currentUser.id,
          data: state,
          updated_at: remoteUpdatedAt,
        },
        { onConflict: "user_id" },
      );
    remoteSaveInFlight = false;
    if (error) {
      console.error(error);
      updateBackendStatus("Sync write failed.");
      if (!options.silent) showToast("Sync failed.");
      return;
    }
    lastRemoteUpdatedAt = remoteUpdatedAt;
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
      .from(PRIVATE_STATE_TABLE)
      .select("data, updated_at")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) {
      console.error(error);
      updateBackendStatus("Sync read failed.");
      if (!options.silent) showToast("Pull failed.");
      return;
    }
    const localHasData = hasMeaningfulState(state);
    if (!data?.data) {
      if (options.startup && localHasData) {
        await pushState({ silent: true });
      } else if (!options.silent) {
        showToast("No remote state yet.");
      }
      return;
    }
    if (hasUnsupportedSchema(data.data)) {
      updateBackendStatus("Remote data uses a newer schema. Update Reef Command before loading.");
      if (!options.silent) showToast("Update Reef Command before loading remote data.");
      return;
    }

    const remoteState = normalizeState(data.data);
    const remoteHasData = hasMeaningfulState(remoteState);
    if (options.startup) {
      if (localHasData && !remoteHasData) {
        await pushState({ silent: true });
        return;
      }
      if (!localHasData && !remoteHasData) {
        return;
      }
      // Existing private remote data wins on startup. This prevents stale local
      // caches, especially pre-private shared photo paths, from overwriting it.
    }

    isRemoteHydrating = true;
    if (localHasData) {
      writeJson(PRE_PULL_BACKUP_KEY, {
        backedUpAt: new Date().toISOString(),
        reason: "before-remote-pull",
        state,
      });
    }
    Object.assign(state, normalizeState(data.data));
    writeJson(STORAGE_KEY, state);
    isRemoteHydrating = false;
    lastRemoteUpdatedAt = data.updated_at || lastRemoteUpdatedAt;
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
    window.RC.Map.renderMapSummaries();
    window.RC.Map.renderReefMap2({ rebuild: true });
    window.RC.Insights?.renderInsightsContext?.();
    showToast("Zone added.");
  }

  function syncLivestockDateControls() {
    const category = $("livestockCategory").value;
    const casual = isCasualStockCategory(category);
    const dateField = $("livestockDateField");
    const dateLabel = $("livestockDateLabel");
    const dateInput = $("livestockAdded");
    const legacy = $("livestockLegacy");
    const legacyRow = $("livestockLegacyRow");

    dateLabel.textContent = casual ? "First Noticed" : "Date Added";
    legacyRow.hidden = casual;
    legacy.disabled = casual;
    if (casual) legacy.checked = false;

    const hideDate = !casual && legacy.checked;
    dateField.hidden = hideDate;
    dateInput.disabled = hideDate;
    if (hideDate) dateInput.value = "";
  }

  function getLivestockFormData() {
    const species = $("livestockSpecies").value.trim();
    const category = $("livestockCategory").value;
    const addedDate = $("livestockAdded").disabled ? "" : $("livestockAdded").value;
    const isLegacy = $("livestockLegacy").checked || (!addedDate && !isCasualStockCategory(category));
    const casual = isCasualStockCategory(category);

    return {
      species,
      name: species,
      category,
      quantity: $("livestockQuantity").value,
      currentCount: $("livestockCurrentCount").value,
      trackingUnit: $("livestockTrackingUnit").value,
      addedDate,
      isLegacy: casual ? false : isLegacy,
      status: "alive",
      casual,
      zoneId: $("livestockZone")?.value || "",
      noteText: $("livestockNotes").value.trim(),
      health: $("livestockHealth").value,
      growthTrend: $("livestockGrowthTrend").value,
      growthNotes: $("livestockGrowthNotes").value.trim(),
      photos: pendingLivestockPhotos,
      photoDataUrl: "",
    };
  }

  function getInlineLivestockFormData(form) {
    const field = (name) => form.elements[name]?.value ?? "";
    const species = field("species").trim();
    const category = field("category");
    const addedDate = form.elements.addedDate?.disabled ? "" : field("addedDate");
    const casual = isCasualStockCategory(category);
    const isLegacy = Boolean(form.elements.isLegacy?.checked) || (!addedDate && !casual);

    return {
      species,
      name: species,
      category,
      quantity: field("quantity"),
      currentCount: field("currentCount"),
      trackingUnit: field("trackingUnit"),
      addedDate,
      isLegacy: casual ? false : isLegacy,
      status: "alive",
      casual,
      zoneId: field("zoneId"),
      noteText: field("noteText").trim(),
      health: field("health"),
      photos: pendingLivestockPhotos,
      photoDataUrl: "",
    };
  }

  function syncInlineLivestockDateControls(form) {
    if (!form) return;
    const category = form.elements.category?.value || "";
    const casual = isCasualStockCategory(category);
    const dateField = form.querySelector("[data-inline-livestock-date-field]");
    const dateLabel = form.querySelector("[data-inline-livestock-date-label]");
    const dateInput = form.elements.addedDate;
    const legacy = form.elements.isLegacy;
    const legacyRow = form.querySelector("[data-inline-livestock-legacy-row]");

    if (dateLabel) dateLabel.textContent = casual ? "First Noticed" : "Date Added";
    if (legacyRow) legacyRow.hidden = casual;
    if (legacy) {
      legacy.disabled = casual;
      if (casual) legacy.checked = false;
    }

    const hideDate = !casual && Boolean(legacy?.checked);
    if (dateField) dateField.hidden = hideDate;
    if (dateInput) {
      dateInput.disabled = hideDate;
      if (hideDate) dateInput.value = "";
    }
  }

  function resetLivestockForm() {
    $("livestockForm").reset();
    $("livestockEditId").value = "";
    editingLivestockId = "";
    pendingLivestockPhotos = [];
    renderPhotoPreview("livestockPhotoPreview", "", "Stock photo");
    syncLivestockDateControls();
    $("livestockFormTitle").textContent = "Add Stock";
    $("livestockSubmitButton").innerHTML = `<i data-lucide="plus"></i>Add`;
    $("cancelLivestockEditButton").hidden = true;
    if ($("livestockFormShell")) {
      $("livestockFormShell").hidden = false;
      $("livestockFormShell").open = false;
    }
    refreshIcons();
  }

  function startLivestockEdit(id) {
    const record = getLivestockRecord(id);
    const item = record ? livestockItemFromRecord(record) : null;
    if (!item) return;
    editingLivestockId = item.id;
    $("livestockEditId").value = "";
    pendingLivestockPhotos = getLivestockPhotos(item);
    if ($("livestockFormShell")) $("livestockFormShell").open = false;
    renderLivestock();
    requestAnimationFrame(() => {
      [...document.querySelectorAll("[data-livestock-card]")]
        .find((card) => card.dataset.livestockCard === item.id)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function addLivestock(event) {
    event.preventDefault();
    if (editingLivestockId) {
      showToast("Save or cancel the open livestock edit first.");
      return;
    }
    const formData = getLivestockFormData();
    if (!formData.species) return;
    const submitButton = $("livestockSubmitButton");
    const editId = $("livestockEditId").value;
    const existing = editId ? getLivestockRecord(editId) : null;
    await saveLivestockRecord(formData, existing, submitButton);
  }

  async function saveInlineLivestockEdit(form) {
    const existing = getLivestockRecord(form.dataset.id);
    if (!existing) {
      resetLivestockForm();
      renderLivestock();
      return;
    }
    const formData = getInlineLivestockFormData(form);
    if (!formData.species) return;
    await saveLivestockRecord(formData, existing, form.querySelector('button[type="submit"]'));
  }

  async function saveLivestockRecord(formData, existing, submitButton) {
    const idleHtml = submitButton?.innerHTML || "";
    let saved = false;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.innerHTML = `<i data-lucide="loader-circle"></i>Saving`;
    }
    refreshIcons();

    const existingItem = existing ? livestockItemFromRecord(existing) : null;
    const id = existing?.id || uid();
    const updatedExisting = Boolean(existing);
    const previousPaths = existingItem ? getPhotoStoragePaths(getLivestockPhotos(existingItem)) : [];

    try {
      const photos = await preparePhotosForSave(id, formData.photos);
      const nextPaths = getPhotoStoragePaths(photos);
      const { noteText: _noteText, ...stockData } = formData;
      const payload = {
        ...stockData,
        zoneId: stockData.zoneId || existingItem?.zoneId || "",
        notes: "",
        photos,
        photoDataUrl: photos.find((photo) => photo.dataUrl)?.dataUrl || "",
      };
      if (existing && !Object.prototype.hasOwnProperty.call(stockData, "growthTrend")) {
        payload.growthTrend = existing.details?.growthTrend || existing.legacyRaw?.growthTrend || "";
        payload.growthNotes = existing.details?.growthNotes || existing.legacyRaw?.growthNotes || existing.legacyRaw?.growthMetric || "";
      }

      const nextItem = {
        ...(existingItem || {}),
        id,
        ...payload,
        status: updatedExisting
          ? normalizeLivestockLifecycleStatus(existingItem.status, payload.category)
          : "alive",
        casual: Boolean(payload.casual || isCasualStockCategory(payload.category)),
        removedDate: existingItem?.removedDate || "",
        outcomeReason: existingItem?.outcomeReason || "",
      };

      if (existing) {
        syncLivestockRecordFromItem(nextItem);
      } else {
        syncLivestockRecordFromItem(nextItem, { createJournal: true });
      }

      if (formData.noteText) {
        addJournalEntry({
          type: "Observation",
          title: `${nextItem.species || nextItem.name || "Livestock"} note`,
          summary: formData.noteText,
          linkedLivestock: [id],
        });
      }

      await removeStoragePaths(previousPaths.filter((path) => !nextPaths.includes(path)));

      resetLivestockForm();
      syncLegacyLivestockFromRecords();
      state.ui.activeView = "livestock";
      saveState();
      saved = true;
      renderLivestock();
      renderPhotoLibrary();
      window.RC.Map?.renderMapMarkerControls?.();
      window.RC.Map?.renderMapSummaries?.();
      window.RC.Map?.renderReefMap2?.({ rebuild: true });
      renderDashboard();
      window.RC.Insights?.renderInsightsContext?.();
      setActiveView("livestock");
      showToast(updatedExisting ? "Stock updated." : "Stock added.");
    } catch (error) {
      console.error(error);
      if (saved) {
        state.ui.activeView = "livestock";
        saveLocalState();
        setActiveView("livestock");
        showToast("Stock saved, but the screen refresh hit a snag.");
      } else {
        showToast("Stock could not be saved. Try again.");
      }
    } finally {
      if (submitButton && document.body.contains(submitButton)) {
        submitButton.disabled = false;
        if (idleHtml) submitButton.innerHTML = idleHtml;
      }
      refreshIcons();
    }
  }

  function syncLivestockRecordFromItem(item, options = {}) {
    if (!item) return;
    state.records ||= { equipment: [], livestock: [] };
    state.records.livestock ||= [];
    const record = RECORDS.buildLivestockRecord
      ? RECORDS.buildLivestockRecord(item)
      : {
          ...item,
          recordType: "livestock",
          addedAt: item.addedDate || "",
          retiredAt: item.removedDate || "",
          details: {
            initialHealth: item.health || "",
            currentCount: item.currentCount || "",
            trackingUnit: item.trackingUnit || "",
          },
          legacyRaw: item,
        };
    const existing = state.records.livestock.find((entry) => entry.id === item.id);
    if (existing) {
      Object.assign(existing, {
        ...record,
        legacyRaw: existing.legacyRaw || record.legacyRaw,
        createdAt: existing.createdAt || record.createdAt,
        updatedAt: new Date().toISOString(),
      });
    } else {
      state.records.livestock.push(record);
    }
    if (options.createJournal) {
      addJournalEntry({
        id: `journal_setup_${item.id}`,
        type: "Livestock Change",
        occurredAt: item.addedDate ? new Date(`${item.addedDate}T00:00:00`).toISOString() : new Date().toISOString(),
        title: `${item.species || item.name || "Livestock"} setup captured`,
        summary: item.health ? `Initial health: ${item.health}` : "",
        linkedLivestock: [item.id],
        effects: [
          {
            recordId: item.id,
            fields: {
              status: item.status,
              addedAt: item.addedDate || "",
              currentHealth: item.health || "",
            },
          },
        ],
      });
    }
  }

  function removeLivestockRecord(id) {
    if (!state.records?.livestock) return;
    state.records.livestock = state.records.livestock.filter((record) => record.id !== id);
    state.journal = (state.journal || []).filter((entry) => !(entry.linkedLivestock || []).includes(id));
  }

  function startJournalForRecord(recordKey = "") {
    const [recordType, recordId] = String(recordKey).split(":");
    state.ui ||= {};
    state.ui.pendingJournalLink = { recordType, recordId };
    if (recordType === "equipment") {
      state.ui.journalLinkFilter = "equipment";
    } else if (recordType === "livestock") {
      const record = getLivestockRecord(recordId);
      state.ui.journalLinkFilter = journalLivestockLinkGroup(record ? livestockItemFromRecord(record) : {});
    }
    if ($("journalEntryType")) {
      $("journalEntryType").value = recordType === "equipment" ? "Equipment Change" : "Livestock Change";
    }
    saveLocalState();
    setActiveView("logbook");
    renderLogMode();
    openJournalComposer();
    showToast("Journal link selected.");
  }

  function openJournalComposer() {
    const shell = $("journalEntryShell");
    if (shell) {
      shell.open = true;
      shell.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    $("journalEntryForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startJournalQuickEntry(mode = "") {
    const typeByMode = {
      test: "Water Test",
      feeding: "Feeding",
      maintenance: "Maintenance",
      water_change: "Water Change",
    };
    const type = typeByMode[mode] || "Observation";
    if ($("journalEntryType")) $("journalEntryType").value = type;
    if (mode === "water_change" && $("maintenanceType")) $("maintenanceType").value = "Water change";
    renderLogMode();
    setActiveView("logbook");
    openJournalComposer();
  }

  function getWaterTestAlerts(test) {
    const alerts = [];
    if (test.ammonia !== null && test.ammonia > 0)
      alerts.push(`Ammonia ${test.ammonia} ppm — should be 0`);
    if (test.nitrite !== null && test.nitrite > 0)
      alerts.push(`Nitrite ${test.nitrite} ppm — should be 0`);
    if (test.nitrate !== null && test.nitrate > 20)
      alerts.push(`Nitrate ${test.nitrate} ppm — elevated (reef target <20)`);
    if (test.phosphate !== null && test.phosphate > 0.1)
      alerts.push(`Phosphate ${test.phosphate} ppm — elevated (reef target <0.1)`);
    return alerts;
  }

  async function handleDocumentClick(event) {
    if (window.RC.Map?.handleMapClick?.(event)) return;
    const removePhoto = event.target.closest("[data-remove-photo]");
    if (removePhoto) {
      if (removePhoto.dataset.removePhoto === "insight") {
        const photoIndex = Number(removePhoto.dataset.photoIndex);
        if (Number.isInteger(photoIndex)) {
          pendingInsightPhotos = pendingInsightPhotos.filter((_photo, index) => index !== photoIndex);
        } else {
          pendingInsightPhotos = [];
        }
        renderPhotoPreview("insightPhotoPreview", pendingInsightPhotos, "Insight photo");
        showToast("Insight photo removed.");
      } else if (removePhoto.dataset.removePhoto === "insight-followup") {
        const runId = removePhoto.dataset.insightRunId || "";
        if (runId && pendingInsightFollowupRunId && pendingInsightFollowupRunId !== runId) return;
        const photoIndex = Number(removePhoto.dataset.photoIndex);
        if (Number.isInteger(photoIndex)) {
          pendingInsightFollowupPhotos = pendingInsightFollowupPhotos.filter((_photo, index) => index !== photoIndex);
        } else {
          pendingInsightFollowupPhotos = [];
        }
        renderPhotoPreview(getInsightFollowupPhotoPreview(runId), pendingInsightFollowupPhotos, "Follow-up insight photo");
        showToast("Follow-up photo removed.");
      } else {
        const photoIndex = Number(removePhoto.dataset.photoIndex);
        if (Number.isInteger(photoIndex)) {
          pendingLivestockPhotos = pendingLivestockPhotos.filter((_photo, index) => index !== photoIndex);
        } else {
          pendingLivestockPhotos = [];
        }
        renderActiveLivestockPhotoPreview();
        showToast("Photo removed.");
      }
      return;
    }

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
      startJournalQuickEntry(quickLog.dataset.openLog);
      return;
    }

    const livestockFilter = event.target.closest("[data-livestock-filter]");
    if (livestockFilter) {
      if (editingLivestockId) resetLivestockForm();
      state.ui.livestockFilter = livestockFilter.dataset.livestockFilter;
      saveLocalState();
      renderLivestock();
      return;
    }

    const journalLinkFilter = event.target.closest("[data-journal-link-filter]");
    if (journalLinkFilter) {
      setJournalLinkFilter(journalLinkFilter.dataset.journalLinkFilter);
      return;
    }

    const parMarkerDelete = event.target.closest("[data-par-marker-delete]");
    if (parMarkerDelete) {
      state.map.parMarkers = (state.map.parMarkers || []).filter((marker) => marker.id !== parMarkerDelete.dataset.parMarkerDelete);
      saveState();
      window.RC.Map.renderMapSummaries();
      window.RC.Map.renderReefMap2({ rebuild: true });
      window.RC.Insights?.renderInsightsContext?.();
      showToast("PAR marker deleted.");
      return;
    }

    const stockClear = event.target.closest("[data-map-stock-clear]");
    if (stockClear) {
      updateLivestockPlacement(stockClear.dataset.mapStockClear, { mapPosition: null, mapMarkerHidden: true });
      saveState();
      window.RC.Map.renderMapMarkerControls();
      window.RC.Map.renderMapSummaries();
      window.RC.Map.renderReefMap2({ rebuild: true });
      window.RC.Insights?.renderInsightsContext?.();
      showToast("Stock marker deleted.");
      return;
    }

    const zoneDelete = event.target.closest("[data-zone-delete]");
    if (zoneDelete) {
      const id = zoneDelete.dataset.zoneDelete;
      state.zones = state.zones.filter((zone) => zone.id !== id);
      getLivestockItems().forEach((item) => {
        if (item.zoneId === id) updateLivestockPlacement(item.id, { zoneId: "" });
      });
      saveState();
      renderZones();
      renderLivestock();
      window.RC.Map.renderMapMarkerControls();
      window.RC.Map.renderMapSummaries();
      window.RC.Map.renderReefMap2({ rebuild: true });
      window.RC.Insights?.renderInsightsContext?.();
      showToast("Zone deleted.");
      return;
    }

    const equipmentAction = event.target.closest("[data-equipment-action]");
    if (equipmentAction) {
      if (equipmentAction.dataset.equipmentAction === "edit") {
        startEquipmentSetup(equipmentAction.dataset.id || "");
      } else if (equipmentAction.dataset.equipmentAction === "cancel") {
        resetEquipmentSetup();
      }
      return;
    }

    const recordJournal = event.target.closest("[data-record-journal]");
    if (recordJournal) {
      startJournalForRecord(recordJournal.dataset.recordJournal);
      return;
    }

    const livestockAction = event.target.closest("[data-livestock-action]");
    if (livestockAction) {
      await updateLivestockStatus(livestockAction.dataset.id, livestockAction.dataset.livestockAction);
      return;
    }

    const insightFollowup = event.target.closest("[data-insight-followup]");
    if (insightFollowup) {
      await window.RC.Insights.generateFollowupInsight(insightFollowup.dataset.insightFollowup, insightFollowup);
      return;
    }

    const deleteEntry = event.target.closest("[data-delete-entry]");
    if (deleteEntry) {
      await deleteTimelineEntry(deleteEntry.dataset.deleteEntry);
      return;
    }
  }

  async function updateLivestockStatus(id, action) {
    const record = getLivestockRecord(id);
    const item = record ? livestockItemFromRecord(record) : null;
    if (!item) return;
    if (action === "edit") {
      startLivestockEdit(id);
      return;
    }
    if (action === "cancel-edit") {
      resetLivestockForm();
      renderLivestock();
      return;
    }
    let toastMessage = "Livestock updated.";
    if (action === "delete") {
      const label = item.species || item.name || "this livestock item";
      const confirmed = window.confirm(`Delete ${label}? This permanently removes the item and its photos.`);
      if (!confirmed) return;
      await removeStoragePaths(getPhotoStoragePaths(getLivestockPhotos(item)));
      removeLivestockRecord(id);
      if (editingLivestockId === id) resetLivestockForm();
      toastMessage = "Livestock deleted.";
    } else if (action === "restore") {
      addJournalEntry({
        type: "Livestock Change",
        title: `${item.species || item.name || "Livestock"} restored`,
        summary: "Marked alive.",
        linkedLivestock: [item.id],
        effects: [{ recordId: item.id, fields: { status: "alive", retiredAt: "" } }],
      });
    } else if (action === "deceased") {
      const removedDate = todayInputValue();
      const outcomeReason = window.prompt("Suspected cause or note?", item.outcomeReason || "") || "";
      addJournalEntry({
        type: "Livestock Change",
        title: `${item.species || item.name || "Livestock"} deceased`,
        summary: outcomeReason,
        linkedLivestock: [item.id],
        effects: [{ recordId: item.id, fields: { status: "deceased", retiredAt: removedDate, outcomeReason } }],
      });
    } else if (action === "removed") {
      const removedDate = todayInputValue();
      const outcomeReason = window.prompt("Removed how?", item.outcomeReason || "") || "";
      addJournalEntry({
        type: "Livestock Change",
        title: `${item.species || item.name || "Livestock"} removed`,
        summary: outcomeReason,
        linkedLivestock: [item.id],
        effects: [{ recordId: item.id, fields: { status: "removed", retiredAt: removedDate, outcomeReason } }],
      });
    }
    syncLegacyLivestockFromRecords();
    saveState();
    renderLivestock();
    renderPhotoLibrary();
    window.RC.Map.renderMapMarkerControls();
    window.RC.Map.renderMapSummaries();
    window.RC.Map.renderReefMap2({ rebuild: true });
    renderDashboard();
    window.RC.Insights?.renderInsightsContext?.();
    showToast(toastMessage);
  }

  async function deleteTimelineEntry(key, options = {}) {
    const [kind, id] = key.split(":");
    const entry = getTimelineEntries().find((item) => item.kind === kind && item.id === id);
    const label = entry?.title || "this entry";
    const confirmed = await requestConfirmation({
      title: options.title || "Delete entry?",
      message: options.message || `Delete "${label}" from the journal? This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    if (kind === "journal") {
      state.journal = state.journal.filter((item) => item.id !== id);
    } else if (kind === "test") {
      if (hasJournalSource()) {
        state.journal = (state.journal || []).filter((entry) => entry.legacyId !== id);
      } else {
        state.waterTests = state.waterTests.filter((test) => test.id !== id);
      }
    } else {
      if (hasJournalSource()) {
        state.journal = (state.journal || []).filter((entry) => entry.legacyId !== id);
      } else {
        state.events = state.events.filter((event) => event.id !== id);
      }
    }
    saveState();
    renderDashboard();
    renderTimeline();
    window.RC.Insights?.renderInsightsContext?.();
    showToast("Entry deleted.");
  }

  async function deleteLastEntry() {
    const latest = getTimelineEntries()[0];
    if (!latest) {
      showToast("No entries to delete.");
      return;
    }
    await deleteTimelineEntry(`${latest.kind}:${latest.id}`, {
      title: "Delete latest entry?",
      message: `Delete the latest entry, "${latest.title || "Journal entry"}"? This cannot be undone.`,
    });
  }

  function updateMap2RefinementOpacity(event) {
    state.ui.map2RefinementOverlayOpacity = clamp(0, 1, finiteNumber(event.target.value, 35) / 100);
    saveLocalState();
    renderMap2RefinementOverlayControls();
    syncMap2RefinementAnnotationOverlay();
    window.RC.Map.renderReefMap2();
  }

  async function handleDocumentChange(event) {
    if (event.target?.id === "livestockInlinePhotoInput") {
      await handlePhotoInput(event, "livestock");
      return;
    }
    if (event.target?.matches?.("[data-insight-followup-photo]")) {
      await handlePhotoInput(event, "insight-followup");
      return;
    }
    const inlineLivestockForm = event.target.closest("[data-livestock-inline-form]");
    if (inlineLivestockForm && (event.target.name === "category" || event.target.name === "isLegacy")) {
      syncInlineLivestockDateControls(inlineLivestockForm);
    }
    if (event.target?.id === "equipmentRecordStatus") {
      syncEquipmentRetiredDateControl();
    }
    if (event.target?.matches?.("[data-journal-livestock-status], [data-journal-equipment-status]")) {
      syncJournalRecordUpdateControls();
    }
  }

  async function handleDocumentSubmit(event) {
    if (event.target.matches("[data-livestock-inline-form]")) {
      event.preventDefault();
      await saveInlineLivestockEdit(event.target);
    }
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("change", handleDocumentChange);
    document.addEventListener("submit", handleDocumentSubmit);
    window.RC.Map?.bindMapEvents?.();
    $("insightPhotoInput").addEventListener("change", (event) => handlePhotoInput(event, "insight"));
    $("zoneForm")?.addEventListener("submit", addZone);
    $("editTankProfileButton")?.addEventListener("click", startTankProfileEdit);
    $("saveTankProfileButton")?.addEventListener("click", updateProfileFromForm);
    $("cancelTankProfileButton")?.addEventListener("click", cancelTankProfileEdit);
    $("addEquipmentRecordButton")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const section = e.currentTarget.closest("details");
      if (section) section.open = true;
      startEquipmentSetup();
    });
    $("equipmentRecordList")?.addEventListener("submit", saveEquipmentSetup);
    $("livestockForm").addEventListener("submit", addLivestock);
    $("livestockCategory").addEventListener("change", syncLivestockDateControls);
    $("livestockLegacy").addEventListener("change", syncLivestockDateControls);
    $("livestockPhotoInput").addEventListener("change", (event) => handlePhotoInput(event, "livestock"));
    $("cancelLivestockEditButton").addEventListener("click", resetLivestockForm);
    $("journalEntryForm")?.addEventListener("submit", addJournalEntryFromForm);
    $("journalEntryType")?.addEventListener("change", () => {
      renderJournalTypeFields();
      renderJournalRecordPickers();
    });
    $("journalLinkedLivestock")?.addEventListener("change", renderJournalLivestockFields);
    $("journalLinkedEquipment")?.addEventListener("change", renderJournalLivestockFields);
    $("journalLinkSearch")?.addEventListener("input", applyJournalLinkFilters);
    $("journalOccurredAt")?.addEventListener("change", updateTestTimingPill);
    $("generateInsightButton").addEventListener("click", () => window.RC.Insights.generateInsight());
    $("privateAuthForm")?.addEventListener("submit", handlePrivateAuthSubmit);
    $("privateMagicLinkButton")?.addEventListener("click", sendMagicLink);
    $("saveBackendButton")?.addEventListener("click", saveBackendSettings);
    $("sendMagicLinkButton")?.addEventListener("click", sendMagicLink);
    $("signOutButton")?.addEventListener("click", signOut);
    $("pullStateButton")?.addEventListener("click", pullState);
    $("pushStateButton")?.addEventListener("click", pushState);
    $("confirmCancelButton")?.addEventListener("click", () => closeConfirmation(false));
    $("confirmActionButton")?.addEventListener("click", () => closeConfirmation(true));
    $("confirmDialog")?.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeConfirmation(false);
    });
    $("confirmDialog")?.addEventListener("close", () => {
      if (pendingConfirmResolve) closeConfirmation(false);
    });
    $("clearMistakeButton").addEventListener("click", deleteLastEntry);
    $("paramTrendsPanel")?.addEventListener("toggle", (event) => {
      if (event.target.open) renderParameterTrends();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && supabaseClient && currentUser) {
        pushState({ silent: true });
      }
    });
  }

  function getPendingInsightPhotos() {
    return pendingInsightPhotos.map(normalizePhotoRecord).filter(Boolean);
  }

  function getPendingInsightFollowupPhotos(runId = "") {
    if (runId && pendingInsightFollowupRunId && pendingInsightFollowupRunId !== runId) return [];
    return pendingInsightFollowupPhotos.map(normalizePhotoRecord).filter(Boolean);
  }

  function clearPendingInsightPhotos() {
    pendingInsightPhotos = [];
    renderPhotoPreview("insightPhotoPreview", pendingInsightPhotos, "Insight photo");
    const photoField = document.querySelector(".insight-photo-field");
    if (photoField) photoField.open = false;
  }

  function clearPendingInsightFollowupPhotos(runId = "") {
    if (runId && pendingInsightFollowupRunId && pendingInsightFollowupRunId !== runId) return;
    pendingInsightFollowupPhotos = [];
    const targetRunId = runId || pendingInsightFollowupRunId;
    pendingInsightFollowupRunId = "";
    renderPhotoPreview(getInsightFollowupPhotoPreview(targetRunId), pendingInsightFollowupPhotos, "Follow-up insight photo");
    const photoField = getInsightFollowupPhotoField(targetRunId);
    if (photoField) photoField.open = false;
  }

  function getInsightFollowupForm(runId) {
    return [...document.querySelectorAll("[data-insight-followup-form]")]
      .find((form) => form.dataset.insightFollowupForm === runId) || null;
  }

  function getInsightFollowupPhotoPreview(runId) {
    return [...document.querySelectorAll("[data-insight-followup-photo-preview]")]
      .find((preview) => preview.dataset.insightFollowupPhotoPreview === runId) || null;
  }

  function getInsightFollowupPhotoField(runId) {
    return [...document.querySelectorAll("[data-insight-followup-photo-field]")]
      .find((field) => field.dataset.insightFollowupPhotoField === runId) || null;
  }

  window.RC = {
    get state() { return state; },
    get supabaseClient() { return supabaseClient; },
    get backendConfig() { return backendConfig; },
    get currentUser() { return currentUser; },
    $, $$, saveState, saveLocalState, showToast, uid, escapeHtml, refreshIcons,
    formatValue, formatDate, formatDateTime, formatAge, daysSince,
    getZoneName, getLatestWaterTest, getLatestEvent, getLatestEventBefore, describeTimeAfter,
    getWaterTestsFromJournal, getEventsFromJournal,
    getEquipmentProfiles, getCareTaskStatuses, getLightingPhotos, getLightPhase,
    getCurrentRecord, getRecordHistory, getLivestockItems, updateLivestockPlacement,
    getTimelineEntries, isCasualStockCategory, isLifecycleStock, getLivestockPhotos,
    getPhotoSrc, getStoragePublicUrl, prepareInsightPhotosForSave, renderPhotoPreview,
    positiveNumber, finiteNumber, nonNegativeNumber, getLidarHeightMap,
    normalizeMap, normalizeMap2RefinementAnnotations, normalizeMapPosition,
    normalizeMap2RefinementPoint, normalizePhotoRecord, getDefaultMap,
    getPendingInsightPhotos, clearPendingInsightPhotos,
    getPendingInsightFollowupPhotos, clearPendingInsightFollowupPhotos,
    getInsightFollowupForm, getInsightFollowupPhotoPreview, getInsightFollowupPhotoField,
    renderAll,
    MAP2_REFINEMENT_SHAPES, MAP2_REFINEMENT_ACTIONS, MAP2_REFINEMENT_DIRECTIONS,
    MAP2_REFINEMENT_STRENGTHS, MAP2_RIGHT_ROCK_OPTION5_REFINEMENT_BASE,
  };

  async function init() {
    try {
      enableInstallShell();
      await disableLocalInstallShell();
      await loadLocalBackendConfig();
      bindEvents();
      seedLogDates();
      renderAll();
      await initBackend();
      renderAll();
    } catch (error) {
      console.error("Init failed:", error);
      showToast("App failed to start: " + (error?.message || String(error)));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
