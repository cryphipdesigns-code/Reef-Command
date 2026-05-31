(function () {
  const STORAGE_KEY = "reefCommandState.v1";
  const BACKEND_KEY = "reefCommandBackend.v1";
  const SHARED_STATE_ID = "default";
  const PHOTO_BUCKET = "reef-photos";
  const PHOTO_ROOT = "shared";

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
  let mapRenderer = null;
  let mapScene = null;
  let mapCamera = null;
  let mapRoot = null;
  let mapAnimationFrame = null;
  let mapResizeObserver = null;
  let mapPointerState = null;
  const mapViewState = {
    yaw: -0.42,
    pitch: 0.34,
    distance: 42,
  };

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
      },
    };
  }

  function getDefaultMap() {
    return {
      modelVersion: 6,
      dimensions: {
        width: 30,
        depth: 12,
        height: 18,
        sandDepth: 1.3,
        waterline: 16.4,
        scaleReference: "3 inch sticky-note cards plus 2 inch in-tank ruler for right rock",
        calibrationNotes: "Five-rock silhouette-locked mesh from the traced front, top, and right-view references. The left rock, right rock, and shelf are hard-anchored to the back glass; the two front rocks remain separate on the sandbed.",
      },
      view: "orbit",
      layers: {
        par: false,
        livestock: false,
        flow: false,
        equipment: false,
        trace: true,
      },
      structures: [
        {
          id: "left-rock",
          name: "Left rock",
          type: "profile-rock",
          x: -10.35,
          y: 1.05,
          z: 1.3,
          width: 7.8,
          depth: 8.6,
          height: 5.2,
          touchesBackGlass: true,
          footprint: [[-3.95, -2.65], [-3.45, -3.75], [-2.2, -3.92], [-1.25, -3.35], [0.35, -3.55], [1.55, -2.95], [2.85, -2.15], [3.35, -0.82], [3.15, 1.2], [2.55, 2.75], [1.85, 4.12], [0.65, 4.85], [-1.35, 4.75], [-2.65, 3.88], [-3.45, 2.35], [-3.9, 0.45]],
          frontProfile: [[-3.95, 0.8], [-3.35, 1.7], [-2.65, 2.65], [-1.65, 3.85], [-0.45, 4.95], [0.75, 4.72], [1.75, 3.65], [2.7, 2.55], [3.35, 1.08]],
          sideProfile: [[-3.75, 0.9], [-2.4, 2.15], [-0.65, 3.55], [1.35, 4.65], [3.15, 4.92], [4.85, 3.55]],
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
          edgeSoftness: 0.32,
          edgeFloor: 0.94,
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
          sideProfile: [[-1.35, 0.45], [-0.45, 1.35], [0.42, 1.55], [1.32, 0.72]],
          heightPoints: [
            { x: -0.95, y: -0.2, h: 0.22, r: 0.8 },
            { x: 0.55, y: 0.1, h: 0.18, r: 0.75 },
          ],
          ridges: [
            { from: [-1.55, -0.18], to: [1.45, 0.25], h: 0.18, r: 0.42 },
          ],
          depressions: [],
          edgeSoftness: 0.28,
          edgeFloor: 0.88,
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
          sideProfile: [[-1.55, 0.85], [-0.55, 2.0], [0.48, 2.25], [1.55, 1.05]],
          heightPoints: [
            { x: -0.8, y: -0.2, h: 0.22, r: 0.82 },
            { x: 0.75, y: 0.15, h: 0.28, r: 0.85 },
          ],
          ridges: [
            { from: [-1.4, -0.35], to: [1.5, 0.3], h: 0.22, r: 0.44 },
          ],
          depressions: [],
          edgeSoftness: 0.28,
          edgeFloor: 0.9,
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
          width: 7.9,
          depth: 8.3,
          height: 4.8,
          touchesBackGlass: true,
          footprint: [[-3.85, -2.75], [-2.7, -3.35], [-1.25, -3.48], [0.65, -3.1], [2.4, -2.45], [3.55, -1.25], [3.85, 0.38], [3.35, 1.95], [3.55, 3.25], [2.55, 4.25], [1.05, 4.85], [-0.85, 4.7], [-2.35, 3.85], [-3.45, 2.28], [-3.95, 0.35]],
          frontProfile: [[-3.85, 0.75], [-3.1, 1.42], [-2.1, 2.35], [-0.85, 3.55], [0.45, 4.45], [1.55, 4.18], [2.65, 3.0], [3.45, 1.95], [3.85, 0.82]],
          sideProfile: [[-3.48, 0.9], [-2.3, 1.75], [-0.75, 3.45], [0.7, 4.7], [2.25, 4.35], [3.65, 3.55], [4.85, 2.35]],
          heightPoints: [
            { x: -2.35, y: -1.15, h: 0.24, r: 1.0 },
            { x: -0.65, y: -0.45, h: 0.38, r: 1.2 },
            { x: 0.75, y: 0.65, h: 0.45, r: 1.15 },
            { x: 1.95, y: 1.65, h: 0.28, r: 0.9 },
          ],
          ridges: [
            { from: [-2.65, -1.55], to: [2.2, 1.2], h: 0.34, r: 0.62 },
            { from: [-0.8, 1.2], to: [2.4, 2.45], h: 0.28, r: 0.52 },
          ],
          depressions: [
            { x: -3.05, y: 0.25, h: 0.24, r: 0.7 },
            { x: 2.15, y: -1.4, h: 0.2, r: 0.58 },
          ],
          edgeSoftness: 0.34,
          edgeFloor: 0.95,
          surfaceNoise: 0.045,
          light: "Low-Medium",
          flow: "Medium-High",
          parMin: 55,
          parMax: 135,
          notes: "Back-glass-touching right rock. Broad continuous footprint from top/right outlines; tallest mass sits toward the rear.",
        },
        {
          id: "center-shelf",
          name: "Shelf rock",
          type: "profile-rock",
          x: 0.15,
          y: 1.35,
          z: 6.75,
          width: 13.8,
          depth: 6.8,
          height: 6.6,
          touchesBackGlass: true,
          footprint: [[-6.85, -1.95], [-5.65, -2.28], [-4.45, -1.95], [-3.15, -2.1], [-1.7, -1.72], [-0.2, -1.95], [1.2, -1.55], [2.65, -1.75], [4.25, -1.25], [5.55, -0.75], [6.7, 0.35], [6.45, 1.85], [5.15, 3.05], [3.25, 3.75], [1.2, 4.3], [-0.75, 4.55], [-2.8, 4.28], [-4.65, 3.65], [-6.05, 2.65], [-6.9, 1.08]],
          bottomProfile: [[-6.85, 0.0], [-5.55, 0.32], [-4.35, 0.08], [-3.25, 0.72], [-2.15, 0.45], [-1.05, 0.88], [0.0, 0.55], [1.05, 0.7], [2.0, 0.42], [3.05, 0.62], [4.2, 0.18], [5.45, 0.38], [6.7, 0.0]],
          frontProfile: [[-6.85, 1.0], [-5.9, 2.55], [-4.65, 4.0], [-3.45, 5.1], [-2.0, 5.45], [-0.65, 4.75], [0.35, 5.75], [1.65, 5.35], [2.95, 5.05], [4.25, 4.2], [5.45, 2.85], [6.7, 1.2]],
          sideProfile: [[-2.28, 0.95], [-1.05, 2.85], [0.8, 4.85], [2.35, 5.75], [3.65, 5.2], [4.55, 3.8]],
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
          edgeSoftness: 0.3,
          edgeFloor: 0.97,
          surfaceNoise: 0.04,
          light: "Medium-High",
          flow: "High",
          parMin: 130,
          parMax: 260,
          notes: "Raised shelf rock, anchored to the back glass with a broad irregular top outline and open sand below.",
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
      par: source.layers?.par ?? defaultLayers.par,
      livestock: source.layers?.livestock ?? defaultLayers.livestock,
      flow: source.layers?.flow ?? defaultLayers.flow,
      equipment: source.layers?.equipment ?? defaultLayers.equipment,
      trace: source.layers?.trace ?? defaultLayers.trace,
    };

    const structureSource = !shouldMigrateStructures && Array.isArray(source.structures) && source.structures.length
      ? source.structures
      : defaults.structures;

    return {
      modelVersion: defaultVersion,
      dimensions,
      view: source.view || defaults.view,
      layers,
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
      bottomProfile: normalizePointPairs(structure.bottomProfile, fallback.bottomProfile),
      frontProfile: normalizePointPairs(structure.frontProfile, fallback.frontProfile),
      sideProfile: normalizePointPairs(structure.sideProfile, fallback.sideProfile),
      edgeSoftness: positiveNumber(structure.edgeSoftness, fallback.edgeSoftness || 0.65),
      edgeFloor: positiveNumber(structure.edgeFloor, fallback.edgeFloor || 0.4),
      surfaceNoise: nonNegativeNumber(structure.surfaceNoise, fallback.surfaceNoise || 0.14),
      notes: structure.notes || fallback.notes || "",
    };
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
      requestAnimationFrame(() => renderReefMap({ rebuild: true }));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    refreshIcons();
  }

  function renderAll() {
    renderTankProfileForm();
    renderDashboard();
    renderZones();
    renderMapSettings();
    renderMapSummaries();
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
    $("mapCalibrationSummary").textContent = `${formatValue(dimensions.width, "in")} x ${formatValue(dimensions.depth, "in")} x ${formatValue(dimensions.height, "in")} · ${state.map.structures.length} structures`;
    $("mapQualityPill").textContent = state.map.modelVersion >= 6
      ? "Silhouette locked"
      : state.map.modelVersion >= 5 ? "Outline traced" : dimensions.scaleReference?.includes("2 inch") ? "Ruler refined" : "Photo draft";
    $$("[data-map-layer]").forEach((button) => {
      button.classList.toggle("active", Boolean(state.map.layers?.[button.dataset.mapLayer]));
    });
    $$("[data-map-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mapView === (state.map.view || "orbit"));
    });
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
    renderMapSummaries();
    renderReefMap({ rebuild: true });
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
    const placedCount = placements.filter((placement) => placement.zone).length;
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
            <span class="map-stat">${escapeHtml(placement.health || "Health untracked")}</span>
            <span class="map-stat">${escapeHtml(placement.growth || "Growth untracked")}</span>
          </div>
        </article>
      `).join("")
      : `<div class="empty-state">No stock to place yet.</div>`;
  }

  function formatStructureSize(structure) {
    return `${formatValue(structure.width, "in")} x ${formatValue(structure.depth, "in")} x ${formatValue(structure.height, "in")}`;
  }

  function formatParRange(structure) {
    if (!structure.parMin && !structure.parMax) return "unknown";
    return `${structure.parMin || "?"}-${structure.parMax || "?"}`;
  }

  function renderReefMap(options = {}) {
    if (!$("reefMapStage")) return;
    if (!window.THREE) {
      $("reefMapFallback").hidden = false;
      return;
    }
    $("reefMapFallback").hidden = true;
    if (!ensureMapRenderer()) return;
    resizeMapRenderer();
    if (options.rebuild || !mapRoot) rebuildReefMapScene();
    updateMapCamera();
    mapRenderer.render(mapScene, mapCamera);
  }

  function ensureMapRenderer() {
    if (mapRenderer) return true;
    const canvas = $("reefMapCanvas");
    if (!canvas || !window.THREE) return false;

    mapScene = new THREE.Scene();
    mapScene.fog = new THREE.Fog(0xeaf6f5, 42, 92);
    mapCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    mapRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    mapRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ("outputColorSpace" in mapRenderer && THREE.SRGBColorSpace) {
      mapRenderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    mapRenderer.shadowMap.enabled = true;
    mapRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    bindMapPointerEvents($("reefMapStage"));
    mapResizeObserver = new ResizeObserver(() => renderReefMap());
    mapResizeObserver.observe($("reefMapStage"));
    startMapAnimation();
    return true;
  }

  function resizeMapRenderer() {
    const stage = $("reefMapStage");
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const canvas = mapRenderer.domElement;
    if (canvas.width !== Math.floor(width * mapRenderer.getPixelRatio()) || canvas.height !== Math.floor(height * mapRenderer.getPixelRatio())) {
      mapRenderer.setSize(width, height, false);
      mapCamera.aspect = width / height;
      mapCamera.updateProjectionMatrix();
    }
  }

  function startMapAnimation() {
    if (mapAnimationFrame) cancelAnimationFrame(mapAnimationFrame);
    const tick = () => {
      if (mapRenderer && $("mapView")?.classList.contains("active")) {
        updateMapCamera();
        mapRenderer.render(mapScene, mapCamera);
      }
      mapAnimationFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function rebuildReefMapScene() {
    clearMapScene();
    mapRoot = new THREE.Group();
    mapScene.add(mapRoot);

    const dimensions = state.map.dimensions;
    addMapLighting(dimensions);
    addTankEnvelope(dimensions);
    addSandBed(dimensions);
    addBackGlassTexture(dimensions);
    if (state.map.layers.equipment) addEquipmentGhosts(dimensions);

    state.map.structures.forEach((structure, index) => {
      mapRoot.add(createRockStructure(structure, index));
      if (state.map.layers.par) mapRoot.add(createParHalo(structure));
    });

    if (state.map.layers.trace) addTraceOutlines(dimensions);
    if (state.map.layers.flow) addFlowArrows(dimensions);
    if (state.map.layers.livestock) addLivestockMarkers();
  }

  function clearMapScene() {
    if (!mapScene) return;
    while (mapScene.children.length) {
      const child = mapScene.children.pop();
      disposeThreeObject(child);
    }
    mapRoot = null;
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

  function addMapLighting(dimensions) {
    const ambient = new THREE.HemisphereLight(0xdff6ff, 0x35534f, 1.8);
    mapScene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(0, -dimensions.depth * 0.35, dimensions.height * 1.85);
    key.castShadow = true;
    key.shadow.mapSize.width = 2048;
    key.shadow.mapSize.height = 2048;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 80;
    key.shadow.camera.left = -dimensions.width;
    key.shadow.camera.right = dimensions.width;
    key.shadow.camera.top = dimensions.height;
    key.shadow.camera.bottom = -dimensions.height;
    mapScene.add(key);

    const fill = new THREE.PointLight(0x77d3d4, 1.1, 80);
    fill.position.set(-dimensions.width * 0.45, -dimensions.depth * 0.7, dimensions.height * 0.55);
    mapScene.add(fill);
  }

  function addTankEnvelope(dimensions) {
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xcdecea,
      transparent: true,
      opacity: 0.13,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tank = new THREE.Mesh(new THREE.BoxGeometry(dimensions.width, dimensions.depth, dimensions.height), glassMaterial);
    tank.position.z = dimensions.height / 2;
    mapRoot.add(tank);

    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x294442, transparent: true, opacity: 0.75 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tank.geometry), edgeMaterial);
    edges.position.copy(tank.position);
    mapRoot.add(edges);

    const waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x7fcfd2,
      transparent: true,
      opacity: 0.22,
      roughness: 0.08,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(dimensions.width, dimensions.depth), waterMaterial);
    water.position.z = dimensions.waterline;
    mapRoot.add(water);
  }

  function addSandBed(dimensions) {
    const random = seededRandom("sand-bed");
    const geometry = new THREE.PlaneGeometry(dimensions.width, dimensions.depth, 58, 24);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const ripple = Math.sin(x * 0.72 + y * 1.18) * 0.06 + Math.cos(y * 1.9) * 0.04;
      positions.setZ(index, dimensions.sandDepth + ripple + random() * 0.08);
    }
    geometry.computeVertexNormals();
    const sand = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xdccfae, roughness: 0.96, metalness: 0 }),
    );
    sand.receiveShadow = true;
    mapRoot.add(sand);

    const pebbleMaterial = new THREE.MeshStandardMaterial({ color: 0xbfae89, roughness: 1 });
    for (let index = 0; index < 110; index += 1) {
      const pebble = new THREE.Mesh(new THREE.SphereGeometry(0.035 + random() * 0.055, 7, 5), pebbleMaterial);
      pebble.position.set(
        (random() - 0.5) * dimensions.width * 0.92,
        (random() - 0.5) * dimensions.depth * 0.88,
        dimensions.sandDepth + 0.04 + random() * 0.08,
      );
      mapRoot.add(pebble);
    }
  }

  function addBackGlassTexture(dimensions) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x6b8c63,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    [-0.34, 0, 0.34].forEach((offset, index) => {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(dimensions.width * 0.18, dimensions.height * 0.62), material.clone());
      panel.material.opacity = index === 1 ? 0.12 : 0.2;
      panel.position.set(dimensions.width * offset, dimensions.depth / 2 + 0.035, dimensions.height * 0.55);
      panel.rotation.x = Math.PI / 2;
      mapRoot.add(panel);
    });
  }

  function addEquipmentGhosts(dimensions) {
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2f31, roughness: 0.55, transparent: true, opacity: 0.55 });
    const yellowMaterial = new THREE.MeshStandardMaterial({ color: 0xe0b21f, roughness: 0.5, transparent: true, opacity: 0.76 });
    const acrylicMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd7eeee, transparent: true, opacity: 0.24, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });

    const overflow = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 6.6), darkMaterial);
    overflow.position.set(-dimensions.width / 2 + 2.6, dimensions.depth / 2 - 0.65, dimensions.height * 0.63);
    mapRoot.add(overflow);

    const filterBox = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.2, 2.2), acrylicMaterial);
    filterBox.position.set(0, dimensions.depth / 2 + 0.42, dimensions.waterline + 0.5);
    mapRoot.add(filterBox);

    const shelfStand = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 8.2), darkMaterial);
    shelfStand.position.set(0.7, 2.6, dimensions.sandDepth + 4.1);
    shelfStand.castShadow = true;
    mapRoot.add(shelfStand);

    [0, 0.65].forEach((offset) => {
      const heater = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 7.2, 16), yellowMaterial);
      heater.rotation.x = Math.PI / 2;
      heater.position.set(dimensions.width / 2 - 1.4 - offset, dimensions.depth / 2 - 0.4, dimensions.height * 0.44);
      mapRoot.add(heater);
    });

    [
      { z: dimensions.height * 0.67, y: dimensions.depth / 2 - 1.8 },
      { z: dimensions.height * 0.54, y: dimensions.depth / 2 - 1.2 },
    ].forEach((pump) => {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.9, 28), darkMaterial);
      body.rotation.z = Math.PI / 2;
      body.position.set(dimensions.width / 2 - 0.7, pump.y, pump.z);
      mapRoot.add(body);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.04, 8, 24), darkMaterial);
      ring.rotation.y = Math.PI / 2;
      ring.position.copy(body.position);
      mapRoot.add(ring);
    });
  }

  function addFlowArrows(dimensions) {
    const arrowMaterialColor = 0x2f9bb3;
    const flows = [
      { start: [dimensions.width / 2 - 1.1, dimensions.depth / 2 - 1.7, dimensions.height * 0.66], dir: [-1, -0.25, -0.08], length: dimensions.width * 0.38 },
      { start: [dimensions.width / 2 - 1.1, dimensions.depth / 2 - 1.0, dimensions.height * 0.53], dir: [-1, -0.45, -0.18], length: dimensions.width * 0.34 },
      { start: [-dimensions.width / 2 + 1.8, dimensions.depth / 2 - 1.3, dimensions.height * 0.43], dir: [0.75, -0.45, 0.04], length: dimensions.width * 0.22 },
    ];
    flows.forEach((flow) => {
      const direction = new THREE.Vector3(...flow.dir).normalize();
      const origin = new THREE.Vector3(...flow.start);
      const arrow = new THREE.ArrowHelper(direction, origin, flow.length, arrowMaterialColor, 0.75, 0.34);
      arrow.cone.material.transparent = true;
      arrow.cone.material.opacity = 0.55;
      arrow.line.material.transparent = true;
      arrow.line.material.opacity = 0.5;
      mapRoot.add(arrow);
    });
  }

  function addTraceOutlines(dimensions) {
    const group = new THREE.Group();
    group.name = "silhouette-trace";
    const frontY = -dimensions.depth / 2 - 0.08;
    const rightX = dimensions.width / 2 + 0.08;

    state.map.structures.forEach((structure) => {
      const footprint = getRockFootprint(structure);
      const perimeter = sampleFootprintPerimeter(footprint, Math.round(clamp(64, 150, getPerimeterLength(footprint) / 0.14)));
      const topTrace = perimeter.map((point) => {
        const z = scaleRockProfileHeight(structure, rockHeightAt(structure, footprint, point[0], point[1]), 1);
        return new THREE.Vector3(structure.x + point[0], structure.y + point[1], structure.z + z + 0.08);
      });
      group.add(createTraceLine(topTrace, 0xf7f2df, 0.9, true));

      if (Array.isArray(structure.frontProfile) && structure.frontProfile.length >= 2) {
        const frontProfile = [...structure.frontProfile]
          .sort((a, b) => a[0] - b[0])
          .map((point) => new THREE.Vector3(structure.x + point[0], frontY, structure.z + point[1] + 0.04));
        group.add(createTraceLine(frontProfile, 0xffffff, 0.82, false));
      }

      if (Array.isArray(structure.bottomProfile) && structure.bottomProfile.length >= 2) {
        const bottomProfile = [...structure.bottomProfile]
          .sort((a, b) => a[0] - b[0])
          .map((point) => new THREE.Vector3(structure.x + point[0], frontY, structure.z + point[1] + 0.04));
        group.add(createTraceLine(bottomProfile, 0xc4fff9, 0.68, false));
      }

      if (Array.isArray(structure.sideProfile) && structure.sideProfile.length >= 2) {
        const sideProfile = [...structure.sideProfile]
          .sort((a, b) => a[0] - b[0])
          .map((point) => new THREE.Vector3(rightX, structure.y + point[0], structure.z + point[1] + 0.04));
        group.add(createTraceLine(sideProfile, 0xdff5ff, 0.72, false));
      }

      if (structure.touchesBackGlass) {
        const backContact = getBackContactPoints(structure, footprint, dimensions)
          .map((point) => new THREE.Vector3(structure.x + point[0], dimensions.depth / 2 + 0.05, structure.z + point[1]));
        if (backContact.length >= 2) group.add(createTraceLine(backContact, 0x77f0e0, 0.82, false));
      }
    });

    mapRoot.add(group);
  }

  function createTraceLine(points, color, opacity = 0.85, loop = false) {
    const linePoints = loop && points.length ? [...points, points[0].clone()] : points;
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints), material);
    line.renderOrder = 30;
    return line;
  }

  function getBackContactPoints(structure, footprint, dimensions) {
    const targetLocalY = dimensions.depth / 2 - structure.y;
    const nearBack = footprint
      .filter((point) => Math.abs(point[1] - targetLocalY) < 0.24)
      .sort((a, b) => a[0] - b[0]);
    if (nearBack.length >= 2) {
      return nearBack.map((point) => [point[0], rockHeightAt(structure, footprint, point[0], point[1]) + 0.12]);
    }

    const bounds = getPointBounds(footprint);
    return [
      [bounds.minX, rockHeightAt(structure, footprint, bounds.minX, targetLocalY) + 0.12],
      [bounds.maxX, rockHeightAt(structure, footprint, bounds.maxX, targetLocalY) + 0.12],
    ];
  }

  function createRockStructure(structure, index) {
    const group = new THREE.Group();
    group.name = structure.id;
    const baseMesh = new THREE.Mesh(createProfileRockGeometry(structure, index), createRockMeshMaterial());
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    return group;
  }

  function createProfileRockGeometry(structure, index, heightScale = 1) {
    const footprint = getRockFootprint(structure);
    const bounds = getPointBounds(footprint);
    const maxDimension = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const perimeterLength = getPerimeterLength(footprint);
    const sampleCount = Math.round(clamp(56, 132, perimeterLength / 0.16));
    const ringCount = Math.round(clamp(16, 34, maxDimension / 0.24));
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

    const centerZ = scaleRockProfileHeight(structure, rockHeightAt(structure, footprint, center[0], center[1]), heightScale);
    const centerIndex = addVertex(center[0], center[1], centerZ, rockVertexColor(structure, center[0], center[1], centerZ, index));
    const rings = [];

    for (let ringIndex = 1; ringIndex <= ringCount; ringIndex += 1) {
      const t = ringIndex / ringCount;
      const ring = [];
      perimeter.forEach((point, pointIndex) => {
        const x = lerp(center[0], point[0], t);
        const y = lerp(center[1], point[1], t);
        const z = scaleRockProfileHeight(structure, rockHeightAt(structure, footprint, x, y), heightScale);
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
    const base = structure.id === "center-shelf" ? 0 : -0.05;
    const addVertex = (x, y, z, color) => {
      const vertexIndex = vertices.length / 3;
      vertices.push(structure.x + x, structure.y + y, structure.z + z);
      colors.push(color.r, color.g, color.b);
      return vertexIndex;
    };

    const bottomRing = perimeter.map((point) => addVertex(point[0], point[1], base + rockBottomAt(structure, point[0]), dark));
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
      const edgeFloor = clamp(0.78, 0.99, structure.edgeFloor || 0.92);
      let relief =
        0.98 +
        (surfaceNoise(`${structure.id}-profile`, x * 0.72, y * 0.72) - 0.5) * 0.08 +
        (surfaceNoise(`${structure.id}-fine-profile`, x * 2.3, y * 2.3) - 0.5) * (structure.surfaceNoise || 0.04) * 0.45;

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

      const rockFloor = Math.max(structure.id === "center-shelf" ? 0.2 : 0.06, bottom + 0.04);
      const edgeShape = edgeFloor + (1 - edgeFloor) * edgeTaper;
      return clamp(rockFloor, structure.height, silhouetteLimit * clamp(0.9, 1.06, relief) * edgeShape);
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

    const roughness = (surfaceNoise(structure.id, x, y) - 0.5) * 2 * (structure.surfaceNoise || 0.14) * structure.height;
    const shapedHeight = Math.max(0, height + roughness);
    return clamp(baseLip, structure.height, baseLip + shapedHeight * (0.18 + edgeTaper * 0.82));
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

  function distanceToSegment(point, start, end) {
    const vx = end[0] - start[0];
    const vy = end[1] - start[1];
    const wx = point[0] - start[0];
    const wy = point[1] - start[1];
    const lengthSq = vx * vx + vy * vy || 1e-6;
    const t = clamp(0, 1, (wx * vx + wy * vy) / lengthSq);
    return Math.hypot(point[0] - (start[0] + t * vx), point[1] - (start[1] + t * vy));
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

  function createParHalo(structure) {
    const color = structure.parMax >= 180 ? 0xf2c94c : structure.parMax >= 100 ? 0x46b87e : 0x4d9de0;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(new THREE.CircleGeometry(1, 48), material);
    halo.scale.set(Math.max(1.4, structure.width * 0.55), Math.max(1.1, structure.depth * 0.55), 1);
    halo.position.set(structure.x, structure.y, structure.z + structure.height + 0.18);
    return halo;
  }

  function addLivestockMarkers() {
    getLivestockMapPlacements().forEach((placement, index) => {
      if (!placement.zone || !placement.structure || !placement.anchor) return;
      const anchor = placement.anchor;
      const color = livestockColor(placement.category);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 18, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.4 }),
      );
      marker.position.copy(anchor);
      marker.castShadow = true;
      mapRoot.add(marker);
      if (index < 18) {
        mapRoot.add(createMapLabel(placement.species, anchor.clone().add(new THREE.Vector3(0, 0, 0.85)), "#405856"));
      }
    });
  }

  function getLivestockMapPlacements() {
    return state.livestock
      .filter((item) => isCasualStockCategory(item.category) || item.status === "active")
      .map((item, index) => {
        const zone = state.zones.find((entry) => entry.id === item.zoneId);
        const structure = getStructureForZone(zone, item, index);
        return {
          id: item.id,
          species: item.species || item.name || "Unknown",
          category: item.category || "Other",
          zone: zone?.name || "",
          health: item.health || "",
          growth: item.growthMetric || item.growthTrend || "",
          structure,
          anchor: structure ? getPlacementAnchor(structure, item.id || `${index}`) : null,
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

  function updateMapCamera() {
    if (!mapCamera) return;
    const dimensions = state.map.dimensions;
    const target = new THREE.Vector3(0, 0, dimensions.height * 0.46);
    const pitch = Math.max(-1.2, Math.min(1.54, mapViewState.pitch));
    const distance = Math.max(18, Math.min(95, mapViewState.distance));
    const horizontal = Math.cos(pitch) * distance;
    mapCamera.position.set(
      Math.sin(mapViewState.yaw) * horizontal,
      -Math.cos(mapViewState.yaw) * horizontal,
      target.z + Math.sin(pitch) * distance,
    );
    mapCamera.lookAt(target);
  }

  function setMapViewPreset(view) {
    state.map.view = view;
    const dimensions = state.map.dimensions;
    const maxDimension = Math.max(dimensions.width, dimensions.depth, dimensions.height);
    if (view === "front") {
      mapViewState.yaw = 0;
      mapViewState.pitch = 0;
      mapViewState.distance = maxDimension * 1.5;
    } else if (view === "right") {
      mapViewState.yaw = Math.PI / 2;
      mapViewState.pitch = 0;
      mapViewState.distance = maxDimension * 1.42;
    } else if (view === "top") {
      mapViewState.yaw = 0;
      mapViewState.pitch = 1.53;
      mapViewState.distance = maxDimension * 1.28;
    } else {
      mapViewState.yaw = -0.42;
      mapViewState.pitch = 0.34;
      mapViewState.distance = maxDimension * 1.55;
    }
    saveState();
    renderMapSettings();
    renderReefMap();
  }

  function bindMapPointerEvents(stage) {
    stage.addEventListener("pointerdown", (event) => {
      mapPointerState = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      if (!mapPointerState || mapPointerState.id !== event.pointerId) return;
      const dx = event.clientX - mapPointerState.x;
      const dy = event.clientY - mapPointerState.y;
      mapPointerState.x = event.clientX;
      mapPointerState.y = event.clientY;
      mapViewState.yaw -= dx * 0.008;
      mapViewState.pitch += dy * 0.006;
      mapViewState.pitch = Math.max(-0.75, Math.min(1.54, mapViewState.pitch));
      state.map.view = "orbit";
      renderMapSettings();
    });
    stage.addEventListener("pointerup", () => {
      mapPointerState = null;
    });
    stage.addEventListener("pointercancel", () => {
      mapPointerState = null;
    });
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      mapViewState.distance += event.deltaY * 0.025;
      mapViewState.distance = Math.max(18, Math.min(95, mapViewState.distance));
    }, { passive: false });
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
          edgeSoftness: structure.edgeSoftness,
          edgeFloor: structure.edgeFloor,
          surfaceNoise: structure.surfaceNoise,
        },
        light: structure.light,
        flow: structure.flow,
        parRange: { min: structure.parMin, max: structure.parMax },
        notes: structure.notes,
      })),
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
          placedLivestockCount: mapPlacements.filter((placement) => placement.zone).length,
          referenceImageCount: 18,
          canRequestRawReferenceImages: false,
          parMapAvailable: state.zones.some((zone) => zone.parMin || zone.parMax),
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
    renderReefMap({ rebuild: true });
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
      renderMapSummaries();
      renderReefMap({ rebuild: true });
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

    const mapView = event.target.closest("[data-map-view]");
    if (mapView) {
      setMapViewPreset(mapView.dataset.mapView);
      return;
    }

    const mapLayer = event.target.closest("[data-map-layer]");
    if (mapLayer) {
      const layer = mapLayer.dataset.mapLayer;
      state.map.layers[layer] = !state.map.layers[layer];
      saveState();
      renderMapSettings();
      renderReefMap({ rebuild: true });
      renderInsightsContext();
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
      renderMapSummaries();
      renderReefMap({ rebuild: true });
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
    renderMapSummaries();
    renderReefMap({ rebuild: true });
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
