import * as THREE from 'three';

const palette = {
  walls: 0xcbd2ce,
  wallEdge: 0x8b9693,
  living: 0xa9d8ca,
  bedroom: 0xc8add8,
  bath: 0x9dcbd8,
  kitchen: 0xd9bc7c,
  terrace: 0xc59861,
  furniture: 0x6f7f80,
  accent: 0x2d8f91
};

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.02, ...options });
}

function addBox(group, { x, z, width, depth, height, y = 0, color, name }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
  mesh.position.set(x, y + height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name || '';
  group.add(mesh);
  return mesh;
}

function addRoomFloor(group, room, totalWidth, totalDepth) {
  const floor = addBox(group, {
    x: -totalWidth / 2 + room.x + room.w / 2,
    z: -totalDepth / 2 + room.z + room.d / 2,
    width: room.w - 0.08,
    depth: room.d - 0.08,
    height: 0.09,
    color: palette[room.kind] || palette.living,
    name: room.label
  });
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(floor.geometry),
    new THREE.LineBasicMaterial({ color: palette.wallEdge, transparent: true, opacity: 0.55 })
  );
  outline.position.copy(floor.position);
  group.add(outline);
}

function addWall(group, x, z, width, depth, height = 1.35) {
  addBox(group, { x, z, width, depth, height, color: palette.walls });
}

function addPerimeter(group, width, depth) {
  const t = 0.13;
  addWall(group, 0, -depth / 2, width, t);
  addWall(group, -width / 2, 0, t, depth);
  addWall(group, width / 2, 0, t, depth);
  // The front wall is deliberately interrupted to expose living room and terrace.
  addWall(group, -width * 0.36, depth / 2, width * 0.24, t, 0.72);
  addWall(group, width * 0.36, depth / 2, width * 0.24, t, 0.72);
}

function addPartitions(group, template) {
  template.walls.forEach((wall) => {
    const x = -template.width / 2 + wall.x;
    const z = -template.depth / 2 + wall.z;
    addWall(group, x, z, wall.horizontal ? wall.length : 0.11, wall.horizontal ? 0.11 : wall.length, wall.height || 1.18);
  });
}

function addBed(group, x, z, rotation = 0) {
  const bed = new THREE.Group();
  addBox(bed, { x: 0, z: 0, width: 1.45, depth: 2.05, height: 0.28, color: 0xd9d5cb });
  addBox(bed, { x: 0, z: -0.72, width: 1.35, depth: 0.48, height: 0.16, y: 0.28, color: 0xf4f0e7 });
  bed.position.set(x, 0.1, z);
  bed.rotation.y = rotation;
  group.add(bed);
}

function addSofa(group, x, z, rotation = 0) {
  const sofa = new THREE.Group();
  addBox(sofa, { x: 0, z: 0, width: 2.1, depth: 0.78, height: 0.42, color: palette.furniture });
  addBox(sofa, { x: 0, z: -0.31, width: 2.1, depth: 0.13, height: 0.55, y: 0.35, color: 0x7f9292 });
  sofa.position.set(x, 0.1, z);
  sofa.rotation.y = rotation;
  group.add(sofa);
}

function addKitchen(group, x, z, width, rotation = 0) {
  const kitchen = new THREE.Group();
  addBox(kitchen, { x: 0, z: 0, width, depth: 0.58, height: 0.78, color: 0xb68c5c });
  addBox(kitchen, { x: 0, z: 0, width: width + 0.04, depth: 0.62, height: 0.06, y: 0.78, color: 0xe4ded1 });
  kitchen.position.set(x, 0, z);
  kitchen.rotation.y = rotation;
  group.add(kitchen);
}

function addDining(group, x, z) {
  addBox(group, { x, z, width: 1.45, depth: 1.0, height: 0.08, y: 0.68, color: 0x9d7954 });
  [[-0.9, 0], [0.9, 0], [0, -0.72], [0, 0.72]].forEach(([dx, dz]) => {
    addBox(group, { x: x + dx, z: z + dz, width: 0.42, depth: 0.42, height: 0.45, color: 0x597071 });
  });
}

