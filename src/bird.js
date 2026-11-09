import * as THREE from "three";

// Low-poly birds with layered, feathered wings. Each wing has an inner arm
// (coverts over a row of secondary feathers) and an outer hand (primary
// feathers fanning out to the wingtip) that bends at the wrist, so a flap
// ripples out along the wing instead of swinging it like a plank.
//
// Bird faces +z, up is +y; side +1 is +x (the bird's left), side -1 is -x.

export const BIRDS = {
  dove: {
    name: "White dove",
    body: 0xfbfaf6, head: 0xfefdf9, covert: 0xffffff, secondary: 0xf5f4f0, primary: 0xeeeff2,
    tip: 0xd9dde4, tail: 0xf8f7f3, beak: 0xe3a2a6, cere: 0xf6eeee,
    span: 1.25, armFeathers: 8, primaries: 9,
  },
  eagle: {
    name: "Bald eagle",
    body: 0x44352c, head: 0xf4eee0, covert: 0x5a4434, secondary: 0x4a392e, primary: 0x3b2f27,
    tip: 0x241f1c, tail: 0xeee9dc, beak: 0xe6b348,
    span: 1.2, armFeathers: 8, primaries: 8, tipFeathers: 5,
  },
  pigeon: {
    name: "Pigeon",
    body: 0x87929e, head: 0x657681, covert: 0xa6b0b9, secondary: 0x98a3ad, primary: 0x7c8692,
    tip: 0x414753, tail: 0x485462, beak: 0x45414a, bar: 0x4a505b,
    span: 0.9, armFeathers: 7, primaries: 8,
  },
  gull: {
    name: "Seagull",
    body: 0xf1eee4, head: 0xfffaf0, covert: 0xc6cfd5, secondary: 0xd0d8dd, primary: 0xb9c2c9,
    tip: 0x2c323b, tail: 0xeceee9, beak: 0xe8b444,
    span: 1.15, armFeathers: 8, primaries: 9, tipFeathers: 4,
  },
};

// A flat feather outline lying in the XZ plane: base at the origin, tip at
// z = -1 (pointing backward), widest just behind the base. Scaled per feather.
function createFeatherGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.6, 0.12, 0.5, 0.55);
  s.quadraticCurveTo(0.4, 0.96, 0, 1);
  s.quadraticCurveTo(-0.32, 0.92, -0.4, 0.52);
  s.quadraticCurveTo(-0.46, 0.12, 0, 0);
  const g = new THREE.ShapeGeometry(s, 5);
  g.rotateX(-Math.PI / 2); // shape +y -> -z (backward), face normal +z -> +y (up)
  return g;
}

