import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  ISLAND_CONSTANTS,
  ISLAND_TEMPLATES,
  BODY_TAPER,
  islandsInRange,
} from "./islands.js";

// Draws the floating islands from islands.js. Each design in ISLAND_TEMPLATES
// is built once, at the base radius, as two meshes: one merged, vertex-coloured,
// flat-shaded mesh for everything solid (grass, sandstone cliffs, ruins,
// cherry trees), and one see-through mesh for its waterfalls. Every island in
// view is then just those two meshes scaled, turned and positioned, so the whole
// sky costs about two draw calls per island.

const R = ISLAND_CONSTANTS.baseRadius;
const VIEW_RANGE = 2500; // islands are drawn up to here (fog hides them by ~2300)
const REFRESH_DISTANCE = 60; // re-check which islands are in view after moving this far

const PALETTE = {
  grass: [0x9fd16a, 0x92c862, 0xa9d878, 0x88bf5c],
  grassEdge: 0x7fb257,
  earth: 0x9a6a4e,
  strata: [0xf0b078, 0xe07f40, 0xf8d4a4, 0xd2693a, 0xee9f64, 0xfae2ba],
  deepRock: [0xae6d7c, 0x9a6384, 0xbb7d84],
  stone: [0xf4e9d4, 0xeadcc2, 0xfaf1e0],
  stoneDark: 0xd9c7a8,
  gold: 0xf5b534,
  trunk: 0x6e4a3c,
  blossom: [0xf9b8cf, 0xf6a3c0, 0xffd0e0, 0xfbc3d6, 0xf191b4],
  leaf: [0x74b05a, 0x5f9f50, 0x86c066],
  water: 0x8fe6dc,
};

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _color = new THREE.Color();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

/**
 * Collects pieces of one island, each coloured per triangle (with a little
 * random shade variation for the low-poly look), then merges them.
 */
