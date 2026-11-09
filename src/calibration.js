import { computeCalibrationBaseline, LANDMARK } from "./controls.js";

const DEFAULT_DURATION_MS = 3000;
const DISCARD_FRACTION = 0.2; // drop the first 20% of samples (camera auto-exposure settling)

function shouldersVisible(landmarks) {
  return [LANDMARK.LEFT_SHOULDER, LANDMARK.RIGHT_SHOULDER].every((i) => (landmarks[i]?.visibility ?? 0) > 0.5);
}

/**
 * Resolves once the player's shoulders have been clearly visible for a run of
 * consecutive frames, so the "hold steady" countdown only starts when they're
 * properly in view. Hips aren't required, so seated players can still calibrate.
 * @param {object} opts
 * @param {() => (Array|null)} opts.getLandmarks
 * @param {number} [opts.requiredFrames]
 * @param {(cb: FrameRequestCallback) => number} [opts.requestFrame] - injectable for tests
 */
export function waitForPose({ getLandmarks, requiredFrames = 12, requestFrame = requestAnimationFrame }) {
  return new Promise((resolve) => {
    let streak = 0;
    const tick = () => {
      const landmarks = getLandmarks();
      streak = landmarks && shouldersVisible(landmarks) && computeCalibrationBaseline([landmarks]) ? streak + 1 : 0;
      if (streak >= requiredFrames) resolve();
      else requestFrame(tick);
    };
    requestFrame(tick);
  });
}

/**
 * Runs the "hold still" calibration countdown, sampling landmarks each frame
 * via getLandmarks(), and resolves to a calibration baseline (see controls.js).
 *
 * @param {object} opts
 * @param {() => (Array|null)} opts.getLandmarks - returns the latest pose landmarks, or null
 * @param {(fraction: number) => void} [opts.onProgress] - called with 0..1 progress
 * @param {number} [opts.durationMs]
 * @param {(cb: FrameRequestCallback) => number} [opts.requestFrame] - injectable for tests
 */
export function runCalibration({
  getLandmarks,
  onProgress,
  durationMs = DEFAULT_DURATION_MS,
  requestFrame = requestAnimationFrame,
}) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let startTime = null;

    const tick = (nowMs) => {
      if (startTime === null) startTime = nowMs;
      const elapsed = nowMs - startTime;
      const fraction = Math.min(elapsed / durationMs, 1);
      onProgress?.(fraction);

      const landmarks = getLandmarks();
      if (landmarks) frames.push(landmarks);

      if (elapsed < durationMs) {
        requestFrame(tick);
        return;
      }

      const discardCount = Math.floor(frames.length * DISCARD_FRACTION);
      const usableFrames = frames.slice(discardCount);
      const baseline = computeCalibrationBaseline(usableFrames);

      if (!baseline) {
        reject(
          new Error(
            "Calibration failed: no pose detected. Make sure your head, shoulders, and hips are visible."
          )
        );
        return;
      }

      resolve(baseline);
    };

    requestFrame(tick);
  });
}
