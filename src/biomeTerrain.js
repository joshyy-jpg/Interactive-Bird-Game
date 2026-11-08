// Terrain shape and colour for the connected biome world. Pure functions only,
// so the chunk worker, flight collision and unit tests all agree exactly on where
// the ground is.

import {
  BIOME_COUNT,
  BIOME_MAP,
  DESERT,
  FOREST,
  OCEAN,
  SNOW,
  biomeWeightsAt,
} from "./biomes.js";
import { fbm, hash01, lerp, perlin, ridged, sstep } from "./noise.js";
import { heightAt as classicHeightAt, safeZoneInfluence } from "./terrain.js";

export const SEA_LEVEL = 0;

// The finest terrain grid. Chunks at the finest level use this exact spacing, so
// flight collision (meshHeightAt) can match what is drawn triangle for triangle.
export const FINE_GRID = 12.5;

const S = BIOME_MAP.seed;

// Keeps the spawn point on open, flat ground above the water.
export const BIOME_SPAWN_ZONE = { x: 0, z: 0, radius: 230, targetHeight: 12 };

function forestHeight(x, z) {
  const rolling = 15 + 16 * fbm(x / 400, z / 400, 3, S + 20);
  const rangeMask = sstep(-0.05, 0.34, fbm(x / 1500, z / 1500, 2, S + 21));
  const ridge = ridged(x / 620, z / 620, 4, S + 22);
  const mountains = rangeMask * ridge * ridge * 260;
  const lake = sstep(0.2, 0.42, fbm(x / 640 + 40, z / 640 - 17, 2, S + 23)) * (1 - rangeMask);
  return lerp(rolling + mountains, -9, lake);
}

function snowHeight(x, z) {
  const warpX = x + 130 * perlin(x / 520, z / 520, S + 30);
  const warpZ = z + 130 * perlin(x / 520, z / 520, S + 31);
  const ridge = ridged(warpX / 820, warpZ / 820, 5, S + 32);
  const valley = 24 + 12 * fbm(x / 300, z / 300, 2, S + 33);
  return valley + 400 * Math.pow(ridge, 1.75);
}

function desertHeight(x, z) {
  const warpX = x + 90 * perlin(x / 400, z / 400, S + 40);
  const warpZ = z + 90 * perlin(x / 400, z / 400, S + 41);

  // Terraced plateaus: flat tops separated by steep cliffs.
  const plateau = sstep(-0.3, 0.42, fbm(warpX / 820, warpZ / 820, 3, S + 42));
  const steps = 4;
  const stepped = plateau * steps;
  const whole = Math.floor(stepped);
  const terraced = (whole + sstep(0.58, 0.92, stepped - whole)) / steps;
  const dunes = 3 * fbm(x / 110, z / 170, 2, S + 43);
  const mesa = 15 + terraced * 150 + dunes;

  // Winding gorges follow the lines where a smooth noise crosses zero.
  const river = Math.abs(
    perlin(warpX / 1250, warpZ / 1250, S + 44) + 0.22 * perlin(warpX / 430, warpZ / 430, S + 45)
  );
  const canyon = sstep(0.045, 0.125, river);
  return lerp(11 + dunes * 0.5, mesa, canyon);
}

// Rock pillars standing in open water. They are part of the terrain so the bird
// collides with them. One pillar at most per cell, checked over a 3x3 block.
const STACK_CELL = 340;
function seaStacks(x, z) {
  const cx = Math.floor(x / STACK_CELL);
  const cz = Math.floor(z / STACK_CELL);
  let height = -Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const gx = cx + dx;
      const gz = cz + dz;
      if (hash01(gx, gz, S + 70) > 0.42) continue;
      const px = (gx + hash01(gx, gz, S + 71)) * STACK_CELL;
      const pz = (gz + hash01(gx, gz, S + 72)) * STACK_CELL;
      const radius = 24 + 22 * hash01(gx, gz, S + 73);
      const distance = Math.hypot(x - px, z - pz);
      if (distance > radius) continue;
      const top = 34 + 62 * hash01(gx, gz, S + 74);
      const crag = 6 * perlin(x / 26, z / 26, S + 75);
      const shape = sstep(radius, radius * 0.55, distance);
      height = Math.max(height, -30 + (top + 30 + crag) * shape);
    }
  }
  return height;
}