function createPartList(rand) {
  const parts = [];
  return {
    /**
     * @param {THREE.BufferGeometry} geometry - consumed (disposed after copying)
     * @param {number|number[]|((x:number,y:number,z:number)=>number)} color - hex, list to pick from, or by position
     * @param {{position?:number[], rotation?:number[], scale?:number[]}} [place]
     */
    add(geometry, color, place = {}, shade = 0.07) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      geometry.dispose();
      g.deleteAttribute("uv");
      _pos.set(...(place.position ?? [0, 0, 0]));
      _quat.setFromEuler(_euler.set(...(place.rotation ?? [0, 0, 0]), "YXZ"));
      _scale.set(...(place.scale ?? [1, 1, 1]));
      g.applyMatrix4(_matrix.compose(_pos, _quat, _scale));
      const p = g.attributes.position;
      const colors = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i += 3) {
        let hex = color;
        if (typeof color === "function") {
          hex = color(
            (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
            (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3,
            (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3
          );
        } else if (Array.isArray(color)) {
          hex = color[Math.floor(rand() * color.length)];
        }
        _color.setHex(hex).multiplyScalar(1 - shade + rand() * shade * 2);
        for (let k = 0; k < 3; k++) _color.toArray(colors, (i + k) * 3);
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    },
    merge() {
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      return merged;
    },
  };
}

// Smooth top shape (matches islands.js islandTopAt at the base radius).
function topHeight(template, d) {
  const f = Math.min(d / R, 1);
  return template.bumpHeight * (1 - f * f);
}

// Inward-only wobble of the cliff outline, periodic around the island. Inward
// only, so the drawn rock never pokes outside the collision shape.
function cliffWobble(angle, y, seed) {
  const a = 0.5 + 0.5 * Math.sin(3 * angle + seed + y * 0.06);
  const b = 0.5 + 0.5 * Math.sin(7 * angle + seed * 2.3 - y * 0.11);
  const c = 0.5 + 0.5 * Math.sin(13 * angle + seed * 0.7 + y * 0.2);
  return 1 - 0.07 * a - 0.05 * b - 0.03 * c;
}

function buildRockBody(parts, template, seed, rand) {
  const depth = template.depthRatio * R;
  // Ring heights from the top down: a grass lip, a band of earth, then
  // sandstone strata a few units thick, each its own row of the lathe so the
  // layers read as clean horizontal bands.
  const ys = [0, -1.5, -4.2];
  for (let y = -4.2; y > -depth + 4; ) {
    y -= 2.4 + rand() * 1.8;
    ys.push(y);
  }
  ys.push(-depth);
  const insets = ys.map((y, i) => (i < 2 || i === ys.length - 1 ? 1 : 0.92 + rand() * 0.08));
  const points = [];
  for (let i = ys.length - 1; i >= 0; i--) {
    const t = -ys[i] / depth; // bottom tip first, so the lathe faces outward
    points.push(new THREE.Vector2(Math.max(R * Math.pow(1 - t, BODY_TAPER) * insets[i], 0.4), ys[i]));
  }
  const lathe = new THREE.LatheGeometry(points, 22);
  const p = lathe.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const w = cliffWobble(Math.atan2(z, x), p.getY(i), seed);
    p.setXYZ(i, x * w, p.getY(i), z * w);
  }

  // One colour per row: grass, earth, then sandstone shades, turning mauve near the tip.
  const rowColors = [PALETTE.grassEdge, PALETTE.earth];
  let last = -1;
  for (let i = 2; i < ys.length - 1; i++) {
    const deep = -ys[i] / depth > 0.6;
    const choices = deep ? PALETTE.deepRock : PALETTE.strata;
    let pick = Math.floor(rand() * choices.length);
    if (pick === last) pick = (pick + 1) % choices.length;
    last = pick;
    rowColors.push(choices[pick]);
  }
  parts.add(
    lathe,
    (x, y) => {
      for (let i = 0; i < ys.length - 1; i++) if (y > ys[i + 1]) return rowColors[i];
      return rowColors[rowColors.length - 1];
    },
    {},
    0.035
  );
}

function buildGrassTop(parts, template, seed, rand) {
  const rings = 7;
  const segments = 22;
  const geometry = new THREE.BufferGeometry();
  const verts = [];
  const ringPoint = (ri, si) => {
    const angle = (si / segments) * Math.PI * 2;
    const f = ri / rings;
    let radius = f * R * 1.035;
    if (ri === rings) radius *= cliffWobble(angle, 0, seed);
    const noise = ri === 0 || ri === rings ? 0 : 0.5 + 0.3 * Math.sin(angle * 5 + ri * 1.7 + seed);
    return [Math.cos(angle) * radius, topHeight(template, radius) + noise, Math.sin(angle) * radius];
  };
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segments; si++) {
      const a = ringPoint(ri, si);
      const b = ringPoint(ri, si + 1);
      const c = ringPoint(ri + 1, si);
      const d = ringPoint(ri + 1, si + 1);
      if (ri === 0) verts.push(...a, ...d, ...c);
      else verts.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geometry.computeVertexNormals();
  parts.add(geometry, PALETTE.grass, {}, 0.06);
}

// A spot on the grass at radius fraction f and angle a, sitting on the surface.
function spot(template, f, angle) {
  const d = f * R;
  return [Math.cos(angle) * d, topHeight(template, d) + 0.3, Math.sin(angle) * d];
}

function addCherryTree(parts, template, at, size, rand, palette = PALETTE.blossom) {
  const [x, y, z] = at;
  const h = 6 * size;
  const lean = (rand() - 0.5) * 0.3;
  parts.add(new THREE.CylinderGeometry(0.35 * size, 0.6 * size, h, 6), PALETTE.trunk, {
    position: [x, y + h / 2, z],
    rotation: [0, 0, lean],
  });
  for (let b = 0; b < 3; b++) {
    const a = rand() * Math.PI * 2;
    parts.add(new THREE.CylinderGeometry(0.15 * size, 0.25 * size, 3 * size, 5), PALETTE.trunk, {
      position: [x + Math.cos(a) * size, y + h * 0.85, z + Math.sin(a) * size],
      rotation: [Math.sin(a) * 0.8, 0, Math.cos(a) * 0.8],
    });
  }
  const blobs = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rand();
    const r = (i === 0 ? 0 : 1.8 + rand() * 1.4) * size;
    const s = (2.2 + rand() * 1.2) * size;
    parts.add(new THREE.IcosahedronGeometry(1, 1), palette, {
      position: [x + Math.cos(a) * r + lean * -h * 0.5, y + h + (rand() - 0.2) * 1.6 * size, z + Math.sin(a) * r],
      scale: [s, s * 0.78, s],
      rotation: [rand(), rand() * 3, 0],
    }, 0.09);
  }
}

