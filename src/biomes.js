// The biome map: which land you are in at any world (x, z). Pure and stateless,
// like terrain.js. It uses the same idea as Minecraft: broad noise fields act as
// climate (temperature) and geography (continent vs sea), and a biome is whatever
// those fields say at that spot. There are no hand-placed borders, so the world
// never ends and the same seed always gives the same map.

import { fbm, lerp, perlin, sstep } from "./noise.js";

export const FOREST = 0;
export const SNOW = 1;
export const DESERT = 2;
export const OCEAN = 3;

export const BIOME_COUNT = 4;

export const BIOME_INFO = [
  { key: "forest", name: "Alpine Forest", tagline: "Pines, meadows and still lakes" },
  { key: "snow", name: "Snow Peaks", tagline: "Thin air over frozen ridges" },
  { key: "desert", name: "Desert Canyons", tagline: "Thread the gorges, circle the mesas" },
  { key: "ocean", name: "Ocean Islands", tagline: "Open water and palm-fringed shores" },
];

export const BIOME_MAP = {
  seed: 4242,

  // Size of a climate region, in world units. Together with the thresholds below
  // this sets how long a crossing takes: tests/unit/biomes.test.js holds the
  // median distance to a new biome to about one or two minutes of flying.
  fieldScale: 3400,
  warpScale: 1100,
  warpAmount: 480,

  // Thresholds on the two noise fields. A wider gap between the two values of a
  // pair means a wider blended border between those biomes.
  oceanFull: -0.2,
  oceanNone: -0.09,
  coldFull: -0.15,
  coldNone: -0.05,
  hotNone: 0.06,
  hotFull: 0.16,

  // Temperature and continent values at the origin are pulled toward a temperate
  // inland climate, so the player always starts in the forest.
  spawnClimateRadius: 700,
  spawnClimateFade: 1500,
};

/**
 * Writes the blend of each biome at (x, z) into `out`. Weights are smooth and
 * always sum to 1, so anything blended by them changes gradually with no seams.
 * Snow and desert never touch directly: the temperate forest band always lies
 * between them.
 * @param {number} x
 * @param {number} z
 * @param {Float64Array} [out]
 * @returns {Float64Array} weights indexed by FOREST, SNOW, DESERT, OCEAN
 */
export function biomeWeightsAt(x, z, out = new Float64Array(BIOME_COUNT)) {
  const m = BIOME_MAP;
  const warpX = x + m.warpAmount * perlin(x / m.warpScale, z / m.warpScale, m.seed + 1);
  const warpZ = z + m.warpAmount * perlin(x / m.warpScale, z / m.warpScale, m.seed + 2);
  let temperature = fbm(warpX / m.fieldScale, warpZ / m.fieldScale, 2, m.seed + 3);
  let continent = fbm(warpX / (m.fieldScale * 1.3), warpZ / (m.fieldScale * 1.3), 2, m.seed + 4);

  const spawnPull = 1 - sstep(m.spawnClimateRadius, m.spawnClimateFade, Math.hypot(x, z));
  temperature = lerp(temperature, 0, spawnPull);
  continent = lerp(continent, 0.2, spawnPull);

  const sea = sstep(m.oceanNone, m.oceanFull, continent);
  const cold = sstep(m.coldNone, m.coldFull, temperature);
  const hot = sstep(m.hotNone, m.hotFull, temperature);
  const land = 1 - sea;
  out[FOREST] = land * (1 - cold - hot);
  out[SNOW] = land * cold;
  out[DESERT] = land * hot;
  out[OCEAN] = sea;
  return out;
}

const _dominantWeights = new Float64Array(BIOME_COUNT);

/** The strongest biome at (x, z). */
export function dominantBiome(x, z) {
  biomeWeightsAt(x, z, _dominantWeights);
  let best = 0;
  for (let i = 1; i < BIOME_COUNT; i++) {
    if (_dominantWeights[i] > _dominantWeights[best]) best = i;
  }
  return best;
}

const SCAN_DIRECTIONS = 24;
const SCAN_STEP = 200;
const SCAN_RANGE = 6000;

/**
 * Finds the closest land that is different from `current`, scanning outward in
 * rings. Used by the HUD so a player always knows which way the next land lies.
 * @returns {{biome:number, distance:number, bearing:number}|null} bearing is a
 *          heading in this game's convention: forward = (sin h, 0, cos h).
 */
export function nearestOtherBiome(x, z, current) {
  for (let r = SCAN_STEP; r <= SCAN_RANGE; r += SCAN_STEP) {
    for (let i = 0; i < SCAN_DIRECTIONS; i++) {
      const bearing = (i / SCAN_DIRECTIONS) * Math.PI * 2;
      const biome = dominantBiome(x + Math.sin(bearing) * r, z + Math.cos(bearing) * r);
      if (biome !== current) return { biome, distance: r, bearing };
    }
  }
  return null;
}

/**
 * Arrow showing where `bearing` lies from the bird's point of view. Heading
 * INCREASES when turning left (see the coordinate notes in flight.js), so a
 * positive relative angle means the target is on the bird's left.
 */
export function relativeArrow(bearing, heading) {
  const relative = Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading));
  const arrows = ["↑", "↖", "←", "↙", "↓", "↘", "→", "↗"];
  const index = Math.round(relative / (Math.PI / 4));
  return arrows[(index + 8) % 8];
}
