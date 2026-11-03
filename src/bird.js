import * as THREE from "three";

export const BIRDS = {
  eagle: { name: "Bald eagle", body: 0x44352c, head: 0xf4eee0, wing: 0x554334, tip: 0x292522, tail: 0xeee9dc, beak: 0xe6b348, span: 1.65 },
  pigeon: { name: "Pigeon", body: 0x87929e, head: 0x657681, wing: 0xa3adb6, tip: 0x414753, tail: 0x485462, beak: 0x45414a, span: 1.08 },
  gull: { name: "Seagull", body: 0xf1eee4, head: 0xfffaf0, wing: 0xc5ced3, tip: 0x303743, tail: 0xeceee9, beak: 0xe8b444, span: 1.48 },
};

export function createBird(species = "eagle") {
  const c = BIRDS[species] ?? BIRDS.eagle;
  const group = new THREE.Group();
  const materials = new Map();
  function material(color) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.04 }));
    return materials.get(color);
  }
  function oval(parent, color, position, scale) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), material(color));
    mesh.position.set(...position); mesh.scale.set(...scale); parent.add(mesh); return mesh;
  }
  oval(group, c.body, [0, 0, 0], [0.29, 0.28, 0.72]);
  oval(group, c.head, [0, 0.16, 0.62], [0.22, 0.24, 0.32]);
  if (species === "pigeon") {
    oval(group, 0x3e7773, [0, 0.09, 0.4], [0.235, 0.265, 0.27]);
    oval(group, c.head, [0, 0.22, 0.66], [0.19, 0.22, 0.24]);
  }
  const beak = new THREE.Mesh(new THREE.ConeGeometry(species === "eagle" ? 0.105 : 0.065, 0.3, 12), material(c.beak));
  beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.12, 0.97); group.add(beak);
  if (species === "eagle") oval(group, c.beak, [0, 0.08, 1.06], [0.065, 0.085, 0.075]);
  for (const side of [-1, 1]) {
    oval(group, 0xd6af58, [side * 0.19, 0.235, 0.75], [0.043, 0.043, 0.038]);
    oval(group, 0x10191c, [side * 0.218, 0.24, 0.76], [0.02, 0.029, 0.025]);
  }
  for (let i = 0; i < 7; i++) {
    const feather = oval(group, c.tail, [(i - 3) * 0.072, -0.01, -0.79], [0.063, 0.028, 0.38]);
    feather.rotation.y = -(i - 3) * 0.09;
  }
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * 0.22, 0.09, 0.15); group.add(pivot);
    oval(pivot, c.wing, [side * c.span * 0.38, 0, -0.04], [c.span * 0.5, 0.085, 0.32]);
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const feather = oval(pivot, i > 6 ? c.tip : c.wing,
        [side * (0.18 + t * c.span), -0.025, -0.20 - t * 0.12],
        [0.105 - t * 0.027, 0.026, 0.32 + t * 0.13]);
      feather.rotation.y = -side * (0.12 + t * 0.72);
      if (species === "pigeon" && (i === 4 || i === 6)) feather.material = material(c.tip);
    }
    wings.push(pivot);
  }
  group.rotation.order = "YXZ";
  return {
    group,
    setPose(position, heading, pitch, bank) { group.position.set(position.x, position.y, position.z); group.rotation.set(-pitch, heading, bank); },
    setWingFlap(phase) { wings.forEach((wing, i) => { wing.rotation.z = (i === 0 ? 1 : -1) * Math.sin(phase) * 0.48; wing.rotation.y = Math.cos(phase) * (i === 0 ? 1 : -1) * 0.06; }); },
    dispose() { group.traverse(obj => obj.geometry?.dispose()); materials.forEach(mat => mat.dispose()); },
  };
}
