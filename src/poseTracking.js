import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Pose inference is throttled independently of the render loop: running a
// heavy ML model every rendered frame can tank framerate on older laptops.
const POSE_INTERVAL_MS = 1000 / 25;

async function createLandmarker(vision, delegate) {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

/**
 * Requests webcam access and starts a MediaPipe PoseLandmarker detection loop
 * against the given <video> element.
 *
 * @param {HTMLVideoElement} videoElement
 * @returns {Promise<{getLatestLandmarks: () => (Array|null), stop: () => void}>}
 */
export async function setupPoseTracking(videoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });
  videoElement.srcObject = stream;
  await new Promise((resolve) => {
    videoElement.onloadedmetadata = () => {
      videoElement.play();
      resolve();
    };
  });

  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

  let poseLandmarker;
  try {
    poseLandmarker = await createLandmarker(vision, "GPU");
  } catch (err) {
    poseLandmarker = await createLandmarker(vision, "CPU");
  }

  let latestLandmarks = null;
  let running = true;
  let timeoutId = null;

  function detectTick() {
    if (!running) return;
    if (videoElement.readyState >= 2) {
      const nowMs = performance.now();
      const result = poseLandmarker.detectForVideo(videoElement, nowMs);
      latestLandmarks = result.landmarks?.[0] ?? null;
    }
    timeoutId = setTimeout(detectTick, POSE_INTERVAL_MS);
  }
  detectTick();

  return {
    getLatestLandmarks: () => latestLandmarks,
    stop: () => {
      running = false;
      if (timeoutId) clearTimeout(timeoutId);
      stream.getTracks().forEach((track) => track.stop());
      poseLandmarker.close();
    },
  };
}
