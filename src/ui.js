const messageEl = document.getElementById("message");
const calibrationBarFillEl = document.getElementById("calibration-bar-fill");
const instructionsEl = document.getElementById("instructions");
const debugEl = document.getElementById("debug");
const errorEl = document.getElementById("error");
const modeSelectEl = document.getElementById("mode-select");
const startFlightBtn = document.getElementById("start-flight");
const startHintEl = document.getElementById("start-hint");
const pauseMenuEl = document.getElementById("pause-menu");
const pauseResumeBtn = document.getElementById("pause-resume");
const pauseControlsEl = document.getElementById("pause-controls");
const trackingEl = document.getElementById("tracking-status");
const trackingTextEl = document.getElementById("tracking-text");
const petalCounterEl = document.getElementById("petal-counter");
const petalCountEl = document.getElementById("petal-count");
const petalLabelEl = document.getElementById("petal-label");
const petalMarkerEl = document.getElementById("petal-marker");
const petalPointerEl = petalMarkerEl.querySelector(".petal-pointer");
const petalDistanceEl = document.getElementById("petal-distance");
const petalToastEl = document.getElementById("petal-toast");
const timerEl = document.getElementById("timer");
const courseResultEl = document.getElementById("course-result");
const courseResultTimeEl = document.getElementById("course-result-time");
const courseResultBestEl = document.getElementById("course-result-best");
const flyAgainBtn = document.getElementById("course-result-fly-again");
const changeModeBtn = document.getElementById("course-result-change-mode");

export function showMessage(text, { showCalibrationBar = false } = {}) {
  messageEl.childNodes[0].nodeValue = text;
  const track = document.getElementById("calibration-bar-track");
  track.style.display = showCalibrationBar ? "block" : "none";
  messageEl.style.display = "block";
}

export function hideMessage() {
  messageEl.style.display = "none";
}

export function setCalibrationProgress(fraction) {
  calibrationBarFillEl.style.width = `${Math.round(fraction * 100)}%`;
}

export function setInstructions(text) {
  instructionsEl.textContent = text;
}

export function setDebug(text) {
  debugEl.textContent = text;
}

export function showError(text) {
  errorEl.textContent = text;
  errorEl.style.display = "block";
  hideMessage();
}

const START_COPY = {
  motion: { label: "Camera setup", hint: "Check your position before flying." },
  keyboard: { label: "Start flying", hint: "Steer with the arrow keys. Hold Space to flap." },
};

/**
 * Shows the menu and resolves once the player presses the start button.
 * Controls and mode are toggles, so the choice isn't final until then.
 * @returns {Promise<{mode: 'freeRoam'|'timeTrial', motion: boolean}>}
 */
export function selectMode() {
  return new Promise((resolve) => {
    modeSelectEl.style.display = "block";
    let mode = "freeRoam";
    let control = "motion";

    function press(buttons, active) {
      buttons.forEach((button) => button.setAttribute("aria-pressed", String(button === active)));
    }
    const controlButtons = [...modeSelectEl.querySelectorAll("[data-control]")];
    const modeButtons = [...modeSelectEl.querySelectorAll("[data-mode]")];
    controlButtons.forEach((button) =>
      button.addEventListener("click", () => {
        control = button.dataset.control;
        press(controlButtons, button);
        startFlightBtn.textContent = START_COPY[control].label;
        startHintEl.textContent = START_COPY[control].hint;
      })
    );
    modeButtons.forEach((button) =>
      button.addEventListener("click", () => {
        mode = button.dataset.mode;
        press(modeButtons, button);
      })
    );
    startFlightBtn.addEventListener(
      "click",
      () => {
        modeSelectEl.style.display = "none";
        resolve({ mode, motion: control === "motion" });
      },
      { once: true }
    );
  });
}

