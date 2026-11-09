import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ISLAND_CONSTANTS,
  ISLAND_MAX_RADIUS,
  HERO_ISLANDS,
  islandAtCell,
  islandsInRange,
  islandsNear,
  islandTopAt,
  islandBodyRadiusAt,
  islandBottomAt,
  islandFloorAt,
  resolveIslandCollision,
} from "../../src/islands.js";
import { CHECKPOINTS } from "../../src/course.js";
import { createInitialFlightState, updateFlight, FLIGHT_CONSTANTS } from "../../src/flight.js";

const C = ISLAND_CONSTANTS;

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// True if (x, y, z) is inside an island's solid rock (not counting the margin).
function insideRock(island, { x, y, z }) {
  const d = Math.hypot(x - island.x, z - island.z);
  if (d >= island.radius) return false;
  return y < islandTopAt(island, d) && y > islandBottomAt(island, d);
}

test("island placement is deterministic", () => {
  for (const [cx, cz] of [[0, 0], [3, -7], [-40, 12], [999, 999]]) {
    assert.deepEqual(islandAtCell(cx, cz), islandAtCell(cx, cz));
  }
  assert.deepEqual(islandsInRange(1234, -5678, 2500), islandsInRange(1234, -5678, 2500));
});

test("the sky is well stocked: roughly one island per two cells", () => {
  let count = 0;
  for (let cx = -30; cx < 30; cx++) for (let cz = -30; cz < 30; cz++) if (islandAtCell(cx, cz)) count++;
  assert.ok(count > 3600 * 0.4 && count < 3600 * 0.6, `count ${count}`);
});

test("3x3 scan is complete: edgeMargin keeps every island inside its own cell", () => {
  assert.ok(C.edgeMargin >= ISLAND_MAX_RADIUS + C.collisionMargin);
  // Wide-scan regression: any island that reaches a point is found by islandsNear.
  const rand = lcg(7);
  for (let i = 0; i < 3000; i++) {
    const x = (rand() - 0.5) * 40000;
    const z = (rand() - 0.5) * 40000;
    const near = new Set(islandsNear(x, z).map((isl) => isl.id));
    for (const island of islandsInRange(x, z, C.cellSize * 3)) {
      if (Math.hypot(island.x - x, island.z - z) < island.radius + C.collisionMargin) {
        assert.ok(near.has(island.id), `island ${island.id} reaches (${x}, ${z}) but islandsNear missed it`);
      }
    }
  }
});

