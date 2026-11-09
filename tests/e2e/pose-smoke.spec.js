import { test, expect } from "@playwright/test";

// Injects a deterministic fake pose tracker before the app's module runs, so
// this test exercises the real state machine + render loop + physics without
// depending on a network model download or a webcam that contains a real human.
// The genuine getUserMedia + MediaPipe path is validated by the manual playtest.
const INJECT_FAKE_TRACKER = `
  (function () {
    function makeNeutralLandmarks() {
      const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
      lm[11] = { x: 0.4, y: 0.4, visibility: 1 };  // left shoulder
      lm[12] = { x: 0.6, y: 0.4, visibility: 1 };  // right shoulder
      lm[23] = { x: 0.42, y: 0.7, visibility: 1 }; // left hip
      lm[24] = { x: 0.58, y: 0.7, visibility: 1 }; // right hip
      lm[15] = { x: 0.35, y: 0.6, visibility: 1 }; // left wrist (arms down)
      lm[16] = { x: 0.65, y: 0.6, visibility: 1 }; // right wrist
      return lm;
    }
    window.__BIRD_TEST_TRACKER = {
      getLatestLandmarks: makeNeutralLandmarks,
      stop: function () {},
    };
  })();
`;

// Picks controls and mode on the menu, then presses the start button.
async function launch(page, { control = "keyboard", mode = "free" } = {}) {
  await page.click(`[data-control=${control}]`);
  await page.click(mode === "trial" ? "#mode-select-time-trial" : "#mode-select-free-roam");
  await page.click("#start-flight");
}

function collectConsoleErrors(page) {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  return consoleErrors;
}

test("motion controls calibrate after choosing a bird and Free Roam moves over terrain", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.addInitScript(INJECT_FAKE_TRACKER);
  await page.goto("/");

  await expect(page.locator("canvas#scene")).toBeVisible();

  // Calibration takes ~3s; give it headroom to reach mode select.
  await page.waitForFunction(
    () => window.__birdGame && window.__birdGame.state === "MODE_SELECT",
    { timeout: 15000 }
  );
  await page.click("[data-bird=pigeon]");
  await launch(page, { control: "motion" });

  await page.waitForFunction(() => window.__birdGame.state === "FLYING", { timeout: 10000 });
  await expect(page.locator("#tracking-status")).toContainText("Camera tracking");
  await expect(page.locator("#mode-name")).toHaveText("Free roam");

  // Physics is running: capture altitude, wait, confirm it changed.
  const y1 = await page.evaluate(() => window.__birdGame.flightState.position.y);
  await page.waitForTimeout(500);
  const y2 = await page.evaluate(() => window.__birdGame.flightState.position.y);
  expect(y2).not.toBe(y1);

  expect(consoleErrors, `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});

test("Time Trial mode renders checkpoints and advances progress when the bird reaches gate 0", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.addInitScript(INJECT_FAKE_TRACKER);
  await page.goto("/");

  await page.waitForFunction(
    () => window.__birdGame && window.__birdGame.state === "MODE_SELECT",
    { timeout: 15000 }
  );
  await launch(page, { mode: "trial" });
  await page.waitForFunction(() => window.__birdGame.state === "FLYING", { timeout: 5000 });

  // Timer HUD should be visible in Time Trial.
  await expect(page.locator("#timer")).toBeVisible();

  // Course hasn't started until the bird reaches checkpoint 0.
  const before = await page.evaluate(() => window.__birdGame.courseState);
  expect(before.status).toBe("idle");
  expect(before.nextCheckpointIndex).toBe(0);

  // Teleport the bird onto checkpoint 0 (test-only shortcut — avoids a slow
  // real flight in CI; direction/steering are covered by tests/unit/direction.test.js).
  await page.evaluate(() => {
    const cp0 = window.__BIRD_CHECKPOINTS[0];
    const pos = window.__birdGame.flightState.position;
    pos.x = cp0.x;
    pos.y = cp0.y;
    pos.z = cp0.z;
  });

  await page.waitForFunction(
    () => window.__birdGame.courseState && window.__birdGame.courseState.nextCheckpointIndex >= 1,
    { timeout: 5000 }
  );
  const after = await page.evaluate(() => window.__birdGame.courseState);
  expect(after.status).toBe("racing");
  expect(after.nextCheckpointIndex).toBe(1);

  expect(consoleErrors, `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});