function oceanHeight(x, z) {
  const seabed = -42 + 10 * fbm(x / 300, z / 300, 2, S + 50);
  const island = sstep(0.1, 0.44, fbm(x / 620, z / 620, 4, S + 51));
  const peak = 0.5 + 0.5 * perlin(x / 170, z / 170, S + 52);
  const land = seabed + island * (56 + island * island * island * peak * 95);
  return Math.max(land, seaStacks(x, z));
}

const HEIGHT_BY_BIOME = [forestHeight, snowHeight, desertHeight, oceanHeight];

const _weights = new Float64Array(BIOME_COUNT);

/** Blended analytic height of the connected world. Only biomes with influence are evaluated. */
export function biomeHeightAt(x, z, safeZones = [BIOME_SPAWN_ZONE]) {
  biomeWeightsAt(x, z, _weights);
  let raw = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    if (_weights[i] > 0.0005) raw += _weights[i] * HEIGHT_BY_BIOME[i](x, z);
  }
  const { blend, target } = safeZoneInfluence(x, z, safeZones);
  return raw * (1 - blend) + target * blend;
}

/** Height of one biome on its own, ignoring blending. Used by tests and tuning. */
export function pureBiomeHeight(biome, x, z) {
  return HEIGHT_BY_BIOME[biome](x, z);
}

/**
 * The connected biome world (Free Roam).
 * @param {{safeZones?: Array}} [options]
 */
export function createBiomeTerrain({ safeZones = [BIOME_SPAWN_ZONE] } = {}) {
  return {
    kind: "biomes",
    seaLevel: SEA_LEVEL,
    heightAt: (x, z) => biomeHeightAt(x, z, safeZones),
    weightsAt: (x, z, out) => biomeWeightsAt(x, z, out),
  };
}

/**
 * The original gentle terrain, drawn with forest colours (Time Trial). The height
 * function is unchanged, so the course and best times are unaffected.
 * @param {{safeZones?: Array}} [options]
 */
export function createClassicTerrain({ safeZones = [] } = {}) {
  return {
    kind: "classic",
    seaLevel: null,
    safeZones,
    heightAt: (x, z) => classicHeightAt(x, z, safeZones),
    weightsAt: (x, z, out = new Float64Array(BIOME_COUNT)) => {
      out.fill(0);
      out[FOREST] = 1;
      return out;
    },
  };
}

/**
 * Terrain height exactly as drawn on the finest chunk grid. Every chunk splits
 * each grid square along the same diagonal, so this is the true surface of the
 * finest mesh, and the bird can never visually sink into it.
 */
export function meshHeightAt(terrain, x, z) {
  const g = FINE_GRID;
  const ix = Math.floor(x / g);
  const iz = Math.floor(z / g);
  const fx = x / g - ix;
  const fz = z / g - iz;
  const h10 = terrain.heightAt((ix + 1) * g, iz * g);
  const h01 = terrain.heightAt(ix * g, (iz + 1) * g);
  if (fx + fz < 1) {
    const h00 = terrain.heightAt(ix * g, iz * g);
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  }
  const h11 = terrain.heightAt((ix + 1) * g, (iz + 1) * g);
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/** What the bird collides with: the drawn ground, or the water surface above it. */
export function flightFloorAt(terrain, x, z) {
  const ground = meshHeightAt(terrain, x, z);
  return terrain.seaLevel == null ? ground : Math.max(ground, terrain.seaLevel);
}

/** 0..1 woodland density. Shared by tree placement and the darker ground under trees. */
export function treeDensityAt(x, z) {
  return sstep(-0.12, 0.3, fbm(x / 340, z / 340, 3, S + 60));
}

// --- Colour ---

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgb(hex) {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ];
}

const C = {
  meadowA: rgb(0x8cae5c),
  meadowB: rgb(0x6d9a4f),
  woodland: rgb(0x47703f),
  rock: rgb(0x7f8078),
  alpine: rgb(0x8d8f7f),
  snow: rgb(0xf1f5f6),
  snowShade: rgb(0xd4e0ea),
  iceRock: rgb(0x566673),
  sand: rgb(0xe5cf9c),
  shoreSnow: rgb(0xc9d6da),
  duneA: rgb(0xe8c083),
  duneB: rgb(0xdca968),
  strataRed: rgb(0xb5583a),
  strataRust: rgb(0xca7a47),
  strataTan: rgb(0xe3b078),
  strataPale: rgb(0xedcfa1),
  canyonFloor: rgb(0xc99a68),
  seabedDeep: rgb(0x2c5b66),
  seabedShallow: rgb(0xd8c79a),
  islandA: rgb(0x79ad50),
  islandB: rgb(0x5a9446),
  seaRock: rgb(0x6f6a62),
};

