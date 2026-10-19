import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildProject } from '../model/project-builder.js';
import { buildInteriorForUnit } from '../model/interior-builder.js';

const MODE_COLORS = {
  progress: { completed: 0x35d49a, inProgress: 0xffc857, finishing: 0xab7ee8, pending: 0xff6b72, unknown: 0x728496 },
  finance: { onTrack: 0x48cde3, attention: 0xffb84d, deviation: 0xe86b9a, unknown: 0x728496 },
  commercial: {
    available: 0x32d6a0,
    inventory: 0x22c7d6,
    reserved: 0xffbe55,
    sold: 0xeab308,
    transferred: 0xef4444,
    delivered: 0x3b82f6,
    cpp: 0xab7ee8,
    unknown: 0x728496
  }
};
const TOWER_PROGRESS_COLORS = {
  unknown: 0x728496,
  projected: 0x6b8fa3,
  pending: 0xff6b72,
  inProgress: 0xffc857,
  finishing: 0xab7ee8,
  completed: 0x35d49a
};

export class RealEstateViewer {
  constructor(canvas, project, onSelect, onInteriorChange, onTowerSelect) {
    this.canvas = canvas;
    this.project = project;
    this.onSelect = onSelect;
    this.onInteriorChange = onInteriorChange;
    this.onTowerSelect = onTowerSelect;
    this.mode = 'commercial';
    this.selectedUnit = null;
    this.selectedTower = null;
    this.towerEditMode = false;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a2233);
    this.scene.fog = new THREE.FogExp2(0x0a2233, 0.0042);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
    this.camera.position.set(145, 100, 165);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.target.set(0, 36, 0);
    this.controls.minDistance = 24;
    this.controls.maxDistance = 240;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.interiorRoot = null;
    this.interiorMode = false;
    this.cameraTransition = null;
    this.exteriorElements = [];
    this.exteriorBackground = this.scene.background;
    this.exteriorFog = this.scene.fog;