function addArch(parts, template, at, angle, size) {
  const [x, y, z] = at;
  const span = 5.5 * size;
  const h = 9 * size;
  const ax = Math.cos(angle + Math.PI / 2);
  const az = Math.sin(angle + Math.PI / 2);
  for (const side of [-1, 1]) {
    parts.add(new THREE.BoxGeometry(2.4 * size, h, 2.4 * size), PALETTE.stone, {
      position: [x + ax * span * side, y + h / 2 - 0.5, z + az * span * side],
      rotation: [0, -angle, 0],
    }, 0.04);
    parts.add(new THREE.BoxGeometry(3.2 * size, 1 * size, 3.2 * size), PALETTE.stoneDark, {
      position: [x + ax * span * side, y + 0.2, z + az * span * side],
      rotation: [0, -angle, 0],
    }, 0.04);
  }
  // Gold trim: a band on each pillar and an angular keystone at the crown.
  for (const side of [-1, 1]) {
    parts.add(new THREE.BoxGeometry(2.8 * size, 0.55 * size, 2.8 * size), PALETTE.gold, {
      position: [x + ax * span * side, y + h * 0.82, z + az * span * side],
      rotation: [0, -angle, 0],
    }, 0.02);
  }
  parts.add(new THREE.OctahedronGeometry(1.7 * size, 0), PALETTE.gold, {
    position: [x, y + h - 0.5 + span + 0.4 * size, z],
    rotation: [0, -angle, 0],
    scale: [1, 1.35, 0.9],
  }, 0.02);
  // Half torus standing upright: TorusGeometry lies in the XY plane, and an arc of PI spans the top half.
  parts.add(new THREE.TorusGeometry(span, 1.25 * size, 6, 12, Math.PI), PALETTE.stone, {
    position: [x, y + h - 0.5, z],
    rotation: [0, -angle + Math.PI / 2, 0],
  }, 0.04);
}

function addColumn(parts, at, size, rand, broken) {
  const [x, y, z] = at;
  const h = (broken ? 2.5 + rand() * 3 : 7 + rand() * 2) * size;
  parts.add(new THREE.BoxGeometry(2.4 * size, 0.9 * size, 2.4 * size), PALETTE.stoneDark, { position: [x, y + 0.1, z] }, 0.04);
  parts.add(new THREE.CylinderGeometry(0.85 * size, 0.95 * size, h, 8), PALETTE.stone, { position: [x, y + h / 2 + 0.4, z] }, 0.05);
  if (!broken) {
    parts.add(new THREE.BoxGeometry(2.2 * size, 0.8 * size, 2.2 * size), PALETTE.stone, { position: [x, y + h + 0.6, z] }, 0.04);
    parts.add(new THREE.BoxGeometry(2.45 * size, 0.3 * size, 2.45 * size), PALETTE.gold, { position: [x, y + h + 0.15, z] }, 0.02);
  }
}

