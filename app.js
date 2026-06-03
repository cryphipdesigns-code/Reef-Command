(function () {
  const STORAGE_KEY = "reefCommandState.v1";
  const BACKEND_KEY = "reefCommandBackend.v1";
  const PRE_PULL_BACKUP_KEY = "reefCommandState.beforeRemotePull.v1";
  const SHARED_STATE_ID = "default";
  const PHOTO_BUCKET = "reef-photos";
  const PHOTO_ROOT = "shared";
  const MAP2_REFINEMENT_SHAPES = ["navigate", "point", "line", "area"];
  const MAP2_REFINEMENT_ACTIONS = ["raise", "depress", "flatten", "cut-back", "smooth", "ridge"];
  const MAP2_REFINEMENT_DIRECTIONS = ["surface", "top-bottom", "left-right", "front-back"];
  const MAP2_REFINEMENT_STRENGTHS = ["light", "medium", "strong"];

  const viewMap = {
    home: "homeView",
    tank: "tankView",
    map: "mapView",
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
  let pendingLivestockPhotos = [];
  let editingLog = null;
  let map2Renderer = null;
  let map2Scene = null;
  let map2Camera = null;
  let map2Root = null;
  let map2AnimationFrame = null;
  let map2ResizeObserver = null;
  let map2PointerState = null;
  let appliedMap2ViewPreset = null;
  const scanMeshAssetCache = new Map();
  const map2ViewState = {
    yaw: 0,
    pitch: 0,
    distance: 42,
    targetOffsetX: 0,
    targetOffsetY: 0,
    targetOffsetZ: 0,
  };
  let map2RefinementDraft = null;

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
      map: getDefaultMap(),
      ui: {
        activeView: "home",
        logMode: "test",
        livestockFilter: "active",
        insightMode: "health",
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
        calibrationNotes: "Five-rock silhouette-locked mesh from traced front, top, and side references. Version 21 tunes Map 2.0 with mirrored LiDAR shelf/right rocks, a shorter shelf height, and legacy front sandbed rocks.",
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
          notes: "Back-glass-touching left rock. Larger continuous mass from the traced top and front outlines, with sand gap at the front-right edge.",
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
          notes: "Back-glass-touching right rock. Version 20 uses the front/back-corrected LiDAR OBJ top envelope as the primary geometry reference, blended with the traced footprint and side/front profiles.",
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
      map: normalizeMap(raw.map, base.map),
    };

    const lightingPhotos = normalizePhotoArray([
      ...(Array.isArray(next.profile.lightingPhotos) ? next.profile.lightingPhotos : []),
      next.profile.lightingPhoto,
      next.profile.lightingPhotoDataUrl,
    ]);
    next.profile.lightingPhotos = lightingPhotos;
    next.profile.lightingPhoto = lightingPhotos[0] || null;
    next.profile.lightingPhotoDataUrl = lightingPhotos.find((photo) => photo.dataUrl)?.dataUrl || "";

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
        photos,
        photoDataUrl: photos.find((photo) => photo.dataUrl)?.dataUrl || "",
        mapPosition: normalizeMapPosition(item.mapPosition),
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
    return { x, y, z };
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

  function getLightingPhotos() {
    return normalizePhotoArray([
      ...(Array.isArray(state.profile.lightingPhotos) ? state.profile.lightingPhotos : []),
      state.profile.lightingPhoto,
      state.profile.lightingPhotoDataUrl,
    ]);
  }

  function setLightingPhotos(photos) {
    const normalized = normalizePhotoArray(photos);
    state.profile.lightingPhotos = normalized;
    state.profile.lightingPhoto = normalized[0] || null;
    state.profile.lightingPhotoDataUrl = normalized.find((photo) => photo.dataUrl)?.dataUrl || "";
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
    if (supabaseClient) {
      return supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
    }
    const baseUrl = backendConfig.supabaseUrl || "";
    if (!baseUrl) return "";
    return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/${encodeStoragePath(path)}`;
  }

  function encodeStoragePath(path) {
    return path.split("/").map((part) => encodeURIComponent(part)).join("/");
  }

  function cleanPathSegment(value) {
    return String(value || "item")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item";
  }

  async function loadLocalBackendConfig() {
    if (hasValidBackendConfig(backendConfig)) return;

    const configPaths = isLocalDevelopmentHost()
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
        value?.insightRuns?.length,
    );
  }

  function getStateDataScore(value) {
    const profile = value?.profile || {};
    const profileFields = [
      "displayVolume",
      "totalVolume",
      "startDate",
      "tankStyle",
      "filtration",
      "lightingModel",
      "lightingSummary",
      "saltMix",
      "dosing",
      "notes",
    ].filter((key) => String(profile[key] || "").trim()).length;
    const equipmentFlags = ["proteinSkimmer", "refugium", "autoTopOff"].filter((key) => Boolean(profile[key])).length;
    const lightingPhotos = Array.isArray(profile.lightingPhotos) ? profile.lightingPhotos.length : 0;
    const zoneDetails = Array.isArray(value?.zones)
      ? value.zones.filter((zone) => zone.parMin || zone.parMax || zone.notes).length
      : 0;
    const score = {
      livestock: Array.isArray(value?.livestock) ? value.livestock.length : 0,
      waterTests: Array.isArray(value?.waterTests) ? value.waterTests.length : 0,
      events: Array.isArray(value?.events) ? value.events.length : 0,
      insightRuns: Array.isArray(value?.insightRuns) ? value.insightRuns.length : 0,
      profileFields,
      equipmentFlags,
      lightingPhotos,
      zoneDetails,
      parMarkers: Array.isArray(value?.map?.parMarkers) ? value.map.parMarkers.length : 0,
    };
    score.core =
      score.livestock +
      score.waterTests +
      score.events +
      score.insightRuns +
      score.profileFields +
      score.equipmentFlags +
      score.lightingPhotos +
      score.zoneDetails;
    score.total = score.core + score.parMarkers;
    return score;
  }

  function shouldProtectRemoteState(remoteState, localState) {
    const remoteScore = getStateDataScore(remoteState);
    const localScore = getStateDataScore(localState);
    return (
      remoteScore.core >= localScore.core + 3 ||
      (remoteScore.livestock > localScore.livestock && remoteScore.core > localScore.core)
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
    if (!normalized || !normalized.dataUrl || !supabaseClient) return normalized;

    const blob = await dataUrlToBlob(normalized.dataUrl);
    const path = normalized.path || [
      PHOTO_ROOT,
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

  async function removeStoragePaths(paths) {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length || !supabaseClient) return;
    const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove(uniquePaths);
    if (error) console.warn("Could not remove stored photos", error);
  }

  async function processImageFiles(files, options) {
    const saved = [];
    const failed = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const label = options.label || "image";
      try {
        showToast(`Processing ${label} ${index + 1} of ${files.length}.`);
        const dataUrl = await compressImageFile(file, options.maxDimension, options.quality);
        const pendingPhoto = createPendingPhoto(dataUrl);
        saved.push(await options.savePhoto(pendingPhoto));
      } catch (error) {
        console.error("Image processing failed", file?.name || index + 1, error);
        failed.push(file?.name || `${label} ${index + 1}`);
      }
    }

    return { saved, failed };
  }

  function showImageSaveResult(savedCount, failedCount, label) {
    if (savedCount && failedCount) {
      showToast(`${savedCount} ${label}${savedCount === 1 ? "" : "s"} saved, ${failedCount} skipped.`);
    } else if (savedCount) {
      showToast(`${savedCount} ${label}${savedCount === 1 ? "" : "s"} saved.`);
    } else {
      showToast(`No ${label}s saved. Try JPEG, PNG, or WebP.`);
    }
  }

  function renderPhotoPreview(previewId, photoValue, altText) {
    const preview = $(previewId);
    if (!preview) return;
    const photos = (Array.isArray(photoValue) ? photoValue : photoValue ? [photoValue] : [])
      .map(normalizePhotoRecord)
      .filter(Boolean);
    if (!photos.length) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }

    const kind = previewId === "lightingPhotoPreview" ? "lighting" : "livestock";
    preview.hidden = false;
    if (kind === "lighting") {
      preview.innerHTML = `
        <div class="photo-preview-grid">
          ${photos.map((photo, index) => `
            <article class="photo-preview-item">
              <img src="${escapeHtml(getPhotoSrc(photo))}" alt="${escapeHtml(`${altText} ${index + 1}`)}" />
              <button class="mini-button danger" type="button" data-remove-photo="lighting" data-photo-index="${index}">Remove</button>
            </article>
          `).join("")}
        </div>
      `;
      return;
    }

    preview.innerHTML = `
      <div class="photo-preview-grid">
        ${photos.map((photo, index) => `
          <article class="photo-preview-item">
            <img src="${escapeHtml(getPhotoSrc(photo))}" alt="${escapeHtml(`${altText} ${index + 1}`)}" />
            <button class="mini-button danger" type="button" data-remove-photo="livestock" data-photo-index="${index}">Remove</button>
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
      if (target === "lighting") {
        const result = await processImageFiles(files, {
          label: "lighting image",
          maxDimension: 1200,
          quality: 0.76,
          savePhoto: (photo) => (supabaseClient ? uploadPhotoRecord(photo, "profile", "lighting") : photo),
        });
        if (result.saved.length) {
          setLightingPhotos([...getLightingPhotos(), ...result.saved]);
          saveState();
          renderPhotoPreview("lightingPhotoPreview", getLightingPhotos(), "Lighting schedule image");
          renderPhotoLibrary();
          renderInsightsContext();
        }
        showImageSaveResult(result.saved.length, result.failed.length, "lighting image");
      } else {
        const result = await processImageFiles(files, {
          label: "photo",
          maxDimension: 1100,
          quality: 0.78,
          savePhoto: (photo) => photo,
        });
        if (result.saved.length) {
          pendingLivestockPhotos = [...pendingLivestockPhotos, ...result.saved];
          renderPhotoPreview("livestockPhotoPreview", pendingLivestockPhotos, "Stock photo");
        }
        showImageSaveResult(result.saved.length, result.failed.length, "photo");
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
    if (next === "map") {
      requestAnimationFrame(() => renderReefMap2({ rebuild: true }));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    refreshIcons();
  }

  function renderAll() {
    renderTankProfileForm();
    renderDashboard();
    renderZones();
    renderMapSettings();
    renderMap2Settings();
    renderMapSummaries();
    renderMapMarkerControls();
    syncLivestockDateControls();
    renderLivestock();
    renderPhotoLibrary();
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
    renderPhotoPreview("lightingPhotoPreview", getLightingPhotos(), "Lighting schedule image");
  }

  function updateProfileFromForm() {
    $$("[data-profile]").forEach((input) => {
      const key = input.dataset.profile;
      state.profile[key] = input.type === "checkbox" ? input.checked : input.value;
    });
    saveState();
    $("profileSavedStatus").textContent = "Saved";
    renderDashboard();
    renderPhotoLibrary();
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

  function renderMapSettings() {
    if (!$("mapSettingsForm")) return;
    const dimensions = state.map.dimensions;
    $$("[data-map-dimension]").forEach((input) => {
      const key = input.dataset.mapDimension;
      input.value = dimensions[key] ?? "";
    });
    $$("[data-map-layer]").forEach((button) => {
      button.classList.toggle("active", Boolean(state.map.layers?.[button.dataset.mapLayer]));
    });
  }

  function renderMap2Settings() {
    if (!$("map2Summary")) return;
    const dimensions = state.map.dimensions;
    $("map2Summary").textContent = `${formatValue(dimensions.width, "in")} x ${formatValue(dimensions.depth, "in")} x ${formatValue(dimensions.height, "in")} · LiDAR shelf/right + legacy front rocks`;
    $("map2QualityPill").textContent = "Hybrid remesh";
    renderMap2FocusSelect();
    renderMap2RefinementControls();
    $$("[data-map2-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.map2View === (appliedMap2ViewPreset || "front"));
    });
    renderMap2NavigationControls();
  }

  function renderMap2NavigationControls() {
    const navTool = getMap2NavTool();
    $$("[data-map2-nav]").forEach((button) => {
      button.classList.toggle("active", button.dataset.map2Nav === navTool);
    });
  }

  function renderMap2FocusSelect() {
    const select = $("map2FocusSelect");
    if (!select) return;
    const options = [
      { id: "tank", name: "Whole tank" },
      ...getMap2Structures().map((structure) => ({ id: structure.id, name: structure.name })),
    ];
    const current = options.some((option) => option.id === state.ui.map2FocusStructureId)
      ? state.ui.map2FocusStructureId
      : "tank";
    if (current !== state.ui.map2FocusStructureId) state.ui.map2FocusStructureId = current;
    select.replaceChildren(...options.map((option) => new Option(option.name, option.id)));
    select.value = current;
  }

  function renderMap2RefinementControls() {
    if (!$("map2RefineStatus")) return;
    const annotations = state.map.refinementAnnotations || [];
    const shape = getMap2RefinementShape();
    $$("[data-map2-refine-shape]").forEach((button) => {
      button.classList.toggle("active", button.dataset.map2RefineShape === shape);
    });
    $("map2RefineAction").value = getMap2RefinementAction();
    $("map2RefineDirection").value = getMap2RefinementDirection();
    $("map2RefineStrength").value = getMap2RefinementStrength();
    $("map2RefineRadius").value = String(getMap2RefinementRadius());
    $("map2RefineNote").value = state.ui.map2RefinementNote || "";
    renderMap2RefinementOverlayControls();
    $("map2RefineCountPill").textContent = `${annotations.length} ${annotations.length === 1 ? "note" : "notes"}`;
    $("map2RefineStatus").textContent = getMap2RefinementStatus();
    const canFinishArea = map2RefinementDraft?.shape === "area" && map2RefinementDraft.points.length >= 3;
    document.querySelector("[data-map2-refinement-finish]").disabled = !canFinishArea;
    document.querySelector("[data-map2-refinement-cancel]").disabled = !map2RefinementDraft;
    $("map2RefinementList").innerHTML = annotations.length
      ? annotations.slice().reverse().map(renderMap2RefinementCard).join("")
      : `<div class="empty-state">No geometry notes yet.</div>`;
  }

  function renderMap2RefinementCard(annotation) {
    const pointCount = annotation.points?.length || 0;
    const meta = [
      getMapStructureName(annotation.structureId),
      getMap2RefinementShapeLabel(annotation.shape),
      getMap2RefinementActionLabel(annotation.action),
      getMap2RefinementDirectionLabel(annotation.direction),
      annotation.strength,
      `${formatValue(annotation.radius, "in")} radius`,
    ].filter(Boolean).join(" · ");
    return `
      <article class="data-card">
        <div class="data-card-header">
          <div class="data-card-title">
            <strong>${escapeHtml(getMap2RefinementActionLabel(annotation.action))}</strong>
            <p class="card-meta">${escapeHtml(meta)}</p>
          </div>
          <span class="category-pill">${escapeHtml(pointCount)} pt${pointCount === 1 ? "" : "s"}</span>
        </div>
        ${annotation.note ? `<p class="card-meta">${escapeHtml(annotation.note)}</p>` : ""}
        <div class="card-actions">
          <button class="mini-button danger" type="button" data-map2-refinement-delete="${annotation.id}">Delete</button>
        </div>
      </article>
    `;
  }

  function getMap2RefinementStatus() {
    const shape = getMap2RefinementShape();
    if (shape === "navigate") return "Ready";
    if (!map2RefinementDraft) return `${getMap2RefinementShapeLabel(shape)} armed`;
    if (map2RefinementDraft.shape === "line") return `${map2RefinementDraft.points.length}/2 line points`;
    if (map2RefinementDraft.shape === "area") return `${map2RefinementDraft.points.length} area points`;
    return "Ready";
  }

  function getMap2RefinementShape() {
    return MAP2_REFINEMENT_SHAPES.includes(state.ui.map2RefinementShape) ? state.ui.map2RefinementShape : "navigate";
  }

  function getMap2RefinementAction() {
    return MAP2_REFINEMENT_ACTIONS.includes(state.ui.map2RefinementAction) ? state.ui.map2RefinementAction : "raise";
  }

  function getMap2RefinementDirection() {
    return MAP2_REFINEMENT_DIRECTIONS.includes(state.ui.map2RefinementDirection) ? state.ui.map2RefinementDirection : "surface";
  }

  function getMap2RefinementStrength() {
    return MAP2_REFINEMENT_STRENGTHS.includes(state.ui.map2RefinementStrength) ? state.ui.map2RefinementStrength : "medium";
  }

  function getMap2RefinementRadius() {
    return positiveNumber(state.ui.map2RefinementRadius, 0.8);
  }

  function getMap2RefinementOverlayVisible() {
    return state.ui.map2RefinementOverlayVisible !== false;
  }

  function getMap2RefinementOverlayOpacity() {
    return clamp(0, 1, finiteNumber(state.ui.map2RefinementOverlayOpacity, 0.35));
  }

  function renderMap2RefinementOverlayControls() {
    const visible = getMap2RefinementOverlayVisible();
    const opacity = Math.round(getMap2RefinementOverlayOpacity() * 100);
    const toggle = document.querySelector("[data-map2-refinement-overlay-toggle]");
    const slider = $("map2RefinementOpacity");
    const value = $("map2RefinementOpacityValue");
    if (toggle) {
      toggle.classList.toggle("active", visible);
      toggle.setAttribute("aria-pressed", String(visible));
    }
    if (slider) {
      slider.value = String(opacity);
      slider.disabled = !visible;
    }
    if (value) value.textContent = `${opacity}%`;
  }

  function getMap2NavTool() {
    return ["rotate", "pan"].includes(state.ui.map2NavTool) ? state.ui.map2NavTool : "rotate";
  }

  function getMap2RefinementShapeLabel(shape) {
    return {
      point: "Point",
      line: "Line",
      area: "Area",
      navigate: "Navigate",
    }[shape] || "Point";
  }

  function getMap2RefinementActionLabel(action) {
    return {
      raise: "Raise",
      depress: "Depress",
      flatten: "Flatten",
      "cut-back": "Cut back",
      smooth: "Smooth",
      ridge: "Ridge / ledge",
    }[action] || "Raise";
  }

  function getMap2RefinementDirectionLabel(direction) {
    return {
      surface: "Surface",
      "top-bottom": "Top to bottom",
      "left-right": "Left to right",
      "front-back": "Front to back",
    }[direction] || "Surface";
  }

  function renderMapMarkerControls() {
    if (!$("mapMarkerForm")) return;
    const tool = getMapTool();
    const stockItems = getMapPlaceableStock();
    if (state.ui.selectedMapStockId && !stockItems.some((item) => item.id === state.ui.selectedMapStockId)) {
      state.ui.selectedMapStockId = "";
    }
    if (!state.ui.selectedMapStockId && stockItems.length) {
      state.ui.selectedMapStockId = stockItems[0].id;
    }

    $$("[data-map-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mapTool === tool);
    });
    $("mapMarkerModePill").textContent = tool === "par" ? "PAR point" : tool === "stock" ? "Stock marker" : "Navigate";
    $("mapParValueField").hidden = tool !== "par";
    $("mapStockSelectField").hidden = tool !== "stock";
    $("mapMarkerNote").disabled = tool === "navigate";
    $("mapStockSelect").innerHTML = stockItems.length
      ? stockItems.map((item) => `<option value="${item.id}">${escapeHtml(item.species || item.name || "Unknown")}</option>`).join("")
      : `<option value="">No active stock</option>`;
    $("mapStockSelect").value = state.ui.selectedMapStockId || "";
  }

  function getMapTool() {
    return ["navigate", "par", "stock"].includes(state.ui.mapTool) ? state.ui.mapTool : "navigate";
  }

  function getMapPlaceableStock() {
    return state.livestock.filter((item) => isCasualStockCategory(item.category) || item.status === "active");
  }

  function updateMapFromSettings() {
    const dimensions = { ...state.map.dimensions };
    $$("[data-map-dimension]").forEach((input) => {
      const key = input.dataset.mapDimension;
      if (input.type === "number") {
        dimensions[key] = input.value === "" ? "" : Number(input.value);
      } else {
        dimensions[key] = input.value;
      }
    });
    state.map = normalizeMap({ ...state.map, dimensions }, getDefaultMap());
    saveState();
    renderMapSettings();
    renderMap2Settings();
    renderMapSummaries();
    renderReefMap2({ rebuild: true });
    renderInsightsContext();
  }

  function renderMapSummaries() {
    if (!$("mapStructureList")) return;
    const structures = state.map.structures || [];
    $("mapStructureCountPill").textContent = `${structures.length} structures`;
    $("mapStructureList").innerHTML = structures.length
      ? structures.map((structure) => `
        <article class="data-card">
          <div class="data-card-header">
            <div class="data-card-title">
              <strong>${escapeHtml(structure.name)}</strong>
              <p class="card-meta">${escapeHtml(structure.light)} light · ${escapeHtml(structure.flow)} flow · ${escapeHtml(formatStructureSize(structure))}</p>
            </div>
            <span class="category-pill">${escapeHtml(structure.type)}</span>
          </div>
          <div class="map-stat-row">
            <span class="map-stat">PAR ${escapeHtml(formatParRange(structure))}</span>
            <span class="map-stat">X ${escapeHtml(formatValue(structure.x, "in"))}</span>
            <span class="map-stat">Y ${escapeHtml(formatValue(structure.y, "in"))}</span>
            <span class="map-stat">Z ${escapeHtml(formatValue(structure.z, "in"))}</span>
          </div>
          ${structure.notes ? `<p class="card-meta">${escapeHtml(structure.notes)}</p>` : ""}
        </article>
      `).join("")
      : `<div class="empty-state">No structures mapped.</div>`;

    const placements = getLivestockMapPlacements();
    const placedCount = placements.filter((placement) => placement.anchor).length;
    $("mapPlacementCountPill").textContent = `${placedCount}/${placements.length} placed`;
    $("mapPlacementList").innerHTML = placements.length
      ? placements.map((placement) => `
        <article class="data-card">
          <div class="data-card-header">
            <div class="data-card-title">
              <strong>${escapeHtml(placement.species)}</strong>
              <p class="card-meta">${escapeHtml(placement.category)} · ${escapeHtml(placement.zone || "Unplaced")}</p>
            </div>
            <span class="category-pill">${escapeHtml(placement.structure?.name || "No zone")}</span>
          </div>
          <div class="map-stat-row">
            <span class="map-stat">${escapeHtml(placement.manual ? "Manual" : placement.anchor ? "Zone estimate" : "Unplaced")}</span>
            ${placement.anchor ? `<span class="map-stat">${escapeHtml(formatMapCoordinate(placement.anchor))}</span>` : ""}
            <span class="map-stat">${escapeHtml(placement.health || "Health untracked")}</span>
            <span class="map-stat">${escapeHtml(placement.growth || "Growth untracked")}</span>
          </div>
          <div class="card-actions">
            <button class="mini-button" type="button" data-map-stock-place="${placement.id}">Place</button>
            ${placement.manual ? `<button class="mini-button danger" type="button" data-map-stock-clear="${placement.id}">Clear</button>` : ""}
          </div>
        </article>
      `).join("")
      : `<div class="empty-state">No stock to place yet.</div>`;

    const parMarkers = state.map.parMarkers || [];
    $("mapParMarkerCountPill").textContent = String(parMarkers.length);
    $("mapParMarkerList").innerHTML = parMarkers.length
      ? parMarkers.map((marker) => `
        <article class="data-card">
          <div class="data-card-header">
            <div class="data-card-title">
              <strong>PAR ${escapeHtml(marker.value || "?")}</strong>
              <p class="card-meta">${escapeHtml(formatMapCoordinate(marker))}${marker.measuredAt ? ` · ${escapeHtml(formatDateTime(marker.measuredAt))}` : ""}</p>
            </div>
            <span class="category-pill">${escapeHtml(marker.structureId ? getMapStructureName(marker.structureId) : "Open sand")}</span>
          </div>
          ${marker.note ? `<p class="card-meta">${escapeHtml(marker.note)}</p>` : ""}
          <div class="card-actions">
            <button class="mini-button danger" type="button" data-par-marker-delete="${marker.id}">Delete</button>
          </div>
        </article>
      `).join("")
      : `<div class="empty-state">No PAR markers yet.</div>`;
  }

  function formatStructureSize(structure) {
    return `${formatValue(structure.width, "in")} x ${formatValue(structure.depth, "in")} x ${formatValue(structure.height, "in")}`;
  }

  function formatParRange(structure) {
    if (!structure.parMin && !structure.parMax) return "unknown";
    return `${structure.parMin || "?"}-${structure.parMax || "?"}`;
  }

  function formatMapCoordinate(point) {
    if (!point) return "No coordinate";
    return `X ${formatValue(point.x, "in")} · Y ${formatValue(point.y, "in")} · Z ${formatValue(point.z, "in")}`;
  }

  function getMapStructureName(id) {
    return state.map.structures.find((structure) => structure.id === id)?.name || "Mapped";
  }

  function renderReefMap2(options = {}) {
    if (!$("reefMap2Stage")) return;
    if (!window.THREE) {
      $("reefMap2Fallback").hidden = false;
      return;
    }
    $("reefMap2Fallback").hidden = true;
    if (!ensureMap2Renderer()) return;
    resizeMap2Renderer();
    if (options.rebuild || !map2Root) rebuildReefMap2Scene();
    if (!appliedMap2ViewPreset) applyMap2ViewPreset("front");
    updateMap2Camera();
    map2Renderer.render(map2Scene, map2Camera);
    renderMap2Settings();
  }

  function ensureMap2Renderer() {
    if (map2Renderer) return true;
    const canvas = $("reefMap2Canvas");
    if (!canvas || !window.THREE) return false;

    map2Scene = new THREE.Scene();
    map2Scene.fog = new THREE.Fog(0xeaf6f5, 42, 92);
    map2Camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    map2Camera.up.set(0, 0, 1);
    map2Renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    map2Renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ("outputColorSpace" in map2Renderer && THREE.SRGBColorSpace) {
      map2Renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    map2Renderer.shadowMap.enabled = true;
    map2Renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    bindMap2PointerEvents($("reefMap2Stage"));
    map2ResizeObserver = new ResizeObserver(() => renderReefMap2());
    map2ResizeObserver.observe($("reefMap2Stage"));
    startMap2Animation();
    return true;
  }

  function resizeMap2Renderer() {
    const stage = $("reefMap2Stage");
    if (!stage || !map2Renderer || !map2Camera) return;
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const canvas = map2Renderer.domElement;
    if (canvas.width !== Math.floor(width * map2Renderer.getPixelRatio()) || canvas.height !== Math.floor(height * map2Renderer.getPixelRatio())) {
      map2Renderer.setSize(width, height, false);
      map2Camera.aspect = width / height;
      map2Camera.updateProjectionMatrix();
    }
  }

  function startMap2Animation() {
    if (map2AnimationFrame) cancelAnimationFrame(map2AnimationFrame);
    const tick = () => {
      if (map2Renderer && $("mapView")?.classList.contains("active")) {
        updateMap2Camera();
        map2Renderer.render(map2Scene, map2Camera);
      }
      map2AnimationFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function rebuildReefMap2Scene() {
    clearMap2Scene();
    map2Root = new THREE.Group();
    map2Scene.add(map2Root);

    const dimensions = state.map.dimensions;
    addMap2Lighting(dimensions);
    addMap2TankEnvelope(dimensions);
    addMap2SandBed(dimensions);

    getMap2Structures().forEach((structure, index) => {
      const mesh = createMap2Rock(structure, index);
      if (mesh) map2Root.add(mesh);
    });
    if (state.map.layers.par) addMap2ParMarkers();
    if (state.map.layers.livestock) addMap2LivestockMarkers();
    addMap2RefinementAnnotations();
  }

  function clearMap2Scene() {
    if (!map2Scene) return;
    while (map2Scene.children.length) {
      const child = map2Scene.children.pop();
      disposeThreeObject(child);
    }
    map2Root = null;
  }

  function addMap2Lighting(dimensions) {
    const ambient = new THREE.HemisphereLight(0xe8fbff, 0x405a55, 1.7);
    map2Scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(-dimensions.width * 0.15, -dimensions.depth * 0.42, dimensions.height * 1.85);
    key.castShadow = true;
    key.shadow.mapSize.width = 2048;
    key.shadow.mapSize.height = 2048;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 85;
    key.shadow.camera.left = -dimensions.width;
    key.shadow.camera.right = dimensions.width;
    key.shadow.camera.top = dimensions.height;
    key.shadow.camera.bottom = -dimensions.height;
    map2Scene.add(key);

    const fill = new THREE.PointLight(0x87dad0, 0.9, 80);
    fill.position.set(dimensions.width * 0.4, -dimensions.depth * 0.72, dimensions.height * 0.7);
    map2Scene.add(fill);
  }

  function addMap2TankEnvelope(dimensions) {
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd1eeee,
      transparent: true,
      opacity: 0.11,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tank = new THREE.Mesh(new THREE.BoxGeometry(dimensions.width, dimensions.depth, dimensions.height), glassMaterial);
    tank.position.z = dimensions.height / 2;
    map2Root.add(tank);

    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2e4947, transparent: true, opacity: 0.72 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tank.geometry), edgeMaterial);
    edges.position.copy(tank.position);
    map2Root.add(edges);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(dimensions.width, dimensions.depth),
      new THREE.MeshPhysicalMaterial({
        color: 0x8bd6d7,
        transparent: true,
        opacity: 0.18,
        roughness: 0.08,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    water.position.z = dimensions.waterline;
    map2Root.add(water);
  }

  function addMap2SandBed(dimensions) {
    const random = seededRandom("map2-sand-bed");
    const geometry = new THREE.PlaneGeometry(dimensions.width, dimensions.depth, 50, 22);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const ripple = Math.sin(x * 0.62 + y * 1.05) * 0.05 + Math.cos(y * 1.7) * 0.035;
      positions.setZ(index, dimensions.sandDepth + ripple + random() * 0.05);
    }
    geometry.computeVertexNormals();
    const sand = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xdccfac, roughness: 0.96, metalness: 0 }),
    );
    sand.receiveShadow = true;
    sand.name = "map2-sand-bed";
    sand.userData.map2Surface = "sand";
    map2Root.add(sand);
  }

  function getMap2Structures() {
    const meshForStructure = {
      "center-shelf": { key: "shelf", mirrorX: true, mirrorY: false, verticalScale: 0.8 },
      "left-rock": { key: "rightRock", mirrorX: true, mirrorY: false },
      "front-left-rock": { mode: "legacy" },
      "front-right-rock": { mode: "legacy" },
      "right-rock": { key: "rightRock", mirrorX: true, mirrorY: false },
    };
    return state.map.structures
      .filter((structure) => meshForStructure[structure.id])
      .map((structure) => ({
        ...structure,
        map2Mesh: meshForStructure[structure.id],
      }));
  }

  function createMap2Rock(structure, index) {
    if (structure.map2Mesh?.mode === "legacy") {
      return createMap2LegacyRock(structure, index);
    }
    return createMap2LidarRock(structure, index);
  }

  function createMap2LegacyRock(structure, index) {
    const mesh = new THREE.Mesh(createProfileRockGeometry(structure, index, 1, { applyMap2Refinements: true }), createRockMeshMaterial());
    mesh.name = `${structure.id}-map2-legacy`;
    mesh.userData.map2StructureId = structure.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 4 + index;
    return mesh;
  }

  function getMap2StructureRefinementAnnotations(structureId) {
    return normalizeMap2RefinementAnnotations(state.map.refinementAnnotations || [])
      .filter((annotation) => annotation.structureId === structureId);
  }

  function getMap2RefinedFootprint(structure, footprint, annotations) {
    const lateralAnnotations = (annotations || []).filter((annotation) =>
      (annotation.direction === "left-right" || annotation.direction === "front-back") &&
      getMap2RefinementLateralAmount(structure, annotation) !== 0,
    );
    if (!lateralAnnotations.length) return footprint;

    const dimensions = state.map.dimensions;
    const center = polygonCentroid(footprint);
    const bounds = getPointBounds(footprint);
    const maxShift = clamp(0.18, 1.35, Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.18);
    const tankMinX = -dimensions.width / 2 - structure.x + 0.05;
    const tankMaxX = dimensions.width / 2 - structure.x - 0.05;
    const tankMinY = -dimensions.depth / 2 - structure.y + 0.05;
    const tankMaxY = dimensions.depth / 2 - structure.y - 0.05;

    return footprint.map((point) => {
      let dx = 0;
      let dy = 0;
      lateralAnnotations.forEach((annotation) => {
        const influence = getMap2RefinementInfluence(annotation, point[0], point[1]);
        if (influence <= 0) return;
        const amount = getMap2RefinementLateralAmount(structure, annotation) * influence;
        if (annotation.direction === "left-right") {
          const sign = getMap2RefinementAxisSign(annotation, point[0], center[0], "x");
          dx += sign * amount;
        } else if (annotation.direction === "front-back") {
          const sign = getMap2RefinementAxisSign(annotation, point[1], center[1], "y");
          dy += sign * amount;
        }
      });

      return [
        clamp(tankMinX, tankMaxX, point[0] + clamp(-maxShift, maxShift, dx)),
        clamp(tankMinY, tankMaxY, point[1] + clamp(-maxShift, maxShift, dy)),
      ];
    });
  }

  function getMap2RefinementLateralAmount(structure, annotation) {
    const sign = {
      raise: 1,
      ridge: 0.72,
      depress: -0.72,
      "cut-back": -1,
    }[annotation.action] || 0;
    if (!sign) return 0;
    return getMap2RefinementAmount(structure, annotation) * sign;
  }

  function getMap2RefinementAxisSign(annotation, coordinate, centerCoordinate, axis) {
    const localSign = Math.sign(coordinate - centerCoordinate);
    if (localSign) return localSign;
    const average = getMap2RefinementAverageAxis(annotation, axis);
    return Math.sign(average - centerCoordinate) || 1;
  }

  function getMap2RefinementAverageAxis(annotation, axis) {
    const points = Array.isArray(annotation.points)
      ? annotation.points.map(normalizeMap2RefinementPoint).filter(Boolean)
      : [];
    if (!points.length) return 0;
    const key = axis === "y" ? "y" : "x";
    return points.reduce((total, point) => total + point[key], 0) / points.length;
  }

  function applyMap2RefinementHeight(structure, annotations, x, y, z, maxHeight = structure.height) {
    if (!annotations.length) return z;
    const minimum = structure.id === "center-shelf" ? 0.04 : 0.02;
    const adjusted = z + getMap2RefinementHeightDelta(structure, annotations, x, y, z);
    return clamp(minimum, Math.max(minimum + 0.01, maxHeight), adjusted);
  }

  function getMap2RefinementHeightDelta(structure, annotations, x, y, z) {
    return annotations.reduce((total, annotation) => {
      const influence = getMap2RefinementInfluence(annotation, x, y);
      if (influence <= 0) return total;
      const amount = getMap2RefinementAmount(structure, annotation);
      const directionalScale = getMap2RefinementVerticalScale(annotation);
      if (annotation.action === "raise" || annotation.action === "ridge") return total + amount * directionalScale * influence;
      if (annotation.action === "depress") return total - amount * directionalScale * influence;
      if (annotation.action === "cut-back") return total - amount * 0.75 * directionalScale * influence;
      if (annotation.action === "flatten" || annotation.action === "smooth") {
        const target = getMap2RefinementAverageZ(annotation);
        const blend = annotation.action === "flatten" ? 0.42 : 0.18;
        return total + (target - z) * blend * directionalScale * influence;
      }
      return total;
    }, 0);
  }

  function getMap2RefinementVerticalScale(annotation) {
    if (annotation.direction === "left-right" || annotation.direction === "front-back") return 0.22;
    if (annotation.direction === "top-bottom") return 1.12;
    return 1;
  }

  function getMap2RefinementAmount(structure, annotation) {
    const strengthAmount = {
      light: 0.32,
      medium: 0.66,
      strong: 1.08,
    }[annotation.strength] || 0.66;
    const actionScale = {
      raise: 1,
      depress: 1,
      flatten: 0.8,
      "cut-back": 0.9,
      smooth: 0.4,
      ridge: 0.72,
    }[annotation.action] || 1;
    const structureScale = structure.id === "center-shelf" ? 0.88 : 1;
    return strengthAmount * actionScale * structureScale;
  }

  function getMap2RefinementInfluence(annotation, x, y) {
    const points = Array.isArray(annotation.points)
      ? annotation.points.map(normalizeMap2RefinementPoint).filter(Boolean)
      : [];
    if (!points.length) return 0;
    const radius = Math.max(0.25, positiveNumber(annotation.radius, 0.8));
    if (annotation.shape === "area" && points.length >= 3) {
      const polygon = points.map((point) => [point.x, point.y]);
      if (pointInPolygon([x, y], polygon)) return 1;
      const distance = distanceToPolygonEdge([x, y], polygon);
      return 1 - smoothstep(0, radius * 1.15, distance);
    }
    if (annotation.shape === "line" && points.length >= 2) {
      let distance = Infinity;
      for (let index = 1; index < points.length; index += 1) {
        distance = Math.min(
          distance,
          distanceToSegment([x, y], [points[index - 1].x, points[index - 1].y], [points[index].x, points[index].y]),
        );
      }
      return Math.exp(-(distance * distance) / (2 * radius * radius));
    }
    const distance = Math.hypot(x - points[0].x, y - points[0].y);
    return Math.exp(-(distance * distance) / (2 * radius * radius));
  }

  function getMap2RefinementAverageZ(annotation) {
    const points = Array.isArray(annotation.points)
      ? annotation.points.map(normalizeMap2RefinementPoint).filter(Boolean)
      : [];
    if (!points.length) return 0;
    return points.reduce((total, point) => total + point.z, 0) / points.length;
  }

  function createMap2LidarRock(structure, index) {
    const heightMap = getLidarHeightMap(structure.map2Mesh?.key);
    if (!heightMap) return null;
    const refinementAnnotations = getMap2StructureRefinementAnnotations(structure.id);
    const footprint = getMap2RefinedFootprint(structure, getRockFootprint(structure), refinementAnnotations);
    const bounds = getPointBounds(footprint);
    const width = Math.max(0.01, bounds.maxX - bounds.minX);
    const depth = Math.max(0.01, bounds.maxY - bounds.minY);
    const maxDimension = Math.max(width, depth);
    const perimeterLength = getPerimeterLength(footprint);
    const sampleCount = Math.round(clamp(72, 180, perimeterLength / 0.15));
    const ringCount = Math.round(clamp(24, 58, maxDimension / 0.2));
    const perimeter = sampleFootprintPerimeter(footprint, sampleCount);
    const center = polygonCentroid(footprint);
    const vertices = [];
    const colors = [];
    const indices = [];
    const verticalScale = positiveNumber(structure.map2Mesh?.verticalScale, 1);
    const scaledHeight = structure.height * verticalScale;

    const pushVertex = (x, y, z, shade) => {
      const vertexIndex = vertices.length / 3;
      vertices.push(structure.x + x, structure.y + y, structure.z + z);
      colors.push(shade.r, shade.g, shade.b);
      return vertexIndex;
    };

    const mapHeightAt = (x, y, radialT) => {
      const rawU = (x - bounds.minX) / width;
      const rawV = (y - bounds.minY) / depth;
      const u = structure.map2Mesh.mirrorX ? 1 - rawU : rawU;
      const v = structure.map2Mesh.mirrorY ? 1 - rawV : rawV;
      const scanHeight = sampleLidarHeightMap(heightMap, u, v);
      const contrast = structure.id === "center-shelf" ? 1.22 : 1.34;
      const contrasted = clamp(0, 1, (scanHeight - 0.5) * contrast + 0.5);
      const floor = structure.id === "center-shelf" ? 0.2 : 0.12;
      const edgeDrop = smoothstep(0.72, 1, radialT);
      const edgeShape = lerp(1, structure.id === "center-shelf" ? 0.32 : 0.18, edgeDrop);
      const shelfLift = structure.id === "center-shelf" ? 0.1 : 0;
      const baseHeight = scaledHeight * (floor + contrasted * (1 - floor + shelfLift)) * edgeShape;
      return applyMap2RefinementHeight(structure, refinementAnnotations, x, y, baseHeight, scaledHeight);
    };

    const centerZ = mapHeightAt(center[0], center[1], 0);
    const centerIndex = pushVertex(center[0], center[1], centerZ, rockVertexColor(structure, center[0], center[1], centerZ, index));
    const rings = [];

    for (let ringIndex = 1; ringIndex <= ringCount; ringIndex += 1) {
      const radialT = ringIndex / ringCount;
      const ring = [];
      perimeter.forEach((point, pointIndex) => {
        const x = lerp(center[0], point[0], radialT);
        const y = lerp(center[1], point[1], radialT);
        const z = mapHeightAt(x, y, radialT);
        ring.push(pushVertex(x, y, z, rockVertexColor(structure, x, y, z, index + pointIndex)));
      });
      rings.push(ring);
    }

    for (let pointIndex = 0; pointIndex < sampleCount; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % sampleCount;
      indices.push(centerIndex, rings[0][pointIndex], rings[0][nextIndex]);
    }

    for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
      const innerRing = rings[ringIndex - 1];
      const outerRing = rings[ringIndex];
      for (let pointIndex = 0; pointIndex < sampleCount; pointIndex += 1) {
        const nextIndex = (pointIndex + 1) % sampleCount;
        const innerA = innerRing[pointIndex];
        const innerB = innerRing[nextIndex];
        const outerA = outerRing[pointIndex];
        const outerB = outerRing[nextIndex];
        indices.push(innerA, outerA, innerB, innerB, outerA, outerB);
      }
    }

    addMap2FootprintSkirt(structure, footprint, perimeter, rings[rings.length - 1], vertices, colors, indices);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.01,
      emissive: 0x151215,
      emissiveIntensity: 0.16,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${structure.id}-map2-lidar`;
    mesh.userData.map2StructureId = structure.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 4 + index;
    return mesh;
  }

  function addMap2RefinementAnnotations() {
    if (!map2Root) return;
    const group = new THREE.Group();
    group.name = "map2-refinement-annotations";
    group.renderOrder = 40;
    (state.map.refinementAnnotations || []).forEach((annotation) => {
      addMap2RefinementAnnotation(group, annotation, false);
    });
    if (map2RefinementDraft?.points?.length) {
      addMap2RefinementAnnotation(group, {
        ...map2RefinementDraft,
        action: getMap2RefinementAction(),
        direction: getMap2RefinementDirection(),
        strength: getMap2RefinementStrength(),
        radius: getMap2RefinementRadius(),
        note: state.ui.map2RefinementNote || "",
      }, true);
    }
    map2Root.add(group);
    syncMap2RefinementAnnotationOverlay();
  }

  function addMap2RefinementAnnotation(group, annotation, draft) {
    const points = getMap2RefinementWorldPoints(annotation);
    if (!points.length) return;
    const color = draft ? 0xf5b84b : getMap2RefinementColor(annotation.action);
    const lineMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: draft ? 0.95 : 0.88,
      depthTest: draft ? false : true,
      depthWrite: false,
    });
    const pointMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: draft ? 0.95 : 0.9,
      depthTest: draft ? false : true,
      depthWrite: false,
    });
    const haloMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: draft ? 0.12 : 0.09,
      depthTest: draft ? false : true,
      depthWrite: false,
      wireframe: true,
    });

    if (annotation.shape === "area" && points.length >= 3) {
      const fillGeometry = new THREE.BufferGeometry();
      const vertices = [];
      const indices = [];
      points.forEach((point) => vertices.push(point.x, point.y, point.z));
      for (let index = 1; index < points.length - 1; index += 1) {
        indices.push(0, index, index + 1);
      }
      fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      fillGeometry.setIndex(indices);
      fillGeometry.computeVertexNormals();
      const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: draft ? 0.18 : 0.12,
        side: THREE.DoubleSide,
        depthTest: draft ? false : true,
        depthWrite: false,
      }));
      fill.renderOrder = 41;
      tagMap2RefinementOverlayObject(fill, draft);
      group.add(fill);
    }

    if (points.length >= 2) {
      const linePoints = annotation.shape === "area" && points.length >= 3
        ? [...points, points[0]]
        : points;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints), lineMaterial);
      line.renderOrder = 42;
      tagMap2RefinementOverlayObject(line, draft);
      group.add(line);
    }

    points.forEach((point) => {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(draft ? 0.14 : 0.12, 14, 8), pointMaterial);
      marker.position.copy(point);
      marker.renderOrder = 43;
      tagMap2RefinementOverlayObject(marker, draft);
      group.add(marker);
    });

    if (annotation.shape === "point" && points[0]) {
      const halo = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.2, annotation.radius || 0.8), 18, 10), haloMaterial);
      halo.position.copy(points[0]);
      halo.renderOrder = 40;
      tagMap2RefinementOverlayObject(halo, draft);
      group.add(halo);
    }
  }

  function tagMap2RefinementOverlayObject(object, draft) {
    object.userData.map2RefinementDraft = draft;
    const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
    materials.forEach((material) => {
      material.userData.map2RefinementBaseOpacity = material.opacity;
      material.userData.map2RefinementDraft = draft;
    });
    return object;
  }

  function syncMap2RefinementAnnotationOverlay() {
    if (!map2Root) return;
    const group = map2Root.getObjectByName("map2-refinement-annotations");
    if (!group) return;
    const visible = getMap2RefinementOverlayVisible();
    const opacityScale = getMap2RefinementOverlayOpacity();
    group.traverse((child) => {
      const draft = Boolean(child.userData?.map2RefinementDraft);
      if (child !== group) child.visible = draft || visible;
      const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
      materials.forEach((material) => {
        if (!Number.isFinite(material.userData?.map2RefinementBaseOpacity)) return;
        material.opacity = material.userData.map2RefinementBaseOpacity * (draft ? 1 : opacityScale);
        material.needsUpdate = true;
      });
    });
  }

  function getMap2RefinementWorldPoints(annotation) {
    const structure = state.map.structures.find((entry) => entry.id === annotation.structureId);
    if (!structure || !Array.isArray(annotation.points)) return [];
    return annotation.points
      .map(normalizeMap2RefinementPoint)
      .filter(Boolean)
      .map((point) => new THREE.Vector3(
        structure.x + point.x,
        structure.y + point.y,
        structure.z + point.z + 0.08,
      ));
  }

  function getMap2RefinementColor(action) {
    return {
      raise: 0x39a86b,
      depress: 0x3f7edb,
      flatten: 0xe0a93f,
      "cut-back": 0xc95b5b,
      smooth: 0x26a9a0,
      ridge: 0x9a6dde,
    }[action] || 0x39a86b;
  }

  function sampleLidarHeightMap(map, u, v) {
    if (!map || !Array.isArray(map.values) || map.rows < 2 || map.columns < 2) return 0.5;
    const clampedU = clamp(0, 1, u);
    const clampedV = clamp(0, 1, v);
    const gridX = clampedU * (map.columns - 1);
    const gridY = clampedV * (map.rows - 1);
    const col = Math.floor(gridX);
    const row = Math.floor(gridY);
    const nextCol = Math.min(map.columns - 1, col + 1);
    const nextRow = Math.min(map.rows - 1, row + 1);
    const tx = gridX - col;
    const ty = gridY - row;
    const top = lerp(map.values[row][col], map.values[row][nextCol], tx);
    const bottom = lerp(map.values[nextRow][col], map.values[nextRow][nextCol], tx);
    return lerp(top, bottom, ty);
  }

  function addMap2FootprintSkirt(structure, footprint, perimeter, outerRing, vertices, colors, indices) {
    const dark = new THREE.Color(0x312a31);
    const bottom = new THREE.Color(0x29252a);
    const center = polygonCentroid(footprint);
    const baseZ = structure.id === "center-shelf" ? 0.04 : -0.08;
    const addVertex = (x, y, z, color) => {
      const vertexIndex = vertices.length / 3;
      vertices.push(structure.x + x, structure.y + y, structure.z + z);
      colors.push(color.r, color.g, color.b);
      return vertexIndex;
    };

    const bottomRing = perimeter.map((point) => addVertex(point[0], point[1], baseZ, dark));
    for (let pointIndex = 0; pointIndex < perimeter.length; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % perimeter.length;
      indices.push(outerRing[pointIndex], bottomRing[pointIndex], outerRing[nextIndex]);
      indices.push(outerRing[nextIndex], bottomRing[pointIndex], bottomRing[nextIndex]);
    }

    const bottomCenter = addVertex(center[0], center[1], baseZ, bottom);
    for (let pointIndex = 0; pointIndex < perimeter.length; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % perimeter.length;
      indices.push(bottomCenter, bottomRing[nextIndex], bottomRing[pointIndex]);
    }
  }

  function disposeThreeObject(object) {
    object.traverse?.((child) => {
      if (child.geometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose?.();
      });
    });
  }

  async function loadScanMeshAsset(asset) {
    if (!asset?.url) throw new Error("Missing scan mesh asset URL");
    if (scanMeshAssetCache.has(asset.url)) return scanMeshAssetCache.get(asset.url);
    const promise = fetch(asset.url)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load ${asset.url}`);
        return response.arrayBuffer();
      })
      .then(parseScanMeshAsset);
    scanMeshAssetCache.set(asset.url, promise);
    return promise;
  }

  function parseScanMeshAsset(buffer) {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (magic !== "RCMS") throw new Error("Unsupported scan mesh asset");
    const version = view.getUint16(4, true);
    if (version !== 1) throw new Error("Unsupported scan mesh version");
    const vertexCount = view.getUint32(8, true);
    const indexCount = view.getUint32(12, true);
    const sourceBounds = [];
    let offset = 16;
    for (let axis = 0; axis < 3; axis += 1) {
      sourceBounds.push([view.getFloat32(offset, true), view.getFloat32(offset + 4, true)]);
      offset += 8;
    }
    const positions = new Uint16Array(buffer, offset, vertexCount * 3);
    offset += vertexCount * 3 * 2;
    const normals = new Int16Array(buffer, offset, vertexCount * 3);
    offset += vertexCount * 3 * 2;
    const indices = new Uint32Array(buffer, offset, indexCount);
    return { vertexCount, indexCount, sourceBounds, positions, normals, indices };
  }

  function createScanMeshFromAsset(structure, asset, index) {
    const footprint = getRockFootprint(structure);
    const bounds = getPointBounds(footprint);
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxY - bounds.minY;
    const verticalScale = structure.scanMeshVerticalScale || 1;
    const positions = new Float32Array(asset.vertexCount * 3);
    const normals = new Float32Array(asset.vertexCount * 3);
    const colors = new Float32Array(asset.vertexCount * 3);
    const axisOrder = structure.scanMeshAxisOrder || [0, 1, 2];

    for (let vertexIndex = 0; vertexIndex < asset.vertexCount; vertexIndex += 1) {
      const sourceIndex = vertexIndex * 3;
      const rawPosition = [
        asset.positions[sourceIndex] / 65535,
        asset.positions[sourceIndex + 1] / 65535,
        asset.positions[sourceIndex + 2] / 65535,
      ];
      const rawNormal = [
        asset.normals[sourceIndex] / 32767,
        asset.normals[sourceIndex + 1] / 32767,
        asset.normals[sourceIndex + 2] / 32767,
      ];
      let scanX = rawPosition[axisOrder[0]];
      let scanY = rawPosition[axisOrder[1]];
      let scanZ = rawPosition[axisOrder[2]];
      let normalX = rawNormal[axisOrder[0]];
      let normalY = rawNormal[axisOrder[1]];
      let normalZ = rawNormal[axisOrder[2]];
      if (structure.scanMeshSwapXY) [scanX, scanY] = [scanY, scanX];
      if (structure.scanMeshSwapXY) [normalX, normalY] = [normalY, normalX];
      if (structure.scanMeshFlipX) scanX = 1 - scanX;
      if (structure.scanMeshFlipY) scanY = 1 - scanY;
      if (structure.scanMeshFlipZ) scanZ = 1 - scanZ;

      const localX = bounds.minX + scanX * width;
      const localY = bounds.minY + scanY * depth;
      const localZ = scanZ * structure.height * verticalScale;
      positions[sourceIndex] = structure.x + localX;
      positions[sourceIndex + 1] = structure.y + localY;
      positions[sourceIndex + 2] = structure.z + localZ;

      normals[sourceIndex] = normalX * (structure.scanMeshFlipX ? -1 : 1);
      normals[sourceIndex + 1] = normalY * (structure.scanMeshFlipY ? -1 : 1);
      normals[sourceIndex + 2] = normalZ * (structure.scanMeshFlipZ ? -1 : 1);

      const color = rockVertexColor(structure, localX, localY, localZ, index + vertexIndex);
      colors[sourceIndex] = color.r;
      colors[sourceIndex + 1] = color.g;
      colors[sourceIndex + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(asset.indices, 1));
    geometry.computeBoundingSphere();
    const material = createRockMeshMaterial();
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${structure.id}-scan`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function createProfileRockGeometry(structure, index, heightScale = 1, options = {}) {
    const refinementAnnotations = options.applyMap2Refinements
      ? getMap2StructureRefinementAnnotations(structure.id)
      : [];
    const footprint = options.applyMap2Refinements
      ? getMap2RefinedFootprint(structure, getRockFootprint(structure), refinementAnnotations)
      : getRockFootprint(structure);
    const bounds = getPointBounds(footprint);
    const maxDimension = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const perimeterLength = getPerimeterLength(footprint);
    const meshResolution = clamp(1, 1.8, structure.meshResolution || 1);
    const sampleCount = Math.round(clamp(56, 180, (perimeterLength / 0.16) * meshResolution));
    const ringCount = Math.round(clamp(16, 48, (maxDimension / 0.24) * meshResolution));
    const perimeter = sampleFootprintPerimeter(footprint, sampleCount);
    const center = polygonCentroid(footprint);
    const vertices = [];
    const colors = [];
    const indices = [];
    const addVertex = (x, y, z, color) => {
      const vertexIndex = vertices.length / 3;
      vertices.push(structure.x + x, structure.y + y, structure.z + z);
      colors.push(color.r, color.g, color.b);
      return vertexIndex;
    };
    const heightAt = (x, y) => {
      const baseHeight = scaleRockProfileHeight(structure, rockHeightAt(structure, footprint, x, y), heightScale);
      return applyMap2RefinementHeight(
        structure,
        refinementAnnotations,
        x,
        y,
        baseHeight,
        Math.max(baseHeight, structure.height * heightScale),
      );
    };

    const centerZ = heightAt(center[0], center[1]);
    const centerIndex = addVertex(center[0], center[1], centerZ, rockVertexColor(structure, center[0], center[1], centerZ, index));
    const rings = [];

    for (let ringIndex = 1; ringIndex <= ringCount; ringIndex += 1) {
      const t = ringIndex / ringCount;
      const ring = [];
      perimeter.forEach((point, pointIndex) => {
        const x = lerp(center[0], point[0], t);
        const y = lerp(center[1], point[1], t);
        const z = heightAt(x, y);
        ring.push(addVertex(x, y, z, rockVertexColor(structure, x, y, z, index + pointIndex)));
      });
      rings.push(ring);
    }

    for (let pointIndex = 0; pointIndex < sampleCount; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % sampleCount;
      indices.push(centerIndex, rings[0][pointIndex], rings[0][nextIndex]);
    }

    for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
      const innerRing = rings[ringIndex - 1];
      const outerRing = rings[ringIndex];
      for (let pointIndex = 0; pointIndex < sampleCount; pointIndex += 1) {
        const nextIndex = (pointIndex + 1) % sampleCount;
        const innerA = innerRing[pointIndex];
        const innerB = innerRing[nextIndex];
        const outerA = outerRing[pointIndex];
        const outerB = outerRing[nextIndex];
        indices.push(innerA, outerA, innerB, innerB, outerA, outerB);
      }
    }

    addFootprintSkirt(structure, footprint, perimeter, rings[rings.length - 1], vertices, colors, indices);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function scaleRockProfileHeight(structure, z, heightScale) {
    const baseLip = structure.id === "center-shelf" ? 0.24 : 0.04;
    return baseLip + Math.max(0, z - baseLip) * heightScale;
  }

  function createRockLobeMesh(structure, lobe, salt) {
    const mesh = new THREE.Mesh(createCraggyRockGeometry(structure, lobe, salt), createRockMeshMaterial());
    mesh.position.set(structure.x + lobe.x, structure.y + lobe.y, structure.z + lobe.z);
    mesh.rotation.set(lobe.tiltX || 0, lobe.tiltY || 0, lobe.rot || 0);
    mesh.scale.set(lobe.rx, lobe.ry, lobe.rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function createCraggyRockGeometry(structure, lobe, salt) {
    const geometry = new THREE.SphereGeometry(1, 30, 18);
    const positions = geometry.attributes.position;
    const colors = [];

    for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
      const x = positions.getX(vertexIndex);
      const y = positions.getY(vertexIndex);
      const z = positions.getZ(vertexIndex);
      const angularNoise = surfaceNoise(`${structure.id}-lobe-${salt}`, x * 2.8 + z * 0.9, y * 2.8 - z * 0.7);
      const cragNoise = surfaceNoise(`${structure.id}-crag-${salt}`, x * 7.4 + y * 1.3, z * 7.4 - y * 0.8);
      const flattenBottom = z < -0.58 ? smoothstep(-1, -0.58, z) : 1;
      const radius = 0.94 + (angularNoise - 0.5) * 0.26 + (cragNoise - 0.5) * 0.12;
      const warpedX = x * radius * (0.96 + Math.abs(z) * 0.04);
      const warpedY = y * radius * (0.96 + Math.abs(z) * 0.035);
      const warpedZ = z * radius * (0.9 + flattenBottom * 0.1);
      positions.setXYZ(vertexIndex, warpedX, warpedY, warpedZ);

      const localX = lobe.x + warpedX * lobe.rx;
      const localY = lobe.y + warpedY * lobe.ry;
      const localZ = lobe.z + warpedZ * lobe.rz;
      const color = rockVertexColor(structure, localX, localY, localZ, salt + vertexIndex);
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  function addFootprintSkirt(structure, footprint, perimeter, outerRing, vertices, colors, indices) {
    const dark = new THREE.Color(0x3e2b2d);
    const bottom = new THREE.Color(0x33262a);
    const center = polygonCentroid(footprint);
    const bounds = getPointBounds(footprint);
    const frontTaperDepth = nonNegativeNumber(structure.frontTaperDepth, 0);
    const frontSkirtLift = clamp(0, 0.96, nonNegativeNumber(structure.frontSkirtLift, frontTaperDepth ? 0.72 : 0));
    const sideSkirtLift = clamp(0, 0.96, nonNegativeNumber(structure.sideSkirtLift, frontTaperDepth ? 0.72 : 0));
    const base = structure.id === "center-shelf" ? 0 : -0.05;
    const addVertex = (x, y, z, color) => {
      const vertexIndex = vertices.length / 3;
      vertices.push(structure.x + x, structure.y + y, structure.z + z);
      colors.push(color.r, color.g, color.b);
      return vertexIndex;
    };

    const bottomRing = perimeter.map((point) => {
      const defaultBottom = base + rockBottomAt(structure, point[0]);
      let bottomZ = defaultBottom;
      if (frontTaperDepth && (frontSkirtLift || sideSkirtLift)) {
        const frontWeight = 1 - smoothstep(bounds.minY, bounds.minY + frontTaperDepth, point[1]);
        const backContactWeight = structure.touchesBackGlass ? smoothstep(bounds.maxY - 0.9, bounds.maxY, point[1]) : 0;
        const lift = Math.max(frontWeight * frontSkirtLift, sideSkirtLift * (1 - backContactWeight));
        if (lift > 0) {
          const topZ = scaleRockProfileHeight(structure, rockHeightAt(structure, footprint, point[0], point[1]), 1);
          const lip = structure.id === "center-shelf" ? 0.14 : 0.06;
          bottomZ = lerp(defaultBottom, Math.max(defaultBottom, topZ - lip), lift);
        }
      }
      return addVertex(point[0], point[1], bottomZ, dark);
    });
    for (let pointIndex = 0; pointIndex < perimeter.length; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % perimeter.length;
      indices.push(outerRing[pointIndex], bottomRing[pointIndex], outerRing[nextIndex]);
      indices.push(outerRing[nextIndex], bottomRing[pointIndex], bottomRing[nextIndex]);
    }

    const bottomCenter = addVertex(center[0], center[1], base + rockBottomAt(structure, center[0]), bottom);
    for (let pointIndex = 0; pointIndex < perimeter.length; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % perimeter.length;
      indices.push(bottomCenter, bottomRing[nextIndex], bottomRing[pointIndex]);
    }
  }

  function createRockMeshMaterial() {
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: 0x241821,
      emissiveIntensity: 0.24,
      roughness: 0.96,
      metalness: 0.01,
      flatShading: false,
    });
  }

  function getRockFootprint(structure) {
    if (Array.isArray(structure.footprint) && structure.footprint.length >= 3) {
      return structure.touchesBackGlass ? lockFootprintToBackGlass(structure, structure.footprint) : structure.footprint;
    }
    const points = [];
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      points.push([
        Math.cos(angle) * structure.width * 0.5,
        Math.sin(angle) * structure.depth * 0.5,
      ]);
    }
    return structure.touchesBackGlass ? lockFootprintToBackGlass(structure, points) : points;
  }

  function lockFootprintToBackGlass(structure, footprint) {
    const dimensions = state?.map?.dimensions || { depth: 12 };
    const targetMaxY = dimensions.depth / 2 - structure.y;
    const bounds = getPointBounds(footprint);
    const delta = targetMaxY - bounds.maxY;
    if (Math.abs(delta) < 0.01) return footprint;

    return footprint.map(([x, y]) => {
      const rearWeight = smoothstep(bounds.minY, bounds.maxY, y);
      return [x, y + delta * rearWeight];
    });
  }

  function rockHeightAt(structure, footprint, x, y) {
    if (Array.isArray(structure.frontProfile) && structure.frontProfile.length >= 2) {
      const frontLimit = profileValueAt(structure.frontProfile, x, structure.height);
      const sideLimit = Array.isArray(structure.sideProfile) && structure.sideProfile.length >= 2
        ? profileValueAt(structure.sideProfile, y, structure.height)
        : structure.height;
      const bottom = rockBottomAt(structure, x);
      const sideConstraint = Math.min(frontLimit, Math.max(sideLimit, frontLimit * 0.78));
      const silhouetteLimit = Math.min(structure.height, Math.max(0.16, sideConstraint + bottom));
      const edgeDistance = distanceToPolygonEdge([x, y], footprint);
      const edgeTaper = smoothstep(0, structure.edgeSoftness || 0.65, edgeDistance);
      const edgeFloor = clamp(0.12, 0.99, structure.edgeFloor || 0.32);
      const footprintBounds = getPointBounds(footprint);
      const frontTaperDepth = nonNegativeNumber(structure.frontTaperDepth, 0);
      const frontTaper = frontTaperDepth
        ? smoothstep(footprintBounds.minY, footprintBounds.minY + frontTaperDepth, y)
        : 1;
      const frontShape = clamp(0.18, 1, structure.frontFloor || 1) + (1 - clamp(0.18, 1, structure.frontFloor || 1)) * frontTaper;
      let relief =
        0.98 +
        (surfaceNoise(`${structure.id}-profile`, x * 0.72, y * 0.72) - 0.5) * 0.08 +
        (surfaceNoise(`${structure.id}-fine-profile`, x * 2.3, y * 2.3) - 0.5) * (structure.surfaceNoise || 0.04) * 0.45 +
        (surfaceNoise(`${structure.id}-scan-crag`, x * 5.2 + y * 0.35, y * 5.2 - x * 0.3) - 0.5) * (structure.cragStrength || 0);

      structure.heightPoints.forEach((point) => {
        const distance = Math.hypot(x - point.x, y - point.y);
        relief += (point.h / Math.max(1, structure.height)) * Math.exp(-(distance * distance) / (2 * point.r * point.r));
      });

      structure.ridges.forEach((ridge) => {
        const distance = distanceToSegment([x, y], ridge.from, ridge.to);
        relief += (ridge.h / Math.max(1, structure.height)) * Math.exp(-(distance * distance) / (2 * ridge.r * ridge.r));
      });

      structure.depressions.forEach((point) => {
        const distance = Math.hypot(x - point.x, y - point.y);
        relief -= (point.h / Math.max(1, structure.height)) * Math.exp(-(distance * distance) / (2 * point.r * point.r));
      });

      structure.troughs.forEach((trough) => {
        const distance = distanceToSegment([x, y], trough.from, trough.to);
        relief -= (trough.h / Math.max(1, structure.height)) * Math.exp(-(distance * distance) / (2 * trough.r * trough.r));
      });

      const rockFloor = Math.max(structure.id === "center-shelf" ? 0.2 : 0.06, bottom + 0.04);
      const edgeShape = edgeFloor + (1 - edgeFloor) * edgeTaper;
      const proceduralHeight = silhouetteLimit * clamp(structure.reliefMin || 0.9, structure.reliefMax || 1.06, relief) * edgeShape * frontShape;
      let shapedHeight = proceduralHeight;
      const scanHeight = scanHeightAt(structure, footprintBounds, x, y);
      if (Number.isFinite(scanHeight)) {
        const directedScanHeight = structure.scanHeightInvert ? 1 - scanHeight : scanHeight;
        const scanContrast = Math.max(0.1, structure.scanHeightContrast || 1);
        const contrastedScanHeight = clamp(0, 1, (directedScanHeight - 0.5) * scanContrast + 0.5);
        const scanFloor = clamp(0.02, 0.92, structure.scanHeightFloor || 0.12);
        const scanCeiling = Math.max(scanFloor + 0.02, structure.scanHeightCeiling || 1);
        const scanTarget =
          structure.height *
          (scanFloor + contrastedScanHeight * (scanCeiling - scanFloor)) *
          edgeShape *
          frontShape;
        shapedHeight = lerp(proceduralHeight, Math.min(silhouetteLimit, Math.max(rockFloor, scanTarget)), clamp(0, 1, structure.scanHeightStrength || 0));
      }
      if (structure.terraceStrength) {
        const bands = Math.max(2, Math.round(structure.terraceBands || 6));
        const normalizedHeight = clamp(0, 1, shapedHeight / Math.max(0.01, structure.height));
        const steppedHeight = (Math.round(normalizedHeight * bands) / bands) * structure.height;
        shapedHeight = lerp(shapedHeight, steppedHeight, clamp(0, 0.92, structure.terraceStrength) * edgeTaper);
      }
      const frontCap = frontTaperDepth
        ? lerp(rockFloor + structure.height * 0.04, structure.height, frontTaper)
        : structure.height;
      return clamp(rockFloor, structure.height, Math.min(shapedHeight, frontCap));
    }

    const edgeDistance = distanceToPolygonEdge([x, y], footprint);
    const edgeTaper = smoothstep(0, structure.edgeSoftness || 0.65, edgeDistance);
    const baseLip = structure.id === "center-shelf" ? 0.32 : 0.06;
    let height = structure.height * 0.08;

    structure.heightPoints.forEach((point) => {
      const distance = Math.hypot(x - point.x, y - point.y);
      height += point.h * Math.exp(-(distance * distance) / (2 * point.r * point.r));
    });

    structure.ridges.forEach((ridge) => {
      const distance = distanceToSegment([x, y], ridge.from, ridge.to);
      height += ridge.h * Math.exp(-(distance * distance) / (2 * ridge.r * ridge.r));
    });

    structure.depressions.forEach((point) => {
      const distance = Math.hypot(x - point.x, y - point.y);
      height -= point.h * Math.exp(-(distance * distance) / (2 * point.r * point.r));
    });

    structure.troughs.forEach((trough) => {
      const distance = distanceToSegment([x, y], trough.from, trough.to);
      height -= trough.h * Math.exp(-(distance * distance) / (2 * trough.r * trough.r));
    });

    const roughness = (surfaceNoise(structure.id, x, y) - 0.5) * 2 * (structure.surfaceNoise || 0.14) * structure.height;
    const shapedHeight = Math.max(0, height + roughness);
    return clamp(baseLip, structure.height, baseLip + shapedHeight * (0.18 + edgeTaper * 0.82));
  }

  function scanHeightAt(structure, bounds, x, y) {
    const map = structure.scanHeightMap;
    if (!map || !Array.isArray(map.values) || map.rows < 2 || map.columns < 2) return null;
    const u = (x - bounds.minX) / ((bounds.maxX - bounds.minX) || 1e-6);
    const v = (y - bounds.minY) / ((bounds.maxY - bounds.minY) || 1e-6);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const gridX = u * (map.columns - 1);
    const gridY = v * (map.rows - 1);
    const col = Math.floor(gridX);
    const row = Math.floor(gridY);
    const nextCol = Math.min(map.columns - 1, col + 1);
    const nextRow = Math.min(map.rows - 1, row + 1);
    const tx = gridX - col;
    const ty = gridY - row;
    const top = lerp(map.values[row][col], map.values[row][nextCol], tx);
    const bottom = lerp(map.values[nextRow][col], map.values[nextRow][nextCol], tx);
    return lerp(top, bottom, ty);
  }

  function profileValueAt(points, coordinate, fallback) {
    if (!Array.isArray(points) || points.length < 2) return fallback;
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    if (coordinate <= sorted[0][0]) return sorted[0][1];
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (coordinate <= current[0]) {
        const t = (coordinate - previous[0]) / ((current[0] - previous[0]) || 1e-6);
        return lerp(previous[1], current[1], smoothstep(0, 1, t));
      }
    }
    return sorted[sorted.length - 1][1];
  }

  function rockBottomAt(structure, x) {
    return Array.isArray(structure.bottomProfile) && structure.bottomProfile.length >= 2
      ? profileValueAt(structure.bottomProfile, x, 0)
      : 0;
  }

  function rockVertexColor(structure, x, y, z, salt) {
    const purple = new THREE.Color(0x6a3150);
    const darkPurple = new THREE.Color(0x342833);
    const olive = new THREE.Color(0x40533f);
    const tan = new THREE.Color(0x5a4d3a);
    const n = surfaceNoise(`${structure.id}-color`, x * 0.82, y * 0.82);
    const speckle = surfaceNoise(`${structure.id}-speckle`, x * 3.4 + salt * 0.001, y * 3.4);
    const heightBlend = clamp(0, 1, z / Math.max(0.01, structure.height));
    const color = purple.clone().lerp(darkPurple, 0.22 + (1 - heightBlend) * 0.18);
    if (n > 0.67) color.lerp(olive, 0.28);
    if (n < 0.18) color.lerp(tan, 0.18);
    if (speckle > 0.76) color.lerp(new THREE.Color(0x8b6f5d), 0.12);
    if (structure.id === "center-shelf") color.lerp(new THREE.Color(0x813f63), 0.08);
    return color;
  }

  function getPointBounds(points) {
    return points.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point[0]),
      maxX: Math.max(bounds.maxX, point[0]),
      minY: Math.min(bounds.minY, point[1]),
      maxY: Math.max(bounds.maxY, point[1]),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  }

  function getPerimeterLength(points) {
    return points.reduce((total, point, index) => total + distance2d(point, points[(index + 1) % points.length]), 0);
  }

  function sampleFootprintPerimeter(points, sampleCount) {
    const perimeterLength = getPerimeterLength(points);
    const samples = [];
    let edgeIndex = 0;
    let edgeStartLength = 0;
    let edgeLength = distance2d(points[0], points[1]);

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const targetLength = (sampleIndex / sampleCount) * perimeterLength;
      while (targetLength > edgeStartLength + edgeLength && edgeIndex < points.length - 1) {
        edgeStartLength += edgeLength;
        edgeIndex += 1;
        edgeLength = distance2d(points[edgeIndex], points[(edgeIndex + 1) % points.length]);
      }
      const start = points[edgeIndex];
      const end = points[(edgeIndex + 1) % points.length];
      const t = clamp(0, 1, (targetLength - edgeStartLength) / (edgeLength || 1e-6));
      samples.push([lerp(start[0], end[0], t), lerp(start[1], end[1], t)]);
    }

    return samples;
  }

  function polygonCentroid(points) {
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const cross = point[0] * next[1] - next[0] * point[1];
      twiceArea += cross;
      x += (point[0] + next[0]) * cross;
      y += (point[1] + next[1]) * cross;
    });

    if (Math.abs(twiceArea) < 1e-6) {
      return points.reduce((total, point) => [total[0] + point[0] / points.length, total[1] + point[1] / points.length], [0, 0]);
    }

    return [x / (3 * twiceArea), y / (3 * twiceArea)];
  }

  function pointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-6) + xi;
      if (intersects) inside = !inside;
    }
    return inside || distanceToPolygonEdge(point, polygon) < 0.08;
  }

  function distanceToPolygonEdge(point, polygon) {
    let minDistance = Infinity;
    polygon.forEach((start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      minDistance = Math.min(minDistance, distanceToSegment(point, start, end));
    });
    return minDistance;
  }

  function getClosestPointOnPolygonEdge(point, polygon) {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    return polygon.reduce((best, start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      const candidate = closestPointOnSegment(point, start, end);
      return !best || candidate.distance < best.distance ? candidate : best;
    }, null);
  }

  function distanceToSegment(point, start, end) {
    const vx = end[0] - start[0];
    const vy = end[1] - start[1];
    const wx = point[0] - start[0];
    const wy = point[1] - start[1];
    const lengthSq = vx * vx + vy * vy || 1e-6;
    const t = clamp(0, 1, (wx * vx + wy * vy) / lengthSq);
    return Math.hypot(point[0] - (start[0] + t * vx), point[1] - (start[1] + t * vy));
  }

  function closestPointOnSegment(point, start, end) {
    const vx = end[0] - start[0];
    const vy = end[1] - start[1];
    const wx = point[0] - start[0];
    const wy = point[1] - start[1];
    const lengthSq = vx * vx + vy * vy || 1e-6;
    const t = clamp(0, 1, (wx * vx + wy * vy) / lengthSq);
    const closest = [start[0] + t * vx, start[1] + t * vy];
    return {
      point: closest,
      distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]),
    };
  }

  function distance2d(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  function surfaceNoise(seed, x, y) {
    const offset = (hashString(seed) % 10000) / 1000;
    const value =
      Math.sin(x * 1.73 + y * 0.91 + offset) * 0.48 +
      Math.sin(x * 4.11 - y * 2.07 + offset * 1.7) * 0.32 +
      Math.sin(x * 7.31 + y * 5.13 + offset * 0.6) * 0.2;
    return value * 0.5 + 0.5;
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp(0, 1, (value - edge0) / ((edge1 - edge0) || 1e-6));
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(min, max, value) {
    return Math.max(min, Math.min(max, value));
  }

  function addMap2ParMarkers() {
    (state.map.parMarkers || []).forEach((marker) => {
      const anchor = getMap2MarkerAnchor(marker);
      const value = Number(marker.value);
      const color = Number.isFinite(value) && value >= 180 ? 0xf2c94c : Number.isFinite(value) && value >= 90 ? 0x4dbb7b : 0x4d9de0;
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 18, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.35 }),
      );
      pin.position.copy(anchor);
      pin.castShadow = true;
      map2Root.add(pin);
      map2Root.add(createMapLabel(String(marker.value || "?"), anchor.clone().add(new THREE.Vector3(0, 0, 0.72)), "#36514f"));
    });
  }

  function addMap2LivestockMarkers() {
    getLivestockMapPlacements().forEach((placement, index) => {
      if (!placement.anchor) return;
      const anchor = getMap2MarkerAnchor(placement.anchor);
      const color = livestockColor(placement.category);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 18, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.4 }),
      );
      marker.position.copy(anchor);
      marker.castShadow = true;
      map2Root.add(marker);
      if (index < 18) {
        map2Root.add(createMapLabel(placement.species, anchor.clone().add(new THREE.Vector3(0, 0, 0.85)), "#405856"));
      }
    });
  }

  function getLivestockMapPlacements() {
    return state.livestock
      .filter((item) => isCasualStockCategory(item.category) || item.status === "active")
      .map((item, index) => {
        const zone = state.zones.find((entry) => entry.id === item.zoneId);
        const manualPosition = normalizeMapPosition(item.mapPosition);
        const manualSurface = manualPosition ? getMapSurfaceAt(manualPosition.x, manualPosition.y) : null;
        const structure = manualSurface?.structure || getStructureForZone(zone, item, index);
        return {
          id: item.id,
          species: item.species || item.name || "Unknown",
          category: item.category || "Other",
          zone: zone?.name || "",
          health: item.health || "",
          growth: item.growthMetric || item.growthTrend || "",
          structure,
          manual: Boolean(manualPosition),
          anchor: manualPosition ? getMarkerAnchor(manualPosition) : structure ? getPlacementAnchor(structure, item.id || `${index}`) : null,
        };
      });
  }

  function getStructureForZone(zone, item, index) {
    if (!zone) return null;
    const name = `${zone.name || ""} ${item.species || ""}`.toLowerCase();
    if (name.includes("front") && name.includes("left")) return findMapStructure("front-left-rock");
    if (name.includes("front") && name.includes("right")) return findMapStructure("front-right-rock");
    if (name.includes("left")) return findMapStructure("left-rock");
    if (name.includes("right")) return findMapStructure("right-rock");
    if (name.includes("sand") || name.includes("low")) return findMapStructure("front-left-rock") || findMapStructure("front-right-rock");
    if (name.includes("top") || name.includes("shelf") || zone.light === "High") return findMapStructure("center-shelf");
    if (name.includes("mid") || zone.light === "Medium") return findMapStructure("center-shelf") || findMapStructure("left-rock");
    return state.map.structures[index % state.map.structures.length] || null;
  }

  function findMapStructure(id) {
    return state.map.structures.find((structure) => structure.id === id);
  }

  function getPlacementAnchor(structure, seed) {
    if (!window.THREE) return null;
    const random = seededRandom(`placement-${seed}`);
    const footprint = getRockFootprint(structure);
    const bounds = getPointBounds(footprint);
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      x = lerp(bounds.minX, bounds.maxX, random());
      y = lerp(bounds.minY, bounds.maxY, random());
      if (pointInPolygon([x, y], footprint)) break;
    }
    const z = rockHeightAt(structure, footprint, x, y) + 0.22;
    return new THREE.Vector3(structure.x + x, structure.y + y, structure.z + z);
  }

  function getMarkerAnchor(point) {
    const surface = getMapSurfaceAt(point.x, point.y);
    const z = Number.isFinite(Number(point.z)) ? Number(point.z) : surface.z;
    return new THREE.Vector3(point.x, point.y, Math.max(z, surface.z) + 0.24);
  }

  function getMap2MarkerAnchor(point) {
    if (!point) return null;
    const surface = getMap2SurfaceAt(point.x, point.y);
    if (!surface) return getMarkerAnchor(point);
    const z = Number.isFinite(Number(point.z)) ? Number(point.z) : surface.z;
    return new THREE.Vector3(point.x, point.y, Math.max(z, surface.z) + 0.24);
  }

  function getMapSurfaceAt(x, y) {
    const map2Surface = getMap2SurfaceAt(x, y);
    if (map2Surface) return map2Surface;
    const dimensions = state.map.dimensions;
    let best = {
      z: dimensions.sandDepth + 0.08,
      structure: null,
    };
    state.map.structures.forEach((structure) => {
      const footprint = getRockFootprint(structure);
      const localX = x - structure.x;
      const localY = y - structure.y;
      if (!pointInPolygon([localX, localY], footprint)) return;
      const z = structure.z + rockHeightAt(structure, footprint, localX, localY);
      if (z > best.z) {
        best = { z, structure };
      }
    });
    return best;
  }

  function getMap2SurfaceAt(x, y) {
    if (!map2Root || !window.THREE) return null;
    const dimensions = state.map.dimensions;
    if (x < -dimensions.width / 2 || x > dimensions.width / 2 || y < -dimensions.depth / 2 || y > dimensions.depth / 2) {
      return null;
    }
    const meshes = getMap2SurfaceMeshes();
    if (!meshes.length) return null;
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, y, dimensions.height + 12),
      new THREE.Vector3(0, 0, -1),
      0,
      dimensions.height + 24,
    );
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const structureId = hit.object.userData?.map2StructureId || "";
    return {
      z: hit.point.z,
      structure: structureId ? state.map.structures.find((structure) => structure.id === structureId) || null : null,
    };
  }

  function getMap2SurfaceMeshes() {
    const meshes = [];
    if (!map2Root) return meshes;
    map2Root.traverse((child) => {
      if (child.isMesh && (child.userData?.map2StructureId || child.userData?.map2Surface === "sand")) {
        meshes.push(child);
      }
    });
    return meshes;
  }

  function createMapLabel(text, position, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255, 255, 255, 0.86)";
    roundRect(context, 12, 22, 488, 84, 18);
    context.fill();
    context.strokeStyle = "rgba(167, 200, 191, 0.95)";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = color;
    context.font = "700 34px Manrope, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(shortenLabel(text), canvas.width / 2, canvas.height / 2 + 3, 452);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.position.copy(position);
    sprite.scale.set(4.4, 1.1, 1);
    return sprite;
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  function shortenLabel(value) {
    const text = String(value || "");
    return text.length > 26 ? `${text.slice(0, 23)}...` : text;
  }

  function livestockColor(category) {
    if (category === "Coral") return 0xe079a0;
    if (category === "Fish") return 0x4098d7;
    if (category === "Invert" || category === "Cleanup crew") return 0xe0ad3b;
    if (category === "Noticed pest") return 0xc2413a;
    if (category === "Microfauna") return 0x2f855a;
    return 0x6d7d87;
  }

  function updateMap2Camera() {
    if (!map2Camera) return;
    const target = getMap2CameraTarget();
    const pitch = Math.max(-1.2, Math.min(1.54, map2ViewState.pitch));
    const distance = constrainMap2Distance(map2ViewState.distance);
    const horizontal = Math.cos(pitch) * distance;
    map2Camera.up.set(0, pitch > 1.45 ? 1 : 0, pitch > 1.45 ? 0 : 1);
    map2Camera.position.set(
      target.x + Math.sin(map2ViewState.yaw) * horizontal,
      target.y - Math.cos(map2ViewState.yaw) * horizontal,
      target.z + Math.sin(pitch) * distance,
    );
    map2Camera.lookAt(target);
  }

  function getMap2CameraTarget() {
    const target = getMap2CameraBaseTarget();
    const offset = getMap2TargetOffsetVector();
    return target.add(offset);
  }

  function getMap2CameraBaseTarget() {
    const dimensions = state.map.dimensions;
    const structure = getMap2FocusedStructure();
    if (!structure) return new THREE.Vector3(0, 0, dimensions.height * 0.46);
    return new THREE.Vector3(structure.x, structure.y, structure.z + structure.height * 0.5);
  }

  function getMap2FocusedStructure() {
    const focusId = state.ui.map2FocusStructureId || "tank";
    if (focusId === "tank") return null;
    return state.map.structures.find((structure) => structure.id === focusId) || null;
  }

  function getMap2FocusFrameSize() {
    const dimensions = state.map.dimensions;
    const structure = getMap2FocusedStructure();
    if (!structure) return Math.max(dimensions.width, dimensions.depth, dimensions.height);
    return Math.max(structure.width, structure.depth, structure.height * 1.6);
  }

  function getMap2PresetDistance(view) {
    const structure = getMap2FocusedStructure();
    const frame = getMap2FocusFrameSize();
    if (!structure) {
      if (view === "top") return frame * 1.28;
      return view === "front" ? frame * 1.5 : frame * 1.42;
    }
    const multiplier = view === "top" ? 2.15 : 2.35;
    return Math.max(9, frame * multiplier);
  }

  function constrainMap2Distance(distance) {
    const minimum = getMap2FocusedStructure() ? 7 : 18;
    return Math.max(minimum, Math.min(95, distance));
  }

  function applyMap2ViewPreset(view) {
    const normalizedView = ["front", "left", "right", "top"].includes(view) ? view : "front";
    resetMap2TargetOffset();
    if (normalizedView === "front") {
      map2ViewState.yaw = 0;
      map2ViewState.pitch = 0;
    } else if (normalizedView === "left") {
      map2ViewState.yaw = -Math.PI / 2;
      map2ViewState.pitch = 0;
    } else if (normalizedView === "right") {
      map2ViewState.yaw = Math.PI / 2;
      map2ViewState.pitch = 0;
    } else if (normalizedView === "top") {
      map2ViewState.yaw = 0;
      map2ViewState.pitch = 1.53;
    }
    map2ViewState.distance = constrainMap2Distance(getMap2PresetDistance(normalizedView));
    appliedMap2ViewPreset = normalizedView;
    return normalizedView;
  }

  function setMap2ViewPreset(view) {
    applyMap2ViewPreset(view);
    renderMap2Settings();
    renderReefMap2();
  }

  function resetMap2Camera() {
    const resetView = ["front", "left", "right", "top"].includes(appliedMap2ViewPreset)
      ? appliedMap2ViewPreset
      : "front";
    applyMap2ViewPreset(resetView);
    renderMap2Settings();
    renderReefMap2();
  }

  function resetMap2TargetOffset() {
    map2ViewState.targetOffsetX = 0;
    map2ViewState.targetOffsetY = 0;
    map2ViewState.targetOffsetZ = 0;
  }

  function getMap2TargetOffsetVector() {
    return new THREE.Vector3(
      finiteNumber(map2ViewState.targetOffsetX, 0),
      finiteNumber(map2ViewState.targetOffsetY, 0),
      finiteNumber(map2ViewState.targetOffsetZ, 0),
    );
  }

  function setMap2TargetOffsetVector(offset) {
    const frame = getMap2FocusFrameSize();
    const maximumOffset = getMap2FocusedStructure() ? frame * 1.15 : frame * 0.55;
    if (offset.length() > maximumOffset) offset.setLength(maximumOffset);
    map2ViewState.targetOffsetX = offset.x;
    map2ViewState.targetOffsetY = offset.y;
    map2ViewState.targetOffsetZ = offset.z;
  }

  function panMap2Camera(dx, dy) {
    if (!map2Camera || !map2Renderer || !window.THREE) return;
    const rect = map2Renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    map2Camera.updateMatrixWorld();
    const distance = constrainMap2Distance(map2ViewState.distance);
    const visibleHeight = 2 * Math.tan((map2Camera.fov * Math.PI / 180) / 2) * distance;
    const visibleWidth = visibleHeight * map2Camera.aspect;
    const right = new THREE.Vector3().setFromMatrixColumn(map2Camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(map2Camera.matrixWorld, 1);
    const offset = getMap2TargetOffsetVector()
      .add(right.multiplyScalar(-(dx / rect.width) * visibleWidth))
      .add(up.multiplyScalar((dy / rect.height) * visibleHeight));
    setMap2TargetOffsetVector(offset);
  }

  function getMapPointerGap(pointers) {
    const points = Array.from(pointers.values());
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function bindMap2PointerEvents(stage) {
    stage.addEventListener("pointerdown", (event) => {
      stage.setPointerCapture(event.pointerId);
      const markerTool = getMapTool();
      const refinementShape = getMap2RefinementShape();
      if (markerTool !== "navigate" || refinementShape !== "navigate") {
        event.preventDefault();
        map2PointerState = {
          id: event.pointerId,
          annotation: markerTool === "navigate",
          placement: markerTool !== "navigate",
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          pointers: new Map([[event.pointerId, { x: event.clientX, y: event.clientY }]]),
        };
        return;
      }
      if (!map2PointerState) {
        map2PointerState = {
          id: event.pointerId,
          mode: getMap2NavTool(),
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          pointers: new Map(),
          pinchStartGap: 0,
          pinchStartDistance: map2ViewState.distance,
        };
      }
      map2PointerState.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (map2PointerState.pointers.size === 2) {
        map2PointerState.pinchStartGap = getMapPointerGap(map2PointerState.pointers);
        map2PointerState.pinchStartDistance = map2ViewState.distance;
      }
    });
    stage.addEventListener("pointermove", (event) => {
      if (!map2PointerState || !map2PointerState.pointers.has(event.pointerId)) return;
      if (map2PointerState.annotation || map2PointerState.placement) {
        map2PointerState.x = event.clientX;
        map2PointerState.y = event.clientY;
        map2PointerState.pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }
      map2PointerState.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (map2PointerState.pointers.size >= 2) {
        const gap = getMapPointerGap(map2PointerState.pointers);
        if (gap > 0 && map2PointerState.pinchStartGap > 0) {
          map2ViewState.distance = map2PointerState.pinchStartDistance * (map2PointerState.pinchStartGap / gap);
          map2ViewState.distance = constrainMap2Distance(map2ViewState.distance);
        }
        return;
      }
      const dx = event.clientX - map2PointerState.x;
      const dy = event.clientY - map2PointerState.y;
      map2PointerState.x = event.clientX;
      map2PointerState.y = event.clientY;
      if (map2PointerState.mode === "pan") {
        panMap2Camera(dx, dy);
      } else {
        map2ViewState.yaw -= dx * 0.008;
        map2ViewState.pitch += dy * 0.006;
        map2ViewState.pitch = Math.max(-0.75, Math.min(1.54, map2ViewState.pitch));
        appliedMap2ViewPreset = "custom";
      }
      renderMap2Settings();
    });
    stage.addEventListener("pointerup", (event) => {
      if ((map2PointerState?.annotation || map2PointerState?.placement) && map2PointerState.pointers.has(event.pointerId)) {
        const moved = Math.hypot(event.clientX - map2PointerState.startX, event.clientY - map2PointerState.startY);
        if (moved <= 14) {
          if (map2PointerState.placement) {
            handleMapPlacementPointer(event);
          } else {
            handleMap2RefinementPointer(event);
          }
        }
      }
      releaseMap2Pointer(event.pointerId);
    });
    stage.addEventListener("pointercancel", (event) => {
      releaseMap2Pointer(event.pointerId);
    });
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      map2ViewState.distance += event.deltaY * 0.025;
      map2ViewState.distance = constrainMap2Distance(map2ViewState.distance);
    }, { passive: false });
  }

  function releaseMap2Pointer(pointerId) {
    if (!map2PointerState) return;
    map2PointerState.pointers.delete(pointerId);
    if (!map2PointerState.pointers.size) {
      map2PointerState = null;
      return;
    }
    const [nextPointerId, nextPointer] = map2PointerState.pointers.entries().next().value;
    map2PointerState.id = nextPointerId;
    map2PointerState.mode = getMap2NavTool();
    map2PointerState.startX = nextPointer.x;
    map2PointerState.startY = nextPointer.y;
    map2PointerState.x = nextPointer.x;
    map2PointerState.y = nextPointer.y;
    if (map2PointerState.pointers.size === 2) {
      map2PointerState.pinchStartGap = getMapPointerGap(map2PointerState.pointers);
      map2PointerState.pinchStartDistance = map2ViewState.distance;
    }
  }

  function handleMap2RefinementPointer(event) {
    const shape = getMap2RefinementShape();
    if (shape === "navigate") return;
    const hit = getMap2RefinementHit(event);
    if (!hit) {
      showToast("Missed rock surface.");
      return;
    }
    if (shape === "point") {
      createMap2RefinementAnnotation("point", hit.structure, [hit.point]);
      return;
    }

    if (!map2RefinementDraft || map2RefinementDraft.shape !== shape || map2RefinementDraft.structureId !== hit.structure.id) {
      map2RefinementDraft = {
        shape,
        structureId: hit.structure.id,
        structureName: hit.structure.name,
        points: [],
      };
    }
    map2RefinementDraft.points.push(hit.point);

    if (shape === "line" && map2RefinementDraft.points.length >= 2) {
      const points = map2RefinementDraft.points.slice(0, 2);
      map2RefinementDraft = null;
      createMap2RefinementAnnotation("line", hit.structure, points);
      return;
    }

    renderMap2RefinementControls();
    renderReefMap2({ rebuild: true });
  }

  function getMap2RefinementHit(event) {
    if (!map2Renderer || !map2Camera || !map2Root || !window.THREE) return null;
    const rect = map2Renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, map2Camera);
    const meshes = [];
    map2Root.traverse((child) => {
      if (child.isMesh && child.userData?.map2StructureId) meshes.push(child);
    });
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return getMap2BottomTraceRefinementHit(raycaster);
    const hit = hits[0];
    const structureId = hit.object.userData.map2StructureId;
    const structure = state.map.structures.find((entry) => entry.id === structureId);
    if (!structure) return null;
    return {
      structure,
      point: {
        x: hit.point.x - structure.x,
        y: hit.point.y - structure.y,
        z: hit.point.z - structure.z,
      },
    };
  }

  function getMap2BottomTraceRefinementHit(raycaster) {
    const direction = getMap2RefinementDirection();
    if (direction !== "left-right" && direction !== "front-back") return null;
    const dimensions = state.map.dimensions;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -dimensions.sandDepth);
    const worldPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, worldPoint)) return null;
    if (
      worldPoint.x < -dimensions.width / 2 ||
      worldPoint.x > dimensions.width / 2 ||
      worldPoint.y < -dimensions.depth / 2 ||
      worldPoint.y > dimensions.depth / 2
    ) {
      return null;
    }

    const tolerance = Math.max(0.42, getMap2RefinementRadius() * 1.6);
    let best = null;
    getMap2Structures().forEach((structure) => {
      const annotations = getMap2StructureRefinementAnnotations(structure.id);
      const footprint = getMap2RefinedFootprint(structure, getRockFootprint(structure), annotations);
      const localPoint = [worldPoint.x - structure.x, worldPoint.y - structure.y];
      const edge = getClosestPointOnPolygonEdge(localPoint, footprint);
      if (!edge || edge.distance > tolerance || (best && edge.distance >= best.distance)) return;
      best = {
        distance: edge.distance,
        structure,
        point: {
          x: edge.point[0],
          y: edge.point[1],
          z: structure.id === "center-shelf" ? 0.08 : 0.02,
        },
      };
    });
    return best ? { structure: best.structure, point: best.point } : null;
  }

  function createMap2RefinementAnnotation(shape, structure, points) {
    const annotation = {
      id: uid(),
      createdAt: new Date().toISOString(),
      structureId: structure.id,
      structureName: structure.name,
      shape,
      action: getMap2RefinementAction(),
      direction: getMap2RefinementDirection(),
      strength: getMap2RefinementStrength(),
      radius: getMap2RefinementRadius(),
      note: state.ui.map2RefinementNote || "",
      points: points.map((point) => ({
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
        z: Number(point.z.toFixed(3)),
      })),
    };
    state.map.refinementAnnotations = [
      ...(state.map.refinementAnnotations || []),
      annotation,
    ];
    saveState();
    renderMap2RefinementControls();
    renderReefMap2({ rebuild: true });
    renderInsightsContext();
    showToast("Geometry note added.");
  }

  function finishMap2RefinementArea() {
    if (!map2RefinementDraft || map2RefinementDraft.shape !== "area" || map2RefinementDraft.points.length < 3) return;
    const structure = state.map.structures.find((entry) => entry.id === map2RefinementDraft.structureId);
    if (!structure) return;
    const points = map2RefinementDraft.points.slice();
    map2RefinementDraft = null;
    createMap2RefinementAnnotation("area", structure, points);
  }

  function cancelMap2RefinementDraft() {
    map2RefinementDraft = null;
    renderMap2RefinementControls();
    renderReefMap2({ rebuild: true });
  }

  function handleMapPlacementPointer(event) {
    const tool = getMapTool();
    if (tool === "navigate") return;
    if (appliedMap2ViewPreset !== "top") {
      setMap2ViewPreset("top");
      showToast("Top view selected.");
      return;
    }
    const coordinate = getMap2CoordinateFromPointer(event);
    if (!coordinate) {
      showToast("Marker missed the tank.");
      return;
    }
    if (tool === "par") {
      const value = $("mapParValue").value.trim();
      if (!value) {
        showToast("Enter a PAR value.");
        return;
      }
      state.map.parMarkers.push({
        id: uid(),
        ...coordinate,
        value,
        note: $("mapMarkerNote").value.trim(),
        measuredAt: new Date().toISOString(),
      });
      state.map.layers.par = true;
      $("mapParValue").value = "";
      $("mapMarkerNote").value = "";
      showToast("PAR marker placed.");
    } else if (tool === "stock") {
      const id = $("mapStockSelect").value || state.ui.selectedMapStockId;
      const item = state.livestock.find((entry) => entry.id === id);
      if (!item) {
        showToast("Choose stock first.");
        return;
      }
      item.mapPosition = {
        ...coordinate,
        placedAt: new Date().toISOString(),
      };
      state.map.layers.livestock = true;
      state.ui.selectedMapStockId = id;
      $("mapMarkerNote").value = "";
      showToast("Stock marker placed.");
    }
    saveState();
    renderMapMarkerControls();
    renderMapSummaries();
    renderMap2Settings();
    renderReefMap2({ rebuild: true });
    renderInsightsContext();
  }

  function getMap2CoordinateFromPointer(event) {
    if (!map2Camera || !map2Renderer || !window.THREE) return null;
    const canvas = map2Renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, map2Camera);
    const hits = raycaster.intersectObjects(getMap2SurfaceMeshes(), false);
    if (!hits.length) return null;
    const hit = hits[0];
    const dimensions = state.map.dimensions;
    if (hit.point.x < -dimensions.width / 2 || hit.point.x > dimensions.width / 2 || hit.point.y < -dimensions.depth / 2 || hit.point.y > dimensions.depth / 2) {
      return null;
    }
    const structureId = hit.object.userData?.map2StructureId || "";
    return {
      x: Number(hit.point.x.toFixed(2)),
      y: Number(hit.point.y.toFixed(2)),
      z: Number(hit.point.z.toFixed(2)),
      structureId,
    };
  }

  function seededRandom(seed) {
    let value = hashString(seed);
    return () => {
      value += 0x6d2b79f5;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(value) {
    let hash = 2166136261;
    String(value).split("").forEach((character) => {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return hash >>> 0;
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
    const photos = getLivestockPhotos(item);
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
        ${renderStockPhotoGrid(item, photos)}
        ${item.notes ? `<p class="card-meta">${escapeHtml(item.notes)}</p>` : ""}
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
    const lightingPhotos = getLightingPhotos();
    lightingPhotos.forEach((photo, index) => {
      photos.push({
        id: `lighting-${index}`,
        title: "Lighting Schedule",
        subtitle: [
          state.profile.lightingModel || "Tank profile",
          lightingPhotos.length > 1 ? `Image ${index + 1}` : "",
        ].filter(Boolean).join(" · "),
        src: getPhotoSrc(photo),
      });
    });

    state.livestock.forEach((item) => {
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
    $("photoCountPill").textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;
    library.innerHTML = photos.length
      ? photos.map((photo) => `
        <article class="photo-tile">
          <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.title)}" />
          <strong>${escapeHtml(photo.title)}</strong>
          <span>${escapeHtml(photo.subtitle)}</span>
        </article>
      `).join("")
      : `<div class="empty-state">No photos yet.</div>`;
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
    updateLogSubmitLabels();
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
          <div class="card-actions">
            <button class="mini-button" type="button" data-edit-entry="${entry.kind}:${entry.id}">Edit</button>
            <button class="mini-button danger" type="button" data-delete-entry="${entry.kind}:${entry.id}">Delete</button>
          </div>
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
    const dataRequests = Array.isArray(result.data_requests) ? result.data_requests : [];

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
      ${renderInsightRequests(dataRequests)}
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

  function renderInsightRequests(requests) {
    if (!requests.length) return "";
    return `
      <article class="insight-card">
        <strong>Raw Data Requests</strong>
        <ul>
          ${requests.map((request) => {
            if (typeof request === "string") return `<li>${escapeHtml(request)}</li>`;
            const label = request.label || request.data_type || "Raw data";
            const priority = request.priority ? ` (${request.priority})` : "";
            const reason = request.reason ? `: ${request.reason}` : "";
            return `<li>${escapeHtml(`${label}${priority}${reason}`)}</li>`;
          }).join("")}
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
    const { lightingPhotoDataUrl, lightingPhoto, lightingPhotos, ...profile } = state.profile;
    const lightingImageCount = getLightingPhotos().length;
    const livestockPhotoInventory = [];
    const livestock = state.livestock.map((item) => {
      const { photoDataUrl, photos, ...safeItem } = item;
      const photoCount = getLivestockPhotos(item).length;
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
    const mapPlacements = getLivestockMapPlacements().map((placement) => ({
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
      structureName: marker.structureId ? getMapStructureName(marker.structureId) : "",
      coordinateInches: {
        x: Number(Number(marker.x).toFixed(2)),
        y: Number(Number(marker.y).toFixed(2)),
        z: Number(Number(marker.z).toFixed(2)),
      },
    }));
    const refinementAnnotations = (state.map.refinementAnnotations || []).map((annotation) => ({
      id: annotation.id,
      structureId: annotation.structureId || "",
      structureName: annotation.structureId ? getMapStructureName(annotation.structureId) : annotation.structureName || "",
      shape: annotation.shape,
      action: annotation.action,
      direction: annotation.direction,
      strength: annotation.strength,
      radiusInches: annotation.radius,
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
      structures: state.map.structures.map((structure) => ({
        id: structure.id,
        name: structure.name,
        type: structure.type,
        position: { x: structure.x, y: structure.y, z: structure.z },
        size: { width: structure.width, depth: structure.depth, height: structure.height },
        geometry: {
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
          scanHeightStrength: structure.scanHeightStrength,
          scanHeightContrast: structure.scanHeightContrast,
          scanHeightInvert: structure.scanHeightInvert,
          terraceStrength: structure.terraceStrength,
          terraceBands: structure.terraceBands,
          scanHeightMap: structure.scanHeightMap
            ? {
                rows: structure.scanHeightMap.rows,
                columns: structure.scanHeightMap.columns,
                source: structure.scanHeightMap.source,
              }
            : null,
        },
        light: structure.light,
        flow: structure.flow,
        parRange: { min: structure.parMin, max: structure.parMax },
        notes: structure.notes,
      })),
      parMarkers,
      refinementAnnotations,
      livestockPlacements: mapPlacements,
      layers: state.map.layers,
    };

    return {
      generatedAt: new Date().toISOString(),
      profile: {
        ...profile,
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
      zones: state.zones,
      mapModel,
      livestock,
      activeLivestock: livestock.filter((item) => isLifecycleStock(item) && item.status === "active"),
      recentWaterTests,
      recentEvents,
      latestWaterTest,
      latestWaterChange,
      latestFeeding,
      currentLightPhase: getLightPhase().label,
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
        },
      },
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
    const dataRequests = [];
    const latest = context.latestWaterTest;

    if (!context.profile.displayVolume) missingData.push("Display volume");
    if (!context.profile.filtration) missingData.push("Filtration type");
    if (!context.profile.lightingModel) missingData.push("Lighting model");
    if (!context.profile.hasLightingScreenshot) missingData.push("Lighting screenshot or intensity schedule");
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
      data_requests: dataRequests,
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
    if (!$("backendUrl") || !$("backendAnonKey")) {
      updateBackendStatus();
      return;
    }
    $("backendUrl").value = backendConfig.supabaseUrl || "";
    $("backendAnonKey").value = backendConfig.supabaseAnonKey || "";
    updateBackendStatus();
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
      status.textContent = `Auto sync on · signed in as ${currentUser.email || currentUser.id}`;
    } else {
      status.textContent = "Auto sync is on.";
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
    await migrateInlinePhotosToStorage();
  }

  async function migrateInlinePhotosToStorage() {
    if (!supabaseClient) return;
    let changed = false;

    try {
      const lightingPhotos = getLightingPhotos();
      if (lightingPhotos.some((photo) => photo.dataUrl)) {
        const uploadedPhotos = [];
        for (const photo of lightingPhotos) {
          uploadedPhotos.push(await uploadPhotoRecord(photo, "profile", "lighting"));
        }
        setLightingPhotos(uploadedPhotos);
        changed = true;
      }

      for (const item of state.livestock) {
        const photos = getLivestockPhotos(item);
        if (!photos.some((photo) => photo.dataUrl)) continue;
        item.photos = await preparePhotosForSave(item.id, photos);
        item.photoDataUrl = "";
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

  async function saveBackendSettings() {
    backendConfig = {
      supabaseUrl: $("backendUrl")?.value.trim() || "",
      supabaseAnonKey: $("backendAnonKey")?.value.trim() || "",
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
    if (!hasMeaningfulState(state) && !options.allowEmpty) {
      if (!options.silent) showToast("Nothing to sync yet.");
      return;
    }
    if (!options.force && !options.allowEmpty) {
      const { data: remoteRow, error: remoteReadError } = await supabaseClient
        .from("reef_shared_state")
        .select("data, updated_at")
        .eq("id", SHARED_STATE_ID)
        .maybeSingle();
      if (!remoteReadError && remoteRow?.data && shouldProtectRemoteState(remoteRow.data, state)) {
        isRemoteHydrating = true;
        state = normalizeState(remoteRow.data);
        saveLocalState();
        isRemoteHydrating = false;
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
      updateBackendStatus("Sync write failed.");
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

    const remoteState = normalizeState(data.data);
    const localTime = new Date(state.updatedAt || 0).getTime();
    const remoteTime = new Date(remoteState.updatedAt || data.updated_at || 0).getTime();
    const remoteHasData = hasMeaningfulState(remoteState);
    if (options.startup) {
      if (localHasData && !remoteHasData) {
        await pushState({ silent: true });
        return;
      }
      if (!localHasData && !remoteHasData) {
        return;
      }
      if (localHasData && remoteHasData && localTime > remoteTime) {
        await pushState({ silent: true });
        return;
      }
    }

    isRemoteHydrating = true;
    if (localHasData) {
      writeJson(PRE_PULL_BACKUP_KEY, {
        backedUpAt: new Date().toISOString(),
        reason: "before-remote-pull",
        state,
      });
    }
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
    renderMapSummaries();
    renderReefMap2({ rebuild: true });
    renderInsightsContext();
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
      addedDate,
      isLegacy: casual ? false : isLegacy,
      status: casual ? "noticed" : "active",
      zoneId: $("livestockZone").value,
      notes: $("livestockNotes").value.trim(),
      health: $("livestockHealth").value,
      growthTrend: $("livestockGrowthTrend").value,
      growthMetric: $("livestockGrowthMetric").value.trim(),
      photos: pendingLivestockPhotos,
      photoDataUrl: "",
    };
  }

  function resetLivestockForm() {
    $("livestockForm").reset();
    $("livestockEditId").value = "";
    pendingLivestockPhotos = [];
    renderPhotoPreview("livestockPhotoPreview", "", "Stock photo");
    syncLivestockDateControls();
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
    pendingLivestockPhotos = getLivestockPhotos(item);
    renderPhotoPreview("livestockPhotoPreview", pendingLivestockPhotos, "Stock photo");
    syncLivestockDateControls();
    $("livestockFormTitle").textContent = "Edit Stock";
    $("livestockSubmitButton").innerHTML = `<i data-lucide="save"></i>Save`;
    $("cancelLivestockEditButton").hidden = false;
    $("livestockForm").scrollIntoView({ behavior: "smooth", block: "start" });
    refreshIcons();
  }

  async function addLivestock(event) {
    event.preventDefault();
    const formData = getLivestockFormData();
    if (!formData.species) return;
    const submitButton = $("livestockSubmitButton");
    submitButton.disabled = true;
    submitButton.innerHTML = `<i data-lucide="loader-circle"></i>Saving`;
    refreshIcons();

    const editId = $("livestockEditId").value;
    const existing = editId ? state.livestock.find((item) => item.id === editId) : null;
    const id = existing?.id || uid();
    const previousPaths = existing ? getPhotoStoragePaths(getLivestockPhotos(existing)) : [];

    try {
      const photos = await preparePhotosForSave(id, formData.photos);
      const nextPaths = getPhotoStoragePaths(photos);
      const payload = {
        ...formData,
        photos,
        photoDataUrl: photos.find((photo) => photo.dataUrl)?.dataUrl || "",
      };

      if (existing) {
        Object.assign(existing, {
          ...payload,
          status: isCasualStockCategory(payload.category) ? "noticed" : existing.status === "noticed" ? "active" : existing.status,
        });
      } else {
        state.livestock.push({
          id,
          ...payload,
          removedDate: "",
          outcomeReason: "",
        });
      }

      await removeStoragePaths(previousPaths.filter((path) => !nextPaths.includes(path)));

      resetLivestockForm();
      saveState();
      renderLivestock();
      renderPhotoLibrary();
      renderMapMarkerControls();
      renderMapSummaries();
      renderReefMap2({ rebuild: true });
      renderDashboard();
      renderInsightsContext();
      showToast(existing ? "Stock updated." : "Stock added.");
    } catch (error) {
      console.error(error);
      showToast("Photo upload failed. Try again.");
    } finally {
      submitButton.disabled = false;
      refreshIcons();
    }
  }

  function updateLogSubmitLabels() {
    const labels = {
      test: "Save Test",
      feeding: "Save Feeding",
      maintenance: "Save Maintenance",
      water_change: "Save Change",
    };

    Object.entries(logFormMap).forEach(([kind, formId]) => {
      const button = $(formId)?.querySelector('button[type="submit"]');
      if (!button) return;
      const label = editingLog?.kind === kind ? "Save Edit" : labels[kind];
      button.innerHTML = `<i data-lucide="save"></i>${label}`;
    });
    refreshIcons();
  }

  function clearLogEdit() {
    editingLog = null;
    updateLogSubmitLabels();
  }

  function setLogMode(mode) {
    state.ui.logMode = mode;
    saveLocalState();
    renderLogMode();
  }

  function setInputValue(id, value) {
    $(id).value = value ?? "";
  }

  function ensureSelectOption(select, value) {
    if (!value || Array.from(select.options).some((option) => option.value === value)) return;
    select.add(new Option(value, value));
  }

  function startLogEdit(key) {
    const [kind, id] = key.split(":");
    if (kind === "test") {
      const test = state.waterTests.find((entry) => entry.id === id);
      if (!test) return;
      editingLog = { kind, id };
      setLogMode("test");
      setInputValue("testMeasuredAt", toDatetimeLocal(test.measuredAt));
      setInputValue("testAmmonia", test.ammonia);
      setInputValue("testNitrite", test.nitrite);
      setInputValue("testNitrate", test.nitrate);
      setInputValue("testPhosphate", test.phosphate);
      setInputValue("testPh", test.ph);
      setInputValue("testSalinity", test.salinity);
      setInputValue("testTemp", test.temperature);
      setInputValue("testAlk", test.alkalinity);
      setInputValue("testCalcium", test.calcium);
      setInputValue("testMagnesium", test.magnesium);
      setInputValue("testNotes", test.notes);
      updateTestTimingPill();
    } else {
      const entry = state.events.find((event) => event.id === id && event.type === kind);
      if (!entry) return;
      editingLog = { kind, id };
      setLogMode(kind);
      if (kind === "feeding") {
        setInputValue("feedingAt", toDatetimeLocal(entry.happenedAt));
        ensureSelectOption($("feedingFood"), entry.label);
        setInputValue("feedingFood", entry.label);
        setInputValue("feedingAmount", entry.amount);
        setInputValue("feedingTarget", entry.target);
        setInputValue("feedingNotes", entry.notes);
      } else if (kind === "maintenance") {
        setInputValue("maintenanceAt", toDatetimeLocal(entry.happenedAt));
        ensureSelectOption($("maintenanceType"), entry.label);
        setInputValue("maintenanceType", entry.label);
        setInputValue("maintenanceDetails", entry.details || entry.notes);
      } else if (kind === "water_change") {
        setInputValue("waterChangeAt", toDatetimeLocal(entry.happenedAt));
        setInputValue("waterChangeGallons", entry.gallons);
        setInputValue("waterChangePercent", entry.percent);
        setInputValue("waterChangeNotes", entry.notes);
      }
    }

    $(logFormMap[kind]).scrollIntoView({ behavior: "smooth", block: "start" });
    updateLogSubmitLabels();
    showToast("Editing timeline entry.");
  }

  function addWaterTest(event) {
    event.preventDefault();
    const measuredAt = fromDatetimeLocal($("testMeasuredAt").value);
    const previousWaterChange = getLatestEventBefore("water_change", measuredAt);
    const previousFeeding = getLatestEventBefore("feeding", measuredAt);
    const existing = editingLog?.kind === "test"
      ? state.waterTests.find((entry) => entry.id === editingLog.id)
      : null;
    const test = {
      id: existing?.id || uid(),
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

    if (existing) {
      Object.assign(existing, test);
    } else {
      state.waterTests.push(test);
    }
    $("waterTestForm").reset();
    seedLogDates();
    clearLogEdit();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast(existing ? "Water test updated." : "Water test saved.");
  }

  function addFeeding(event) {
    event.preventDefault();
    const existing = editingLog?.kind === "feeding"
      ? state.events.find((entry) => entry.id === editingLog.id)
      : null;
    const feeding = {
      id: existing?.id || uid(),
      type: "feeding",
      happenedAt: fromDatetimeLocal($("feedingAt").value),
      label: $("feedingFood").value,
      amount: $("feedingAmount").value.trim(),
      target: $("feedingTarget").value.trim(),
      notes: $("feedingNotes").value.trim(),
    };
    if (existing) {
      Object.assign(existing, feeding);
    } else {
      state.events.push(feeding);
    }
    $("feedingForm").reset();
    seedLogDates();
    clearLogEdit();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast(existing ? "Feeding updated." : "Feeding saved.");
  }

  function addMaintenance(event) {
    event.preventDefault();
    const existing = editingLog?.kind === "maintenance"
      ? state.events.find((entry) => entry.id === editingLog.id)
      : null;
    const maintenance = {
      id: existing?.id || uid(),
      type: "maintenance",
      happenedAt: fromDatetimeLocal($("maintenanceAt").value),
      label: $("maintenanceType").value,
      details: $("maintenanceDetails").value.trim(),
      notes: "",
    };
    if (existing) {
      Object.assign(existing, maintenance);
    } else {
      state.events.push(maintenance);
    }
    $("maintenanceForm").reset();
    seedLogDates();
    clearLogEdit();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast(existing ? "Maintenance updated." : "Maintenance saved.");
  }

  function addWaterChange(event) {
    event.preventDefault();
    const existing = editingLog?.kind === "water_change"
      ? state.events.find((entry) => entry.id === editingLog.id)
      : null;
    const waterChange = {
      id: existing?.id || uid(),
      type: "water_change",
      happenedAt: fromDatetimeLocal($("waterChangeAt").value),
      label: "Water change",
      gallons: $("waterChangeGallons").value,
      percent: $("waterChangePercent").value,
      notes: $("waterChangeNotes").value.trim(),
    };
    if (existing) {
      Object.assign(existing, waterChange);
    } else {
      state.events.push(waterChange);
    }
    $("waterChangeForm").reset();
    seedLogDates();
    clearLogEdit();
    saveState();
    renderDashboard();
    renderTimeline();
    renderInsightsContext();
    showToast(existing ? "Water change updated." : "Water change saved.");
  }

  async function handleDocumentClick(event) {
    const removePhoto = event.target.closest("[data-remove-photo]");
    if (removePhoto) {
      if (removePhoto.dataset.removePhoto === "lighting") {
        const lightingPhotos = getLightingPhotos();
        const photoIndex = Number(removePhoto.dataset.photoIndex);
        const removedPhotos = Number.isInteger(photoIndex)
          ? lightingPhotos.filter((_photo, index) => index === photoIndex)
          : lightingPhotos;
        const remainingPhotos = Number.isInteger(photoIndex)
          ? lightingPhotos.filter((_photo, index) => index !== photoIndex)
          : [];
        setLightingPhotos(remainingPhotos);
        await removeStoragePaths(getPhotoStoragePaths(removedPhotos));
        saveState();
        renderPhotoPreview("lightingPhotoPreview", getLightingPhotos(), "Lighting schedule image");
        renderPhotoLibrary();
        renderInsightsContext();
        showToast("Lighting image removed.");
      } else {
        const photoIndex = Number(removePhoto.dataset.photoIndex);
        if (Number.isInteger(photoIndex)) {
          pendingLivestockPhotos = pendingLivestockPhotos.filter((_photo, index) => index !== photoIndex);
        } else {
          pendingLivestockPhotos = [];
        }
        renderPhotoPreview("livestockPhotoPreview", pendingLivestockPhotos, "Stock photo");
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
      state.ui.logMode = quickLog.dataset.openLog;
      saveLocalState();
      setActiveView("logbook");
      renderLogMode();
      return;
    }

    const logMode = event.target.closest("[data-log-mode]");
    if (logMode) {
      clearLogEdit();
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

    const map2View = event.target.closest("[data-map2-view]");
    if (map2View) {
      setMap2ViewPreset(map2View.dataset.map2View);
      return;
    }

    const map2Nav = event.target.closest("[data-map2-nav]");
    if (map2Nav) {
      state.ui.map2NavTool = ["rotate", "pan"].includes(map2Nav.dataset.map2Nav)
        ? map2Nav.dataset.map2Nav
        : "rotate";
      state.ui.mapTool = "navigate";
      state.ui.map2RefinementShape = "navigate";
      map2RefinementDraft = null;
      saveLocalState();
      renderMapMarkerControls();
      renderMap2Settings();
      renderReefMap2({ rebuild: true });
      return;
    }

    if (event.target.closest("[data-map2-reset-camera]")) {
      resetMap2Camera();
      return;
    }

    if (event.target.closest("[data-map2-refinement-overlay-toggle]")) {
      state.ui.map2RefinementOverlayVisible = !getMap2RefinementOverlayVisible();
      saveLocalState();
      renderMap2RefinementControls();
      syncMap2RefinementAnnotationOverlay();
      renderReefMap2();
      return;
    }

    const map2RefineShape = event.target.closest("[data-map2-refine-shape]");
    if (map2RefineShape) {
      state.ui.mapTool = "navigate";
      state.ui.map2RefinementShape = MAP2_REFINEMENT_SHAPES.includes(map2RefineShape.dataset.map2RefineShape)
        ? map2RefineShape.dataset.map2RefineShape
        : "navigate";
      map2RefinementDraft = null;
      saveLocalState();
      renderMapMarkerControls();
      renderMap2RefinementControls();
      renderReefMap2({ rebuild: true });
      return;
    }

    if (event.target.closest("[data-map2-refinement-finish]")) {
      finishMap2RefinementArea();
      return;
    }

    if (event.target.closest("[data-map2-refinement-cancel]")) {
      cancelMap2RefinementDraft();
      return;
    }

    const map2RefinementDelete = event.target.closest("[data-map2-refinement-delete]");
    if (map2RefinementDelete) {
      state.map.refinementAnnotations = (state.map.refinementAnnotations || [])
        .filter((annotation) => annotation.id !== map2RefinementDelete.dataset.map2RefinementDelete);
      saveState();
      renderMap2RefinementControls();
      renderReefMap2({ rebuild: true });
      renderInsightsContext();
      return;
    }

    const mapLayer = event.target.closest("[data-map-layer]");
    if (mapLayer) {
      const layer = mapLayer.dataset.mapLayer;
      state.map.layers[layer] = !state.map.layers[layer];
      saveState();
      renderMapSettings();
      renderReefMap2({ rebuild: true });
      renderInsightsContext();
      return;
    }

    const mapTool = event.target.closest("[data-map-tool]");
    if (mapTool) {
      state.ui.mapTool = mapTool.dataset.mapTool;
      state.ui.map2RefinementShape = "navigate";
      map2RefinementDraft = null;
      if (state.ui.mapTool !== "navigate") setMap2ViewPreset("top");
      saveLocalState();
      renderMapMarkerControls();
      renderMap2RefinementControls();
      renderReefMap2({ rebuild: true });
      return;
    }

    const parMarkerDelete = event.target.closest("[data-par-marker-delete]");
    if (parMarkerDelete) {
      state.map.parMarkers = (state.map.parMarkers || []).filter((marker) => marker.id !== parMarkerDelete.dataset.parMarkerDelete);
      saveState();
      renderMapSummaries();
      renderReefMap2({ rebuild: true });
      renderInsightsContext();
      showToast("PAR marker deleted.");
      return;
    }

    const stockPlace = event.target.closest("[data-map-stock-place]");
    if (stockPlace) {
      state.ui.mapTool = "stock";
      state.ui.map2RefinementShape = "navigate";
      state.ui.selectedMapStockId = stockPlace.dataset.mapStockPlace;
      map2RefinementDraft = null;
      setMap2ViewPreset("top");
      saveLocalState();
      renderMapMarkerControls();
      renderMap2RefinementControls();
      return;
    }

    const stockClear = event.target.closest("[data-map-stock-clear]");
    if (stockClear) {
      const item = state.livestock.find((entry) => entry.id === stockClear.dataset.mapStockClear);
      if (item) item.mapPosition = null;
      saveState();
      renderMapMarkerControls();
      renderMapSummaries();
      renderReefMap2({ rebuild: true });
      renderInsightsContext();
      showToast("Stock marker cleared.");
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
      renderMapMarkerControls();
      renderMapSummaries();
      renderReefMap2({ rebuild: true });
      renderInsightsContext();
      showToast("Zone deleted.");
      return;
    }

    const livestockAction = event.target.closest("[data-livestock-action]");
    if (livestockAction) {
      await updateLivestockStatus(livestockAction.dataset.id, livestockAction.dataset.livestockAction);
      return;
    }

    const editEntry = event.target.closest("[data-edit-entry]");
    if (editEntry) {
      startLogEdit(editEntry.dataset.editEntry);
      return;
    }

    const deleteEntry = event.target.closest("[data-delete-entry]");
    if (deleteEntry) {
      deleteTimelineEntry(deleteEntry.dataset.deleteEntry);
    }
  }

  async function updateLivestockStatus(id, action) {
    const item = state.livestock.find((entry) => entry.id === id);
    if (!item) return;
    if (action === "edit") {
      startLivestockEdit(id);
      return;
    }
    if (action === "delete") {
      await removeStoragePaths(getPhotoStoragePaths(getLivestockPhotos(item)));
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
    renderPhotoLibrary();
    renderMapMarkerControls();
    renderMapSummaries();
    renderReefMap2({ rebuild: true });
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
    if (editingLog?.kind === kind && editingLog.id === id) clearLogEdit();
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

  function updateMap2RefinementOpacity(event) {
    state.ui.map2RefinementOverlayOpacity = clamp(0, 1, finiteNumber(event.target.value, 35) / 100);
    saveLocalState();
    renderMap2RefinementOverlayControls();
    syncMap2RefinementAnnotationOverlay();
    renderReefMap2();
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);
    $$("[data-profile]").forEach((input) => {
      input.addEventListener("input", updateProfileFromForm);
      input.addEventListener("change", updateProfileFromForm);
    });
    $$("[data-map-dimension]").forEach((input) => {
      input.addEventListener("input", updateMapFromSettings);
      input.addEventListener("change", updateMapFromSettings);
    });
    $("mapSettingsForm").addEventListener("submit", (event) => event.preventDefault());
    $("mapMarkerForm").addEventListener("submit", (event) => event.preventDefault());
    $("map2RefineForm")?.addEventListener("submit", (event) => event.preventDefault());
    $("map2FocusSelect")?.addEventListener("change", (event) => {
      state.ui.map2FocusStructureId = event.target.value;
      saveLocalState();
      applyMap2ViewPreset(["front", "left", "right", "top"].includes(appliedMap2ViewPreset) ? appliedMap2ViewPreset : "front");
      renderMap2Settings();
      renderReefMap2();
    });
    $("map2RefineAction")?.addEventListener("change", (event) => {
      state.ui.map2RefinementAction = event.target.value;
      saveLocalState();
      renderMap2RefinementControls();
      renderReefMap2({ rebuild: true });
    });
    $("map2RefineDirection")?.addEventListener("change", (event) => {
      state.ui.map2RefinementDirection = event.target.value;
      saveLocalState();
      renderMap2RefinementControls();
    });
    $("map2RefineStrength")?.addEventListener("change", (event) => {
      state.ui.map2RefinementStrength = event.target.value;
      saveLocalState();
      renderMap2RefinementControls();
    });
    $("map2RefineRadius")?.addEventListener("change", (event) => {
      state.ui.map2RefinementRadius = positiveNumber(event.target.value, 0.8);
      saveLocalState();
      renderMap2RefinementControls();
      renderReefMap2({ rebuild: true });
    });
    $("map2RefineNote")?.addEventListener("input", (event) => {
      state.ui.map2RefinementNote = event.target.value;
      saveLocalState();
    });
    $("map2RefinementOpacity")?.addEventListener("input", updateMap2RefinementOpacity);
    $("map2RefinementOpacity")?.addEventListener("change", updateMap2RefinementOpacity);
    $("mapStockSelect").addEventListener("change", (event) => {
      state.ui.selectedMapStockId = event.target.value;
      saveLocalState();
    });
    $("lightingPhotoInput").addEventListener("change", (event) => handlePhotoInput(event, "lighting"));
    $("zoneForm").addEventListener("submit", addZone);
    $("livestockForm").addEventListener("submit", addLivestock);
    $("livestockCategory").addEventListener("change", syncLivestockDateControls);
    $("livestockLegacy").addEventListener("change", syncLivestockDateControls);
    $("livestockPhotoInput").addEventListener("change", (event) => handlePhotoInput(event, "livestock"));
    $("cancelLivestockEditButton").addEventListener("click", resetLivestockForm);
    $("waterTestForm").addEventListener("submit", addWaterTest);
    $("feedingForm").addEventListener("submit", addFeeding);
    $("maintenanceForm").addEventListener("submit", addMaintenance);
    $("waterChangeForm").addEventListener("submit", addWaterChange);
    $("testMeasuredAt").addEventListener("change", updateTestTimingPill);
    $("generateInsightButton").addEventListener("click", generateInsight);
    $("saveBackendButton")?.addEventListener("click", saveBackendSettings);
    $("sendMagicLinkButton")?.addEventListener("click", sendMagicLink);
    $("signOutButton")?.addEventListener("click", signOut);
    $("pullStateButton")?.addEventListener("click", pullState);
    $("pushStateButton")?.addEventListener("click", pushState);
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
    enableInstallShell();
    await disableLocalInstallShell();
    await loadLocalBackendConfig();
    bindEvents();
    seedLogDates();
    initInsightMode();
    await initBackend();
    renderAll();
  }

  init();
})();