export function createBird(species = "dove") {
  const c = BIRDS[species] ?? BIRDS.dove;
  const group = new THREE.Group();
  const materials = new Map();
  const sphere = new THREE.SphereGeometry(1, 16, 10);
  const feather = createFeatherGeometry();

  function material(color) {
    if (!materials.has(color)) {
      // A little self-glow keeps light plumage bright white in the warm sunset light.
      materials.set(color, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.14, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide }));
    }
    return materials.get(color);
  }
  function oval(parent, color, position, scale) {
    const mesh = new THREE.Mesh(sphere, material(color));
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  }
  // A feather from `base`, pointing backward then turned by `angle` toward the
  // wingtip on `side` (0 = straight back), drooping slightly (`droop`).
  function addFeather(parent, color, base, width, length, angle, side, droop = 0.04) {
    const mesh = new THREE.Mesh(feather, material(color));
    mesh.position.set(...base);
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = -side * angle;
    mesh.rotation.x = -droop; // tip hangs slightly below the base
    mesh.scale.set(width, 1, length);
    parent.add(mesh);
    return mesh;
  }

  // --- Body ---
  const isDove = species === "dove";
  oval(group, c.body, [0, 0, 0], [0.27, 0.26, 0.68]);
  if (isDove) oval(group, c.body, [0, -0.03, 0.28], [0.265, 0.27, 0.36]); // full, rounded chest
  oval(group, c.head, [0, 0.17, 0.62], isDove ? [0.19, 0.2, 0.22] : [0.22, 0.24, 0.32]);
  if (species === "pigeon") {
    oval(group, 0x3e7773, [0, 0.09, 0.4], [0.235, 0.265, 0.27]);
    oval(group, c.head, [0, 0.22, 0.66], [0.19, 0.22, 0.24]);
  }
  const beakRadius = species === "eagle" ? 0.105 : isDove ? 0.05 : 0.065;
  const beakLength = isDove ? 0.18 : 0.3;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(beakRadius, beakLength, 12), material(c.beak));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, isDove ? 0.14 : 0.12, isDove ? 0.88 : 0.97);
  group.add(beak);
  if (species === "eagle") oval(group, c.beak, [0, 0.08, 1.06], [0.065, 0.085, 0.075]);
  if (isDove) oval(group, c.cere, [0, 0.17, 0.79], [0.055, 0.04, 0.05]);
  for (const side of [-1, 1]) {
    const eyeZ = isDove ? 0.7 : 0.75;
    const eyeX = isDove ? 0.155 : 0.19;
    if (!isDove) oval(group, 0xd6af58, [side * eyeX, 0.235, eyeZ], [0.043, 0.043, 0.038]);
    oval(group, 0x14161c, [side * (eyeX + 0.025), isDove ? 0.21 : 0.24, eyeZ + 0.01], [0.022, 0.03, 0.027]);
  }

  // --- Tail: a fan of feathers ---
  const tailFeathers = isDove ? 9 : 7;
  for (let i = 0; i < tailFeathers; i++) {
    const f = i / (tailFeathers - 1) - 0.5;
    addFeather(group, c.tail, [f * 0.18, 0.0, -0.5], 0.2, isDove ? 0.62 : 0.56, f * (isDove ? 1.0 : 0.7), 1, 0.06);
  }

  // --- Wings ---
  const armLength = 0.8 * c.span;
  const handLength = 0.62 * c.span;
  const wings = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.2, 0.1, 0.14);
    group.add(arm);

    // Leading edge of the inner wing, then secondaries under a row of coverts.
    oval(arm, c.covert, [side * armLength * 0.5, 0.0, 0.04], [armLength * 0.52, 0.065, 0.14]);
    for (let i = 0; i < c.armFeathers; i++) {
      const t = i / (c.armFeathers - 1);
      const color = species === "pigeon" && (i === 3 || i === 5) ? c.bar : c.secondary;
      addFeather(arm, color, [side * (0.06 + t * armLength * 0.95), -0.012, 0.02], 0.27, (0.62 + t * 0.08) * Math.max(c.span, 1), 0.04 + t * 0.06, side, 0.06);
    }
    for (let i = 0; i < c.armFeathers - 1; i++) {
      const t = i / (c.armFeathers - 2);
      addFeather(arm, c.covert, [side * (0.08 + t * armLength * 0.9), 0.02, 0.12], 0.24, 0.32, 0.04 + t * 0.05, side, 0.02);
    }

    // Outer hand: primaries fan from pointing back to pointing out at the tip.
    const hand = new THREE.Group();
    hand.position.set(side * armLength, 0, 0.02);
    arm.add(hand);
    oval(hand, c.covert, [side * handLength * 0.45, 0.0, 0.02], [handLength * 0.5, 0.05, 0.11]);
    const tipCount = c.tipFeathers ?? 3;
    for (let i = 0; i < c.primaries; i++) {
      const t = i / (c.primaries - 1);
      const color = i >= c.primaries - tipCount ? c.tip : c.primary;
      addFeather(hand, color, [side * (0.04 + t * handLength * 0.92), -0.012, 0.03], 0.25 - t * 0.04, (0.7 + t * 0.3) * c.span, 0.12 + t * 0.95, side, 0.05);
    }
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      addFeather(hand, c.covert, [side * (0.05 + t * handLength * 0.75), 0.018, 0.1], 0.22, 0.3, 0.2 + t * 0.6, side, 0.02);
    }
    wings.push({ side, arm, hand });
  }

  group.rotation.order = "YXZ";
  return {
    group,
    setPose(position, heading, pitch, bank) {
      group.position.set(position.x, position.y, position.z);
      group.rotation.set(-pitch, heading, bank);
    },
    // amount 0 = wings held out in a glide, 1 = full flapping stroke. The hand
    // trails the arm a little and folds back on the upstroke.
    setWingFlap(phase, amount = 1) {
      for (const { side, arm, hand } of wings) {
        const stroke = Math.sin(phase) * amount;
        const handStroke = Math.sin(phase - 0.75) * amount;
        arm.rotation.z = side * (0.2 - stroke * 0.6); // gentle V (dihedral) when gliding
        arm.rotation.y = side * Math.cos(phase) * 0.08 * amount;
        hand.rotation.z = side * (0.06 - handStroke * 0.45);
        hand.rotation.y = side * Math.max(0, -Math.sin(phase + 0.3)) * 0.35 * amount;
      }
    },
    dispose() {
      sphere.dispose();
      feather.dispose();
      group.traverse((obj) => obj.geometry?.dispose());
      materials.forEach((mat) => mat.dispose());
    },
  };
}
