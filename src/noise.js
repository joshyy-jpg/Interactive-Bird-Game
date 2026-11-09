// Seeded, stateless 2D noise. Pure functions only (no Three.js/DOM) so the same
// code runs on the main thread, in the chunk worker, and in plain Node tests,
// and always produces the same world from the same seed.

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Hermite step from 0 at `edge0` to 1 at `edge1`. Edges may be reversed. */
export function sstep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function latticeHash(ix, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic hash of an integer cell to [0, 1). `salt` picks an independent value. */
export function hash01(ix, iz, salt) {
  return latticeHash(ix, iz, salt) / 4294967296;
}

// Eight evenly spaced unit gradients. Lookup tables keep perlin() allocation-free.
const GRAD_X = new Float64Array(8);
const GRAD_Z = new Float64Array(8);
for (let i = 0; i < 8; i++) {
  GRAD_X[i] = Math.cos((i / 8) * Math.PI * 2);
  GRAD_Z[i] = Math.sin((i / 8) * Math.PI * 2);
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gradient noise, roughly in [-1, 1], with continuous slope everywhere. */
export function perlin(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const g00 = latticeHash(ix, iz, seed) & 7;
  const g10 = latticeHash(ix + 1, iz, seed) & 7;
  const g01 = latticeHash(ix, iz + 1, seed) & 7;
  const g11 = latticeHash(ix + 1, iz + 1, seed) & 7;
  const n00 = GRAD_X[g00] * fx + GRAD_Z[g00] * fz;
  const n10 = GRAD_X[g10] * (fx - 1) + GRAD_Z[g10] * fz;
  const n01 = GRAD_X[g01] * fx + GRAD_Z[g01] * (fz - 1);
  const n11 = GRAD_X[g11] * (fx - 1) + GRAD_Z[g11] * (fz - 1);
  const u = fade(fx);
  const v = fade(fz);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * Math.SQRT2;
}

/** Fractal noise: `octaves` layers of perlin, normalized to roughly [-1, 1]. */
export function fbm(x, z, octaves, seed) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * perlin(x * frequency, z * frequency, seed + i * 131);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03; // not exactly 2, so layers never line up on the same lattice
  }
  return sum / total;
}

/**
 * Ridged fractal noise in [0, 1]: sharp crests along the zero-lines of the
 * noise, which reads as mountain ridges rather than rounded hills. Each layer
 * only adds detail where the layers below are already high, so valleys stay
 * smooth and crests stay craggy.
 */
export function ridged(x, z, octaves, seed) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    const signal = 1 - Math.abs(perlin(x * frequency, z * frequency, seed + i * 173));
    const shaped = signal * signal * weight;
    sum += shaped * amplitude;
    total += amplitude;
    weight = Math.min(Math.max(shaped * 2, 0), 1);
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / total;
}
