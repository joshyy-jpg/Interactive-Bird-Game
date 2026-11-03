import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createChaseCamera,
  CAMERA_CONSTANTS,
  deadzone,
  normalizeAngle,
} from "../../src/chaseCamera.js";

const dt = 1 / 60;

function makeFlightState(overrides = {}) {
  return {
    position: { x: 0, y: 50, z: 0 },
    heading: 0, // facing +z
    pitchAngle: 0,
    bankAngle: 0,
    forwardSpeed: 10,
    ...overrides,
  };
}

// Runs the camera to a steady state under a constant flight state.
function settle(flightState, steps = 400) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const chase = createChaseCamera(camera);
  for (let i = 0; i < steps; i++) chase.update(flightState, dt);
  return { camera, chase };
}

// With heading 0 the bird faces +z; in this right-handed world its RIGHT is -x
// and its LEFT is +x (which is also the chase camera's screen-left).
const lateralAxis = "x";

test("deadzone is zero inside the band and continuous just outside it", () => {
  assert.equal(deadzone(0.05, 0.1), 0);
  assert.equal(deadzone(-0.05, 0.1), 0);
  assert.ok(Math.abs(deadzone(0.1001, 0.1)) < 1e-3, "no jump at the edge");
  assert.ok(Math.abs(deadzone(0.3, 0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(deadzone(-0.3, 0.1) + 0.2) < 1e-9);
});

test("normalizeAngle wraps into [-pi, pi] and picks the short way around", () => {
  assert.ok(Math.abs(normalizeAngle(3 * Math.PI)) - Math.PI < 1e-6);
  assert.ok(Math.abs(normalizeAngle(4 * Math.PI)) < 1e-6, "full turns collapse to 0");

  // The property the camera relies on: crossing the +/-pi seam takes the short
  // route (a small positive step), not a ~2pi lurch the other way.
  const bird = -Math.PI + 0.1;
  const cam = Math.PI - 0.1;
  const delta = normalizeAngle(bird - cam);
  assert.ok(delta > 0 && delta < 0.3, `expected a small positive step, got ${delta}`);
});

test("level flight puts the camera behind and above the bird", () => {
  const state = makeFlightState();
  const { camera } = settle(state);
  // Bird faces +z, so "behind" is -z.
  assert.ok(camera.position.z < state.position.z, "camera should be behind the bird");
  assert.ok(camera.position.y > state.position.y, "camera should be above the bird");
  assert.ok(Math.abs(camera.position[lateralAxis]) < 0.1, "no lateral offset when level");
});

test("banking RIGHT swings the camera to the bird's LEFT (+x), the outside of the turn", () => {
  const state = makeFlightState({ bankAngle: 0.5 }); // positive = banking right
  const { camera } = settle(state);
  assert.ok(
    camera.position[lateralAxis] > 0.5,
    `camera should sit on the bird's left (+x), got x=${camera.position[lateralAxis]}`
  );
});

test("banking LEFT mirrors it, swinging the camera to the bird's RIGHT (-x)", () => {
  const state = makeFlightState({ bankAngle: -0.5 });
  const { camera } = settle(state);
  assert.ok(
    camera.position[lateralAxis] < -0.5,
    `camera should sit on the bird's right (-x), got x=${camera.position[lateralAxis]}`
  );
});

test("a bank inside the deadzone does not swing the camera sideways", () => {
  const tiny = CAMERA_CONSTANTS.bankDeadzone * 0.8;
  const { camera } = settle(makeFlightState({ bankAngle: tiny }));
  assert.ok(
    Math.abs(camera.position[lateralAxis]) < 0.05,
    `micro-bank should not move the camera, got x=${camera.position[lateralAxis]}`
  );
});

test("DIVING raises the camera above the bird and drops its aim below the bird", () => {
  const level = settle(makeFlightState());
  const diving = settle(makeFlightState({ pitchAngle: -0.6 })); // nose down

  assert.ok(
    diving.camera.position.y > level.camera.position.y,
    `diving camera (${diving.camera.position.y}) should ride higher than level (${level.camera.position.y})`
  );
  // Aim point below the bird => looking over its back at the ground ahead.
  assert.ok(
    diving.chase.state.aim.y < 50,
    `diving aim (${diving.chase.state.aim.y}) should fall below the bird (50)`
  );
});

test("CLIMBING mirrors it: camera sinks and aim rises above the bird", () => {
  const level = settle(makeFlightState());
  const climbing = settle(makeFlightState({ pitchAngle: 0.6 })); // nose up

  assert.ok(
    climbing.camera.position.y < level.camera.position.y,
    `climbing camera (${climbing.camera.position.y}) should sink below level (${level.camera.position.y})`
  );
  assert.ok(
    climbing.chase.state.aim.y > 50 + CAMERA_CONSTANTS.aimHeight,
    `climbing aim (${climbing.chase.state.aim.y}) should rise above the bird`
  );
});

test("a pitch inside the deadzone does not raise or lower the camera", () => {
  const tiny = -CAMERA_CONSTANTS.pitchDeadzone * 0.8;
  const level = settle(makeFlightState());
  const nudged = settle(makeFlightState({ pitchAngle: tiny }));
  assert.ok(
    Math.abs(nudged.camera.position.y - level.camera.position.y) < 0.05,
    "micro-pitch should not move the camera vertically"
  );
});

test("camera yaw LAGS the bird's heading rather than snapping to it", () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const chase = createChaseCamera(camera);
  chase.update(makeFlightState({ heading: 0 }), dt); // initialize at 0

  // Bird suddenly points 90deg right; camera must not follow instantly.
  const turned = makeFlightState({ heading: Math.PI / 2 });
  chase.update(turned, dt);
  assert.ok(
    chase.state.heading > 0 && chase.state.heading < Math.PI / 2 * 0.2,
    `camera heading should trail well behind, got ${chase.state.heading}`
  );

  // ...but it does catch up eventually.
  for (let i = 0; i < 400; i++) chase.update(turned, dt);
  assert.ok(Math.abs(chase.state.heading - Math.PI / 2) < 0.01, "camera catches up");
});

test("camera moves smoothly, never teleporting on a sudden flight change", () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const chase = createChaseCamera(camera);
  const level = makeFlightState();
  for (let i = 0; i < 400; i++) chase.update(level, dt);

  // Yank the bird into a hard banking dive; each single frame step must be small.
  const violent = makeFlightState({ bankAngle: 1.0, pitchAngle: -0.8, heading: Math.PI });
  let prev = camera.position.clone();
  for (let i = 0; i < 120; i++) {
    chase.update(violent, dt);
    const step = camera.position.distanceTo(prev);
    assert.ok(step < 1.0, `camera jumped ${step.toFixed(2)} units in one frame`);
    prev = camera.position.clone();
  }
});

test("camera never sinks below the minimum height", () => {
  const state = makeFlightState({ position: { x: 0, y: 2, z: 0 }, pitchAngle: 0.7 });
  const { camera } = settle(state);
  assert.ok(camera.position.y >= CAMERA_CONSTANTS.minCameraHeight - 1e-6);
});
