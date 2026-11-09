import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForPose } from "../../src/calibration.js";
import { LANDMARK } from "../../src/controls.js";

function body({ shoulderVisibility = 1 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[LANDMARK.LEFT_SHOULDER] = { x: 0.4, y: 0.4, visibility: shoulderVisibility };
  lm[LANDMARK.RIGHT_SHOULDER] = { x: 0.6, y: 0.4, visibility: shoulderVisibility };
  lm[LANDMARK.LEFT_HIP] = { x: 0.42, y: 0.7, visibility: 1 };
  lm[LANDMARK.RIGHT_HIP] = { x: 0.58, y: 0.7, visibility: 1 };
  return lm;
}

// Runs waitForPose over a scripted list of frames; returns how many it consumed.
async function framesNeeded(script, requiredFrames) {
  let i = 0;
  await waitForPose({
    getLandmarks: () => {
      assert.ok(i < script.length, "waitForPose kept waiting past the end of the script");
      return script[i++];
    },
    requiredFrames,
    requestFrame: (cb) => queueMicrotask(() => cb(0)),
  });
  return i;
}

test("waits through frames with nobody in view", async () => {
  assert.equal(await framesNeeded([null, null, null, body(), body(), body()], 3), 6);
});

test("losing the player restarts the run of good frames", async () => {
  assert.equal(await framesNeeded([body(), body(), null, body(), body(), body()], 3), 6);
});

test("shoulders the tracker is only guessing at don't count as in view", async () => {
  const guess = body({ shoulderVisibility: 0.2 });
  assert.equal(await framesNeeded([guess, guess, body(), body()], 2), 4);
});

test("seated players with no visible hips can still get through", async () => {
  const seated = body();
  seated[LANDMARK.LEFT_HIP].visibility = 0.1;
  seated[LANDMARK.RIGHT_HIP].visibility = 0.1;
  assert.equal(await framesNeeded([seated, seated], 2), 2);
});