/** Opens the pause screen, listing the controls for the current input style. */
export function showPause(motion) {
  const rows = motion
    ? [
        ["Steer", "Lean, or tip your arms"],
        ["Speed up and rise", "Flap your arms"],
        ["Climb", "Hold your arms up"],
        ["Dive", "Arms still at your sides"],
        ["Recalibrate", "C"],
        ["Camera view", "H"],
      ]
    : [
        ["Steer", "\u2190 \u2192 or A D"],
        ["Climb", "\u2191 or W"],
        ["Dive", "\u2193 or S"],
        ["Speed up and rise", "Hold Space"],
      ];
  pauseControlsEl.replaceChildren(
    ...rows.map(([action, input]) => {
      const row = document.createElement("li");
      const left = document.createElement("span");
      const right = document.createElement("span");
      left.textContent = action;
      right.textContent = input;
      row.append(left, right);
      return row;
    })
  );
  pauseMenuEl.classList.add("open");
  pauseResumeBtn.focus({ preventScroll: true });
}

export function hidePause() {
  pauseMenuEl.classList.remove("open");
  // Nothing may keep focus: Space flaps, and it would also press a focused button.
  document.activeElement?.blur?.();
}

/** Shows whether the camera can currently see the player. */
export function setTracking(tracking) {
  if (trackingEl.classList.contains("lost") === !tracking && !trackingEl.hidden) return;
  trackingEl.hidden = false;
  trackingEl.classList.toggle("lost", !tracking);
  trackingTextEl.textContent = tracking ? "Camera tracking" : "Move back into view";
}

const twoDigits = (n) => String(n).padStart(2, "0");

/** Updates the "03/08 Sky petals" counter; `pulse` gives it a little pop for a pickup. */
export function setPetalCount(collected, total, bloom, { pulse = false } = {}) {
  petalCounterEl.hidden = false;
  petalCountEl.textContent = `${twoDigits(collected)}/${twoDigits(total)}`;
  petalLabelEl.textContent = bloom > 1 ? `Sky petals \u00b7 Bloom ${bloom}` : "Sky petals";
  if (pulse) petalCounterEl.animate([{ transform: "scale(1.22)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
}

let toastTimer = null;
export function showToast(text) {
  petalToastEl.textContent = text;
  petalToastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => petalToastEl.classList.remove("show"), 3000);
}

let lastMarkerText = "";
/**
 * Positions the guide marker. On-screen it floats above the petal; off-screen
 * it sits at the screen edge and becomes an arrow pointing the way.
 * @param {{x:number, y:number, onScreen:boolean}|null} marker - normalized -1..1 position, or null to hide
 * @param {number} [distance] - world units to the petal
 */
export function setPetalMarker(marker, distance = 0) {
  petalMarkerEl.hidden = !marker;
  if (!marker) return;
  const px = (marker.x + 1) * 0.5 * window.innerWidth;
  const py = (1 - marker.y) * 0.5 * window.innerHeight - (marker.onScreen ? 44 : 0);
  petalMarkerEl.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
  petalMarkerEl.classList.toggle("edge", !marker.onScreen);
  if (!marker.onScreen) {
    const degrees = (Math.atan2(marker.x * window.innerWidth, marker.y * window.innerHeight) * 180) / Math.PI;
    petalPointerEl.style.setProperty("--point", `${degrees}deg`);
  }
  const text = `${Math.round(distance / 10) * 10} m`; // whole tens: a smooth readout that isn't a blur of digits
  if (text !== lastMarkerText) {
    petalDistanceEl.textContent = text;
    lastMarkerText = text;
  }
}

export function showTimer(text) {
  timerEl.textContent = text;
  timerEl.style.display = "block";
}

export function hideTimer() {
  timerEl.style.display = "none";
}

/**
 * Shows the course-finished overlay with elapsed/best time, and resolves once
 * the player clicks "Fly Again" or "Change Mode".
 * @param {{elapsedText: string, bestText: string}} times
 * @returns {Promise<'flyAgain'|'changeMode'>}
 */
export function showCourseResult({ elapsedText, bestText }) {
  return new Promise((resolve) => {
    courseResultTimeEl.textContent = elapsedText;
    courseResultBestEl.textContent = bestText;
    courseResultEl.style.display = "block";
    function pick(choice) {
      courseResultEl.style.display = "none";
      flyAgainBtn.removeEventListener("click", onFlyAgain);
      changeModeBtn.removeEventListener("click", onChangeMode);
      resolve(choice);
    }
    function onFlyAgain() {
      pick("flyAgain");
    }
    function onChangeMode() {
      pick("changeMode");
    }
    flyAgainBtn.addEventListener("click", onFlyAgain);
    changeModeBtn.addEventListener("click", onChangeMode);
  });
}