function addBathroomFixtures(group, x, z) {
  addBox(group, { x, z, width: 0.72, depth: 0.48, height: 0.42, color: 0xf5f5f0 });
  addBox(group, { x: x + 0.8, z, width: 0.5, depth: 0.42, height: 0.62, color: 0xf5f5f0 });
}

const templates = {
  '1 recámara': {
    width: 7.2, depth: 11.2,
    rooms: [
      { label: 'Cocina', kind: 'kitchen', x: 0, z: 0, w: 3.0, d: 3.1 },
      { label: 'Baño', kind: 'bath', x: 3.0, z: 0, w: 2.1, d: 3.1 },
      { label: 'Acceso', kind: 'living', x: 5.1, z: 0, w: 2.1, d: 3.1 },
      { label: 'Dormitorio', kind: 'bedroom', x: 0, z: 3.1, w: 3.25, d: 4.5 },
      { label: 'Salón / comedor', kind: 'living', x: 3.25, z: 3.1, w: 3.95, d: 6.7 },
      { label: 'Terraza', kind: 'terrace', x: 0, z: 7.6, w: 3.25, d: 3.6 }
    ],
    walls: [
      { x: 3.0, z: 1.55, length: 3.1 }, { x: 5.1, z: 1.55, length: 3.1 },
      { x: 1.62, z: 3.1, length: 3.25, horizontal: true },
      { x: 3.25, z: 5.35, length: 4.5 },
      { x: 1.62, z: 7.6, length: 3.25, horizontal: true }
    ],
    furnish(group) {
      addKitchen(group, -2.1, -4.65, 2.2);
      addBathroomFixtures(group, 0.2, -4.65);
      addBed(group, -2.0, -1.0);
      addSofa(group, 1.7, 1.65, Math.PI / 2);
      addDining(group, 1.7, -1.0);
    }
  },
  '2 recámaras': {
    width: 9.6, depth: 12.2,
    rooms: [
      { label: 'Cocina', kind: 'kitchen', x: 0, z: 0, w: 3.1, d: 3.1 },
      { label: 'Baño 1', kind: 'bath', x: 3.1, z: 0, w: 2.2, d: 3.1 },
      { label: 'Baño 2', kind: 'bath', x: 5.3, z: 0, w: 2.1, d: 3.1 },
      { label: 'Acceso', kind: 'living', x: 7.4, z: 0, w: 2.2, d: 3.1 },
      { label: 'Dormitorio 2', kind: 'bedroom', x: 0, z: 3.1, w: 3.5, d: 4.5 },
      { label: 'Dormitorio principal', kind: 'bedroom', x: 0, z: 7.6, w: 3.5, d: 4.6 },
      { label: 'Salón / comedor', kind: 'living', x: 3.5, z: 3.1, w: 6.1, d: 6.4 },
      { label: 'Terraza', kind: 'terrace', x: 3.5, z: 9.5, w: 6.1, d: 2.7 }
    ],
    walls: [
      { x: 3.1, z: 1.55, length: 3.1 }, { x: 5.3, z: 1.55, length: 3.1 }, { x: 7.4, z: 1.55, length: 3.1 },
      { x: 1.75, z: 3.1, length: 3.5, horizontal: true },
      { x: 3.5, z: 5.35, length: 4.5 },
      { x: 1.75, z: 7.6, length: 3.5, horizontal: true },
      { x: 3.5, z: 9.5, length: 6.1, horizontal: true }
    ],
    furnish(group) {
      addKitchen(group, -3.25, -5.15, 2.35);
      addBathroomFixtures(group, -0.55, -5.15);
      addBed(group, -3.05, -1.0);
      addBed(group, -3.05, 3.55);
      addSofa(group, 2.1, 1.8, Math.PI / 2);
      addDining(group, 1.4, -1.05);
    }
  },
  '3 recámaras': {
    width: 12.4, depth: 13.0,
    rooms: [
      { label: 'Cocina', kind: 'kitchen', x: 0, z: 0, w: 3.4, d: 3.2 },
      { label: 'Baño 1', kind: 'bath', x: 3.4, z: 0, w: 2.1, d: 3.2 },
      { label: 'Baño 2', kind: 'bath', x: 5.5, z: 0, w: 2.1, d: 3.2 },
      { label: 'Acceso', kind: 'living', x: 7.6, z: 0, w: 4.8, d: 3.2 },
      { label: 'Dormitorio 2', kind: 'bedroom', x: 0, z: 3.2, w: 3.5, d: 4.2 },
      { label: 'Dormitorio 3', kind: 'bedroom', x: 0, z: 7.4, w: 3.5, d: 5.6 },
      { label: 'Dormitorio principal', kind: 'bedroom', x: 3.5, z: 3.2, w: 3.6, d: 4.5 },
      { label: 'Salón / comedor', kind: 'living', x: 7.1, z: 3.2, w: 5.3, d: 7.2 },
      { label: 'Terraza', kind: 'terrace', x: 3.5, z: 10.4, w: 8.9, d: 2.6 }
    ],
    walls: [
      { x: 3.4, z: 1.6, length: 3.2 }, { x: 5.5, z: 1.6, length: 3.2 }, { x: 7.6, z: 1.6, length: 3.2 },
      { x: 1.75, z: 3.2, length: 3.5, horizontal: true },
      { x: 3.5, z: 5.3, length: 4.2 }, { x: 7.1, z: 5.45, length: 4.5 },
      { x: 1.75, z: 7.4, length: 3.5, horizontal: true },
      { x: 5.3, z: 10.4, length: 3.6, horizontal: true }
    ],
    furnish(group) {
      addKitchen(group, -4.65, -5.45, 2.5);
      addBathroomFixtures(group, -1.6, -5.45);
      addBed(group, -4.35, -1.2);
      addBed(group, -4.35, 3.35);
      addBed(group, -1.0, -1.15);
      addSofa(group, 3.4, 1.9, Math.PI / 2);
      addDining(group, 3.15, -1.1);
    }
  }
};

