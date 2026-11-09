import { createScene } from "./scene.js";
import { createBird } from "./bird.js";
import { setupPoseTracking } from "./poseTracking.js";
import { createPreview } from "./preview.js";
import { runCalibration, waitForPose } from "./calibration.js";
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
import { surfaceHeightAt, SPAWN_SAFE_ZONE } from "./terrain.js";
import { islandFloorAt, resolveIslandCollision } from "./islands.js";
import {
  CHECKPOINTS,
  createCourseState,
  updateCourseState,
  resetCourseState,
  elapsedSeconds,
  getCourseSafeZones,
  shiftCourseStart,
} from "./course.js";
import { createCheckpoints } from "./checkpoints.js";
import * as ui from "./ui.js";
import { sampleWind } from "./wind.js";
import { createWindVisuals } from "./windVisuals.js";
import {
  PETAL_CONSTANTS,
  createPetalRun,
  startNextBloom,
  collectPetals,
  collectedCount,
  isBloomComplete,
  chooseTarget,
} from "./petals.js";
import { createPetalField } from "./petalModels.js";

const STATE = {
  LOADING: "LOADING",
  CALIBRATING: "CALIBRATING",
  MODE_SELECT: "MODE_SELECT",
  FLYING: "FLYING",
  ERROR: "ERROR",
};

