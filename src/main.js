import { createScene } from "./scene.js";
import { createBird } from "./bird.js";
import { setupPoseTracking } from "./poseTracking.js";
import { createPreview } from "./preview.js";
import { runCalibration } from "./calibration.js";
import {
  createControlsState,
  computeControlInputs,
  computeCalibrationBaseline,
} from "./controls.js";
import {
  createInitialFlightState,
  updateFlight,
  FLIGHT_CONSTANTS,
} from "./flight.js";
import { heightAt, SPAWN_SAFE_ZONE } from "./terrain.js";
import {
  CHECKPOINTS,
  createCourseState,
  updateCourseState,
  resetCourseState,
  elapsedSeconds,
  getCourseSafeZones,
} from "./course.js";
import { createCheckpoints } from "./checkpoints.js";
import * as ui from "./ui.js";
import { sampleWind } from "./wind.js";
import { createWindVisuals } from "./windVisuals.js";

const STATE = {
  LOADING: "LOADING",
  CALIBRATING: "CALIBRATING",
  MODE_SELECT: "MODE_SELECT",
  FLYING: "FLYING",
  ERROR: "ERROR",
};

const BEST_TIME_KEY = "birdgame.bestTime.v2";

function loadBestTimeSeconds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BEST_TIME_KEY) ?? "null");
    if (!parsed || parsed.checkpointCount !== CHECKPOINTS.length) return null;
    return parsed.seconds;
  } catch {
    return null; // storage unavailable (private mode, sandboxed, etc.) — no big deal
  }
}

