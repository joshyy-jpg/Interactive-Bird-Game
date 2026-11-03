// Regression tests for the full input -> physics direction chain. These pin the
// user-facing contract: lean right -> the bird banks right AND veers toward its
// right (world -x, which is screen-right from the chase camera). Individually
// correct-looking sign conventions in controls/flight/bird once combined to make
// the bird tilt one way while turning the other; this locks the whole chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANDMARK,
  createControlsState,
  computeControlInputs,
  computeCalibrationBaseline,
} from "../../src/controls.js";
import { createInitialFlightState, updateFlight } from "../../src/flight.js";

const dt = 1 / 60;

// Image coords: y grows downward. leanTilt > 0 drops the subject's RIGHT
// shoulder (landmark 12), i.e. the player is leaning to their right.
function makeFrame(leanTilt = 0) {
  const frame = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));
  frame[LANDMARK.LEFT_SHOULDER] = { x: 0.4, y: 0.4, visibility: 1 };
  frame[LANDMARK.RIGHT_SHOULDER] = { x: 0.6, y: 0.4 + leanTilt, visibility: 1 };
  frame[LANDMARK.LEFT_HIP] = { x: 0.42, y: 0.7, visibility: 1 };
  frame[LANDMARK.RIGHT_HIP] = { x: 0.58, y: 0.7, visibility: 1 };
  frame[LANDMARK.LEFT_WRIST] = { x: 0.35, y: 0.4, visibility: 1 }; // arms at shoulder level
  frame[LANDMARK.RIGHT_WRIST] = { x: 0.65, y: 0.4, visibility: 1 };
  return frame;
}

function flyWithLean(leanTilt, steps = 240) {
  const baseline = computeCalibrationBaseline([makeFrame(), makeFrame(), makeFrame()]);
  const controlsState = createControlsState();
  let flightState = createInitialFlightState();
  let t = 0;
  for (let i = 0; i < steps; i++) {
    t += dt * 1000;
    const controls = computeControlInputs(makeFrame(leanTilt), baseline, controlsState, dt, t);
    flightState = updateFlight(flightState, controls, dt);
  }
  return flightState;
}

test("leaning RIGHT banks right and carries the bird toward its right (-x)", () => {
  const state = flyWithLean(0.12);
  assert.ok(state.bankAngle > 0, `expected right bank, got ${state.bankAngle}`);
  assert.ok(state.position.x < -1, `expected drift toward -x, got ${state.position.x}`);
});

test("leaning LEFT banks left and carries the bird toward its left (+x)", () => {
  const state = flyWithLean(-0.12);
  assert.ok(state.bankAngle < 0, `expected left bank, got ${state.bankAngle}`);
  assert.ok(state.position.x > 1, `expected drift toward +x, got ${state.position.x}`);
});

test("standing straight flies straight (no lateral drift)", () => {
  const state = flyWithLean(0);
  assert.ok(Math.abs(state.position.x) < 0.5, `expected no drift, got ${state.position.x}`);
});
