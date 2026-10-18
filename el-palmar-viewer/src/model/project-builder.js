import * as THREE from 'three';
import { createUnitData } from '../data/unit-data.js';

const architectural = {
  wall: 0xf0e7d7,
  concrete: 0xc7bca9,
  accent: 0x4e696b,
  glass: 0x4d9aae,
  railing: 0x86c7d2,
  stone: 0x8d7b67,
  landscape: 0x3d715f
};

function technicalUnitId(towerId, level, slot) {
  const levelCode = level < 0
    ? `NM${String(Math.abs(level)).padStart(4, '0')}`
    : `N${String(level).padStart(4, '0')}`;
  return `${towerId}-${levelCode}-U${String(slot).padStart(2, '0')}`;
}

function addWindow(group, width, depth, y, side = 1) {
  const window = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.9, width * 0.48), 1.15, 0.08),
    new THREE.MeshPhysicalMaterial({ color: architectural.glass, metalness: 0.08, roughness: 0.12, transparent: true, opacity: 0.88, clearcoat: 0.35 })
  );
  window.position.set(0, y, side * (depth / 2 + 0.045));
  group.add(window);
}

function addBalcony(group, width, depth, baseY, side = 1, style = 'glass') {
  const slabDepth = 1.25;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.8, width * 0.93), 0.13, slabDepth),
    new THREE.MeshStandardMaterial({ color: architectural.concrete, roughness: 0.7 })
  );
  slab.position.set(0, baseY, side * (depth / 2 + slabDepth / 2 - 0.08));
  slab.castShadow = true;
  group.add(slab);

  const railingMaterial = style === 'perforated'
    ? new THREE.MeshStandardMaterial({ color: 0xd5d9d6, roughness: 0.48, transparent: true, opacity: 0.85 })
    : new THREE.MeshPhysicalMaterial({ color: architectural.railing, roughness: 0.08, transparent: true, opacity: 0.5, clearcoat: 0.5 });
  const railing = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.8, width * 0.88), 0.92, 0.045),
    railingMaterial
  );
  railing.position.set(0, baseY + 0.46, side * (depth / 2 + slabDepth - 0.12));
  group.add(railing);

  const postMaterial = new THREE.MeshStandardMaterial({ color: architectural.accent, roughness: 0.55 });
  [-0.43, 0.43].forEach((offset) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.96, 0.055), postMaterial);
    post.position.set(width * offset, baseY + 0.47, side * (depth / 2 + slabDepth - 0.1));
    group.add(post);
  });
}

function createUnit({ tower, floor, spec, width, depth, x, y, z = 0, height, balconyLevels = 1 }) {
  const technicalId = technicalUnitId(tower.id, Number(floor.level), spec.slot);
  const material = new THREE.MeshStandardMaterial({ color: architectural.wall, roughness: 0.48, metalness: 0.015 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width - 0.12, height - 0.14, depth - 0.12), material);
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;

  const unit = new THREE.Group();
  unit.position.set(x, y, z);
  unit.add(body);
  for (let levelIndex = 0; levelIndex < balconyLevels; levelIndex += 1) {
    const localBase = levelIndex * tower.floorHeight + 0.16;
    addWindow(unit, width, depth, localBase + tower.floorHeight * 0.56, 1);
    addBalcony(unit, width, depth, localBase, 1, tower.id === 'C' ? 'perforated' : 'glass');
  }
  unit.userData = createUnitData(technicalId, tower, floor, spec);
  unit.userData.floorLabel = floor.label;
  unit.userData.kind = 'unit';
  unit.userData.selectableMesh = body;
  body.userData.unitRoot = unit;
  return unit;
}

function addFloorBand(group, width, depth, y) {
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.35, 0.14, depth + 0.35),
    new THREE.MeshStandardMaterial({ color: architectural.concrete, roughness: 0.68 })
  );
  band.position.y = y;
  band.castShadow = true;
  group.add(band);
}

