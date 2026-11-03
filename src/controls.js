// Converts raw pose landmarks + a calibration baseline into normalized flight
// control inputs: { turnInput, climbInput }. Pure logic, no DOM/Three.js refs,
// so this is unit-testable with synthetic landmark objects.
//
//   turnInput:  -1 (full left) .. 0 (straight) .. +1 (full right)
//   climbInput: -1 (full dive) .. 0 (glide) .. +1 (full climb)
//
// Turning comes from body lean (shoulder-line tilt). Climb/dive comes primarily
// from how high you hold your arms (arms up = climb, arms down = dive), with an
// separate speed impulse on a quick completed flap. Held arm positions steer
// after a short intent delay. Both axes have a neutral deadzone so small movements do nothing.

export const LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
};

const VISIBILITY_THRESHOLD = 0.5;

export const CONTROL_CONSTANTS = {
  // --- Turning (body lean) ---
  // Flip to -1 if webcam mirroring makes leaning right steer left in testing.
  turnSignMultiplier: 1,
  turnDeadzoneRad: 0.07, // ~4deg neutral zone: no turn until you lean past this
  maxTurnAngleRad: 0.5, // additional lean beyond the deadzone that = full turn
  // Exponential smoothing rates (per second), so control feel is identical on
  // 60Hz and 120Hz displays. Lower = smoother/slower.
  turnSmoothingRate: 12,

  // --- Climb / dive (arm height RELATIVE TO SHOULDERS) ---
  // armHeight is 0 when wrists are level with the shoulders (arms out like
  // wings), positive above, negative below. So arms-level = glide, arms-up =
  // climb, arms-down = descend. This is independent of calibration.
  armHeightSmoothingRate: 40, // per-second smoothing on the raw arm-height signal
  climbDeadzone: 0.1, // arm height within this of shoulder level = glide
  climbRange: 0.5, // arm height beyond the deadzone that = full climb/dive

  // --- Quick flap detection, independent of sustained pitch ---
  flapUpperThreshold: 0.25, // armHeight crossing above this (above shoulders) = arms raised
  flapLowerThreshold: 0.0, // armHeight dropping back to shoulder level = arms down
  minFlapDurationMs: 120, // debounce: ignore upstrokes shorter than this
  maxFlapDurationMs: 650,
  poseHoldMs: 500, // short strokes preserve pitch; held poses steer
  flapBurstDecayPerSecond: 2.0, // how fast a flap burst fades
  flapSpeedMin: 0.5,
  flapSpeedMax: 4.0,
};