const BEST_TIME_KEY = "birdgame.bestTime.v2";
const MENU_VIEW_CENTER = { x: 0, y: 80, z: 0 };

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
  let species = "dove";
  let bird = createBird(species);
  sceneApi.addToScene(bird.group);

  const flightState0 = createInitialFlightState();
  app.flightState = flightState0;

  // Render a static frame immediately so the sky/bird show while models load.
  bird.setPose(flightState0.position, flightState0.heading, 0, 0);
  sceneApi.updateChaseCamera(flightState0, 0.016);
  sceneApi.render();

  ui.hideMessage();
  app.state = STATE.MODE_SELECT;
  const names = { dove: "White dove", eagle: "Bald eagle", pigeon: "Pigeon", gull: "Seagull" };
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
    bird.setWingFlap(now * 0.0017, 0.4);
    sceneApi.updateWorld(MENU_VIEW_CENTER);
    sceneApi.camera.position.set(-4.5, 82, 7.5);
    sceneApi.camera.lookAt(-2.3, 82, 0);
    sceneApi.render(); requestAnimationFrame(menuFrame);
  }
  requestAnimationFrame(menuFrame);
  const { mode, motion } = await ui.selectMode();
  menuActive = false;
  app.species = species;
  let tracker = { getLatestLandmarks: () => null };
  let baseline;
  if (motion) {
  document.body.classList.add("camera-setup");
  document.getElementById("setup-back").addEventListener("click", () => location.reload());

  try {
    ui.showMessage("Starting your camera…");
    // Test seam: an e2e test can inject a fake tracker to exercise the state
    // machine + physics without a real webcam / network model download.
    tracker = window.__BIRD_TEST_TRACKER
      ? window.__BIRD_TEST_TRACKER
      : await setupPoseTracking(video);
  } catch (err) {
    app.state = STATE.ERROR;
    document.body.classList.remove("camera-setup");
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
  ui.showMessage("Step back until your head, shoulders and hips are in view.");
  const getLandmarks = () => tracker.getLatestLandmarks();

  try {
    await waitForPose({ getLandmarks });
    ui.showMessage("Hold steady · 1/3", { showCalibrationBar: true });
    baseline = await runCalibration({
      getLandmarks,
      onProgress: (f) => {
        ui.setCalibrationProgress(f);
        ui.showMessage(`Hold steady · ${Math.min(Math.floor(f * 3) + 1, 3)}/3`, { showCalibrationBar: true });
      },
    });
  } catch (err) {
    app.state = STATE.ERROR;
    document.body.classList.remove("camera-setup");
    ui.showError(err?.message ?? String(err));
    return;
  }

  document.body.classList.remove("camera-setup");
  previewWrap.classList.remove("visible"); // H brings it back in flight
  ui.setTracking(true);
  }
  ui.hideMessage();
  const pauseButton = document.getElementById("pause-button");
  pauseButton.hidden = false;
  const modeName = document.getElementById("mode-name");
  modeName.textContent = mode === "timeTrial" ? "Time trial" : "Free roam";
  modeName.hidden = false;
  const keys = new Set();
  // Holding Space flaps continuously; a quick tap still gives one short wingbeat.
  let flapTapUntil = 0;
  window.addEventListener("keydown", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    if (e.key === " " && !e.repeat) flapTapUntil = performance.now() + 300;
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => { keys.clear(); flapTapUntil = 0; });
  // Free Roam only ever protects the spawn point; Time Trial also flattens
  // terrain around every checkpoint (see terrain.js's safe-zone mechanism),
  // so a checkpoint can never spawn inside a randomly-placed mountain.
  const activeSafeZones =
    mode === "timeTrial" ? [SPAWN_SAFE_ZONE, ...getCourseSafeZones()] : [SPAWN_SAFE_ZONE];
  // The floor is the sea or an islet, or the grassy top of a floating island
  // the bird is already flying over (judged from where it was last frame).
  let floorReferenceY = flightState0.position.y;
  const groundHeightAt = (x, z) =>
    Math.max(surfaceHeightAt(x, z, activeSafeZones), islandFloorAt(x, z, floorReferenceY));

  const checkpointsApi = mode === "timeTrial" ? createCheckpoints(sceneApi.scene) : null;
  let courseState = mode === "timeTrial" ? createCourseState() : null;
  let finishHandled = false;

  // Rebuild the ground immediately so newly-active safe zones (checkpoints)
  // show up right away rather than waiting for the bird to wander far enough
  // to trigger the normal distance-based rebuild — see world.js's `force` doc.
  sceneApi.updateWorld(flightState0.position, activeSafeZones, true);

  const windVisuals = createWindVisuals(sceneApi.scene);

  // Sky petals are a Free Roam goal; Time Trial stays about the gates.
  const petalField = mode === "freeRoam" ? createPetalField(sceneApi.scene) : null;
  let petalRun = petalField ? createPetalRun(flightState0.position.x, flightState0.position.z) : null;
  let petalTargetId = null;
  if (petalField) {
    petalField.setPetals(petalRun.petals);
    ui.setPetalCount(0, PETAL_CONSTANTS.setSize, petalRun.bloom);
    app.petalRun = petalRun;
  }

  // --- Flying ---
  app.state = STATE.FLYING;
  // One short tip at a time; the full control list is on the pause screen.
  const tips = motion
    ? ["\u2039  Lean to steer  \u203a", "Or tip your arms like wings", "Flap your arms to rise", "Hold your arms up to climb", "Arms still at your sides to dive"]
    : ["\u2039  \u2190 \u2192 to steer  \u203a", "Hold Space to flap and rise", "\u2191 climb  \u00b7  \u2193 dive"];
  if (mode === "timeTrial") tips.push("Fly through the gold rings");
  else tips.push("Follow the gold marker to sky petals");
  let tipIndex = 0;
  let tipClock = 0;
  ui.setInstructions(tips[0]);
  if (mode === "timeTrial") ui.showTimer("0.00s");

  const controlsState = createControlsState();
  let flightState = flightState0;
  let wingPhase = 0;
  const speedHud = document.getElementById("speed-hud");
  speedHud.hidden = false;
  const speedValue = document.getElementById("speed-value");
  const staminaFill = document.getElementById("stamina-fill");
  const staminaTrack = staminaFill.parentElement;
  const flapStatus = document.getElementById("flap-status");
  const flightStatus = document.getElementById("flight-status");
  let lastTime = performance.now();

  /** Shows the finish overlay, persists a best time, and either resumes with a
   * fresh run (teleport back to spawn) or reloads to change mode entirely. */
  async function handleCourseFinish() {
    pauseButton.hidden = true;
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
    flapTapUntil = 0;
    Object.assign(controlsState, createControlsState());
    checkpointsApi.updateVisuals(0);
    finishHandled = false;
    pauseButton.hidden = false;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  // Re-capture the neutral baseline on demand (press C): the player holds still
  // for a moment and we rebuild the "straight and level" reference. Fixes a bird
  // that's stuck turning because calibration caught them mid-lean.
  let recalSamples = null;

  // Pausing freezes the flight and the race clock until the player resumes.
  let paused = false;
  let pausedAt = 0;
  function setPaused(next) {
    if (next === paused || finishHandled || recalSamples !== null) return;
    paused = next;
    app.paused = paused;
    keys.clear();
    flapTapUntil = 0;
    if (paused) {
      pausedAt = performance.now();
      ui.showPause(motion);
    } else {
      ui.hidePause();
      if (courseState) courseState = shiftCourseStart(courseState, (performance.now() - pausedAt) / 1000);
      Object.assign(controlsState, createControlsState()); // stale wrist positions would read as a huge flap
    }
  }
  pauseButton.addEventListener("click", () => {
    pauseButton.blur();
    setPaused(true);
  });
  document.getElementById("pause-resume").addEventListener("click", () => setPaused(false));
  document.getElementById("pause-back").addEventListener("click", () => location.reload());

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "escape" && !e.repeat) {
      setPaused(!paused);
      return;
    }
    if (paused) return;
    if (motion && key === "c" && recalSamples === null) {
      recalSamples = [];
      ui.showMessage("Recalibrating — stand straight and hold still…");
    } else if (key === "h") {
      previewWrap.classList.toggle("visible");
    }
  });

  let trackingLostFor = 0;

  function loop(now) {
    if (paused) {
      lastTime = now;
      sceneApi.render();
      requestAnimationFrame(loop);
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    const landmarks = tracker.getLatestLandmarks();
    if (motion) {
      // Single missed detections are normal; only report a real loss of tracking.
      trackingLostFor = landmarks ? 0 : trackingLostFor + dt;
      ui.setTracking(trackingLostFor < 0.6);
    }

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
      flapInput: keys.has(" ") || now < flapTapUntil ? 1 : 0,
      climbInput: Number(keys.has("arrowup") || keys.has("w")) - Number(keys.has("arrowdown") || keys.has("s")),
    };

    const streams = windVisuals.update(flightState.position, now/1000);
    const wind = sampleWind(flightState.position, flightState.heading, flightState.pitchAngle, streams);
    controls.windAcceleration = wind.acceleration;
    floorReferenceY = flightState.position.y;
    flightState = updateFlight(flightState, controls, dt, groundHeightAt);
    // Floating islands are solid: slide out of any rock the bird flew into.
    const bump = resolveIslandCollision(flightState.position, FLIGHT_CONSTANTS.groundClearance);
    if (bump.hit) flightState = { ...flightState, position: bump.position };

    if (petalField) {
      const pickup = collectPetals(petalRun, flightState.position);
      if (pickup.collected.length > 0) {
        petalRun = pickup.run;
        petalField.collect(pickup.collected);
        ui.setPetalCount(collectedCount(petalRun), PETAL_CONSTANTS.setSize, petalRun.bloom, { pulse: true });
        if (isBloomComplete(petalRun)) {
          ui.showToast(`Bloom ${petalRun.bloom} complete`);
          petalRun = startNextBloom(petalRun, flightState.position.x, flightState.position.z);
          petalField.setPetals(petalRun.petals);
          ui.setPetalCount(0, PETAL_CONSTANTS.setSize, petalRun.bloom);
        }
        app.petalRun = petalRun;
      }
    }
    app.windStrength = wind.strength;
    app.flightState = flightState;

    // Wings beat faster and wider the harder the bird is flapping, and settle
    // into a still glide pose when it isn't.
    wingPhase += dt * (9 + 9 * flightState.flapPower);

    bird.setPose(
      flightState.position,
      flightState.heading,
      flightState.pitchAngle,
      flightState.bankAngle
    );
    bird.setWingFlap(wingPhase, flightState.flapPower);
    sceneApi.updateWorld(flightState.position, activeSafeZones);
    sceneApi.updateChaseCamera(flightState, dt);
    const targetFov = 60 + Math.max(0, flightState.forwardSpeed-16)*0.35;
    sceneApi.camera.fov += (targetFov-sceneApi.camera.fov)*(1-Math.exp(-2*dt));
    sceneApi.camera.updateProjectionMatrix();
    petalField?.update(now / 1000, dt, sceneApi.camera);
    sceneApi.render();
    if (petalField) {
      const target = chooseTarget(petalRun, flightState.position, flightState.heading, petalTargetId);
      petalTargetId = target?.id ?? null;
      const p = flightState.position;
      const distance = target ? Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z) : 0;
      const marker = target && petalField.markerFor(target, sceneApi.camera);
      ui.setPetalMarker(marker && (!marker.onScreen || distance > PETAL_CONSTANTS.markerHideDistance) ? marker : null, distance);
    }
    speedValue.textContent = Math.round(flightState.forwardSpeed);
    const staminaPercent = Math.round(flightState.stamina * 100);
    staminaFill.style.width = `${flightState.stamina * 100}%`;
    staminaFill.classList.toggle("tired", flightState.stamina < 0.25);
    staminaTrack.setAttribute("aria-valuenow", staminaPercent);
    flapStatus.textContent = `Stamina ${staminaPercent}%`;
    flightStatus.textContent =
      wind.strength > 0.1 ? "Wind boost"
      : flightState.flapPower > 0.15 ? (flightState.stamina < 0.25 ? "Tired · glide to rest" : "Flapping")
      : flightState.pitchAngle < -0.12 ? "Diving"
      : flightState.pitchAngle > 0.12 ? "Climbing"
      : "Gliding";
    tipClock += dt;
    if (tipClock > 6) {
      tipClock = 0;
      tipIndex = (tipIndex + 1) % tips.length;
      ui.setInstructions(tips[tipIndex]);
    }

    if (mode === "timeTrial" && !finishHandled) {
      const nowSeconds = now / 1000;
      courseState = updateCourseState(courseState, flightState.position, nowSeconds);
      app.courseState = courseState;
      checkpointsApi.updateVisuals(courseState.nextCheckpointIndex);
      checkpointsApi.animate(nowSeconds);
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
