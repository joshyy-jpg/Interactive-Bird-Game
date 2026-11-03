import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANDMARK,
  createControlsState,
  computeControlInputs,
  computeCalibrationBaseline,
} from "../../src/controls.js";

// Builds a full 33-entry landmark frame. In MediaPipe normalized image coords
// y increases downward, so a *smaller* wristY means arms raised higher.
function makeFrame({
  shoulderY = 0.4,
  shoulderTilt = 0, // right shoulder relative y offset (positive = right shoulder lower)
  wristY = 0.6, // both wrists
  hipY = 0.7,
} = {}) {
  const frame = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));
  frame[LANDMARK.LEFT_SHOULDER] = { x: 0.4, y: shoulderY, visibility: 1 };
  frame[LANDMARK.RIGHT_SHOULDER] = { x: 0.6, y: shoulderY + shoulderTilt, visibility: 1 };
  frame[LANDMARK.LEFT_HIP] = { x: 0.42, y: hipY, visibility: 1 };
  frame[LANDMARK.RIGHT_HIP] = { x: 0.58, y: hipY, visibility: 1 };
  frame[LANDMARK.LEFT_WRIST] = { x: 0.35, y: wristY, visibility: 1 };
  frame[LANDMARK.RIGHT_WRIST] = { x: 0.65, y: wristY, visibility: 1 };
  return frame;
}

function neutralBaseline() {
  // Arms down at rest (wrists below shoulders), level shoulders.
  const frames = Array.from({ length: 30 }, () => makeFrame());
  return computeCalibrationBaseline(frames);
}

// Runs several identical frames so the EMA-smoothed signals settle.
function settle(frame, baseline, state, frames = 12) {
  let out;
  let t = 0;
  for (let i = 0; i < frames; i++) {
    t += 16;
    out = computeControlInputs(frame, baseline, state, 1 / 60, t);
  }
  return out;
}

test("calibration baseline computes sensible values", () => {
  const baseline = neutralBaseline();
  assert.ok(baseline);
  assert.ok(baseline.scale > 0);
  assert.ok(Math.abs(baseline.neutralShoulderAngle) < 0.01, "level shoulders ~0 angle");
});

test("calibration falls back to shoulder width when hips are missing (seated)", () => {
  const seated = makeFrame();
  seated[LANDMARK.LEFT_HIP] = { x: 0.42, y: 0.7, visibility: 0.1 };
  seated[LANDMARK.RIGHT_HIP] = { x: 0.58, y: 0.7, visibility: 0.1 };
  const baseline = computeCalibrationBaseline([seated, seated, seated]);
  assert.ok(baseline, "should still calibrate without visible hips");
  assert.ok(baseline.scale > 0);
});

test("calibration returns null when no valid frames", () => {
  const empty = new Array(33).fill(null);
  assert.equal(computeCalibrationBaseline([empty]), null);
});

test("small lean within the deadzone produces no turn", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  // A tiny tilt (~2deg) should stay inside the neutral zone.
  const out = settle(makeFrame({ shoulderTilt: 0.01 }), baseline, state);
  assert.equal(out.turnInput, 0);
});

test("a clear lean turns, and left/right have opposite signs", () => {
  const baseline = neutralBaseline();
  const right = settle(makeFrame({ shoulderTilt: 0.12 }), baseline, createControlsState());
  assert.ok(right.turnInput > 0, `expected positive turn, got ${right.turnInput}`);

  const left = settle(makeFrame({ shoulderTilt: -0.12 }), baseline, createControlsState());
  assert.ok(left.turnInput < 0, `expected negative turn, got ${left.turnInput}`);
});

