// Sky petals: the Free Roam collectibles. Pure functions only (no Three.js/DOM
// refs), so this is unit-testable in plain Node. petalModels.js draws them.
//
// A "bloom" is a set of 8 petals, one on each of the 8 nearest floating islands
// the player hasn't used yet. Finishing a bloom opens a new one around wherever
// the bird is, so the goal never runs out in the endless sky.

import { islandsInRange, islandTopAt, ISLAND_CONSTANTS } from "./islands.js";
import { surfaceHeightAt } from "./terrain.js";

export const PETAL_CONSTANTS = {
  setSize: 8,
  collectRadius: 16, // generous: leaning and arm controls are imprecise
  searchRange: 1400, // first radius searched for islands; widens if too few
  overTopHeight: 14, // "over" spot: this far above the island's grass
  besideGap: 20, // "beside" spot: this far out from the island's edge
  besideDepth: 0.35, // "beside" spot: how far down the cliff (fraction of depth)
  underGap: 18, // "under" spot: this far below the island's tip
  minAboveSurface: 10, // never closer than this to the sea or an islet
  markerHideDistance: 90, // on-screen petals closer than this don't need the guide marker
};

function spotHash(island) {
  let h = Math.imul(Math.round(island.x) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.round(island.z), 0xc2b2ae35);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Where an island's petal floats: over its grass, beside its cliff, or under its tip. */
export function petalSpot(island) {
  const c = PETAL_CONSTANTS;
  const h = spotHash(island);
  const kind = h % 3;
  let { x, z } = island;
  let y;
  if (kind === 0) {
    y = islandTopAt(island, 0) + ISLAND_CONSTANTS.surfaceNoise * island.scale + c.overTopHeight;
  } else if (kind === 1) {
    const angle = (((h >>> 8) % 360) * Math.PI) / 180;
    const reach = island.radius + c.besideGap;
    x += Math.cos(angle) * reach;
    z += Math.sin(angle) * reach;
    y = island.top - island.depth * c.besideDepth;
  } else {
    y = island.top - island.depth - c.underGap;
  }
  return { x, y: Math.max(y, surfaceHeightAt(x, z) + c.minAboveSurface), z };
}

function pickPetals(x, z, usedIslands, bloom) {
  const c = PETAL_CONSTANTS;
  let candidates = [];
  for (let range = c.searchRange; candidates.length < c.setSize; range *= 1.5) {
    candidates = islandsInRange(x, z, range).filter((island) => !usedIslands.includes(island.id));
  }
  const distance = (island) => Math.hypot(island.x - x, island.z - z);
  return candidates
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, c.setSize)
    .map((island) => ({ id: `${bloom}:${island.id}`, islandId: island.id, collected: false, ...petalSpot(island) }));
}

/** A new run, with the first bloom opened around (x, z). */
export function createPetalRun(x, z) {
  const petals = pickPetals(x, z, [], 1);
  return { bloom: 1, petals, usedIslands: petals.map((p) => p.islandId) };
}

/** Opens the next bloom around (x, z), on islands no earlier bloom has used. */
export function startNextBloom(run, x, z) {
  const bloom = run.bloom + 1;
  const petals = pickPetals(x, z, run.usedIslands, bloom);
  return { bloom, petals, usedIslands: [...run.usedIslands, ...petals.map((p) => p.islandId)] };
}

export function collectedCount(run) {
  return run.petals.filter((p) => p.collected).length;
}

export function isBloomComplete(run) {
  return run.petals.every((p) => p.collected);
}

/**
 * Collects any petals within reach of the bird.
 * @returns {{run: object, collected: object[]}} `run` is unchanged if nothing was collected
 */
export function collectPetals(run, position) {
  const reach = PETAL_CONSTANTS.collectRadius;
  const collected = run.petals.filter(
    (p) => !p.collected && Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z) <= reach
  );
  if (collected.length === 0) return { run, collected };
  return {
    run: { ...run, petals: run.petals.map((p) => (collected.includes(p) ? { ...p, collected: true } : p)) },
    collected,
  };
}

/**
 * The petal the guide marker should point at: close and preferably ahead of
 * the bird. Sticks with the current target unless another is clearly better,
 * so the marker doesn't flick between two petals while the bird turns.
 * @returns {object|null} a petal, or null if none are left
 */
export function chooseTarget(run, position, heading, currentId = null) {
  const score = (p) => {
    const dx = p.x - position.x;
    const dz = p.z - position.z;
    const across = Math.hypot(dx, dz) || 1;
    const ahead = (Math.sin(heading) * dx + Math.cos(heading) * dz) / across; // 1 ahead, -1 behind
    return Math.hypot(dx, p.y - position.y, dz) * (1.6 - 0.6 * ahead);
  };
  const open = run.petals.filter((p) => !p.collected);
  if (open.length === 0) return null;
  const best = open.reduce((a, b) => (score(b) < score(a) ? b : a));
  const current = open.find((p) => p.id === currentId);
  return current && score(best) > score(current) * 0.7 ? current : best;
}

/**
 * Where to draw a guide marker, given a target's normalized screen position
 * (-1..1). On-screen targets are left alone; anything else is pushed to the
 * screen edge in the target's direction.
 * @param {boolean} behind - the target is behind the camera (its x/y come out mirrored)
 */
export function edgeMarker(ndcX, ndcY, behind, marginX = 0.9, marginY = 0.78) {
  let x = behind ? -ndcX : ndcX;
  let y = behind ? -ndcY : ndcY;
  if (!behind && Math.abs(x) <= marginX && Math.abs(y) <= marginY) return { x, y, onScreen: true };
  if (Math.abs(x) < 1e-3 && Math.abs(y) < 1e-3) y = -1; // dead astern: point down, not nowhere
  const k = 1 / Math.max(Math.abs(x) / marginX, Math.abs(y) / marginY);
  return { x: x * k, y: y * k, onScreen: false };
}