function mix(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function mixInto(out, b, t) {
  out[0] += (b[0] - out[0]) * t;
  out[1] += (b[1] - out[1]) * t;
  out[2] += (b[2] - out[2]) * t;
}

function forestColor(out, x, z, h, slope) {
  const patch = 0.5 + 0.5 * perlin(x / 150, z / 150, S + 80);
  mix(out, C.meadowA, C.meadowB, patch);
  mixInto(out, C.woodland, treeDensityAt(x, z) * 0.75);
  const wobble = 14 * perlin(x / 70, z / 70, S + 81);
  mixInto(out, C.alpine, sstep(105, 150, h + wobble));
  mixInto(out, C.rock, sstep(0.75, 1.25, slope));
  mixInto(out, C.snow, sstep(158, 195, h + wobble) * (1 - sstep(1.1, 1.7, slope)));
}

function snowColor(out, x, z, h, slope) {
  const patch = 0.5 + 0.5 * perlin(x / 110, z / 110, S + 82);
  mix(out, C.snow, C.snowShade, patch);
  mixInto(out, C.iceRock, sstep(0.85, 1.35, slope));
}

function desertColor(out, x, z, h, slope) {
  const patch = 0.5 + 0.5 * perlin(x / 130, z / 170, S + 83);
  mix(out, C.duneA, C.duneB, patch);
  mixInto(out, C.canyonFloor, 1 - sstep(10, 22, h));

  // Rock layers run level around the whole landscape, like real sandstone.
  const layer = h * 0.2 + 1.4 * perlin(x / 240, z / 240, S + 84);
  const wave = 0.5 + 0.5 * Math.sin(layer);
  const wave2 = 0.5 + 0.5 * Math.sin(layer * 2.7 + 1.3);
  const strata = [0, 0, 0];
  mix(strata, C.strataRed, C.strataTan, wave);
  mixInto(strata, C.strataRust, wave2 * 0.55);
  mixInto(strata, C.strataPale, sstep(0.72, 0.95, wave2) * 0.5);
  mixInto(out, strata, sstep(0.3, 0.75, slope));
}

function oceanColor(out, x, z, h, slope) {
  if (h < SEA_LEVEL) {
    mix(out, C.seabedDeep, C.seabedShallow, sstep(-26, -2, h));
    return;
  }
  const patch = 0.5 + 0.5 * perlin(x / 110, z / 110, S + 85);
  mix(out, C.islandA, C.islandB, patch);
  mixInto(out, C.seaRock, sstep(0.7, 1.15, slope));
}

const COLOR_BY_BIOME = [forestColor, snowColor, desertColor, oceanColor];
const _biomeColor = [0, 0, 0];

/**
 * Linear-space ground colour at a point. Same inputs give the same colour, so
 * neighbouring chunks always agree along their shared edges.
 * @param {number[]} out - receives [r, g, b]
 * @param {boolean} hasWater - false for the classic terrain, which has no shores
 */
export function terrainColorAt(out, x, z, h, slope, weights, hasWater) {
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    if (weights[i] <= 0.0005) continue;
    COLOR_BY_BIOME[i](_biomeColor, x, z, h, slope);
    out[0] += _biomeColor[0] * weights[i];
    out[1] += _biomeColor[1] * weights[i];
    out[2] += _biomeColor[2] * weights[i];
  }
  if (hasWater && h < 8) {
    const coldShore = weights[SNOW];
    const shore = sstep(8, 2.5, h) * (1 - sstep(0.7, 1.2, slope));
    const tint = weights[OCEAN] > 0.5 && h < SEA_LEVEL ? null : coldShore > 0.5 ? C.shoreSnow : C.sand;
    if (tint) mixInto(out, tint, shore);
  }
}

// Exposed for tests: the biome indices that have their own height function.
export const HEIGHT_BIOMES = [FOREST, SNOW, DESERT, OCEAN];
