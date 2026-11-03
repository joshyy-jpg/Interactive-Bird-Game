import * as THREE from "three";

// Chase-camera feel. All smoothing values are exponential rates (per second):
// LOWER = slower, floatier, less nauseating. Deadzones are in radians.
export const CAMERA_CONSTANTS = {
  distanceBack: 9, // how far behind the bird the camera sits
  baseHeight: 2.5, // height above the bird in level flight
  minCameraHeight: 1.5, // never dip below this (keeps camera out of the ground)

  headingSmoothing: 1.8, // how fast camera yaw catches up to the bird's heading
  positionSmoothing: 2.5, // how fast the camera body moves to its target spot
  aimSmoothing: 2.0, // how fast the look-at point catches up
  inputSmoothing: 1.6, // how fast bank/pitch offsets ramp in

  bankDeadzone: 0.12, // ~7deg of bank before the camera swings at all
  pitchDeadzone: 0.1, // ~6deg of pitch before the camera rises/sinks at all

  lateralPerRadian: 4.0, // extra push to the outside of a turn, per radian of bank
  risePerRadian: 7.0, // camera rise per radian of nose-down pitch
  aimAhead: 6, // how far ahead of the bird the camera looks
  aimHeight: 1, // slight upward bias on the aim point
  rollFactor: 0.25, // how much the camera rolls with the bird's bank
};

export function normalizeAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Subtracts the deadzone from the magnitude (continuous, no jump at the edge),
// so tiny bank/pitch wobbles produce exactly zero camera movement.
export function deadzone(value, dz) {
  const mag = Math.abs(value);
  return mag <= dz ? 0 : Math.sign(value) * (mag - dz);
}

/**
 * Third-person chase camera that leads the eye toward where the bird is going.
 *
 * Horizontal: the camera's yaw LAGS the bird's heading, so as the bird banks and
 * turns right the camera is left behind on the outside of the turn (to the
 * bird's left), looking along the tail; the background sweeps left. Mirrored for
 * a left turn. A small extra lateral push exaggerates the effect.
 *
 * Vertical: nose-down pitch raises the camera above the bird and drops the aim
 * point below it, so you look over the bird's back at the ground it's diving
 * toward. Mirrored when climbing (camera sinks, you look up past it at sky).
 *
 * Both axes are deadzoned (micro-adjustments move nothing) and heavily smoothed
 * (no snapping), so the camera reads general direction of travel.
 *
 * @param {THREE.Camera} camera
 * @param {object} [constants] - overrides for CAMERA_CONSTANTS (used by tests)
 */
export function createChaseCamera(camera, constants = CAMERA_CONSTANTS) {
  const c = constants;

  // Reused each frame to avoid per-frame allocation.
  const _forward = new THREE.Vector3();
  const _left = new THREE.Vector3(); // bird's left; the outside of a right turn
  const _desiredPos = new THREE.Vector3();
  const _desiredAim = new THREE.Vector3();

  // The camera's own lagging state. It trails the bird rather than being rigidly
  // bolted behind it; that lag is what produces the swing toward the tail.
  const cam = {
    heading: 0,
    bank: 0, // deadzoned + smoothed bank, radians
    pitch: 0, // deadzoned + smoothed pitch, radians
    aim: new THREE.Vector3(),
    initialized: false,
  };

  function update(flightState, dt) {
    const pos = flightState.position;

    if (!cam.initialized) {
      cam.heading = flightState.heading;
      cam.aim.set(pos.x, pos.y, pos.z);
      cam.initialized = true;
    }

    // Lag the camera's yaw behind the bird's heading (shortest way around).
    const headingDelta = normalizeAngle(flightState.heading - cam.heading);
    cam.heading = normalizeAngle(
      cam.heading + headingDelta * (1 - Math.exp(-c.headingSmoothing * dt))
    );

    // Deadzone, then slowly smooth, the bank/pitch driving the camera offsets.
    const inputT = 1 - Math.exp(-c.inputSmoothing * dt);
    cam.bank += (deadzone(flightState.bankAngle, c.bankDeadzone) - cam.bank) * inputT;
    cam.pitch += (deadzone(flightState.pitchAngle, c.pitchDeadzone) - cam.pitch) * inputT;

    // Basis vectors from the LAGGING camera heading. With forward =
    // (sin h, 0, cos h), the bird's left is (cos h, 0, -sin h).
    _forward.set(Math.sin(cam.heading), 0, Math.cos(cam.heading));
    _left.set(Math.cos(cam.heading), 0, -Math.sin(cam.heading));

    // Sit behind the bird; push toward the OUTSIDE of the turn (left side for a
    // right/positive bank); rise when diving (pitch < 0), sink when climbing.
    _desiredPos
      .set(pos.x, pos.y, pos.z)
      .addScaledVector(_forward, -c.distanceBack)
      .addScaledVector(_left, cam.bank * c.lateralPerRadian);
    _desiredPos.y += c.baseHeight - cam.pitch * c.risePerRadian;
    _desiredPos.y = Math.max(_desiredPos.y, c.minCameraHeight);

    camera.position.lerp(_desiredPos, 1 - Math.exp(-c.positionSmoothing * dt));

    // Aim ahead of the bird along its flight direction, tilted by the smoothed
    // pitch. Diving drops this below the bird, bringing the ground into view.
    const bh = flightState.heading;
    const cp = Math.cos(cam.pitch);
    _desiredAim.set(
      pos.x + Math.sin(bh) * cp * c.aimAhead,
      pos.y + Math.sin(cam.pitch) * c.aimAhead + c.aimHeight,
      pos.z + Math.cos(bh) * cp * c.aimAhead
    );
    cam.aim.lerp(_desiredAim, 1 - Math.exp(-c.aimSmoothing * dt));

    camera.up.set(0, 1, 0);
    camera.lookAt(cam.aim);
    // Negative: rolling the camera clockwise (like tilting your head right)
    // makes the horizon appear to rotate counter-clockwise, which is how the
    // world reads when banking right. Positive here would tilt the wrong way.
    camera.rotateZ(-cam.bank * c.rollFactor);
  }

  // Exposed for tests/debugging: the camera's internal lagging state.
  return { update, state: cam };
}
