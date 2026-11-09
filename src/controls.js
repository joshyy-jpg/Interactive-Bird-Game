// Converts raw pose landmarks + a calibration baseline into normalized flight
// control inputs: { turnInput, climbInput }. Pure logic, no DOM/Three.js refs,
// so this is unit-testable with synthetic landmark objects.
//
//   turnInput:  -1 (full left) .. 0 (straight) .. +1 (full right)
//   climbInput: -1 (full dive) .. 0 (glide) .. +1 (full climb)
//
//   flapInput:  0 (arms still) .. 1 (flapping hard)
//
// Turning comes from body lean (shoulder-line tilt). Climb/dive comes from the
// AVERAGE height of your arms (arms up = climb, arms down = dive), smoothed so
// the up-and-down of a flap doesn't make the bird bob. Flapping is measured as
// how much your wrists are moving, so any steady flapping counts at once, with
// no exact rhythm to hit and no limit on how many strokes register.

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
  // wings), positive above, negative below, in torso lengths. So arms-level =
  // glide, arms-up = climb, arms-down = dive. Independent of calibration.
  armHeightSmoothingRate: 6, // per second, applied twice: averages out flapping strokes
  climbDeadzone: 0.1, // arm height within this of shoulder level = glide
  climbRange: 0.45, // arm height beyond the deadzone that = full climb/dive

  // --- Flapping: how much the wrists move, in torso lengths per second ---
  wristSmoothingRate: 20, // per second; removes camera jitter before measuring motion
  flapMotionRate: 6, // per second; how quickly flap strength follows your arms
  flapMotionDeadzone: 0.45, // slower movement than this (jitter, small adjustments) = no flap
  flapMotionFull: 2.0, // this much wrist movement = flapping at full power
};

export function createControlsState() {
  return {
    turnInput: 0,
    hasArm: false,
    armStage1: 0, // first and second smoothing passes of the arm height
    armStage2: 0,
    hasWrists: false,
    leftWrist: 0, // smoothed wrist heights, torso lengths above the shoulders
    rightWrist: 0,
    flapMotion: 0, // smoothed wrist speed
    lastClimbInput: 0,
    lastFlapInput: 0,
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
 * Safe to call every render frame even when the camera delivers fewer frames:
 * flapping is measured as total wrist movement over time, so repeated frames
 * simply add no movement.
 * @param {Array} landmarks - current frame's 33 pose landmarks (or null if none detected)
 * @param {{scale:number, neutralShoulderAngle:number}} baseline
 * @param {object} state - from createControlsState(), mutated in place
 * @param {number} dt - seconds since last frame
 * @param {number} [nowMs] - unused; kept so existing callers need no change
 * @returns {{turnInput: number, climbInput: number, flapInput: number}}
 */
export function computeControlInputs(landmarks, baseline, state, dt, nowMs) { // eslint-disable-line no-unused-vars
  const c = CONTROL_CONSTANTS;

  const requiredIndices = [
    LANDMARK.LEFT_SHOULDER,
    LANDMARK.RIGHT_SHOULDER,
    LANDMARK.LEFT_WRIST,
    LANDMARK.RIGHT_WRIST,
  ];
  const tracked =
    !!landmarks && requiredIndices.every((i) => landmarkVisible(landmarks, i));

  if (!tracked || !baseline) {
    // Hold steering through a tracking gap, but let flapping fade out, and
    // forget the wrists so reappearing doesn't count as a huge arm movement.
    state.hasWrists = false;
    state.flapMotion *= Math.exp(-c.flapMotionRate * dt);
    state.lastFlapInput = flapFromMotion(state.flapMotion, c);
    return { turnInput: state.turnInput, climbInput: state.lastClimbInput, flapInput: state.lastFlapInput };
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

  // Wrist heights relative to the SHOULDERS, in torso lengths (image y grows downward).
  const shoulderMidY = (ls.y + rs.y) / 2;
  const leftHeight = (shoulderMidY - lw.y) / baseline.scale;
  const rightHeight = (shoulderMidY - rw.y) / baseline.scale;

  // --- Flapping: smoothed wrist speed, both arms averaged. ---
  if (!state.hasWrists) {
    state.leftWrist = leftHeight;
    state.rightWrist = rightHeight;
    state.hasWrists = true;
  }
  const wristT = 1 - Math.exp(-c.wristSmoothingRate * dt);
  const nextLeft = state.leftWrist + (leftHeight - state.leftWrist) * wristT;
  const nextRight = state.rightWrist + (rightHeight - state.rightWrist) * wristT;
  const speed = dt > 0 ? (Math.abs(nextLeft - state.leftWrist) + Math.abs(nextRight - state.rightWrist)) / 2 / dt : 0;
  state.leftWrist = nextLeft;
  state.rightWrist = nextRight;
  state.flapMotion += (speed - state.flapMotion) * (1 - Math.exp(-c.flapMotionRate * dt));
  const flapInput = flapFromMotion(state.flapMotion, c);

  // --- Climb/dive: arm height averaged over the flap stroke, deadzoned. ---
  const rawArmHeight = (leftHeight + rightHeight) / 2;
  if (!state.hasArm) {
    state.armStage1 = state.armStage2 = rawArmHeight;
    state.hasArm = true;
  }
  const armT = 1 - Math.exp(-c.armHeightSmoothingRate * dt);
  state.armStage1 += (rawArmHeight - state.armStage1) * armT;
  state.armStage2 += (state.armStage1 - state.armStage2) * armT;
  let climbInput = deadzoneMap(state.armStage2, c.climbDeadzone, c.climbRange);
  // Flapping means "keep me up". Many people flap with their arms mostly below
  // the shoulders, so while flapping, low arms don't count as a dive request.
  if (climbInput < 0) climbInput *= 1 - flapInput;

  state.lastClimbInput = climbInput;
  state.lastFlapInput = flapInput;
  return { turnInput, climbInput, flapInput };
}

function flapFromMotion(motion, c) {
  return clamp((motion - c.flapMotionDeadzone) / (c.flapMotionFull - c.flapMotionDeadzone), 0, 1);
}