    const built = buildProject(project);
    this.projectRoot = built.root;
    this.towers = built.towers;
    this.units = built.units;
    this.prepareTowerMaterials();
    this.scene.add(this.projectRoot);
    this.addEnvironment();
    this.setMode(this.mode);
    this.bindEvents();
    this.resize();
    this.animate();
  }

  addEnvironment() {
    this.scene.add(new THREE.HemisphereLight(0xdaf4ff, 0x315a52, 4.8));
    const sun = new THREE.DirectionalLight(0xffe7be, 5.8);
    sun.position.set(-48, 86, 62);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -70;
    sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.00025;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x79c8e5, 1.6);
    fill.position.set(62, 34, -70);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(125, 96),
      new THREE.MeshStandardMaterial({ color: 0x23483f, roughness: 0.94, metalness: 0.01 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.exteriorElements.push(ground);

    const ocean = new THREE.Mesh(
      new THREE.BoxGeometry(230, 0.12, 76),
      new THREE.MeshPhysicalMaterial({ color: 0x16768e, roughness: 0.16, metalness: 0.08, clearcoat: 0.75 })
    );
    ocean.position.set(0, -0.01, 82);
    ocean.receiveShadow = true;
    this.scene.add(ocean);
    this.exteriorElements.push(ocean);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(34, 34.15, 128),
      new THREE.MeshBasicMaterial({ color: 0x2c8298, transparent: true, opacity: 0.42, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);
    this.exteriorElements.push(ring);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('pointerdown', (event) => {
      this.downPoint = { x: event.clientX, y: event.clientY };
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (this.interiorMode) return;
      if (!this.downPoint || Math.hypot(event.clientX - this.downPoint.x, event.clientY - this.downPoint.y) > 5) return;
      this.pick(event);
    });
    this.canvas.addEventListener('dblclick', (event) => {
      if (this.interiorMode || this.towerEditMode) return;
      this.pick(event);
      if (this.selectedUnit) this.enterInterior();
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
  }

  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.towerEditMode) {
      const editableTowers = [...this.towers.values()].filter(tower => tower.userData.editable && tower.visible);
      const hit = this.raycaster.intersectObjects(editableTowers, true)[0];
      let tower = hit?.object || null;
      while (tower && tower.userData?.kind !== 'tower') tower = tower.parent;
      this.selectTower(tower?.userData?.editable ? tower : null);
      return;
    }
    const candidates = [...this.units.values()]
      .filter((unit) => unit.visible && unit.userData.bank73UnitId)
      .map((unit) => unit.userData.selectableMesh);
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    this.selectUnit(hit?.object?.userData?.unitRoot || null);
  }

  selectUnit(unit) {
    if (this.selectedUnit) {
      this.selectedUnit.userData.selectableMesh.material.emissive.setHex(0x000000);
      this.selectedUnit.userData.selectableMesh.material.emissiveIntensity = 0;
    }
    this.selectedUnit = unit;
    if (unit) {
      const material = unit.userData.selectableMesh.material;
      material.emissive.setHex(0x62ddff);
      material.emissiveIntensity = 0.72;
    }
    this.onSelect?.(unit?.userData || null);
  }

  prepareTowerMaterials() {
    this.towers.forEach(tower => {
      tower.traverse(object => {
        if (!object.isMesh || !object.material) return;
        if (Array.isArray(object.material)) object.material = object.material.map(material => material.clone());
        else object.material = object.material.clone();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        object.userData.viewerBaseMaterials = materials.map(material => ({
          color: material.color?.getHex?.(),
          emissive: material.emissive?.getHex?.(),
          emissiveIntensity: material.emissiveIntensity,
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite
        }));
      });
    });
  }

  restoreTowerMaterials(tower) {
    tower.traverse(object => {
      const base = object.userData?.viewerBaseMaterials;
      if (!object.isMesh || !base) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material, index) => {
        const state = base[index];
        if (!state) return;
        if (state.color != null && material.color) material.color.setHex(state.color);
        if (state.emissive != null && material.emissive) material.emissive.setHex(state.emissive);
        if (state.emissiveIntensity != null) material.emissiveIntensity = state.emissiveIntensity;
        material.transparent = state.transparent;
        material.opacity = state.opacity;
        material.depthWrite = state.depthWrite;
      });
    });
  }

  towerPayload(tower) {
    if (!tower) return null;
    return {
      towerId: tower.userData.towerId,
      name: tower.userData.name || tower.name,
      constructionStatus: tower.userData.constructionStatus || 'unknown',
      visible: tower.userData.visible !== false,
      appearance: tower.userData.appearance || 'solid',
      editable: tower.userData.editable === true
    };
  }

  applyTowerPresentation(tower) {
    this.restoreTowerMaterials(tower);
    const selected = this.towerEditMode && this.selectedTower === tower;
    tower.visible = tower.userData.visible !== false || selected;
    const tint = this.mode === 'progress' && tower.userData.editable
      ? TOWER_PROGRESS_COLORS[tower.userData.constructionStatus] || TOWER_PROGRESS_COLORS.unknown
      : null;
    tower.traverse(object => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (tint != null && material.color) material.color.setHex(tint);
        if (tower.userData.appearance === 'translucent' || (selected && tower.userData.visible === false)) {
          material.transparent = true;
          material.opacity = selected && tower.userData.visible === false ? 0.24 : 0.38;
          material.depthWrite = false;
        }
        if (selected && material.emissive) {
          material.emissive.setHex(tint ?? 0xffffff);
          material.emissiveIntensity = 0.12;
        }
      });
    });
  }

  selectTower(tower) {
    this.selectedTower = tower || null;
    this.towers.forEach(item => {
      if (item.userData.editable) this.applyTowerPresentation(item);
    });
    this.onTowerSelect?.(this.towerPayload(this.selectedTower));
  }

  selectTowerById(towerId) {
    const tower = this.towers.get(String(towerId || ''));
    this.selectTower(tower?.userData?.editable ? tower : null);
  }

  setTowerEditMode(active) {
    this.towerEditMode = Boolean(active);
    if (this.towerEditMode) {
      this.selectUnit(null);
      this.selectTowerById(this.selectedTower?.userData?.towerId || 'A');
    } else {
      this.selectTower(null);
      this.setMode(this.mode);
    }
  }

  updateTower(data = {}) {
    const tower = this.towers.get(String(data.towerId || ''));
    if (!tower || !tower.userData.editable) return;
    tower.userData.name = data.name || tower.userData.name;
    tower.name = tower.userData.name;
    tower.userData.constructionStatus = data.constructionStatus || 'unknown';
    tower.userData.visible = data.visible !== false;
    tower.userData.appearance = data.appearance || 'solid';
    this.selectTower(tower);
  }

  setMode(mode) {
    this.mode = mode;
    this.towers.forEach(tower => {
      if (tower.userData.editable) this.applyTowerPresentation(tower);
    });
    this.units.forEach((unit) => {
      const data = unit.userData;
      const tower = this.towers.get(data.towerId);
      if (mode === 'progress' && tower?.userData?.editable) return;
      const state = data[mode].status;
      const color = MODE_COLORS[mode][state] || MODE_COLORS[mode].unknown;
      unit.userData.selectableMesh.material.color.setHex(color);
    });
    if (this.selectedUnit) {
      this.selectedUnit.userData.selectableMesh.material.emissive.setHex(0x62ddff);
      this.selectedUnit.userData.selectableMesh.material.emissiveIntensity = 0.72;
    }
  }

  filter(towerId = 'all', floor = 'all') {
    if (this.interiorMode) this.exitInterior();
    this.towers.forEach((tower, id) => {
      const configuredVisible = tower.userData.visible !== false || (this.towerEditMode && this.selectedTower === tower);
      tower.visible = configuredVisible && (towerId === 'all' || id === towerId);
    });
    this.units.forEach((unit) => {
      unit.visible = (towerId === 'all' || unit.userData.towerId === towerId) && (floor === 'all' || String(unit.userData.floor) === String(floor));
    });
    if (this.selectedUnit && !this.selectedUnit.visible) this.selectUnit(null);
  }

  focusTower(towerId) {
    if (this.interiorMode) this.exitInterior();
    if (towerId === 'all') { this.resetView(); return; }
    const tower = this.towers.get(towerId);
    if (!tower) return;
    this.cameraTransition = null;
    const world = tower.getWorldPosition(new THREE.Vector3());
    const isHighRise = towerId === 'A' || towerId === 'B';
    this.controls.target.set(world.x, isHighRise ? 45 : 7, world.z);
    this.camera.position.set(world.x + (isHighRise ? 58 : 54), isHighRise ? 58 : 26, world.z + (isHighRise ? 64 : 48));
  }

  resetView() {
    if (this.interiorMode) {
      this.focusInterior();
      return;
    }
    this.cameraTransition = null;
    this.controls.target.set(0, 36, 0);
    this.camera.position.set(145, 100, 165);
    this.controls.update();
  }

  moveCamera(position, target, duration = 700) {
    this.cameraTransition = {
      start: performance.now(), duration,
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone()
    };
  }

  focusInterior() {
    if (!this.interiorRoot) return;
    const { width, depth } = this.interiorRoot.userData;
    const size = Math.max(width, depth);
    this.moveCamera(
      new THREE.Vector3(size * 1.24, size * 1.18, size * 1.48),
      new THREE.Vector3(0, 0.2, 0),
      600
    );
  }

  enterInterior() {
    if (!this.selectedUnit || this.selectedUnit.userData.interiorAvailable === false || this.interiorMode) return false;
    this.savedView = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      minDistance: this.controls.minDistance,
      maxDistance: this.controls.maxDistance,
      maxPolarAngle: this.controls.maxPolarAngle
    };
    this.interiorRoot = buildInteriorForUnit(this.selectedUnit.userData);
    this.interiorRoot.position.y = 0.12;
    this.scene.add(this.interiorRoot);
    this.projectRoot.visible = false;
    this.exteriorElements.forEach((element) => { element.visible = false; });
    this.scene.background = new THREE.Color(0x163846);
    this.scene.fog = new THREE.FogExp2(0x163846, 0.012);
    this.renderer.toneMappingExposure = 1.12;
    this.interiorMode = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 42;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.focusInterior();
    this.onInteriorChange?.(true, this.selectedUnit.userData, this.interiorRoot.userData);
    return true;
  }

  exitInterior() {
    if (!this.interiorMode) return false;
    if (this.interiorRoot) {
      const oldInterior = this.interiorRoot;
      this.scene.remove(oldInterior);
      oldInterior.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose?.());
        else object.material?.dispose?.();
      });
    }
    this.interiorRoot = null;
    this.interiorMode = false;
    this.projectRoot.visible = true;
    this.exteriorElements.forEach((element) => { element.visible = true; });
    this.scene.background = this.exteriorBackground;
    this.scene.fog = this.exteriorFog;
    this.renderer.toneMappingExposure = 1.45;
    if (this.savedView) {
      this.controls.minDistance = this.savedView.minDistance;
      this.controls.maxDistance = this.savedView.maxDistance;
      this.controls.maxPolarAngle = this.savedView.maxPolarAngle;
      this.moveCamera(this.savedView.position, this.savedView.target, 650);
    }
    this.onInteriorChange?.(false, this.selectedUnit?.userData || null, null);
    return true;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.cameraTransition) {
      const elapsed = performance.now() - this.cameraTransition.start;
      const linear = Math.min(1, elapsed / this.cameraTransition.duration);
      const eased = linear < 0.5 ? 4 * linear ** 3 : 1 - ((-2 * linear + 2) ** 3) / 2;
      this.camera.position.lerpVectors(this.cameraTransition.fromPosition, this.cameraTransition.toPosition, eased);
      this.controls.target.lerpVectors(this.cameraTransition.fromTarget, this.cameraTransition.toTarget, eased);
      if (linear >= 1) this.cameraTransition = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
