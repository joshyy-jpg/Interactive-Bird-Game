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

test("missing/low-visibility landmarks hold last inputs", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  const seen = settle(makeFrame({ shoulderTilt: 0.12, wristY: 0.2 }), baseline, state);

  const out = computeControlInputs(null, baseline, state, 1 / 60, 9999);
  assert.equal(out.turnInput, seen.turnInput);
  assert.equal(out.climbInput, state.lastClimbInput);
});

// Drives the controls with wrist heights over time. `wristYAt(t)` returns the
// image y of both wrists (shoulders at 0.4, hips at 0.7, so 0.3 = one torso).
// Camera frames arrive at `fps`; the game calls the controls every 60Hz render
// frame and repeats the latest camera frame in between, as main.js does.
function drive(wristYAt, seconds, { fps = 30, state = createControlsState(), baseline = neutralBaseline(), start = 0 } = {}) {
  const outputs = [];
  const dt = 1 / 60;
  let frame = null;
  let nextCamera = start;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const t = start + i * dt;
    if (t >= nextCamera - 1e-9) {
      const y = wristYAt(t);
      frame = y === null ? null : makeFrame({ wristY: y });
      nextCamera += 1 / fps;
    }
    outputs.push({ t, ...computeControlInputs(frame, baseline, state, dt, t * 1000) });
  }
  return { outputs, state, baseline };
}

const wave = (hz, low, high) => (t) => low + (high - low) * (0.5 - 0.5 * Math.cos(2 * Math.PI * hz * t));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("steady arm flapping registers strongly and continuously, with no gaps between strokes", () => {
  const { outputs } = drive(wave(2, 0.3, 0.55), 3);
  const last2s = outputs.filter((o) => o.t >= 1).map((o) => o.flapInput);
  assert.ok(mean(last2s) > 0.7, `mean flap ${mean(last2s)}`);
  assert.ok(Math.min(...last2s) > 0.4, `flap dropped to ${Math.min(...last2s)} between strokes`);
});

test("small, quick flaps still count", () => {
  const { outputs } = drive(wave(2.5, 0.35, 0.47), 3);
  const last2s = outputs.filter((o) => o.t >= 1).map((o) => o.flapInput);
  assert.ok(mean(last2s) > 0.4, `mean flap ${mean(last2s)}`);
});

test("holding still with camera jitter is not a flap", () => {
  let n = 0;
  const jitter = () => 0.4 + 0.004 * Math.sin((n++) * 2.3999);
  const { outputs } = drive(jitter, 3);
  assert.equal(Math.max(...outputs.map((o) => o.flapInput)), 0);
});

test("raising the arms once to climb gives at most a brief flap, then a steady climb", () => {
  const raise = (t) => (t < 0.3 ? 0.6 - (0.45 * t) / 0.3 : 0.15);
  const { outputs } = drive(raise, 1.5);
  const last = outputs.at(-1);
  assert.equal(last.flapInput, 0);
  assert.ok(last.climbInput > 0.5, `climb ${last.climbInput}`);
});

test("holding the arms up starts a climb within half a second", () => {
  const state = createControlsState();
  const baseline = neutralBaseline();
  drive(() => 0.4, 0.5, { state, baseline });
  const { outputs } = drive(() => 0.15, 0.5, { state, baseline, start: 0.5 });
  assert.ok(outputs.at(-1).climbInput > 0.5, `climb ${outputs.at(-1).climbInput}`);
});

test("flapping with the arms mostly below the shoulders does not dive", () => {
  const { outputs } = drive(wave(1.8, 0.45, 0.75), 3);
  const last = outputs.filter((o) => o.t >= 1.5);
  assert.ok(mean(last.map((o) => o.flapInput)) > 0.7);
  assert.ok(Math.min(...last.map((o) => o.climbInput)) > -0.15, `dove to ${Math.min(...last.map((o) => o.climbInput))}`);
});

test("flapping around shoulder level doesn't make the bird bob between climb and dive", () => {
  const { outputs } = drive(wave(1.5, 0.25, 0.55), 4);
  const climbs = outputs.filter((o) => o.t >= 2).map((o) => o.climbInput);
  assert.ok(Math.max(...climbs.map(Math.abs)) < 0.2, `climb swung to ${Math.max(...climbs.map(Math.abs))}`);
});