for (const species of ["dove", "eagle", "pigeon", "gull"]) {
  test(`${species} can be previewed and flown with keyboard controls`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/");
    await page.click(`[data-bird=${species}]`);
    await expect(page.locator(`[data-bird=${species}]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#mode-select")).toBeVisible();
    if (species === "dove") await page.screenshot({ path: "artifacts/menu.png" });
    await launch(page);
    await page.waitForFunction(() => window.__birdGame.state === "FLYING");
    expect(await page.evaluate(() => window.__birdGame.species)).toBe(species);
    const start = await page.evaluate(() => window.__birdGame.flightState.position.y);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(600);
    await page.keyboard.up("ArrowUp");
    expect(await page.evaluate(() => window.__birdGame.flightState.position.y)).toBeGreaterThan(start);
    if (species === "dove") await page.screenshot({ path: "artifacts/flight.png" });
    await page.click("#pause-button");
    await page.click("#pause-back");
    await expect(page.locator("#mode-select")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("small screens keep selection and launch controls accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.click("[data-bird=gull]");
  await expect(page.locator("#mode-select-free-roam")).toBeInViewport();
  await page.screenshot({ path: "artifacts/menu-small.png" });
  await expect(page.locator("[data-control=keyboard]")).toBeInViewport();
  await expect(page.locator("#start-flight")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("holding Space flaps: speeds up, climbs, spends stamina that rests back, and wind still boosts", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await launch(page);
  await page.waitForFunction(() => window.__birdGame.state === "FLYING");
  await page.evaluate(() => { window.__birdGame.flightState.position.x = 80; }); // away from the first wind stream
  const before = await page.evaluate(() => ({ ...window.__birdGame.flightState, position: { ...window.__birdGame.flightState.position } }));
  await page.keyboard.down("Space");
  // Wait on the speed itself, not the clock: slow test machines run fewer physics steps per second.
  await page.waitForFunction((target) => window.__birdGame.flightState.forwardSpeed > target, before.forwardSpeed + 8, { timeout: 10000 });
  const during = await page.evaluate(() => window.__birdGame.flightState);
  await expect(page.locator("#flight-status")).toContainText("Flapping");
  await page.keyboard.up("Space");
  expect(during.forwardSpeed).toBeGreaterThan(before.forwardSpeed + 8);
  expect(during.position.y).toBeGreaterThan(before.position.y);
  expect(during.stamina).toBeLessThan(1);
  await expect(page.locator("#flap-status")).toContainText("Stamina");
  await page.waitForFunction(() => window.__birdGame.flightState.stamina === 1, null, { timeout: 8000 });
  await page.evaluate(() => {
    const state = window.__birdGame.flightState;
    state.position = { x:0, y:32, z:80 }; state.heading = 0; state.pitchAngle = 0;
  });
  await page.waitForFunction(() => window.__birdGame.windStrength > 0.5);
  await expect(page.locator("#flight-status")).toContainText("Wind boost");
  await page.screenshot({ path: "artifacts/wind-flight.png" });
  expect(errors).toEqual([]);
});

test("camera setup waits for the player to be in view, then counts down and flies", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(INJECT_FAKE_TRACKER);
  await page.addInitScript(() => {
    // Nobody in front of the camera until the test says so.
    window.__bodyVisible = false;
    const real = window.__BIRD_TEST_TRACKER.getLatestLandmarks;
    window.__BIRD_TEST_TRACKER.getLatestLandmarks = () => (window.__bodyVisible ? real() : null);
  });
  await page.goto("/");
  await expect(page.locator("#start-flight")).toHaveText("Camera setup");
  await launch(page, { control: "motion" });
  await expect(page.locator("#message")).toContainText("Step back");
  await expect(page.locator("#preview-wrap")).toBeVisible();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__birdGame.state)).toBe("CALIBRATING");
  await page.evaluate(() => { window.__bodyVisible = true; });
  await expect(page.locator("#message")).toContainText("Hold steady");
  await page.waitForFunction(() => window.__birdGame.state === "FLYING", { timeout: 10000 });
  await expect(page.locator("#preview-wrap")).toBeHidden();
  // Walking out of frame is reported, and coming back clears it.
  await page.evaluate(() => { window.__bodyVisible = false; });
  await expect(page.locator("#tracking-status")).toContainText("Move back into view");
  await page.evaluate(() => { window.__bodyVisible = true; });
  await expect(page.locator("#tracking-status")).toContainText("Camera tracking");
  expect(errors).toEqual([]);
});

test("the menu start button follows the controls choice", async ({ page }) => {
  await page.goto("/");
  await page.click("[data-control=keyboard]");
  await expect(page.locator("#start-flight")).toHaveText("Start flying");
  await page.click("[data-control=motion]");
  await expect(page.locator("#start-flight")).toHaveText("Camera setup");
});

test("Esc freezes the flight and the race clock, and resumes where it left off", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await launch(page, { mode: "trial" });
  await page.waitForFunction(() => window.__birdGame.state === "FLYING");
  await page.evaluate(() => {
    const cp0 = window.__BIRD_CHECKPOINTS[0];
    Object.assign(window.__birdGame.flightState.position, { x: cp0.x, y: cp0.y, z: cp0.z });
  });
  await page.waitForFunction(() => window.__birdGame.courseState?.status === "racing");

  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-menu")).toBeVisible();
  await expect(page.locator("#pause-controls")).toContainText("Hold Space");
  const seconds = async () => parseFloat(await page.locator("#timer").textContent());
  const z = () => page.evaluate(() => window.__birdGame.flightState.position.z);
  const pausedTime = await seconds();
  const pausedZ = await z();
  await page.waitForTimeout(1500);
  expect(await seconds()).toBe(pausedTime);
  expect(await z()).toBe(pausedZ);

  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-menu")).toBeHidden();
  await page.waitForTimeout(300);
  expect(await z()).toBeGreaterThan(pausedZ);
  const resumedTime = await seconds();
  expect(resumedTime).toBeGreaterThan(pausedTime);
  expect(resumedTime).toBeLessThan(pausedTime + 1.2); // the 1.5s pause wasn't counted

  // The on-screen buttons work too, and leave nothing focused for Space to press.
  await page.click("#pause-button");
  await page.click("#pause-resume");
  await expect(page.locator("#pause-menu")).toBeHidden();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(errors).toEqual([]);
});

test("sky petals: collecting counts up, a full bloom opens the next, Time Trial has none", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await launch(page);
  await page.waitForFunction(() => window.__birdGame.state === "FLYING");
  await expect(page.locator("#petal-counter")).toContainText("00/08");
  await expect(page.locator("#petal-marker")).toBeVisible();
  await expect(page.locator("#petal-distance")).toContainText(" m");

  const flyTo = (i) => page.evaluate((i) => {
    const petal = window.__birdGame.petalRun.petals[i];
    Object.assign(window.__birdGame.flightState.position, { x: petal.x, y: petal.y, z: petal.z });
  }, i);

  await flyTo(0);
  await expect(page.locator("#petal-count")).toHaveText("01/08");
  expect(await page.evaluate(() => window.__birdGame.petalRun.petals[0].collected)).toBe(true);
  await page.screenshot({ path: "artifacts/petal-pickup.png" });

  for (let i = 1; i < 8; i++) {
    await flyTo(i);
    await expect(page.locator("#petal-count")).toHaveText(i === 7 ? "00/08" : `0${i + 1}/08`);
  }
  await expect(page.locator("#petal-toast")).toHaveText("Bloom 1 complete");
  await expect(page.locator("#petal-label")).toContainText("Bloom 2");
  expect(await page.evaluate(() => window.__birdGame.petalRun.bloom)).toBe(2);
  expect(errors).toEqual([]);

  await page.goto("/");
  await launch(page, { mode: "trial" });
  await page.waitForFunction(() => window.__birdGame.state === "FLYING");
  await expect(page.locator("#petal-counter")).toBeHidden();
  await expect(page.locator("#petal-marker")).toBeHidden();
});