templates.PH = {
  ...templates['3 recámaras'],
  width: 14.2,
  depth: 14.4,
  rooms: templates['3 recámaras'].rooms.map((room) => ({ ...room, w: room.w + (room.x > 6 ? 1.8 : 0), d: room.d + (room.z > 9 ? 1.4 : 0) })),
  furnish(group) {
    templates['3 recámaras'].furnish(group);
    addSofa(group, 5.0, 3.8, 0);
  }
};

export function buildInteriorForUnit(unitData) {
  const template = templates[unitData.apartmentModel] || templates['1 recámara'];
  const root = new THREE.Group();
  root.name = `Interior ${unitData.unitId}`;
  root.userData = {
    kind: 'interior',
    unitId: unitData.unitId,
    approximation: true,
    source: 'Aproximación tipológica basada en planos aprobados y renders disponibles',
    width: template.width,
    depth: template.depth
  };

  template.rooms.forEach((room) => addRoomFloor(root, room, template.width, template.depth));
  addPerimeter(root, template.width, template.depth);
  addPartitions(root, template);
  template.furnish(root);

  const terraceEdge = new THREE.Mesh(
    new THREE.BoxGeometry(template.width * 0.62, 0.7, 0.045),
    new THREE.MeshPhysicalMaterial({ color: 0x8bc4cd, transparent: true, opacity: 0.42, roughness: 0.12 })
  );
  terraceEdge.position.set(template.width * 0.15, 0.36, template.depth / 2 + 0.2);
  root.add(terraceEdge);

  return root;
}

export function getInteriorTemplate(type) {
  return templates[type] || templates['1 recámara'];
}