test("islands never overlap each other", () => {
  const islands = islandsInRange(0, 0, 9000);
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      const a = islands[i];
      const b = islands[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > a.radius + b.radius + 2 * C.collisionMargin, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("islands hang between minBottom and maxTop, so low flight is always clear", () => {
  const islands = islandsInRange(0, 0, 20000);
  assert.ok(islands.length > 500);
  for (const island of islands) {
    assert.ok(island.top - island.depth >= C.minBottom - 1e-9, `${island.id} bottom ${island.top - island.depth}`);
    assert.ok(island.top <= Math.max(C.maxTop, ...HERO_ISLANDS.map((h) => h.top)) + 1e-9, `${island.id} top ${island.top}`);
  }
});

test("spawn, the area around it and every Time Trial gate are clear of islands", () => {
  assert.equal(resolveIslandCollision({ x: 0, y: 30, z: 0 }).hit, false);
  for (const cp of CHECKPOINTS) {
    for (const [dx, dy, dz] of [[0, 0, 0], [cp.radius, 0, 0], [-cp.radius, 0, 0], [0, cp.radius, 0], [0, 0, cp.radius]]) {
      assert.equal(resolveIslandCollision({ x: cp.x + dx, y: cp.y + dy, z: cp.z + dz }).hit, false);
    }
  }
  const rand = lcg(3);
  for (let i = 0; i < 5000; i++) {
    const p = { x: (rand() - 0.5) * 30000, y: rand() * (C.minBottom - C.collisionMargin - 0.01), z: (rand() - 0.5) * 30000 };
    assert.equal(resolveIslandCollision(p).hit, false, `low point hit an island: ${JSON.stringify(p)}`);
  }
});

test("a point inside an island's rock is pushed back outside it", () => {
  const rand = lcg(11);
  const islands = islandsInRange(0, 0, 6000);
  let checked = 0;
  for (const island of islands) {
    for (let k = 0; k < 20; k++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * island.radius * 0.95;
      const lo = islandBottomAt(island, d);
      const hi = islandTopAt(island, d);
      const p = { x: island.x + Math.cos(a) * d, y: lo + rand() * (hi - lo), z: island.z + Math.sin(a) * d };
      if (!insideRock(island, p)) continue;
      const { position, hit } = resolveIslandCollision(p, FLIGHT_CONSTANTS.groundClearance);
      assert.ok(hit);
      assert.ok(!insideRock(island, position), `still inside ${island.id}: ${JSON.stringify(position)}`);
      assert.ok(Math.hypot(position.x - p.x, position.y - p.y, position.z - p.z) <= island.radius + island.depth);
      checked++;
    }
  }
  assert.ok(checked > 500);
});

test("island tops are a floor only for a bird already above them", () => {
  const island = islandsInRange(0, 0, 3000).find((i) => !String(i.id).startsWith("hero"));
  const surface = islandTopAt(island, 0) + C.surfaceNoise * island.scale;
  assert.equal(islandFloorAt(island.x, island.z, surface + 4), surface);
  assert.equal(islandFloorAt(island.x, island.z, island.top - island.depth - 20), -Infinity);
  assert.equal(islandFloorAt(island.x + island.radius * 1.2, island.z, surface + 4), -Infinity);
});

// Same wiring as main.js: island-top floor judged from last frame's height,
// then push out of any rock the bird flew into.
function fly(state, controls, seconds) {
  const dt = 1 / 60;
  const path = [];
  for (let i = 0; i < seconds / dt; i++) {
    const prevY = state.position.y;
    state = updateFlight(state, controls, dt, (x, z) => Math.max(0, islandFloorAt(x, z, prevY)));
    const bump = resolveIslandCollision(state.position, FLIGHT_CONSTANTS.groundClearance);
    if (bump.hit) state = { ...state, position: bump.position };
    path.push(state.position);
  }
  return { state, path };
}

test("flying straight at an island's cliff never ends up inside the rock", () => {
  const hero = islandsInRange(60, 520, 1).find((i) => i.id === "hero0");
  assert.ok(hero);
  for (const height of [0.15, 0.4, 0.7]) {
    let state = createInitialFlightState();
    state.position = { x: hero.x, y: hero.top - hero.depth * height, z: hero.z - 250 };
    state.heading = 0; // +z, straight at the island
    state.forwardSpeed = 40;
    const { path } = fly(state, { flapInput: 1 }, 12);
    for (const p of path) assert.ok(!insideRock(hero, p), `inside rock at ${JSON.stringify(p)}`);
  }
});

test("gliding over an island's top skims its grass instead of sinking in", () => {
  const hero = islandsInRange(60, 520, 1).find((i) => i.id === "hero0");
  let state = createInitialFlightState();
  // Approach just above rim height, nose gently down: without the floor the
  // bird would sink into the grassy mound.
  state.position = { x: hero.x, y: hero.top + 6, z: hero.z - hero.radius - 15 };
  state.heading = 0;
  state.forwardSpeed = 30;
  const { path } = fly(state, { climbInput: -0.3 }, 5);
  let overTop = 0;
  for (const p of path) {
    assert.ok(!insideRock(hero, p));
    const d = Math.hypot(p.x - hero.x, p.z - hero.z);
    if (d < hero.radius * 0.9) {
      overTop++;
      assert.ok(p.y >= islandTopAt(hero, d) + FLIGHT_CONSTANTS.groundClearance - 1e-6);
    }
  }
  assert.ok(overTop > 10, "the bird should have crossed the island's top");
});

test("body radius narrows from the full radius at the top to nothing at the tip", () => {
  const island = islandsInRange(0, 0, 3000)[0];
  assert.equal(islandBodyRadiusAt(island, island.top), island.radius);
  assert.ok(islandBodyRadiusAt(island, island.top - island.depth * 0.5) < island.radius);
  assert.equal(islandBodyRadiusAt(island, island.top - island.depth - 1), 0);
  assert.equal(islandBodyRadiusAt(island, island.top + 1), 0);
});