test("a tracking gap fades flapping out, and reappearing doesn't count as a flap", () => {
  const state = createControlsState();
  const baseline = neutralBaseline();
  drive(wave(2, 0.3, 0.55), 1, { state, baseline });
  const gap = drive(() => null, 1, { state, baseline, start: 1 });
  assert.ok(gap.outputs.at(-1).flapInput < 0.05, `flap after gap ${gap.outputs.at(-1).flapInput}`);
  const back = drive(() => 0.15, 0.3, { state, baseline, start: 2 });
  assert.ok(Math.max(...back.outputs.map((o) => o.flapInput)) < 0.2);
});

// A player with arms held out: `left`/`right` are wrist heights above the
// shoulders in torso lengths (torso = 0.3 of the image).
function wingFrame({ lean = 0, left = 0, right = 0, wristVisibility = 1 } = {}) {
  const frame = makeFrame({ shoulderTilt: 0.2 * Math.tan(lean) });
  frame[LANDMARK.LEFT_WRIST] = { x: 0.1, y: 0.4 - left * 0.3, visibility: wristVisibility };
  frame[LANDMARK.RIGHT_WRIST] = { x: 0.9, y: 0.4 - right * 0.3, visibility: wristVisibility };
  return frame;
}
const degrees = (d) => (d * Math.PI) / 180;

test("a comfortable lean is enough: about 17 degrees is a full turn", () => {
  const baseline = neutralBaseline();
  const at = (d) => settle(wingFrame({ lean: degrees(d) }), baseline, createControlsState(), 90).turnInput;
  assert.ok(at(12) > 0.6, `12deg gave ${at(12)}`);
  assert.ok(at(17) > 0.97, `17deg gave ${at(17)}`);
  assert.ok(at(5) < at(12), "bigger leans should turn harder");
});

test("leaning still steers when the hands are out of the camera's view", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  settle(wingFrame({ right: 0.6, left: 0.6 }), baseline, state, 60);
  const climbBefore = state.lastClimbInput;
  const out = settle(wingFrame({ lean: degrees(14), wristVisibility: 0.1 }), baseline, state, 60);
  assert.ok(out.turnInput > 0.7, `turn ${out.turnInput}`);
  assert.equal(out.climbInput, climbBefore, "climb holds while the arms can't be seen");
});

test("hands reappearing after leaving the frame isn't read as a flap", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  settle(wingFrame({ left: 0.5, right: 0.5, wristVisibility: 0.1 }), baseline, state, 30);
  const out = computeControlInputs(wingFrame({ left: -0.5, right: -0.5 }), baseline, state, 1 / 60, 0);
  assert.equal(out.flapInput, 0);
});

test("tipping the arms steers without leaning, the same way as leaning", () => {
  const baseline = neutralBaseline();
  const right = settle(wingFrame({ left: 0.45, right: -0.45 }), baseline, createControlsState(), 90);
  const left = settle(wingFrame({ left: -0.45, right: 0.45 }), baseline, createControlsState(), 90);
  assert.ok(right.turnInput > 0.95, `right hand low gave ${right.turnInput}`);
  assert.ok(left.turnInput < -0.95, `left hand low gave ${left.turnInput}`);
  const lean = settle(wingFrame({ lean: degrees(14) }), baseline, createControlsState(), 90);
  assert.ok(lean.turnInput > 0, "lean right and right hand low must agree");
});

test("tipping the arms is not read as flapping and doesn't change climb", () => {
  const baseline = neutralBaseline();
  const state = createControlsState();
  const dt = 1 / 60;
  let peakFlap = 0;
  let out;
  for (let i = 0; i < 90; i++) {
    const tip = 0.45 * Math.min(i / 30, 1); // tipped over half a second
    out = computeControlInputs(wingFrame({ left: tip, right: -tip }), baseline, state, dt, i * 16);
    peakFlap = Math.max(peakFlap, out.flapInput);
  }
  assert.equal(peakFlap, 0);
  assert.equal(out.climbInput, 0);
});

test("flapping straight doesn't steer, even with one arm lagging the other", () => {
  const baseline = neutralBaseline();
  for (const lag of [0, 0.04, 0.08]) {
    const state = createControlsState();
    const dt = 1 / 60;
    let peak = 0;
    for (let i = 0; i < 360; i++) {
      const t = i * dt;
      const frame = wingFrame({ left: 0.6 * Math.sin(4 * Math.PI * t), right: 0.6 * Math.sin(4 * Math.PI * (t - lag)) });
      peak = Math.max(peak, Math.abs(computeControlInputs(frame, baseline, state, dt, t * 1000).turnInput));
    }
    assert.ok(peak < 0.05, `lag ${lag}s steered with peak ${peak}`);
  }
});
