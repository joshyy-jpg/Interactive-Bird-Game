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
  await page.selectOption("#control-style", "motion");
  await page.click("[data-bird=pigeon]");
  await page.click("#mode-select-free-roam");

  await page.waitForFunction(() => window.__birdGame.state === "FLYING", { timeout: 5000 });

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
  await page.click("#mode-select-time-trial");
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

for (const species of ["eagle", "pigeon", "gull"]) {
  test(`${species} can be previewed and flown with keyboard controls`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/");
    await page.click(`[data-bird=${species}]`);
    await expect(page.locator(`[data-bird=${species}]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#mode-select")).toBeVisible();
    if (species === "eagle") await page.screenshot({ path: "artifacts/menu.png" });
    await page.click("#mode-select-free-roam");
    await page.waitForFunction(() => window.__birdGame.state === "FLYING");
    expect(await page.evaluate(() => window.__birdGame.species)).toBe(species);
    const start = await page.evaluate(() => window.__birdGame.flightState.position.y);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(600);
    await page.keyboard.up("ArrowUp");
    expect(await page.evaluate(() => window.__birdGame.flightState.position.y)).toBeGreaterThan(start);
    if (species === "eagle") await page.screenshot({ path: "artifacts/flight.png" });
    await page.click("#menu-return");
    await expect(page.locator("#mode-select")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("small screens keep selection and launch controls accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.click("[data-bird=gull]");
  await expect(page.locator("#mode-select-free-roam")).toBeInViewport();
  await expect(page.locator("#control-style")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("flaps spend energy, cooldown blocks them, and wind boosts without spending energy", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await page.click("#mode-select-free-roam");
  await page.waitForFunction(() => window.__birdGame.state === "FLYING");
  await page.evaluate(() => { window.__birdGame.flightState.position.x = 80; });
  const initialSpeed = await page.evaluate(() => window.__birdGame.flightState.forwardSpeed);
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__birdGame.flightState.flapEnergy < 5);
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  expect(await page.evaluate(() => window.__birdGame.flightState.flapEnergy)).toBe(4);
  expect(await page.evaluate(() => window.__birdGame.flightState.forwardSpeed)).toBeGreaterThan(initialSpeed);
  for (let i = 1; i < 5; i++) {
    await page.waitForFunction(() => window.__birdGame.flightState.flapCooldown === 0);
    await page.keyboard.press("Space");
    await page.waitForFunction(remaining => window.__birdGame.flightState.flapEnergy <= remaining, 4-i);
  }
  await expect(page.locator("#flap-status")).toContainText("Recovering");
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.__birdGame.flightState.flapEnergy)).toBeLessThan(1);
  await page.evaluate(() => {
    const state = window.__birdGame.flightState;
    state.position = { x:0, y:32, z:80 }; state.heading = 0; state.pitchAngle = 0;
  });
  await page.waitForFunction(() => window.__birdGame.windStrength > 0.5);
  await expect(page.locator("#flight-status")).toContainText("WIND STREAM");
  await page.screenshot({ path: "artifacts/wind-flight.png" });
  await page.waitForFunction(() => window.__birdGame.flightState.flapRecovery === 0, null, { timeout: 12000 });
  await expect(page.locator("#flap-status")).not.toContainText("Recovering");
  expect(errors).toEqual([]);
});