export function createControlsState() {
  return {
    emaArmHeight: 0,
    hasEma: false,
    flapPhase: "ARMS_DOWN",
    flapStartTime: null,
    flapStartSignal: 0,
    flapBurst: 0,
    turnInput: 0,
    lastClimbInput: 0,
    poseSign: 0,
    poseSince: 0,
    pitchHoldUntil: 0,
  };
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// Maps a signed value through a neutral deadzone into [-1, 1]: zero inside the
// deadzone, then ramps up to +/-1 as it moves `range` past the deadzone edge.
function deadzoneMap(value, deadzone, range) {
  const mag = Math.abs(value);
  if (mag <= deadzone) return 0;
  return Math.sign(value) * clamp((mag - deadzone) / range, 0, 1);
}

function landmarkVisible(landmarks, index) {
  const lm = landmarks[index];
  return !!lm && (lm.visibility === undefined || lm.visibility > VISIBILITY_THRESHOLD);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Signed tilt of the shoulder line away from horizontal, in radians.
// Using the ABSOLUTE horizontal distance as the reference avoids the atan2
// wrap-around near +/-180deg (the subject's shoulders are near-horizontal in
// the image, and which shoulder has the larger x depends on camera mirroring).
// Level shoulders -> 0; right shoulder lower -> positive; right shoulder higher
// -> negative. Range is (-pi/2, pi/2), so no discontinuity between lean sides.
function shoulderTilt(leftShoulder, rightShoulder) {
  const dy = rightShoulder.y - leftShoulder.y;
  const dx = Math.abs(rightShoulder.x - leftShoulder.x) || 1e-6;
  return Math.atan2(dy, dx);
}

// A robust scale reference. Prefer torso length (shoulders->hips), but fall back
// to shoulder width when the hips aren't in frame (e.g. seated at a desk).
function scaleReference(landmarks) {
  const ls = landmarks[LANDMARK.LEFT_SHOULDER];
  const rs = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lh = landmarks[LANDMARK.LEFT_HIP];
  const rh = landmarks[LANDMARK.RIGHT_HIP];
  if (!ls || !rs) return null;
  const shoulderWidth = distance(ls, rs);
  const hipsVisible =
    lh && rh && (lh.visibility ?? 1) > VISIBILITY_THRESHOLD &&
    (rh.visibility ?? 1) > VISIBILITY_THRESHOLD;
  if (hipsVisible) {
    const torso = distance(midpoint(ls, rs), midpoint(lh, rh));
    if (torso > 0) return torso;
  }
  // Shoulder width is a stable stand-in when hips are missing.
  return shoulderWidth > 0 ? shoulderWidth * 1.8 : null;
}

/**
 * Computes calibration baseline values from a batch of sampled landmark frames.
 * @param {Array} landmarkFrames - array of 33-landmark arrays sampled while user stands neutrally.
 */
export function computeCalibrationBaseline(landmarkFrames) {
  const scales = [];
  const shoulderAngles = [];

  for (const landmarks of landmarkFrames) {
    const ls = landmarks[LANDMARK.LEFT_SHOULDER];
    const rs = landmarks[LANDMARK.RIGHT_SHOULDER];
    if (!ls || !rs) continue;

    const scale = scaleReference(landmarks);
    if (!scale) continue;

    scales.push(scale);
    shoulderAngles.push(shoulderTilt(ls, rs));
  }

  if (scales.length === 0) return null;

  const median = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  // Note: climb/dive uses arm height relative to the shoulders live (shoulder
  // level = glide), so it needs no calibrated baseline — only the turn neutral
  // and the scale reference are captured here.
  return {
    scale: median(scales),
    neutralShoulderAngle: median(shoulderAngles),
  };
}

/**
 * Computes one frame's control inputs from landmarks, mutating and returning `state`.
 * @param {Array} landmarks - current frame's 33 pose landmarks (or null if none detected)
 * @param {{scale:number, neutralShoulderAngle:number, neutralArmHeight:number}} baseline
 * @param {object} state - from createControlsState(), mutated in place
 * @param {number} dt - seconds since last frame
 * @param {number} nowMs - current timestamp in ms (for flap debounce timing)
 * @returns {{turnInput: number, climbInput: number, flapImpulse: number}}
 */
export function computeControlInputs(landmarks, baseline, state, dt, nowMs) {
  const c = CONTROL_CONSTANTS;

  // Flap bursts always fade over time, regardless of tracking quality.
  state.flapBurst = Math.max(0, state.flapBurst - c.flapBurstDecayPerSecond * state.flapBurst * dt);

  const requiredIndices = [
    LANDMARK.LEFT_SHOULDER,
    LANDMARK.RIGHT_SHOULDER,
    LANDMARK.LEFT_WRIST,
    LANDMARK.RIGHT_WRIST,
  ];
  const tracked =
    !!landmarks && requiredIndices.every((i) => landmarkVisible(landmarks, i));

  if (!tracked || !baseline) {
    // Tracking gaps cannot complete a partially observed flap.
    state.flapPhase = "ARMS_DOWN";
    state.hasEma = false;
    state.poseSince = nowMs;
    return { turnInput: state.turnInput, climbInput: state.lastClimbInput, flapImpulse: 0 };
  }

  const ls = landmarks[LANDMARK.LEFT_SHOULDER];
  const rs = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lw = landmarks[LANDMARK.LEFT_WRIST];
  const rw = landmarks[LANDMARK.RIGHT_WRIST];

  // --- Turn: shoulder-line tilt through a deadzone, then smoothed. ---
  const shoulderAngle = shoulderTilt(ls, rs);
  const angleDelta = (shoulderAngle - baseline.neutralShoulderAngle) * c.turnSignMultiplier;
  const rawTurn = deadzoneMap(angleDelta, c.turnDeadzoneRad, c.maxTurnAngleRad);
  state.turnInput += (rawTurn - state.turnInput) * (1 - Math.exp(-c.turnSmoothingRate * dt));
  const turnInput = state.turnInput;

  // --- Climb/dive: smoothed arm height relative to the SHOULDERS, deadzoned. ---
  // 0 = wrists level with shoulders (glide); >0 above = climb; <0 below = descend.
  const shoulderMid = midpoint(ls, rs);
  const avgWristY = (lw.y + rw.y) / 2;
  const rawArmHeight = (shoulderMid.y - avgWristY) / baseline.scale;
  state.emaArmHeight = state.hasEma
    ? state.emaArmHeight +
      (rawArmHeight - state.emaArmHeight) * (1 - Math.exp(-c.armHeightSmoothingRate * dt))
    : rawArmHeight;
  state.hasEma = true;
  const armHeight = state.emaArmHeight;
  const sustainedClimb = deadzoneMap(armHeight, c.climbDeadzone, c.climbRange);

  let flapImpulse = 0;
  // --- Flap burst detection (hysteresis state machine on arm height). ---
  if (state.flapPhase === "ARMS_DOWN" && armHeight > c.flapUpperThreshold) {
    state.flapPhase = "ARMS_UP";
    state.flapStartTime = nowMs;
    state.flapStartSignal = armHeight;
  } else if (state.flapPhase === "ARMS_UP" && armHeight < c.flapLowerThreshold) {
    const durationMs = nowMs - (state.flapStartTime ?? nowMs);
    if (durationMs >= c.minFlapDurationMs && durationMs <= c.maxFlapDurationMs) {
      const amplitude = Math.max(0, state.flapStartSignal - armHeight);
      const flapSpeed = clamp(amplitude / (durationMs / 1000), c.flapSpeedMin, c.flapSpeedMax);
      flapImpulse = 0.65 + 0.35 * (flapSpeed / c.flapSpeedMax);
      state.flapBurst = flapImpulse;
      state.pitchHoldUntil = nowMs + c.poseHoldMs;
      state.poseSince = nowMs;
    }
    state.flapPhase = "ARMS_DOWN";
  }

  const sign = Math.sign(sustainedClimb);
  if (sign !== state.poseSign) { state.poseSign = sign; state.poseSince = nowMs; }
  // A quick up/down stroke preserves the previous pitch. Only a held arm
  // position steers; this also allows flapping during an established dive.
  const held = nowMs - state.poseSince >= c.poseHoldMs && nowMs >= state.pitchHoldUntil;
  const climbInput = held ? sustainedClimb : state.lastClimbInput;
  state.lastClimbInput = climbInput;

  return { turnInput, climbInput, flapImpulse };
}