function addFallenColumn(parts, at, size, angle) {
  const [x, y, z] = at;
  parts.add(new THREE.CylinderGeometry(0.85 * size, 0.9 * size, 6 * size, 8), PALETTE.stone, {
    position: [x, y + 0.6 * size, z],
    rotation: [0, angle, Math.PI / 2],
  }, 0.05);
}

function addSteps(parts, at, size) {
  const [x, y, z] = at;
  parts.add(new THREE.BoxGeometry(14 * size, 1.2 * size, 11 * size), PALETTE.stoneDark, { position: [x, y, z] }, 0.03);
  parts.add(new THREE.BoxGeometry(11 * size, 1.2 * size, 8 * size), PALETTE.stone, { position: [x, y + 1.1 * size, z] }, 0.03);
}

function addBush(parts, at, size, rand) {
  const [x, y, z] = at;
  const pink = rand() < 0.3;
  parts.add(new THREE.IcosahedronGeometry(1, 0), pink ? PALETTE.blossom : PALETTE.leaf, {
    position: [x, y + 0.4 * size, z],
    scale: [1.6 * size, 1.1 * size, 1.6 * size],
    rotation: [rand(), rand() * 3, 0],
  }, 0.08);
}

function buildWaterfall(template, angle, width) {
  // Falls from the island's rim, bowing out slightly, and fades out in the air.
  const length = template.depthRatio * R + 45;
  const rows = 14;
  const positions = [];
  const uvs = [];
  const colors = [];
  const rim = R * 1.03;
  const ox = Math.cos(angle);
  const oz = Math.sin(angle);
  const tx = -oz;
  const tz = ox;
  for (let i = 0; i <= rows; i++) {
    const s = (i / rows) * length;
    const out = rim + 1 + 5 * (1 - Math.exp(-s / 7));
    const w = width * (1 + s / length * 0.6);
    const y = topHeight(template, R) + 0.4 - s;
    const alpha = Math.min(1, s / 2 + 0.3) * Math.pow(1 - s / length, 1.4) * 0.92;
    for (const side of [-1, 1]) {
      positions.push(ox * out + tx * side * w * 0.5, y, oz * out + tz * side * w * 0.5);
      uvs.push(side < 0 ? 0 : width / 8, s / 14);
      colors.push(1, 1, 1, alpha);
    }
  }
  const index = [];
  for (let i = 0; i < rows; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}

function buildTemplate(template, index) {
  const seed = 101 + index * 37;
  const rand = seeded(seed);
  const parts = createPartList(rand);
  buildRockBody(parts, template, seed, rand);
  buildGrassTop(parts, template, seed, rand);

  // Waterfalls pour off the rim; a small pool and stream feed each one.
  const fallAngles = [];
  for (let i = 0; i < template.waterfalls; i++) fallAngles.push(rand() * 0.6 + i * 2.6);
  const falls = [];
  for (const a of fallAngles) {
    const pool = spot(template, 0.62, a);
    parts.add(new THREE.CircleGeometry(5.5, 10), PALETTE.water, { position: [pool[0], pool[1] + 0.25, pool[2]], rotation: [-Math.PI / 2, 0, 0] }, 0.03);
    const mid = spot(template, 0.84, a);
    parts.add(new THREE.BoxGeometry(R * 0.36, 0.3, 3.4), PALETTE.water, { position: [mid[0], mid[1] + 0.2, mid[2]], rotation: [0, -a, 0] }, 0.03);
    falls.push(buildWaterfall(template, a, 5 + rand() * 2));
  }

  // Keep decorations away from the waterfalls' pools and streams.
  const clearOfWater = (angle) => fallAngles.every((a) => Math.abs(Math.atan2(Math.sin(angle - a), Math.cos(angle - a))) > 0.45);
  const pickAngle = () => {
    for (let tries = 0; tries < 20; tries++) {
      const a = rand() * Math.PI * 2;
      if (clearOfWater(a)) return a;
    }
    return rand() * Math.PI * 2;
  };

  if (template.arch) {
    const a = pickAngle();
    addArch(parts, template, spot(template, 0.25, a), a + 0.3, 1);
  }
  if (template.steps) addSteps(parts, spot(template, 0, 0), 1);
  for (let i = 0; i < template.columns; i++) {
    if (template.steps) {
      const a = (i / template.columns) * Math.PI * 2;
      addColumn(parts, spot(template, 0.42, a), 1, rand, i % 3 === 2);
    } else {
      const a = pickAngle();
      if (rand() < 0.35) addFallenColumn(parts, spot(template, 0.4 + rand() * 0.3, a), 1, rand() * 3);
      else addColumn(parts, spot(template, 0.35 + rand() * 0.4, a), 1, rand, rand() < 0.5);
    }
  }
  for (let i = 0; i < template.cherry; i++) {
    const a = pickAngle();
    addCherryTree(parts, template, spot(template, 0.45 + rand() * 0.35, a), 0.85 + rand() * 0.45, rand);
  }
  for (let i = 0; i < template.green; i++) {
    const a = pickAngle();
    addCherryTree(parts, template, spot(template, 0.4 + rand() * 0.45, a), 0.7 + rand() * 0.3, rand, PALETTE.leaf);
  }
  for (let i = 0; i < template.bushes; i++) {
    const a = pickAngle();
    addBush(parts, spot(template, 0.3 + rand() * 0.62, a), 0.7 + rand() * 0.8, rand);
  }

  const solid = parts.merge();
  const water = falls.length ? mergeGeometries(falls, false) : null;
  falls.forEach((g) => g.dispose());
  water?.computeBoundingSphere();
  return { solid, water };
}

function createWaterfallTexture() {
  const w = 64;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(200,245,240,0.55)";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 30 + Math.random() * 90;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.55})`;
    ctx.fillRect(x, y, 1 + Math.random() * 3, len);
    if (y + len > h) ctx.fillRect(x, y - h, 1 + Math.random() * 3, len); // wrap vertically so it tiles
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Streams islands in and out around the bird.
 * @param {THREE.Scene} scene
 */
export function createIslandField(scene) {
  const templates = ISLAND_TEMPLATES.map((t, i) => buildTemplate(t, i));
  const solidMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
  });
  const fallTexture = createWaterfallTexture();
  const fallMaterial = new THREE.MeshBasicMaterial({
    map: fallTexture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const root = new THREE.Group();
  root.name = "floating-islands";
  scene.add(root);
  const live = new Map();
  let lastRefresh = null;

  function addIsland(island) {
    const t = templates[island.template];
    const group = new THREE.Group();
    group.add(new THREE.Mesh(t.solid, solidMaterial));
    if (t.water) {
      const falls = new THREE.Mesh(t.water, fallMaterial);
      falls.renderOrder = 2;
      group.add(falls);
    }
    group.position.set(island.x, island.top, island.z);
    group.rotation.y = island.rotation;
    group.scale.setScalar(island.scale);
    root.add(group);
    live.set(island.id, group);
  }

  function refresh(center) {
    const wanted = new Map(islandsInRange(center.x, center.z, VIEW_RANGE).map((i) => [i.id, i]));
    for (const [id, group] of live) {
      if (!wanted.has(id)) {
        root.remove(group);
        live.delete(id);
      }
    }
    for (const [id, island] of wanted) if (!live.has(id)) addIsland(island);
  }

  function update(center, time) {
    fallTexture.offset.y = -time * 1.6; // v grows downward along each fall, so this streams the water down
    if (!lastRefresh || Math.hypot(center.x - lastRefresh.x, center.z - lastRefresh.z) > REFRESH_DISTANCE) {
      refresh(center);
      lastRefresh = { x: center.x, z: center.z };
    }
  }

  return { update, count: () => live.size };
}
