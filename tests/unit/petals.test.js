import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PETAL_CONSTANTS as C,
  petalSpot,
  createPetalRun,
  startNextBloom,
  collectPetals,
  collectedCount,
  isBloomComplete,
  chooseTarget,
  edgeMarker,
} from "../../src/petals.js";
import { islandsInRange, resolveIslandCollision } from "../../src/islands.js";
import { surfaceHeightAt } from "../../src/terrain.js";
import { FLIGHT_CONSTANTS } from "../../src/flight.js";

const at = (p) => ({ x: p.x, y: p.y, z: p.z });

test("a bloom is 8 petals on 8 different islands, the same every time", () => {
  const run = createPetalRun(0, 0);
  assert.equal(run.petals.length, C.setSize);
  assert.equal(new Set(run.petals.map((p) => p.islandId)).size, C.setSize);
  assert.deepEqual(run, createPetalRun(0, 0));
});

test("every petal can be reached: clear of rock, above the surface, under the thin air", () => {
  const islands = islandsInRange(0, 0, 30000);
  assert.ok(islands.length > 1000);
  for (const island of islands) {
    const spot = petalSpot(island);
    assert.equal(resolveIslandCollision(spot).hit, false, `${island.id} petal is inside rock`);
    assert.ok(spot.y >= surfaceHeightAt(spot.x, spot.z) + C.minAboveSurface - 1e-9, `${island.id} petal too low`);
    assert.ok(spot.y < FLIGHT_CONSTANTS.softCeilingStart + 40, `${island.id} petal too high: ${spot.y}`);
  }
});

test("petals appear over, beside and under islands", () => {
  const islands = islandsInRange(0, 0, 8000);
  const kinds = islands.map((island) => {
    const spot = petalSpot(island);
    if (Math.hypot(spot.x - island.x, spot.z - island.z) > island.radius) return "beside";
    return spot.y > island.top ? "over" : "under";
  });
  for (const kind of ["over", "beside", "under"]) {
    assert.ok(kinds.filter((k) => k === kind).length > islands.length * 0.2, kind);
  }
});

test("a fast bird can't skip through a petal between frames", () => {
  assert.ok(FLIGHT_CONSTANTS.maxSpeed * 0.05 < C.collectRadius); // 0.05s is main.js's longest frame step
});

test("only petals in reach are collected, and only once", () => {
  const run = createPetalRun(0, 0);
  const target = run.petals[3];
  const far = collectPetals(run, { x: target.x, y: target.y + C.collectRadius + 1, z: target.z });
  assert.equal(far.run, run, "nothing in reach leaves the run untouched");
  assert.deepEqual(far.collected, []);

  const near = collectPetals(run, { x: target.x, y: target.y + C.collectRadius - 1, z: target.z });
  assert.deepEqual(near.collected.map((p) => p.id), [target.id]);
  assert.equal(collectedCount(near.run), 1);
  assert.equal(collectedCount(run), 0, "must not mutate the original run");

  const again = collectPetals(near.run, at(target));
  assert.deepEqual(again.collected, []);
});

test("finishing a bloom opens a new one nearby on islands not used before", () => {
  let run = createPetalRun(0, 0);
  for (const petal of run.petals) {
    assert.equal(isBloomComplete(run), false);
    run = collectPetals(run, at(petal)).run;
  }
  assert.equal(isBloomComplete(run), true);

  const seen = new Set(run.petals.map((p) => p.islandId));
  for (let bloom = 2; bloom <= 6; bloom++) {
    run = startNextBloom(run, 500, 900);
    assert.equal(run.bloom, bloom);
    assert.equal(run.petals.length, C.setSize);
    assert.equal(collectedCount(run), 0);
    for (const petal of run.petals) {
      assert.ok(!seen.has(petal.islandId), `island ${petal.islandId} reused`);
      seen.add(petal.islandId);
    }
  }
  assert.equal(new Set(run.usedIslands).size, 6 * C.setSize);
});

test("petal ids stay unique between blooms", () => {
  const first = createPetalRun(0, 0);
  const second = startNextBloom(first, 0, 0);
  const ids = [...first.petals, ...second.petals].map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("the guide prefers a petal ahead of the bird over a slightly nearer one behind", () => {
  const run = {
    petals: [
      { id: "behind", x: 0, y: 30, z: -300, collected: false },
      { id: "ahead", x: 0, y: 30, z: 450, collected: false },
    ],
  };
  assert.equal(chooseTarget(run, { x: 0, y: 30, z: 0 }, 0).id, "ahead");
  assert.equal(chooseTarget(run, { x: 0, y: 30, z: 0 }, Math.PI).id, "behind");
});

test("the guide doesn't flick to another petal unless it's clearly better", () => {
  const run = {
    petals: [
      { id: "a", x: -200, y: 30, z: 200, collected: false },
      { id: "b", x: 200, y: 30, z: 200, collected: false },
    ],
  };
  const bird = { x: 0, y: 30, z: 0 };
  assert.equal(chooseTarget(run, bird, 0.3, "a").id, "a");
  assert.equal(chooseTarget(run, bird, -0.3, "b").id, "b");
  // Way off to one side, the other petal finally wins.
  assert.equal(chooseTarget(run, { x: 190, y: 30, z: 190 }, 0, "a").id, "b");
});

test("the guide skips collected petals and has nothing to say when all are gone", () => {
  const run = {
    petals: [
      { id: "a", x: 0, y: 30, z: 50, collected: true },
      { id: "b", x: 0, y: 30, z: 900, collected: false },
    ],
  };
  assert.equal(chooseTarget(run, { x: 0, y: 30, z: 0 }, 0, "a").id, "b");
  assert.equal(chooseTarget({ petals: [{ ...run.petals[0] }] }, { x: 0, y: 30, z: 0 }, 0), null);
});

test("on-screen markers stay put", () => {
  assert.deepEqual(edgeMarker(0.2, -0.3, false), { x: 0.2, y: -0.3, onScreen: true });
});

test("off-screen markers are pushed to the edge in the target's direction", () => {
  const m = edgeMarker(3, 0.3, false, 0.9, 0.78);
  assert.equal(m.onScreen, false);
  assert.ok(Math.abs(m.x - 0.9) < 1e-9);
  assert.ok(Math.abs(m.y - 0.09) < 1e-9);
});

test("targets behind the camera un-mirror and go to the edge, even near the centre", () => {
  // Behind the camera, projected x/y come out flipped: -0.1 really means to the right.
  const m = edgeMarker(-0.1, 0, true, 0.9, 0.78);
  assert.equal(m.onScreen, false);
  assert.ok(Math.abs(m.x - 0.9) < 1e-9);
  const dead = edgeMarker(0, 0, true, 0.9, 0.78);
  assert.ok(Math.abs(dead.x) < 1e-9);
  assert.ok(Math.abs(dead.y + 0.78) < 1e-9, "dead astern points down");
});
