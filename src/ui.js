const messageEl = document.getElementById("message");
const calibrationBarFillEl = document.getElementById("calibration-bar-fill");
const instructionsEl = document.getElementById("instructions");
const debugEl = document.getElementById("debug");
const errorEl = document.getElementById("error");
const modeSelectEl = document.getElementById("mode-select");
const freeRoamBtn = document.getElementById("mode-select-free-roam");
const timeTrialBtn = document.getElementById("mode-select-time-trial");
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

/**
 * Shows the Free Roam / Time Trial picker and resolves with the choice once
 * the player clicks a button.
 * @returns {Promise<'freeRoam'|'timeTrial'>}
 */
export function selectMode() {
  return new Promise((resolve) => {
    modeSelectEl.style.display = "block";
    function pick(mode) {
      modeSelectEl.style.display = "none";
      freeRoamBtn.removeEventListener("click", onFreeRoam);
      timeTrialBtn.removeEventListener("click", onTimeTrial);
      resolve(mode);
    }
    function onFreeRoam() {
      pick("freeRoam");
    }
    function onTimeTrial() {
      pick("timeTrial");
    }
    freeRoamBtn.addEventListener("click", onFreeRoam);
    timeTrialBtn.addEventListener("click", onTimeTrial);
  });
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