function buildHighRise(tower, unitRegistry) {
  const group = new THREE.Group();
  group.name = tower.name;
  group.userData = { kind: 'tower', towerId: tower.id };
  group.position.set(...tower.position);
  group.rotation.y = tower.rotationY;
  const { width, depth } = tower.footprint;
  const residentialDepth = 13.7;
  const residentialZ = (depth - residentialDepth) / 2;

  tower.floors.forEach((floor) => {
    const span = floor.storeySpan || 1;
    const unitWidth = width / floor.units.length;
    const y = (floor.storey - 1) * tower.floorHeight;
    floor.units.forEach((spec, index) => {
      const unit = createUnit({
        tower, floor, spec,
        width: unitWidth,
        depth: residentialDepth,
        x: -width / 2 + unitWidth * (index + 0.5),
        y,
        z: residentialZ,
        height: tower.floorHeight * span,
        balconyLevels: span
      });
      group.add(unit);
      unitRegistry.set(unit.userData.unitId, unit);
    });
    for (let bandIndex = 0; bandIndex < span; bandIndex += 1) {
      addFloorBand(group, width, depth, y + bandIndex * tower.floorHeight + 0.08);
    }
  });

  const totalHeight = 28 * tower.floorHeight;
  const serviceSpine = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.53, totalHeight, depth - residentialDepth + 0.2),
    new THREE.MeshStandardMaterial({ color: 0xc6c5bf, roughness: 0.82 })
  );
  serviceSpine.position.set(0, totalHeight / 2, -depth / 2 + (depth - residentialDepth) / 2);
  serviceSpine.castShadow = true;
  group.add(serviceSpine);

  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xf3eee5, roughness: 0.46 });
  [-width / 2 + 0.22, width / 2 - 0.22].forEach((x) => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.42, totalHeight, 0.48), edgeMaterial);
    edge.position.set(x, totalHeight / 2, depth / 2 + 0.18);
    edge.castShadow = true;
    group.add(edge);
  });

  const twinCoreMaterial = new THREE.MeshStandardMaterial({ color: architectural.accent, roughness: 0.78 });
  [-2.4, 2.4].forEach((x) => {
    const core = new THREE.Mesh(new THREE.BoxGeometry(3.4, totalHeight + 1.8, 3.8), twinCoreMaterial);
    core.position.set(x, (totalHeight + 1.8) / 2, -depth / 2 + 1.8);
    core.castShadow = true;
    group.add(core);
  });

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.65, 0.35, depth + 0.65),
    new THREE.MeshStandardMaterial({ color: 0xb8b6ae, roughness: 0.9 })
  );
  roof.position.y = totalHeight + 0.2;
  group.add(roof);
  return group;
}

function buildTerracedBar(tower, unitRegistry) {
  const group = new THREE.Group();
  group.name = tower.name;
  group.userData = { kind: 'tower', towerId: tower.id };
  group.position.set(...tower.position);
  const { width, depth } = tower.footprint;

  tower.floors.forEach((floor) => {
    const y = (floor.storey - 1) * tower.floorHeight;
    const splitAfter = Math.min(floor.splitAfter || floor.units.length, floor.units.length);
    const coreWidth = floor.coreWidth || 0;
    const residentialWidth = width - coreWidth;
    const leftWidth = splitAfter < floor.units.length ? residentialWidth / 2 : residentialWidth;
    const rightWidth = splitAfter < floor.units.length ? residentialWidth / 2 : 0;
    const placements = [];

    const placeSegment = (items, startX, segmentWidth) => {
      const totalWeight = items.reduce((sum, spec) => sum + (spec.frontageWeight || 1), 0);
      let cursor = startX;
      items.forEach((spec) => {
        const unitWidth = segmentWidth * (spec.frontageWeight || 1) / totalWeight;
        placements.push({ spec, width: unitWidth, x: cursor + unitWidth / 2 });
        cursor += unitWidth;
      });
    };

    placeSegment(floor.units.slice(0, splitAfter), -width / 2, leftWidth);
    if (splitAfter < floor.units.length) {
      placeSegment(floor.units.slice(splitAfter), coreWidth / 2, rightWidth);
    }

    placements.forEach(({ spec, width: unitWidth, x }) => {
      const unit = createUnit({
        tower, floor, spec,
        width: unitWidth,
        depth,
        x,
        y,
        height: tower.floorHeight,
        balconyLevels: 1
      });
      group.add(unit);
      unitRegistry.set(unit.userData.unitId, unit);
    });
    addFloorBand(group, width, depth, y + 0.08);
  });

  const storeyCount = Math.max(...tower.floors.map((floor) => floor.storey + (floor.storeySpan || 1) - 1));
  const towerHeight = storeyCount * tower.floorHeight;
  const coreMaterial = new THREE.MeshStandardMaterial({ color: architectural.accent, roughness: 0.78 });
  [-3.1, 3.1].forEach((x) => {
    const core = new THREE.Mesh(new THREE.BoxGeometry(3.6, towerHeight + 0.9, 3.4), coreMaterial);
    core.position.set(x, towerHeight / 2, -depth / 2 + 1.5);
    group.add(core);
  });
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.4, 0.28, depth + 0.4),
    new THREE.MeshStandardMaterial({ color: 0xb8b6ae, roughness: 0.9 })
  );
  roof.position.y = towerHeight + 0.16;
  group.add(roof);
  return group;
}

