// Floating sky islands: where they are and how the bird bumps into them.
// Pure functions only (no Three.js/DOM refs), so this is unit-testable in plain
// Node, same as terrain.js and flight.js. islandModels.js draws them.
//
// Placement uses a spatial hash grid like terrain.js: every cell decides from
// its own coordinates (and the seed) whether it holds an island, so the sky is
// endless, identical every visit, and costs no memory.
//
// Shape (in island-local terms, R = radius, D = depth, H = bump height):
//   grassy top:  y = top + H * (1 - (d/R)^2)            for d < R
//   rock body:   radius R * (1 - t)^BODY_TAPER at depth t*D below the top,
//                narrowing to a point D below the top.
// islandModels.js builds the visible geometry inside this envelope, so the
// collision shape below is never smaller than what's drawn.

export const ISLAND_CONSTANTS = {
  SEED: 9071,
  cellSize: 560,
  probability: 0.5,
  baseRadius: 40, // template radius before per-island scaling
  scaleMin: 0.65,
  scaleMax: 1.5,
  // Undersides never dip below this, so low flight (spawn at y=30, every Time
  // Trial gate) is always clear of islands.
  minBottom: 48,
  maxTop: 205, // stays under the soft "thin air" ceiling (flight.js) so tops are reachable
  // Island centres stay this far inside their cell. It's larger than the
  // biggest island, so islands never overlap and a 3x3 cell scan finds every
  // island that could touch a point. Tested invariant.
  edgeMargin: 80,
  spawnClearRadius: 260, // random islands keep away from spawn; hand-placed ones frame the view instead
  heroClearance: 60, // gap kept between a random island and a hand-placed one
  collisionMargin: 2.5, // bird body radius-ish padding around the rock
  surfaceNoise: 0.8, // max height the grass mesh's bumps rise above the smooth top shape
};

export const BODY_TAPER = 0.7;

// Island designs. islandModels.js decorates each one; only depthRatio and
// bumpHeight matter for collision.
export const ISLAND_TEMPLATES = [
  { name: "arch", depthRatio: 1.3, bumpHeight: 4, waterfalls: 1, arch: true, columns: 2, cherry: 2, green: 1, bushes: 6 },
  { name: "grove", depthRatio: 1.1, bumpHeight: 6, waterfalls: 1, arch: false, columns: 0, cherry: 5, green: 1, bushes: 8 },
  { name: "temple", depthRatio: 1.5, bumpHeight: 3, waterfalls: 1, arch: false, columns: 7, cherry: 1, green: 1, bushes: 4, steps: true },
  { name: "spire", depthRatio: 1.8, bumpHeight: 7, waterfalls: 0, arch: false, columns: 1, cherry: 1, green: 1, bushes: 4 },
  { name: "meadow", depthRatio: 1.0, bumpHeight: 5, waterfalls: 1, arch: false, columns: 3, cherry: 1, green: 4, bushes: 10 },
  { name: "twin falls", depthRatio: 1.4, bumpHeight: 4, waterfalls: 2, arch: true, columns: 0, cherry: 3, green: 0, bushes: 6 },
];

// Hand-placed islands that frame the opening views: one ahead of spawn (seen
// as you start flying) and one behind it (seen behind the bird on the menu).
export const HERO_ISLANDS = [
  { x: 60, z: 520, top: 118, template: 0, scale: 1.25, rotation: 2.6 },
  { x: -300, z: 820, top: 168, template: 2, scale: 1.4, rotation: 0.9 },
  { x: 330, z: 1050, top: 140, template: 1, scale: 1.1, rotation: 4.1 },
  { x: 160, z: -236, top: 152, template: 5, scale: 1.2, rotation: 3.3 },
  { x: -380, z: -900, top: 160, template: 4, scale: 1.35, rotation: 1.2 },
];