test("both lean directions work when the right shoulder is on the image-left (real camera)", () => {
  // MediaPipe reports subject-relative shoulders; with an unmirrored camera the
  // subject's right shoulder (index 12) sits at a SMALLER x than the left. This
  // used to trip an atan2 wrap-around that made only one lean direction work.
  const frame = (tilt) => {
    const f = makeFrame();
    f[LANDMARK.RIGHT_SHOULDER] = { x: 0.4, y: 0.4 + tilt, visibility: 1 };
    f[LANDMARK.LEFT_SHOULDER] = { x: 0.6, y: 0.4, visibility: 1 };
    return f;
  };
  const baseline = computeCalibrationBaseline([frame(0), frame(0), frame(0)]);

  const right = settle(frame(0.12), baseline, createControlsState());
  const left = settle(frame(-0.12), baseline, createControlsState());

  assert.ok(right.turnInput > 0, `right lean should turn one way, got ${right.turnInput}`);
  assert.ok(left.turnInput < 0, `left lean should turn the other, got ${left.turnInput}`);
  // Roughly symmetric magnitude — no wrap-around blowing one side to full lock.
  assert.ok(
    Math.abs(right.turnInput + left.turnInput) < 0.3,
    `expected symmetric turns, got ${right.turnInput} and ${left.turnInput}`
  );
});

test("raising arms above the shoulders produces a positive climb input", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  const out = settle(makeFrame({ wristY: 0.15 }), baseline, state, 45);
  assert.ok(out.climbInput > 0, `expected climb, got ${out.climbInput}`);
});

test("arms level with the shoulders is a glide (~0 climb)", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  // Wrists at the same height as the shoulders (0.4) — arms out like wings.
  const out = settle(makeFrame({ wristY: 0.4 }), baseline, state, 45);
  assert.equal(out.climbInput, 0);
});

test("arms below the shoulders give a dive (negative climb) input", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  const out = settle(makeFrame({ wristY: 0.85 }), baseline, state, 45);
  assert.ok(out.climbInput < 0, `expected dive, got ${out.climbInput}`);
});

test("completing a flap (arms up then back down) registers a burst", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  let t = 1000;
  const step = (f) => {
    t += 50;
    return computeControlInputs(f, baseline, state, 0.05, t);
  };

  // Sweep arms up high...
  for (let i = 0; i < 8; i++) step(makeFrame({ wristY: 0.12 }));
  // ...then back down to the sides to complete the flap cycle.
  for (let i = 0; i < 8; i++) step(makeFrame({ wristY: 0.6 }));

  assert.ok(state.flapBurst > 0, `flap should register a burst, got ${state.flapBurst}`);
});

test("missing/low-visibility landmarks hold last inputs", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  const seen = settle(makeFrame({ shoulderTilt: 0.12, wristY: 0.2 }), baseline, state);

  const out = computeControlInputs(null, baseline, state, 1 / 60, 9999);
  assert.equal(out.turnInput, seen.turnInput);
  assert.equal(out.climbInput, state.lastClimbInput);
});

function gestureDriver(initialPitch = 0) {
  const state = createControlsState(); state.lastClimbInput = initialPitch;
  const baseline = neutralBaseline(); let t = 0;
  return { state, step(wristY, frames) {
    const outputs = [];
    for (let i = 0; i < frames; i++) { t += 1000/60; outputs.push(computeControlInputs(makeFrame({ wristY }), baseline, state, 1/60, t)); }
    return outputs;
  }, gap() { t += 100; return computeControlInputs(null,baseline,state,0.1,t); } };
}

test("quick flap adds one speed impulse and preserves an established dive", () => {
  const g = gestureDriver(-0.6);
  const up = g.step(0.15, 15), down = g.step(0.6, 15);
  assert.equal([...up,...down].filter(o => o.flapImpulse > 0).length,1);
  assert.ok([...up,...down].every(o => o.climbInput === -0.6));
  assert.ok(g.step(0.6,40).at(-1).climbInput < -0.9);
});

test("held high then lowered arms steer without triggering a flap", () => {
  const g = gestureDriver();
  assert.ok(g.step(0.15,70).at(-1).climbInput > 0);
  const down = g.step(0.7,60);
  assert.ok(down.every(o => o.flapImpulse === 0));
  assert.ok(down.at(-1).climbInput < 0);
});

test("brief jitter and a tracking gap do not complete flaps", () => {
  const g = gestureDriver();
  const jitter = [...g.step(0.15,2),...g.step(0.6,5)];
  assert.ok(jitter.every(o => o.flapImpulse === 0));
  g.step(0.15,15); assert.equal(g.gap().flapImpulse,0);
  assert.ok(g.step(0.6,15).every(o => o.flapImpulse === 0));
});
