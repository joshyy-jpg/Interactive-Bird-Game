// Deterministic, infinite, sparse terrain height. Pure functions only (no
// Three.js/DOM refs) so this is unit-testable in plain Node, same philosophy
// as flight.js/controls.js/chaseCamera.js.
//
// heightAt(x, z) never stores or looks up a heightmap — every call recomputes
// from world coordinates via seeded hashing, so the terrain is the same at
// any (x, z) forever, for every player, with zero memory cost. That's what
// makes it simultaneously "endless" and "seeded" (deterministic).

export const TERRAIN_CONSTANTS = {
  SEED: 1337, // change this to get a different (but still fixed) world

  // Gentle rolling ground everywhere, so it's not billiard-flat between features.
  baseNoiseCellSize: 50,
  baseNoiseAmplitude: 2,

  // Sparse peaks/dips via a spatial hash grid: most cells have no feature at
  // all. featureRadiusMax MUST stay <= featureCellSize — see the "3x3 search
  // is sufficient" invariant test in tests/unit/terrain.test.js.
  featureCellSize: 240,
  featureProbability: 0.12, // ~12% of cells get a feature
  dipFraction: 0.35, // of those, 35% are dips (valleys), 65% are peaks (mountains)
  featureRadiusMin: 35,
  featureRadiusMax: 150,
  peakAmplitudeMin: 10,
  peakAmplitudeMax: 40, // well under FLIGHT_CONSTANTS.softCeilingStart (110)
  dipAmplitudeMin: 5,
  dipAmplitudeMax: 20,

  spawnSafeRadius: 70,
};

export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Deterministic 32-bit hash -> [0, 1). `salt` distinguishes what a given
// (ix, iz) cell is being asked for (presence? offset? amplitude?) so the same
// hash function can drive many independent-looking random choices per cell.
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

function latticeHeight(cx, cz) {
  const c = TERRAIN_CONSTANTS;
  return (hash01(cx, cz, 0x1 ^ c.SEED) * 2 - 1) * c.baseNoiseAmplitude;
}

// Bilinear-interpolated value noise: gentle, non-billiard-flat ground texture.
function baseNoise(x, z) {
  const cs = TERRAIN_CONSTANTS.baseNoiseCellSize;
  const cx = Math.floor(x / cs);
  const cz = Math.floor(z / cs);
  const fx = x / cs - cx;
  const fz = z / cs - cz;

  const h00 = latticeHeight(cx, cz);
  const h10 = latticeHeight(cx + 1, cz);
  const h01 = latticeHeight(cx, cz + 1);
  const h11 = latticeHeight(cx + 1, cz + 1);

  const sx = smoothstep(fx);
  const sz = smoothstep(fz);
  const a = lerp(h00, h10, sx);
  const b = lerp(h01, h11, sx);
  return lerp(a, b, sz);
}

// Decides whether the feature-grid cell (gcx, gcz) has a peak/dip, and if so,
// its center/radius/amplitude — all derived only from (gcx, gcz, SEED), so
// it's identical every time this cell is asked about, with no stored state.
// Exported (alongside smoothstep) purely so tests/unit/terrain.test.js can do
// a genuine wide-scan regression check against the production 3x3 scan below.
export function featureAtCell(gcx, gcz) {
  const c = TERRAIN_CONSTANTS;
  if (hash01(gcx, gcz, 0x2 ^ c.SEED) >= c.featureProbability) return null;

  const S = c.featureCellSize;
  const offX = hash01(gcx, gcz, 0x3 ^ c.SEED) * S;
  const offZ = hash01(gcx, gcz, 0x4 ^ c.SEED) * S;
  const cx = gcx * S + offX;
  const cz = gcz * S + offZ;

  const isDip = hash01(gcx, gcz, 0x5 ^ c.SEED) < c.dipFraction;
  const radius = lerp(c.featureRadiusMin, c.featureRadiusMax, hash01(gcx, gcz, 0x6 ^ c.SEED));

  const [lo, hi] = isDip
    ? [c.dipAmplitudeMin, c.dipAmplitudeMax]
    : [c.peakAmplitudeMin, c.peakAmplitudeMax];
  const amplitude = lerp(lo, hi, hash01(gcx, gcz, 0x7 ^ c.SEED)) * (isDip ? -1 : 1);

  return { cx, cz, radius, amplitude };
}

// Sums contributions from features in the 3x3 cell block around (x, z). This
// is only complete as long as featureRadiusMax <= featureCellSize (a feature
// centered at the far edge of its own cell still can't reach past a
// neighboring cell into the block beyond it) — see the invariant test.
function sumNearbyFeatures(x, z) {
  const S = TERRAIN_CONSTANTS.featureCellSize;
  const cx = Math.floor(x / S);
  const cz = Math.floor(z / S);
  let sum = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const f = featureAtCell(cx + dx, cz + dz);
      if (!f) continue;
      const dist = Math.hypot(x - f.cx, z - f.cz);
      if (dist >= f.radius) continue;
      sum += f.amplitude * smoothstep(1 - dist / f.radius);
    }
  }
  return sum;
}

// The strongest-blending safe zone covering (x, z), or null if none reaches it.
export function safeZoneInfluence(x, z, safeZones) {
  let bestBlend = 0;
  let bestTarget = 0;
  for (const zone of safeZones) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d >= zone.radius) continue;
    const blend = smoothstep(1 - d / zone.radius);
    if (blend > bestBlend) {
      bestBlend = blend;
      bestTarget = zone.targetHeight ?? 0;
    }
  }
  return { blend: bestBlend, target: bestTarget };
}

/**
 * Terrain height at world (x, z). Deterministic and stateless: the same
 * (x, z, safeZones) always returns the same value, so terrain never needs to
 * be stored — any range is "free" to evaluate.
 *
 * @param {number} x
 * @param {number} z
 * @param {Array<{x:number, z:number, radius:number, targetHeight?:number}>} [safeZones]
 *        Registered flat zones (e.g. checkpoints, spawn point) that force
 *        terrain toward targetHeight near their center, blending smoothly out
 *        to raw procedural height by their edge — a GUARANTEE, not a hope,
 *        that a checkpoint can never spawn inside a mountain regardless of seed.
 */
export function heightAt(x, z, safeZones = []) {
  const raw = baseNoise(x, z) + sumNearbyFeatures(x, z);
  const { blend, target } = safeZoneInfluence(x, z, safeZones);
  return raw * (1 - blend) + target * blend;
}

// Always-active safe zone at the origin, so the spawn point is never buried
// even in Free Roam, which registers no checkpoint safe zones.
export const SPAWN_SAFE_ZONE = {
  x: 0,
  z: 0,
  radius: TERRAIN_CONSTANTS.spawnSafeRadius,
  targetHeight: 0,
};