function saveBestTimeIfBetter(seconds) {
  const current = loadBestTimeSeconds();
  const isBetter = current == null || seconds < current;
  if (isBetter) {
    try {
      localStorage.setItem(
        BEST_TIME_KEY,
        JSON.stringify({ seconds, checkpointCount: CHECKPOINTS.length, dateISO: new Date().toISOString() })
      );
    } catch {
      // storage unavailable — best time just won't persist this session
    }
  }
  return isBetter ? seconds : current;
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(2)}s`;
}

const canvas = document.getElementById("scene");
const video = document.getElementById("webcam");
const previewCanvas = document.getElementById("preview");
const previewWrap = document.getElementById("preview-wrap");

// Exposed so the Playwright smoke test can assert progression without a human.
const app = { state: STATE.LOADING, flightState: null, courseState: null };
window.__birdGame = app;
window.__BIRD_CHECKPOINTS = CHECKPOINTS; // test seam: e2e can teleport toward a known gate

async function main() {
  const sceneApi = createScene(canvas);
  let bird = createBird();
  sceneApi.addToScene(bird.group);

  const flightState0 = createInitialFlightState();
  app.flightState = flightState0;

  // Render a static frame immediately so the sky/bird show while models load.
  bird.setPose(flightState0.position, flightState0.heading, 0, 0);
  sceneApi.updateChaseCamera(flightState0, 0.016);
  sceneApi.render();

  ui.hideMessage();
  app.state = STATE.MODE_SELECT;
  let species = "eagle";
  const names = { eagle: "Bald eagle", pigeon: "Pigeon", gull: "Seagull" };
  document.querySelectorAll("[data-bird]").forEach(button => button.addEventListener("click", () => {
    species = button.dataset.bird;
    sceneApi.scene.remove(bird.group); bird.dispose(); bird = createBird(species); sceneApi.addToScene(bird.group);
    document.querySelectorAll("[data-bird]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    document.getElementById("bird-name").textContent = names[species];
  }));
  let menuActive = true;
  function menuFrame(now) {
    if (!menuActive) return;
    bird.setPose({ x: 0, y: 80, z: 0 }, -0.6 + Math.sin(now * 0.0002) * 0.2, 0.06, 0);
    bird.setWingFlap(now * 0.0017);
    sceneApi.camera.position.set(-4.5, 81.5, 7.5);
    sceneApi.camera.lookAt(-2.3, 80, 0);
    sceneApi.render(); requestAnimationFrame(menuFrame);
  }
  requestAnimationFrame(menuFrame);
  const mode = await ui.selectMode();
  menuActive = false;
  app.species = species;
  const motion = document.getElementById("control-style").value === "motion";
  let tracker = { getLatestLandmarks: () => null };
  let baseline;
  if (motion) {

  try {
    ui.showMessage("Requesting camera & loading pose tracker…");
    // Test seam: an e2e test can inject a fake tracker to exercise the state
    // machine + physics without a real webcam / network model download.
    tracker = window.__BIRD_TEST_TRACKER
      ? window.__BIRD_TEST_TRACKER
      : await setupPoseTracking(video);
  } catch (err) {
    app.state = STATE.ERROR;
    ui.showError(
      "Couldn't start the camera or pose tracker. Please allow camera access and reload.\n\n" +
        (err?.message ?? err)
    );
    return;
  }

  // Show the live camera + tracking preview as soon as the webcam is ready,
  // so the player can see themselves during calibration and flight.
  const preview = createPreview(previewCanvas, video, () =>
    tracker.getLatestLandmarks()
  );
  previewWrap.classList.add("visible");
  preview.start();

  // --- Calibration ---
  app.state = STATE.CALIBRATING;
  ui.showMessage("Stand back so your head, shoulders & hips are visible. Hold still…", {
    showCalibrationBar: true,
  });


  try {
    baseline = await runCalibration({
      getLandmarks: () => tracker.getLatestLandmarks(),
      onProgress: (f) => ui.setCalibrationProgress(f),
    });
  } catch (err) {
    app.state = STATE.ERROR;
    ui.showError(err?.message ?? String(err));
    return;
  }

  }
  ui.hideMessage();
  const menuReturn = document.getElementById("menu-return");
  menuReturn.hidden = false;
  menuReturn.addEventListener("click", () => location.reload());
  const keys = new Set();
  let flapQueued = false;
  window.addEventListener("keydown", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    if (e.key === " " && !e.repeat && !motion && app.state === STATE.FLYING) flapQueued = true;
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => { keys.clear(); flapQueued = false; });
  // Free Roam only ever protects the spawn point; Time Trial also flattens
  // terrain around every checkpoint (see terrain.js's safe-zone mechanism),
  // so a checkpoint can never spawn inside a randomly-placed mountain.
  const activeSafeZones =
    mode === "timeTrial" ? [SPAWN_SAFE_ZONE, ...getCourseSafeZones()] : [SPAWN_SAFE_ZONE];
  const groundHeightAt = (x, z) => heightAt(x, z, activeSafeZones);

  const checkpointsApi = mode === "timeTrial" ? createCheckpoints(sceneApi.scene) : null;
  let courseState = mode === "timeTrial" ? createCourseState() : null;
  let finishHandled = false;

  // Rebuild the ground immediately so newly-active safe zones (checkpoints)
  // show up right away rather than waiting for the bird to wander far enough
  // to trigger the normal distance-based rebuild — see world.js's `force` doc.
  sceneApi.updateWorld(flightState0.position, activeSafeZones, true);

  const windVisuals = createWindVisuals(sceneApi.scene);

  // --- Flying ---
  app.state = STATE.FLYING;
  ui.setInstructions(
    mode === "timeTrial"
      ? "Lean to turn  •  Raise arms to climb, lower to dive  •  Fly through the gates in order!  •  [C] recalibrate  [H] hide camera"
      : "Lean left / right to turn  •  Raise your arms to climb  •  Lower them to dive  •  [C] recalibrate  [H] hide camera"
  );
  if (motion) ui.setInstructions("Lean to turn • Quick up/down flap = speed • Hold arms high / low = climb / dive • C recalibrate · H camera");
  if (!motion) ui.setInstructions("← → / A D turn • ↑ / W climb • ↓ / S dive • Tap SPACE to flap • Follow the mint wind streams");
  if (mode === "timeTrial") ui.showTimer("0.00s");

  const controlsState = createControlsState();
  let flightState = flightState0;
  let wingPhase = 0;
  let flapAnimation = 0;
  const speedHud = document.getElementById("speed-hud");
  speedHud.hidden = false;
  const speedValue = document.getElementById("speed-value");
  const speedFill = document.getElementById("speed-fill");
  const flapCharges = document.querySelectorAll(".flap-charge");
  const flapStatus = document.getElementById("flap-status");
  const flightStatus = document.getElementById("flight-status");
  let lastTime = performance.now();

  /** Shows the finish overlay, persists a best time, and either resumes with a
   * fresh run (teleport back to spawn) or reloads to change mode entirely. */
  async function handleCourseFinish() {
    const elapsed = elapsedSeconds(courseState, performance.now() / 1000);
    const best = saveBestTimeIfBetter(elapsed);
    const choice = await ui.showCourseResult({
      elapsedText: `Time: ${formatSeconds(elapsed)}`,
      bestText: `Best: ${formatSeconds(best)}`,
    });
    if (choice === "changeMode") {
      location.reload();
      return;
    }
    // Fly Again: reset course progress and teleport back to the start,
    // without reloading (that would re-trigger the camera permission prompt).
    courseState = resetCourseState();
    flightState = createInitialFlightState();
    flapQueued = false;
    Object.assign(controlsState, createControlsState());
    checkpointsApi.updateVisuals(0);
    finishHandled = false;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  // Re-capture the neutral baseline on demand (press C): the player holds still
  // for a moment and we rebuild the "straight and level" reference. Fixes a bird
  // that's stuck turning because calibration caught them mid-lean.
  let recalSamples = null;
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (motion && key === "c" && recalSamples === null) {
      recalSamples = [];
      ui.showMessage("Recalibrating — stand straight and hold still…");
    } else if (key === "h") {
      previewWrap.classList.toggle("visible");
    }
  });

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    const landmarks = tracker.getLatestLandmarks();

    // Recalibration: collect ~1s of frames, then rebuild the baseline.
    if (recalSamples !== null) {
      if (landmarks) recalSamples.push(landmarks);
      if (recalSamples.length >= 45) {
        const fresh = computeCalibrationBaseline(recalSamples);
        if (fresh) {
          baseline = fresh;
          Object.assign(controlsState, createControlsState());
        }
        recalSamples = null;
        ui.hideMessage();
      }
      sceneApi.render();
      requestAnimationFrame(loop);
      return;
    }

    const controls = motion ? computeControlInputs(landmarks, baseline, controlsState, dt, now) : {
      turnInput: Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a")),
      flapImpulse: flapQueued ? 1 : 0,
      climbInput: Number(keys.has("arrowup") || keys.has("w")) - Number(keys.has("arrowdown") || keys.has("s")),
    };

    flapQueued = false;
    const streams = windVisuals.update(flightState.position, now/1000);
    const wind = sampleWind(flightState.position, flightState.heading, flightState.pitchAngle, streams);
    controls.windAcceleration = wind.acceleration;
    flightState = updateFlight(flightState, controls, dt, groundHeightAt);
    app.windStrength = wind.strength;
    app.flightState = flightState;

    // Only accepted strokes animate a flap; otherwise hold a gliding pose.
    if (flightState.flapPower > 0) { flapAnimation = 0.42; wingPhase = 0; }
    flapAnimation = Math.max(0, flapAnimation-dt);
    wingPhase += dt * 15;

    bird.setPose(
      flightState.position,
      flightState.heading,
      flightState.pitchAngle,
      flightState.bankAngle
    );
    bird.setWingFlap(flapAnimation > 0 ? wingPhase : 0);
    sceneApi.updateWorld(flightState.position, activeSafeZones);
    sceneApi.updateChaseCamera(flightState, dt);
    const targetFov = 60 + Math.max(0, flightState.forwardSpeed-16)*0.35;
    sceneApi.camera.fov += (targetFov-sceneApi.camera.fov)*(1-Math.exp(-2*dt));
    sceneApi.camera.updateProjectionMatrix();
    sceneApi.render();
    speedValue.textContent = Math.round(flightState.forwardSpeed);
    speedFill.style.width = `${flightState.forwardSpeed/FLIGHT_CONSTANTS.maxSpeed*100}%`;
    flapCharges.forEach((pip,i) => pip.classList.toggle("available", flightState.flapEnergy >= i+1));
    const recovery = flightState.flapRecovery;
    flapStatus.textContent = recovery > 0 ? `Recovering · ${recovery.toFixed(1)}s` : `${Math.floor(flightState.flapEnergy)} / 5 flaps · ${motion ? "quick arm stroke" : "tap SPACE"}`;
    flightStatus.textContent = wind.strength > 0.1 ? "WIND STREAM · BOOST" : flightState.flapPower > 0 || flapAnimation > 0 ? "FLAP · ACCELERATING" : flightState.pitchAngle < -0.12 ? "DIVING · BUILDING SPEED" : flightState.pitchAngle > 0.12 ? "CLIMBING · USING MOMENTUM" : "GLIDING · RECOVERING";

    if (mode === "timeTrial" && !finishHandled) {
      const nowSeconds = now / 1000;
      courseState = updateCourseState(courseState, flightState.position, nowSeconds);
      app.courseState = courseState;
      checkpointsApi.updateVisuals(courseState.nextCheckpointIndex);
      ui.showTimer(formatSeconds(elapsedSeconds(courseState, nowSeconds)));

      if (courseState.status === "finished") {
        finishHandled = true;
        handleCourseFinish(); // async; pauses the loop below until it resolves
        return;
      }
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main();