function hash01(ix, iz, salt) {
  let h = ix | 0;
  h = Math.imul(h ^ (iz | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (salt | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function describe(base, id) {
  const c = ISLAND_CONSTANTS;
  const t = ISLAND_TEMPLATES[base.template];
  const radius = c.baseRadius * base.scale;
  return {
    id,
    x: base.x,
    z: base.z,
    top: base.top,
    template: base.template,
    scale: base.scale,
    rotation: base.rotation,
    radius,
    depth: t.depthRatio * radius,
    bump: t.bumpHeight * base.scale,
  };
}

const HEROES = HERO_ISLANDS.map((h, i) => {
  const island = describe(h, `hero${i}`);
  if (island.top - island.depth < ISLAND_CONSTANTS.minBottom) {
    throw new Error(`hero island ${i} hangs below minBottom`);
  }
  return island;
});

const MAX_RADIUS = ISLAND_CONSTANTS.baseRadius * ISLAND_CONSTANTS.scaleMax;

/** The random island in grid cell (cx, cz), or null. Deterministic. */
export function islandAtCell(cx, cz) {
  const c = ISLAND_CONSTANTS;
  const s = c.SEED;
  if (hash01(cx, cz, 0x11 ^ s) >= c.probability) return null;
  const span = c.cellSize - 2 * c.edgeMargin;
  const x = cx * c.cellSize + c.edgeMargin + hash01(cx, cz, 0x12 ^ s) * span;
  const z = cz * c.cellSize + c.edgeMargin + hash01(cx, cz, 0x13 ^ s) * span;
  if (Math.hypot(x, z) < c.spawnClearRadius) return null;

  const template = Math.floor(hash01(cx, cz, 0x14 ^ s) * ISLAND_TEMPLATES.length);
  const scale = c.scaleMin + hash01(cx, cz, 0x15 ^ s) * (c.scaleMax - c.scaleMin);
  const depth = ISLAND_TEMPLATES[template].depthRatio * c.baseRadius * scale;
  const lowestTop = c.minBottom + depth;
  const top = lowestTop + hash01(cx, cz, 0x16 ^ s) * Math.max(0, c.maxTop - lowestTop);
  const rotation = hash01(cx, cz, 0x17 ^ s) * Math.PI * 2;

  const island = describe({ x, z, top, template, scale, rotation }, `${cx},${cz}`);
  for (const hero of HEROES) {
    if (Math.hypot(x - hero.x, z - hero.z) < island.radius + hero.radius + c.heroClearance) return null;
  }
  return island;
}

/** Every island whose centre lies within `range` of (x, z). */
export function islandsInRange(x, z, range) {
  const S = ISLAND_CONSTANTS.cellSize;
  const result = [];
  for (let cx = Math.floor((x - range) / S); cx <= Math.floor((x + range) / S); cx++) {
    for (let cz = Math.floor((z - range) / S); cz <= Math.floor((z + range) / S); cz++) {
      const island = islandAtCell(cx, cz);
      if (island && Math.hypot(island.x - x, island.z - z) <= range) result.push(island);
    }
  }
  for (const hero of HEROES) {
    if (Math.hypot(hero.x - x, hero.z - z) <= range) result.push(hero);
  }
  return result;
}

/** Islands that could touch the point (x, z): the 3x3 cells around it plus nearby heroes. */
export function islandsNear(x, z) {
  const S = ISLAND_CONSTANTS.cellSize;
  const cx = Math.floor(x / S);
  const cz = Math.floor(z / S);
  const result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const island = islandAtCell(cx + dx, cz + dz);
      if (island) result.push(island);
    }
  }
  for (const hero of HEROES) {
    if (Math.hypot(hero.x - x, hero.z - z) < hero.radius + 20) result.push(hero);
  }
  return result;
}

/** Height of the smooth grassy top at horizontal distance d from the centre (d < radius). */
export function islandTopAt(island, d) {
  const f = Math.min(d / island.radius, 1);
  return island.top + island.bump * (1 - f * f);
}

/** Radius of the rock body at height y (0 above the top or below the tip). */
export function islandBodyRadiusAt(island, y) {
  if (y > island.top || y < island.top - island.depth) return 0;
  const t = (island.top - y) / island.depth;
  return island.radius * Math.pow(1 - t, BODY_TAPER);
}

/** Height of the rock's underside at horizontal distance d (d < radius). */
export function islandBottomAt(island, d) {
  const f = Math.min(d / island.radius, 1);
  return island.top - island.depth * (1 - Math.pow(f, 1 / BODY_TAPER));
}

/**
 * Floor from island tops for a bird that's flying over one: the bird can skim
 * across an island's grass but not sink into it. Only applies when the bird
 * was already above that island's grass last frame (prevY), so a bird flying
 * underneath an island isn't yanked up on top of it.
 * @returns {number} the highest island-top floor at (x, z), or -Infinity
 */
export function islandFloorAt(x, z, prevY) {
  const noise = ISLAND_CONSTANTS.surfaceNoise;
  let floor = -Infinity;
  for (const island of islandsNear(x, z)) {
    const d = Math.hypot(x - island.x, z - island.z);
    if (d >= island.radius * 1.04) continue; // grass lip overhangs the rock slightly
    const surface = islandTopAt(island, d) + noise * island.scale;
    if (prevY >= surface - 1.5 && surface > floor) floor = surface;
  }
  return floor;
}

/**
 * Pushes a position that ended up inside an island's rock out to the nearest
 * outside spot: sideways out of the cliff, down below the underside, or up
 * onto the grass, whichever is the smallest move.
 * @param {{x:number,y:number,z:number}} position
 * @param {number} [clearance] - height kept above the grass if pushed up (flight.js groundClearance)
 * @returns {{position: {x:number,y:number,z:number}, hit: boolean}}
 */
export function resolveIslandCollision(position, clearance = 4) {
  const margin = ISLAND_CONSTANTS.collisionMargin;
  let { x, y, z } = position;
  let hit = false;
  for (const island of islandsNear(x, z)) {
    const dx = x - island.x;
    const dz = z - island.z;
    const d = Math.hypot(dx, dz);
    if (d >= island.radius + margin) continue;
    const surface = d < island.radius ? islandTopAt(island, d) + ISLAND_CONSTANTS.surfaceNoise * island.scale : island.top;
    if (y >= surface || y <= island.top - island.depth - margin) continue;

    const bodyRadius = islandBodyRadiusAt(island, Math.min(y, island.top)) + margin;
    if (d >= bodyRadius) continue;

    const outward = bodyRadius - d;
    const down = y - (islandBottomAt(island, Math.min(d, island.radius)) - margin);
    const up = surface + clearance - y;
    hit = true;
    if (outward <= down && outward <= up && d > 1e-6) {
      x = island.x + (dx / d) * bodyRadius;
      z = island.z + (dz / d) * bodyRadius;
    } else if (down <= up) {
      y -= down;
    } else {
      y += up;
    }
  }
  return { position: hit ? { x, y, z } : position, hit };
}

export { MAX_RADIUS as ISLAND_MAX_RADIUS };
