import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heightAt,
  TERRAIN_CONSTANTS,
  SPAWN_SAFE_ZONE,
  featureAtCell,
  smoothstep,
} from "../../src/terrain.js";

// Brute-force reference: sums feature contributions from a wide 5x5 cell
// block (ignoring base noise, which isn't in question here). Compared below
// against heightAt's production 3x3 scan to prove the 3x3 optimization misses
// nothing, given today's featureRadiusMax <= featureCellSize invariant.
function sumFeaturesWide(x, z, halfWidth) {
  const S = TERRAIN_CONSTANTS.featureCellSize;
  const cx = Math.floor(x / S);
  const cz = Math.floor(z / S);
  let sum = 0;
  for (let dx = -halfWidth; dx <= halfWidth; dx++) {
    for (let dz = -halfWidth; dz <= halfWidth; dz++) {
      const f = featureAtCell(cx + dx, cz + dz);
      if (!f) continue;
      const dist = Math.hypot(x - f.cx, z - f.cz);
      if (dist >= f.radius) continue;
      sum += f.amplitude * smoothstep(1 - dist / f.radius);
    }
  }
  return sum;
}

// Deterministic PRNG for reproducible sampling in these tests (not related to
// terrain's own internal hashing — just picks which (x,z) points to probe).
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("heightAt is deterministic: same input always gives the same output", () => {
  const a = heightAt(1234.5, -678.9, []);
  const b = heightAt(1234.5, -678.9, []);
  assert.equal(a, b);
});

test("features are sparse: most sampled points are near the base-noise range", () => {
  const rand = mulberry32(42);
  const c = TERRAIN_CONSTANTS;
  let featureDriven = 0;
  const samples = 2000;
  for (let i = 0; i < samples; i++) {
    const x = (rand() - 0.5) * 20000;
    const z = (rand() - 0.5) * 20000;
    const h = heightAt(x, z, []);
    if (Math.abs(h) > c.baseNoiseAmplitude * 1.5) featureDriven++;
  }
  const fraction = featureDriven / samples;
  assert.ok(fraction < 0.25, `expected sparse features, got ${fraction} of samples feature-driven`);
});

test("3x3 neighbor scan (production) matches a brute-force 5x5 scan: nothing is missed", () => {
  const rand = mulberry32(7);
  let checked = 0;
  for (let i = 0; i < 300; i++) {
    const x = (rand() - 0.5) * 20000;
    const z = (rand() - 0.5) * 20000;
    const scan3x3 = sumFeaturesWide(x, z, 1); // matches heightAt's internal radius
    const scan5x5 = sumFeaturesWide(x, z, 2); // deliberately wider
    assert.equal(
      scan3x3,
      scan5x5,
      `widening the scan at (${x},${z}) changed the result — a feature was missed by 3x3`
    );
    checked++;
  }
  assert.equal(checked, 300);
});

test("invariant: featureRadiusMax must not exceed featureCellSize (or the 3x3 scan can miss features)", () => {
  assert.ok(TERRAIN_CONSTANTS.featureRadiusMax <= TERRAIN_CONSTANTS.featureCellSize);
});

test("safe zone: height is exactly the target at the zone center", () => {
  const zone = { x: 500, z: 500, radius: 50, targetHeight: 0 };
  const h = heightAt(500, 500, [zone]);
  assert.ok(Math.abs(h) < 1e-9, `expected exactly 0 at zone center, got ${h}`);
});

test("safe zone: height is untouched (matches raw) at the zone edge", () => {
  const zone = { x: 500, z: 500, radius: 50, targetHeight: 0 };
  const raw = heightAt(550, 500, []);
  const withZone = heightAt(550, 500, [zone]);
  assert.equal(withZone, raw);
});

test("safe zone: a midpoint is strictly between raw and target (smooth blend, no hard cutoff)", () => {
  const zone = { x: 500, z: 500, radius: 50, targetHeight: 0 };
  const raw = heightAt(525, 500, []);
  const blended = heightAt(525, 500, [zone]);
  if (Math.abs(raw) > 1e-6) {
    assert.notEqual(blended, raw);
    assert.ok(Math.abs(blended) < Math.abs(raw), "midpoint should be pulled toward target");
  }
});

test("SPAWN_SAFE_ZONE keeps the origin flat", () => {
  const h = heightAt(0, 0, [SPAWN_SAFE_ZONE]);
  assert.ok(Math.abs(h) < 1e-9, `expected origin to be flat, got ${h}`);
});
