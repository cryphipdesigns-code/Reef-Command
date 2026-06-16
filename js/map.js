(function () {
  let map2Renderer = null;
  let map2Scene = null;
  let map2Camera = null;
  let map2Root = null;
  let map2AnimationFrame = null;
  let map2ResizeObserver = null;
  let map2PointerState = null;
  let appliedMap2ViewPreset = null;
  const scanMeshAssetCache = new Map();
  const map2ViewState = { yaw: 0, pitch: 0, distance: 42, targetOffsetX: 0, targetOffsetY: 0, targetOffsetZ: 0 };
  let map2RefinementDraft = null;

  const RC = window.RC;
  const state = RC.state;
  const $ = (id) => RC.$(id);
  const $$ = (sel, root) => RC.$$(sel, root);
  const {
    saveState, saveLocalState, showToast, uid, escapeHtml, refreshIcons,
    formatValue, formatDateTime, isCasualStockCategory, positiveNumber, finiteNumber,
    nonNegativeNumber, getLidarHeightMap, normalizeMap, normalizeMap2RefinementAnnotations,
    normalizeMapPosition, normalizeMap2RefinementPoint, getDefaultMap, normalizePhotoRecord,
    getLivestockItems, updateLivestockPlacement,
    MAP2_REFINEMENT_SHAPES, MAP2_REFINEMENT_ACTIONS, MAP2_REFINEMENT_DIRECTIONS,
    MAP2_REFINEMENT_STRENGTHS, MAP2_RIGHT_ROCK_OPTION5_REFINEMENT_BASE,
  } = RC;

  let threeLoadPromise = null;
  function loadThreeJs() {
    if (window.THREE) return Promise.resolve();
    if (threeLoadPromise) return threeLoadPromise;
    threeLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./vendor/three.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return threeLoadPromise;
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
    $("map2Summary").textContent = `${formatValue(dimensions.width, "in")} x ${formatValue(dimensions.depth, "in")} x ${formatValue(dimensions.height, "in")} · LiDAR right rock + LiDAR shelf`;
    $("map2QualityPill").textContent = "LiDAR right rock";
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
    const annotations = getMap2RefinementAnnotationsForCurrentGeometry();
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
    const placementsById = new Map(getLivestockMapPlacements().map((placement) => [placement.id, placement]));
    if (state.ui.selectedMapStockId && !stockItems.some((item) => item.id === state.ui.selectedMapStockId)) {
      state.ui.selectedMapStockId = "";
    }
    if (!state.ui.selectedMapStockId && stockItems.length) {
      state.ui.selectedMapStockId = stockItems[0].id;
    }
    const selectedPlacement = placementsById.get(state.ui.selectedMapStockId) || null;

    $$("[data-map-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mapTool === tool);
    });
    $("mapMarkerModePill").textContent = tool === "par"
      ? "PAR point"
      : tool === "stock"
        ? (selectedPlacement?.anchor ? "Move stock" : "Place stock")
        : "Navigate";
    $("mapParValueField").hidden = tool !== "par";
    $("mapStockSelectField").hidden = tool !== "stock";
    $("mapMarkerNote").disabled = tool === "navigate";
    $("mapStockSelect").innerHTML = stockItems.length
      ? stockItems.map((item) => {
        const placement = placementsById.get(item.id);
        const label = `${item.species || item.name || "Unknown"} · ${getMapPlacementStatus(placement)}`;
        return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
      }).join("")
      : `<option value="">No active stock</option>`;
    $("mapStockSelect").value = state.ui.selectedMapStockId || "";
    renderMapStockMarkerActions(tool, selectedPlacement);
  }

  function getMapTool() {
    return ["navigate", "par", "stock"].includes(state.ui.mapTool) ? state.ui.mapTool : "navigate";
  }

  function renderMapStockMarkerActions(tool, placement) {
    const container = $("mapStockMarkerActions");
    if (!container) return;
    const visible = tool === "stock" && placement;
    container.hidden = !visible;
    if (!visible) {
      container.innerHTML = "";
      return;
    }
    const actionLabel = placement.anchor ? "Move Marker" : "Place Marker";
    container.innerHTML = `
      <button class="mini-button good" type="button" data-map-stock-place="${escapeHtml(placement.id)}">${actionLabel}</button>
      ${placement.anchor ? `<button class="mini-button danger" type="button" data-map-stock-clear="${escapeHtml(placement.id)}">Delete Marker</button>` : ""}
    `;
  }

  function getMapPlaceableStock() {
    const livestock = getLivestockItems ? getLivestockItems() : state.livestock;
    return livestock.filter((item) => isCasualStockCategory(item.category) || item.status === "alive" || item.status === "active");
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
    RC.Insights?.renderInsightsContext?.();
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
              <p class="card-meta">${escapeHtml(structure.light)} light · ${escapeHtml(formatStructureSize(structure))}</p>
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
            <span class="category-pill">${escapeHtml(placement.hidden ? "No marker" : placement.structure?.name || "No zone")}</span>
          </div>
          <div class="map-stat-row">
            <span class="map-stat">${escapeHtml(getMapPlacementStatus(placement))}</span>
            ${placement.anchor ? `<span class="map-stat">${escapeHtml(formatMapCoordinate(placement.anchor))}</span>` : ""}
            <span class="map-stat">${escapeHtml(placement.health || "Health untracked")}</span>
            <span class="map-stat">${escapeHtml(placement.growth || "Growth untracked")}</span>
          </div>
          <div class="card-actions">
            <button class="mini-button good" type="button" data-map-stock-place="${escapeHtml(placement.id)}">${placement.anchor ? "Move Marker" : "Place Marker"}</button>
            ${placement.anchor ? `<button class="mini-button danger" type="button" data-map-stock-clear="${escapeHtml(placement.id)}">Delete Marker</button>` : ""}
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

  function getMapPlacementStatus(placement) {
    if (!placement) return "Unplaced";
    if (placement.hidden) return "No marker";
    if (placement.manual) return "Manual marker";
    if (placement.anchor) return "Zone estimate";
    return "Unplaced";
  }

  function getMapStructureName(id) {
    return state.map.structures.find((structure) => structure.id === id)?.name || "Mapped";
  }

  async function renderReefMap2(options = {}) {
    if (!$("reefMap2Stage")) return;
    await loadThreeJs();
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
      "left-rock": { mode: "option5" },
      "front-left-rock": { mode: "legacy" },
      "front-right-rock": { mode: "legacy" },
      "right-rock": { key: "rightRock", mirrorX: false, mirrorY: false },
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
    if (structure.map2Mesh?.mode === "option5") {
      return createMap2Option5Rock(structure, index);
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

  function createMap2Option5Rock(structure, index) {
    const refinementAnnotations = getMap2StructureRefinementAnnotations(structure.id);
    const option5Footprint = getMap2DisplayedBaseFootprint(structure);
    const footprint = getMap2RefinedFootprint(structure, option5Footprint, refinementAnnotations);
    const bounds = getPointBounds(footprint);
    const maxDimension = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const perimeterLength = getPerimeterLength(footprint);
    const useExternalRightRockDensity = structure.id === "right-rock";
    const sampleCount = useExternalRightRockDensity ? 76 : Math.round(clamp(76, 132, perimeterLength / 0.16));
    const ringCount = useExternalRightRockDensity ? 30 : Math.round(clamp(28, 44, maxDimension / 0.24));
    const perimeter = sampleFootprintPerimeter(footprint, sampleCount);
    const center = polygonCentroid(footprint);
    const vertices = [];
    const colors = [];
    const indices = [];

    const pushVertex = (x, y, z, shade) => {
      const vertexIndex = vertices.length / 3;
      vertices.push(structure.x + x, structure.y + y, structure.z + z);
      colors.push(shade.r, shade.g, shade.b);
      return vertexIndex;
    };

    const heightAt = (x, y) => {
      const baseHeight = getMap2Option5Height(structure, footprint, x, y);
      return applyMap2RefinementHeight(structure, refinementAnnotations, x, y, baseHeight, structure.height);
    };

    const centerZ = heightAt(center[0], center[1]);
    const centerIndex = pushVertex(center[0], center[1], centerZ, rockVertexColor(structure, center[0], center[1], centerZ, index));
    const rings = [];

    for (let ringIndex = 1; ringIndex <= ringCount; ringIndex += 1) {
      const radialT = ringIndex / ringCount;
      const ring = [];
      perimeter.forEach((point, pointIndex) => {
        const x = lerp(center[0], point[0], radialT);
        const y = lerp(center[1], point[1], radialT);
        const z = heightAt(x, y);
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

    const mesh = new THREE.Mesh(geometry, createRockMeshMaterial());
    mesh.name = `${structure.id}-map2-option5`;
    mesh.userData.map2StructureId = structure.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 4 + index;
    return mesh;
  }

  function getMap2Option5BaseFootprint(structure) {
    if (structure.id === "right-rock" && Array.isArray(structure.footprint) && structure.footprint.length >= 3) {
      return structure.footprint;
    }
    return getRockFootprint(structure);
  }

  function getMap2DisplayedBaseFootprint(structure) {
    if (structure.map2Mesh?.mode === "option5") {
      return getMap2Option5Footprint(structure, getMap2Option5BaseFootprint(structure));
    }
    return getRockFootprint(structure);
  }

  function getMap2Option5Footprint(structure, footprint) {
    if (structure.id !== "left-rock" && structure.id !== "right-rock") return footprint;
    return footprint.map(([x, y]) => {
      let nextX = x;
      let nextY = y;
      if (structure.id === "left-rock") {
        const frontRightCut = map2Option5Gaussian(x, y, 2.4, -3.0, 1.9);
        const backLeftLift = map2Option5Gaussian(x, y, -2.1, 3.0, 1.8);
        nextX -= 0.42 * frontRightCut;
        nextY += 0.34 * frontRightCut + 0.18 * backLeftLift;
      } else {
        const frontProngCut = map2Option5Gaussian(x, y, 1.4, -4.6, 1.8);
        const leftShoulderWiden = map2Option5Gaussian(x, y, -3.5, 1.2, 1.9);
        nextX -= 0.35 * leftShoulderWiden;
        nextY += 0.42 * frontProngCut;
      }
      return [nextX, nextY];
    });
  }

  function getMap2Option5Height(structure, footprint, x, y) {
    let height = getMap2Option5SilhouetteHeight(structure, footprint, x, y);
    if (structure.id === "left-rock") {
      // Primary summit back-left of center (matches sideProfile peak at y≈3.15, frontProfile peak at x≈-0.45)
      height += 0.58 * map2Option5Gaussian(x, y, -0.85, 1.05, 1.25);
      // Secondary shoulder right-back — creates a twin-ridge silhouette from the front
      height += 0.34 * map2Option5Gaussian(x, y, 0.75, 2.15, 0.88);
      // Diagonal structural ridge front-left → back-right (mirrors structure.ridges entry)
      height += 0.35 * map2Option5LineGaussian(x, y, [-2.8, -1.15], [2.0, 1.55], 0.74);
      // Diffuse back-glass mass along the rear edge
      height += 0.22 * map2Option5LineGaussian(x, y, [-3.4, 3.8], [2.2, 4.5], 1.05);
      // Front-right gap — cleans up separation toward the shelf and front rocks
      height -= 0.48 * map2Option5Gaussian(x, y, 2.35, -2.05, 0.92);
      // Left-flank taper toward the tank side wall
      height -= 0.16 * map2Option5Gaussian(x, y, -3.6, 0.45, 1.05);
      // Narrow plateau near the summit
      const plateau = map2Option5Gaussian(x, y, -0.45, 1.35, 0.95);
      height = lerp(height, Math.min(structure.height, 4.65), 0.18 * plateau);
    } else if (structure.id === "right-rock") {
      height += 0.72 * map2Option5Gaussian(x, y, 1.25, 0.25, 1.15);
      height += 0.42 * map2Option5LineGaussian(x, y, [-2.8, 2.45], [0.75, 3.15], 0.58);
      height -= 0.55 * map2Option5Gaussian(x, y, -0.1, -0.6, 0.9);
      height -= 0.32 * map2Option5LineGaussian(x, y, [0.2, -2.7], [2.6, -3.75], 0.52);
      const plateau = map2Option5Gaussian(x, y, 1.25, 0.4, 1.05);
      height = lerp(height, Math.min(structure.height, 4.9), 0.2 * plateau);
    }

    const edgeDistance = distanceToPolygonEdge([x, y], footprint);
    const edgeShape = 0.13 + 0.87 * smoothstep(0, 0.72, edgeDistance);
    return clamp(0.06, structure.height, height * edgeShape);
  }

  function getMap2Option5SilhouetteHeight(structure, footprint, x, y) {
    const frontLimit = profileValueAt(structure.frontProfile, x, structure.height);
    const sideLimit = Array.isArray(structure.sideProfile) && structure.sideProfile.length >= 2
      ? profileValueAt(structure.sideProfile, y, structure.height)
      : structure.height;
    const silhouetteLimit = Math.min(structure.height, Math.max(0.16, Math.min(frontLimit, Math.max(sideLimit, frontLimit * 0.78))));
    const edgeDistance = distanceToPolygonEdge([x, y], footprint);
    const edgeTaper = smoothstep(0, structure.edgeSoftness || 0.9, edgeDistance);
    const edgeFloor = clamp(0.12, 0.99, structure.edgeFloor || 0.24);
    const footprintBounds = getPointBounds(footprint);
    const frontTaperDepth = nonNegativeNumber(structure.frontTaperDepth, 0);
    const frontTaper = frontTaperDepth
      ? smoothstep(footprintBounds.minY, footprintBounds.minY + frontTaperDepth, y)
      : 1;
    const frontFloor = clamp(0.08, 1, structure.frontFloor || 0.24);
    const frontShape = frontFloor + (1 - frontFloor) * frontTaper;
    const broadVariation =
      0.96 +
      Math.sin((x - footprintBounds.minX) * 0.8) * 0.035 +
      Math.cos(y * 0.9) * 0.025;
    return clamp(0.06, structure.height, silhouetteLimit * (edgeFloor + (1 - edgeFloor) * edgeTaper) * frontShape * broadVariation);
  }

  function map2Option5Gaussian(x, y, centerX, centerY, radius) {
    const dx = x - centerX;
    const dy = y - centerY;
    return Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
  }

  function map2Option5LineGaussian(x, y, start, end, radius) {
    const distance = distanceToSegment([x, y], start, end);
    return Math.exp(-(distance * distance) / (2 * radius * radius));
  }

  function getMap2StructureRefinementAnnotations(structureId) {
    return getMap2RefinementAnnotationsForCurrentGeometry()
      .filter((annotation) => annotation.structureId === structureId);
  }

  function getMap2RefinementAnnotationsForCurrentGeometry() {
    return normalizeMap2RefinementAnnotations(state.map.refinementAnnotations || [])
      .filter(shouldApplyMap2RefinementAnnotation);
  }

  function shouldApplyMap2RefinementAnnotation(annotation) {
    if (annotation.structureId !== "right-rock") return true;
    return annotation.geometryBase === MAP2_RIGHT_ROCK_OPTION5_REFINEMENT_BASE;
  }

  function getMap2RefinementGeometryBase(structureId) {
    return structureId === "right-rock" ? MAP2_RIGHT_ROCK_OPTION5_REFINEMENT_BASE : "";
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
    const maxShift = clamp(0.4, 2.4, Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.32);
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
        if (annotation.direction === "left-right") {
          dx += getMap2RefinementLateralShift(structure, annotation, point, center, "x") * influence;
        } else if (annotation.direction === "front-back") {
          dy += getMap2RefinementLateralShift(structure, annotation, point, center, "y") * influence;
        }
      });

      return [
        clamp(tankMinX, tankMaxX, point[0] + clamp(-maxShift, maxShift, dx)),
        clamp(tankMinY, tankMaxY, point[1] + clamp(-maxShift, maxShift, dy)),
      ];
    });
  }

  function getMap2RefinementLateralShift(structure, annotation, point, center, axis) {
    const targetShift = getMap2RefinementTargetShift(annotation, point, axis);
    if (Number.isFinite(targetShift) && Math.abs(targetShift) > 0.03) {
      return targetShift * getMap2RefinementTargetStrengthScale(annotation);
    }
    const amount = getMap2RefinementLateralAmount(structure, annotation);
    const coordinate = axis === "y" ? point[1] : point[0];
    const centerCoordinate = axis === "y" ? center[1] : center[0];
    const sign = getMap2RefinementAxisSign(annotation, coordinate, centerCoordinate, axis);
    return sign * amount;
  }

  function getMap2RefinementTargetShift(annotation, point, axis) {
    const points = Array.isArray(annotation.points)
      ? annotation.points.map(normalizeMap2RefinementPoint).filter(Boolean)
      : [];
    const key = axis === "y" ? "y" : "x";
    const targetKey = axis === "y" ? "targetY" : "targetX";
    const targetPoints = points.filter((entry) => Number.isFinite(entry[targetKey]));
    if (!targetPoints.length) return null;
    const radius = Math.max(0.25, positiveNumber(annotation.radius, 0.8));
    let weightedShift = 0;
    let totalWeight = 0;
    targetPoints.forEach((entry) => {
      const distance = Math.hypot(point[0] - entry.x, point[1] - entry.y);
      const weight = Math.exp(-(distance * distance) / (2 * radius * radius));
      weightedShift += (entry[targetKey] - entry[key]) * weight;
      totalWeight += weight;
    });
    return totalWeight > 0 ? weightedShift / totalWeight : null;
  }

  function getMap2RefinementTargetStrengthScale(annotation) {
    const strengthScale = {
      light: 0.45,
      medium: 0.72,
      strong: 1,
    }[annotation.strength] || 0.72;
    const actionScale = {
      raise: 1,
      depress: 1,
      "cut-back": 1,
      ridge: 0.75,
    }[annotation.action] || 0.5;
    return strengthScale * actionScale;
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
      const swapAxes = heightMap.transform?.swap;
      const mappedU = swapAxes ? rawV : rawU;
      const mappedV = swapAxes ? rawU : rawV;
      const u = structure.map2Mesh.mirrorX ? 1 - mappedU : mappedU;
      const v = structure.map2Mesh.mirrorY ? 1 - mappedV : mappedV;
      const scanHeight = sampleLidarHeightMap(heightMap, u, v);
      const isShelf = structure.id === "center-shelf";
      const contrast = structure.scanHeightContrast ?? (isShelf ? 1.22 : 1.34);
      const floor = structure.scanHeightFloor ?? (isShelf ? 0.2 : 0.12);
      const contrasted = clamp(0, 1, (scanHeight - 0.5) * contrast + 0.5);
      const edgeDrop = smoothstep(0.72, 1, radialT);
      const edgeShape = lerp(1, isShelf ? 0.32 : 0.18, edgeDrop);
      const shelfLift = isShelf ? 0.1 : 0;
      const lidarHeight = scaledHeight * (floor + contrasted * (1 - floor + shelfLift)) * edgeShape;
      const strength = structure.scanHeightStrength;
      let baseHeight = lidarHeight;
      if (Number.isFinite(strength) && strength < 1) {
        const silhouetteLimit = getMap2Option5SilhouetteHeight(structure, footprint, x, y);
        baseHeight = Math.min(lerp(silhouetteLimit, lidarHeight, strength), silhouetteLimit * 1.05);
      }
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
    getMap2RefinementAnnotationsForCurrentGeometry().forEach((annotation) => {
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

    const targetSegments = getMap2RefinementTargetWorldSegments(annotation);
    if (targetSegments.length) {
      const targetLine = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(targetSegments), new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: draft ? 0.92 : 0.72,
        depthTest: false,
        depthWrite: false,
      }));
      targetLine.renderOrder = 44;
      tagMap2RefinementOverlayObject(targetLine, draft);
      group.add(targetLine);
    }

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

  function getMap2RefinementTargetWorldSegments(annotation) {
    if (annotation.direction !== "left-right" && annotation.direction !== "front-back") return [];
    const structure = state.map.structures.find((entry) => entry.id === annotation.structureId);
    if (!structure || !Array.isArray(annotation.points)) return [];
    const segments = [];
    annotation.points
      .map(normalizeMap2RefinementPoint)
      .filter((point) => point && (Number.isFinite(point.targetX) || Number.isFinite(point.targetY)))
      .forEach((point) => {
        const targetX = Number.isFinite(point.targetX) ? point.targetX : point.x;
        const targetY = Number.isFinite(point.targetY) ? point.targetY : point.y;
        const z = structure.z + point.z + 0.14;
        segments.push(
          new THREE.Vector3(structure.x + point.x, structure.y + point.y, z),
          new THREE.Vector3(structure.x + targetX, structure.y + targetY, z),
        );
      });
    return segments;
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
    const stockToolActive = getMapTool() === "stock";
    const selectedStockId = state.ui.selectedMapStockId || "";
    getLivestockMapPlacements().forEach((placement, index) => {
      if (!placement.anchor) return;
      const anchor = getMap2MarkerAnchor(placement.anchor);
      const color = livestockColor(placement.category);
      const selected = placement.id === selectedStockId;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(stockToolActive && selected ? 0.28 : 0.22, 18, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: stockToolActive && selected ? 0.38 : 0.22, roughness: 0.4 }),
      );
      marker.position.copy(anchor);
      marker.castShadow = true;
      marker.userData.map2LivestockMarker = true;
      marker.userData.livestockId = placement.id;
      map2Root.add(marker);
      if ((!stockToolActive && index < 18) || (stockToolActive && selected)) {
        map2Root.add(createMapLabel(
          placement.species,
          anchor.clone().add(new THREE.Vector3(0, 0, 0.85)),
          "#405856",
          stockToolActive ? { opacity: 0.78, backgroundOpacity: 0.54, strokeOpacity: 0.72 } : {},
        ));
      }
    });
  }

  function getLivestockMapPlacements() {
    const livestock = getLivestockItems ? getLivestockItems() : state.livestock;
    return livestock
      .filter((item) => isCasualStockCategory(item.category) || item.status === "alive" || item.status === "active")
      .map((item, index) => {
        const zone = state.zones.find((entry) => entry.id === item.zoneId);
        const hidden = item.mapMarkerHidden === true;
        const manualPosition = hidden ? null : normalizeMapPosition(item.mapPosition);
        const manualSurface = manualPosition ? getMapSurfaceAt(manualPosition.x, manualPosition.y) : null;
        const zoneStructure = getStructureForZone(zone, item, index);
        const structure = manualSurface?.structure || zoneStructure;
        const anchor = hidden
          ? null
          : manualPosition
            ? getMarkerAnchor(manualPosition)
            : zoneStructure
              ? getPlacementAnchor(zoneStructure, item.id || `${index}`)
              : null;
        return {
          id: item.id,
          species: item.species || item.name || "Unknown",
          category: item.category || "Other",
          zone: zone?.name || "",
          health: item.health || "",
          growth: [item.growthTrend, item.growthNotes].filter(Boolean).join(" · "),
          structure,
          hidden,
          manual: Boolean(manualPosition),
          anchor,
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
    return { x: structure.x + x, y: structure.y + y, z: structure.z + z };
  }

  function getMarkerAnchor(point) {
    const surface = getMapSurfaceAt(point.x, point.y);
    const z = Number.isFinite(Number(point.z)) ? Number(point.z) : surface.z;
    return { x: point.x, y: point.y, z: Math.max(z, surface.z) + 0.24 };
  }

  function getMap2MarkerAnchor(point) {
    if (!point) return null;
    const surface = getMap2SurfaceAt(point.x, point.y);
    if (!surface) {
      const anchor = getMarkerAnchor(point);
      return new THREE.Vector3(anchor.x, anchor.y, anchor.z);
    }
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

  function createMapLabel(text, position, color, options = {}) {
    const backgroundOpacity = clamp(0.12, 0.92, finiteNumber(options.backgroundOpacity, 0.86));
    const strokeOpacity = clamp(0.1, 1, finiteNumber(options.strokeOpacity, 0.95));
    const opacity = clamp(0.1, 1, finiteNumber(options.opacity, 1));
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = `rgba(255, 255, 255, ${backgroundOpacity})`;
    roundRect(context, 12, 22, 488, 84, 18);
    context.fill();
    context.strokeStyle = `rgba(167, 200, 191, ${strokeOpacity})`;
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = color;
    context.font = "700 34px Manrope, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(shortenLabel(text), canvas.width / 2, canvas.height / 2 + 3, 452);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity }));
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
      } else if (map2PointerState?.pointers.has(event.pointerId) && map2PointerState.pointers.size === 1) {
        const moved = Math.hypot(event.clientX - map2PointerState.startX, event.clientY - map2PointerState.startY);
        if (moved <= 10) handleMap2MarkerSelectionPointer(event);
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
    const bottomTraceHit = getMap2BottomTraceRefinementHit(raycaster);
    if (bottomTraceHit) return bottomTraceHit;
    const meshes = [];
    map2Root.traverse((child) => {
      if (child.isMesh && child.userData?.map2StructureId) meshes.push(child);
    });
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
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

    const focusedStructure = getMap2FocusedStructure();
    const tolerance = Math.max(focusedStructure ? 1.5 : 0.9, getMap2RefinementRadius() * (focusedStructure ? 4 : 2.5));
    const candidateStructures = focusedStructure
      ? getMap2Structures().filter((structure) => structure.id === focusedStructure.id)
      : getMap2Structures();
    let best = null;
    candidateStructures.forEach((structure) => {
      const annotations = getMap2StructureRefinementAnnotations(structure.id);
      const footprint = getMap2RefinedFootprint(structure, getMap2DisplayedBaseFootprint(structure), annotations);
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
          targetX: localPoint[0],
          targetY: localPoint[1],
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
      geometryBase: getMap2RefinementGeometryBase(structure.id),
      note: state.ui.map2RefinementNote || "",
      points: points.map(serializeMap2RefinementPoint),
    };
    state.map.refinementAnnotations = [
      ...(state.map.refinementAnnotations || []),
      annotation,
    ];
    saveState();
    renderMap2RefinementControls();
    renderReefMap2({ rebuild: true });
    RC.Insights?.renderInsightsContext?.();
    showToast("Geometry note added.");
  }

  function serializeMap2RefinementPoint(point) {
    const serialized = {
      x: Number(point.x.toFixed(3)),
      y: Number(point.y.toFixed(3)),
      z: Number(point.z.toFixed(3)),
    };
    if (Number.isFinite(Number(point.targetX))) serialized.targetX = Number(Number(point.targetX).toFixed(3));
    if (Number.isFinite(Number(point.targetY))) serialized.targetY = Number(Number(point.targetY).toFixed(3));
    return serialized;
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
      const item = getMapPlaceableStock().find((entry) => entry.id === id);
      if (!item) {
        showToast("Choose stock first.");
        return;
      }
      const hadVisibleMarker = getLivestockMapPlacements().some((placement) => placement.id === id && placement.anchor);
      if (updateLivestockPlacement) {
        updateLivestockPlacement(id, {
          mapPosition: {
            ...coordinate,
            placedAt: new Date().toISOString(),
          },
          mapMarkerHidden: false,
        });
      } else {
        item.mapPosition = {
          ...coordinate,
          placedAt: new Date().toISOString(),
        };
        item.mapMarkerHidden = false;
      }
      state.map.layers.livestock = true;
      state.ui.selectedMapStockId = id;
      $("mapMarkerNote").value = "";
      showToast(hadVisibleMarker ? "Stock marker moved." : "Stock marker placed.");
    }
    saveState();
    renderMapMarkerControls();
    renderMapSummaries();
    renderMap2Settings();
    renderReefMap2({ rebuild: true });
    RC.Insights?.renderInsightsContext?.();
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

  function handleMap2MarkerSelectionPointer(event) {
    const livestockId = getMap2LivestockMarkerHit(event);
    if (!livestockId) return false;
    state.ui.selectedMapStockId = livestockId;
    state.ui.mapTool = "stock";
    state.ui.map2RefinementShape = "navigate";
    map2RefinementDraft = null;
    saveLocalState();
    renderMapMarkerControls();
    renderMap2RefinementControls();
    renderReefMap2({ rebuild: true });
    showToast("Stock marker selected.");
    return true;
  }

  function getMap2LivestockMarkerHit(event) {
    if (!map2Renderer || !map2Camera || !map2Root || !window.THREE) return null;
    const canvas = map2Renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, map2Camera);
    const markers = [];
    map2Root.traverse((child) => {
      if (child.isMesh && child.userData?.map2LivestockMarker) markers.push(child);
    });
    const hits = raycaster.intersectObjects(markers, false);
    return hits[0]?.object?.userData?.livestockId || null;
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

  function updateMap2RefinementOpacity(event) {
    state.ui.map2RefinementOverlayOpacity = clamp(0, 1, finiteNumber(event.target.value, 35) / 100);
    saveLocalState();
    renderMap2RefinementOverlayControls();
    syncMap2RefinementAnnotationOverlay();
    renderReefMap2();
  }

  function handleMapClick(event) {
    const map2View = event.target.closest("[data-map2-view]");
    if (map2View) { setMap2ViewPreset(map2View.dataset.map2View); return true; }

    const map2Nav = event.target.closest("[data-map2-nav]");
    if (map2Nav) {
      state.ui.map2NavTool = ["rotate", "pan"].includes(map2Nav.dataset.map2Nav) ? map2Nav.dataset.map2Nav : "rotate";
      state.ui.mapTool = "navigate";
      state.ui.map2RefinementShape = "navigate";
      map2RefinementDraft = null;
      saveLocalState();
      renderMapMarkerControls();
      renderMap2Settings();
      renderReefMap2({ rebuild: true });
      return true;
    }

    if (event.target.closest("[data-map2-reset-camera]")) { resetMap2Camera(); return true; }

    if (event.target.closest("[data-map2-refinement-overlay-toggle]")) {
      state.ui.map2RefinementOverlayVisible = !getMap2RefinementOverlayVisible();
      saveLocalState();
      renderMap2RefinementControls();
      syncMap2RefinementAnnotationOverlay();
      renderReefMap2();
      return true;
    }

    const map2RefineShape = event.target.closest("[data-map2-refine-shape]");
    if (map2RefineShape) {
      state.ui.mapTool = "navigate";
      state.ui.map2RefinementShape = MAP2_REFINEMENT_SHAPES.includes(map2RefineShape.dataset.map2RefineShape)
        ? map2RefineShape.dataset.map2RefineShape : "navigate";
      map2RefinementDraft = null;
      saveLocalState();
      renderMapMarkerControls();
      renderMap2RefinementControls();
      renderReefMap2({ rebuild: true });
      return true;
    }

    if (event.target.closest("[data-map2-refinement-finish]")) { finishMap2RefinementArea(); return true; }
    if (event.target.closest("[data-map2-refinement-cancel]")) { cancelMap2RefinementDraft(); return true; }

    const map2RefinementDelete = event.target.closest("[data-map2-refinement-delete]");
    if (map2RefinementDelete) {
      state.map.refinementAnnotations = (state.map.refinementAnnotations || [])
        .filter((a) => a.id !== map2RefinementDelete.dataset.map2RefinementDelete);
      saveState();
      renderMap2RefinementControls();
      renderReefMap2({ rebuild: true });
      RC.Insights?.renderInsightsContext?.();
      return true;
    }

    const mapLayer = event.target.closest("[data-map-layer]");
    if (mapLayer) {
      state.map.layers[mapLayer.dataset.mapLayer] = !state.map.layers[mapLayer.dataset.mapLayer];
      saveState();
      renderMapSettings();
      renderReefMap2({ rebuild: true });
      RC.Insights?.renderInsightsContext?.();
      return true;
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
      return true;
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
      renderReefMap2({ rebuild: true });
      showToast("Click the map to set this stock marker.");
      return true;
    }

    return false;
  }

  function bindMapEvents() {
    $$("[data-map-dimension]").forEach((input) => {
      input.addEventListener("input", updateMapFromSettings);
      input.addEventListener("change", updateMapFromSettings);
    });
    $("mapSettingsForm").addEventListener("submit", (e) => e.preventDefault());
    $("mapMarkerForm").addEventListener("submit", (e) => e.preventDefault());
    $("map2RefineForm")?.addEventListener("submit", (e) => e.preventDefault());
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
      renderMapMarkerControls();
      if (getMapTool() === "stock") renderReefMap2({ rebuild: true });
    });
  }

  window.RC.Map = {
    renderMapSettings, renderMap2Settings, renderMapSummaries, renderMapMarkerControls,
    renderMap2RefinementControls, updateMapFromSettings, renderReefMap2,
    syncMap2RefinementAnnotationOverlay, applyMap2ViewPreset, setMap2ViewPreset,
    resetMap2Camera, handleMapClick, bindMapEvents,
    getLivestockMapPlacements, getMap2RefinementAnnotationsForCurrentGeometry, getMapStructureName,
  };
})();
