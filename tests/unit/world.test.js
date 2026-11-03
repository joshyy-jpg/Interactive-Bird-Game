import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapAround } from "../../src/world.js";

test("wrapAround keeps coordinates inside the moving window", () => {
  const half = 250;
  for (const center of [0, 100, -3000, 12345.6]) {
    for (const coord of [-500, -250, 0, 249, 250, 999, -12345]) {
      const wrapped = wrapAround(coord, center, half);
      assert.ok(
        wrapped >= center - half && wrapped < center + half,
        `wrap(${coord}, ${center}) = ${wrapped} outside [${center - half}, ${center + half})`
      );
    }
  }
});

test("wrapAround preserves position modulo the window size", () => {
  const half = 250;
  const wrapped = wrapAround(-700, 600, half);
  // Must differ from the original by an exact multiple of 2*half.
  const diff = wrapped - -700;
  assert.equal(diff % (2 * half), 0);
});

test("wrapAround is identity when the coordinate is already in the window", () => {
  assert.equal(wrapAround(50, 0, 250), 50);
  assert.equal(wrapAround(-200, 0, 250), -200);
});