function addApprovedSiteElements(root) {
  const basement = new THREE.Group();
  basement.name = 'Basamento y estacionamientos simplificados';
  const basementMaterial = new THREE.MeshStandardMaterial({ color: architectural.stone, roughness: 0.82 });
  const basementBody = new THREE.Mesh(new THREE.BoxGeometry(72, 10.6, 28), basementMaterial);
  basementBody.position.set(0, 5.25, -6.4);
  basementBody.castShadow = true;
  basementBody.receiveShadow = true;
  basement.add(basementBody);

  const openingMaterial = new THREE.MeshStandardMaterial({ color: 0x263c42, roughness: 0.55, metalness: 0.12 });
  for (let level = 0; level < 3; level += 1) {
    const opening = new THREE.Mesh(new THREE.BoxGeometry(66, 1.45, 0.12), openingMaterial);
    opening.position.set(0, 1.95 + level * 2.85, 7.66);
    basement.add(opening);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(72.5, 0.28, 28.4),
      new THREE.MeshStandardMaterial({ color: 0xb5a58f, roughness: 0.74 })
    );
    band.position.set(0, 0.55 + level * 2.85, -6.4);
    basement.add(band);
  }
  root.add(basement);

  const plaza = new THREE.Mesh(
    new THREE.BoxGeometry(78, 0.42, 51),
    new THREE.MeshStandardMaterial({ color: 0xcac0ad, roughness: 0.88 })
  );
  plaza.position.set(0, -0.22, 4);
  plaza.receiveShadow = true;
  root.add(plaza);

  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.28, 7),
    new THREE.MeshPhysicalMaterial({ color: 0x31b7cf, transparent: true, opacity: 0.88, roughness: 0.08, clearcoat: 0.8 })
  );
  pool.position.set(0, 0.04, 24);
  root.add(pool);
  const poolCoping = new THREE.Mesh(
    new THREE.RingGeometry(4.1, 4.45, 4),
    new THREE.MeshStandardMaterial({ color: 0xc9c5b8, roughness: 0.88, side: THREE.DoubleSide })
  );
  poolCoping.scale.set(2.25, 0.9, 1);
  poolCoping.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  poolCoping.position.set(0, 0.18, 24);
  root.add(poolCoping);

  const planterMaterial = new THREE.MeshStandardMaterial({ color: architectural.landscape, roughness: 0.9 });
  [-29, 29].forEach((x) => {
    const planter = new THREE.Mesh(new THREE.BoxGeometry(12, 0.75, 3.2), planterMaterial);
    planter.position.set(x, 0.28, 23.5);
    planter.castShadow = true;
    root.add(planter);
  });
}

export function buildProject(project) {
  const root = new THREE.Group();
  root.name = project.name;
  const towers = new Map();
  const units = new Map();
  project.towers.forEach((towerConfig) => {
    const tower = towerConfig.kind === 'terracedBar'
      ? buildTerracedBar(towerConfig, units)
      : buildHighRise(towerConfig, units);
    towers.set(towerConfig.id, tower);
    root.add(tower);
  });
  addApprovedSiteElements(root);
  return { root, towers, units };
}
