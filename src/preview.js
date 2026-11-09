// Draws a small mirrored webcam view with the detected pose skeleton overlaid,
// so the player can confirm the camera is tracking their body. Purely a visual
// aid — it does not feed into flight controls.

// Body-skeleton connections by landmark index (face/hands omitted for clarity).
const CONNECTIONS = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
];

// The landmarks the flight controls actually use — highlighted brighter.
const KEY_POINTS = new Set([11, 12, 13, 14, 15, 16, 23, 24]);
const VISIBILITY_THRESHOLD = 0.5;

/**
 * @param {HTMLCanvasElement} canvas - the preview canvas
 * @param {HTMLVideoElement} video - the webcam video element
 * @param {() => (Array|null)} getLandmarks - returns latest pose landmarks
 * @returns {{start: () => void, stop: () => void}}
 */
export function createPreview(canvas, video, getLandmarks) {
  const ctx = canvas.getContext("2d");
  let running = false;
  let rafId = null;

  function point(lm, w, h) {
    // Video is mirrored horizontally, so mirror landmark x to match.
    return { x: (1 - lm.x) * w, y: lm.y * h };
  }

  function drawSkeleton(landmarks, w, h) {
    // The canvas is drawn at very different sizes (camera setup vs. in flight),
    // so size strokes in on-screen pixels rather than canvas pixels.
    const px = w / (canvas.clientWidth || w);
    ctx.lineWidth = 2.5 * px;
    ctx.strokeStyle = "rgba(249, 185, 59, 0.95)";
    for (const [a, b] of CONNECTIONS) {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!la || !lb) continue;
      if ((la.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;
      if ((lb.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;
      const pa = point(la, w, h);
      const pb = point(lb, w, h);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm || (lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;
      if (!KEY_POINTS.has(i) && !CONNECTIONS.some(([a, b]) => a === i || b === i))
        continue;
      const p = point(lm, w, h);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (KEY_POINTS.has(i) ? 4.5 : 3) * px, 0, Math.PI * 2);
      ctx.fillStyle = KEY_POINTS.has(i) ? "#f4efe1" : "rgba(249, 185, 59, 0.95)";
      ctx.fill();
    }
  }

  function draw() {
    if (!running) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1); // mirror so it reads like a mirror
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    const landmarks = getLandmarks();
    if (landmarks) drawSkeleton(landmarks, w, h);

    rafId = requestAnimationFrame(draw);
  }

  return {
    start() {
      if (running) return;
      running = true;
      draw();
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}
