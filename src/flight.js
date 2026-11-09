// Pure arcade-style flight physics. No Three.js/DOM references so this is
// unit-testable in plain Node. All units are arbitrary "world units" per second.
//
// Feel goals (from playtesting): flying should be EASY. Holding "up" always
// climbs; flapping gives thrust and lift, so you can gain speed going up as well
// as going down; diving builds speed fast; pulling out of a dive turns that speed
// into a big zoom climb. Stamina only makes long flapping weaker, never stops it.

export const FLIGHT_CONSTANTS = {
  maxBankAngle: Math.PI / 3, // 60deg max bank from full turn input
  bankResponsiveness: 4, // lerp speed toward target bank angle
  turnRateCoefficient: 1.4, // bank angle -> yaw rate multiplier

  // Asymmetric pitch limits. Neither reaches vertical: the arcade physics (and
  // the pose controls) don't support looping.
  maxClimbPitch: Math.PI / 4, // 45deg max nose up
  maxDivePitch: Math.PI / 3, // 60deg max nose down
  pitchResponsiveness: 3.5,

  baseSinkRate: 1, // gentle downward drift when gliding without flapping

  // Soft altitude ceiling ("thin air"): climb strength fades to zero between
  // these heights, so the bird tops out gently instead of hitting a wall.
  softCeilingStart: 220,
  softCeilingEnd: 340,

  // --- Speed ---
  minSpeed: 8,
  cruiseSpeed: 16,
  maxSpeed: 70,
  cruiseRecovery: 0.8, // per second: a slow bird eases back up toward cruise speed
  diveAcceleration: 18, // speed gained per second when pointing straight down
  climbDeceleration: 6, // speed spent per second when pointing straight up
  dragCoefficient: 0.0032, // per (speed squared): caps dives and flapping near maxSpeed

  // --- Flapping (flapInput 0..1, held Space or measured arm-flapping vigour) ---
  flapThrust: 15, // speed gained per second at full flapping
  flapLift: 7, // extra climb rate (units/s) at full flapping, even in level flight
  flapClimbBias: 0.35, // flapping without steering tilts the nose up this much (0..1 of full climb)
  flapResponse: 8, // per second: how fast flap power follows the input
  staminaDrainPerSecond: 0.12, // ~8 seconds of non-stop full flapping
  staminaRegenPerSecond: 0.35, // ~3 seconds from empty to full
  staminaRegenDelay: 0.6, // seconds of rest before stamina starts coming back
  tiredFlapStrength: 0.4, // flapping still works at 40% when stamina is empty

  groundClearance: 4, // terrain clearance; trees are visual scenery
};

export function createInitialFlightState() {
  return {
    position: { x: 0, y: 30, z: 0 },
    heading: 0, // radians, yaw around Y axis
    pitchAngle: 0, // radians, positive = nose up
    bankAngle: 0, // radians, positive = banking right
    forwardSpeed: FLIGHT_CONSTANTS.cruiseSpeed,
    flapPower: 0, // 0..1 effective flapping right now (drives thrust, lift and wing animation)
    stamina: 1, // 0..1
    flapRest: 0, // seconds since the last flapping
  };
}

function lerp(a, b, t) {
  return a + (b - a) * Math.min(Math.max(t, 0), 1);
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// 1 below softCeilingStart, fading smoothly to 0 at softCeilingEnd.
function ceilingFactor(y, c) {
  if (y <= c.softCeilingStart) return 1;
  if (y >= c.softCeilingEnd) return 0;
  const t = (y - c.softCeilingStart) / (c.softCeilingEnd - c.softCeilingStart);
  return 1 - t * t * (3 - 2 * t); // smoothstep
}

/**
 * Advances flight state by dt seconds given normalized control inputs.
 * @param {object} state - result of createInitialFlightState() (mutated copy returned)
 * @param {{turnInput?: number, climbInput?: number, flapInput?: number, windAcceleration?: number}} controls -
 *        turnInput: steering in [-1,1]. climbInput: +1 = full climb, 0 = glide,
 *        -1 = full dive. flapInput: 0 = wings still, 1 = flapping as hard as possible.
 * @param {number} dt - seconds elapsed since last update
 * @param {(x: number, z: number) => number} [groundHeightAt] - terrain height
 *        at a world (x, z); defaults to a flat floor at 0 (terrain.js's
 *        heightAt gets wired in by main.js — flight.js stays terrain-agnostic
 *        so its existing tests keep working unmodified with no 4th arg).
 */
export function updateFlight(state, controls, dt, groundHeightAt = () => 0) {
  const c = FLIGHT_CONSTANTS;
  const turnInput = clamp(controls.turnInput ?? 0, -1, 1);
  let climbInput = clamp(controls.climbInput ?? 0, -1, 1);
  const flapInput = clamp(controls.flapInput ?? 0, 0, 1);

  // --- Stamina: long flapping gets weaker, never blocked. ---
  let stamina = state.stamina ?? 1;
  let flapRest = flapInput > 0.05 ? 0 : (state.flapRest ?? 0) + dt;
  stamina -= flapInput * c.staminaDrainPerSecond * dt;
  if (flapRest > c.staminaRegenDelay) stamina += c.staminaRegenPerSecond * dt;
  stamina = clamp(stamina, 0, 1);
  const strength = c.tiredFlapStrength + (1 - c.tiredFlapStrength) * Math.min(stamina / 0.25, 1);
  const flapTarget = flapInput * strength;
  const flapPower = (state.flapPower ?? 0) + (flapTarget - (state.flapPower ?? 0)) * (1 - Math.exp(-c.flapResponse * dt));

  // Flapping means "up": unless the player is asking to dive, it lifts the nose.
  if (climbInput >= 0) climbInput = Math.max(climbInput, flapPower * c.flapClimbBias);

  // Fast birds can spend momentum on a zoom climb even in thin air.
  const momentumLift = clamp((state.forwardSpeed - c.cruiseSpeed) / 16, 0, 1);
  if (climbInput > 0) climbInput *= Math.max(ceilingFactor(state.position.y, c), momentumLift);

  const targetBank = turnInput * c.maxBankAngle;
  const bankAngle = lerp(state.bankAngle, targetBank, c.bankResponsiveness * dt);

  const targetPitch =
    climbInput >= 0 ? climbInput * c.maxClimbPitch : climbInput * c.maxDivePitch;
  const pitchAngle = lerp(state.pitchAngle, targetPitch, c.pitchResponsiveness * dt);

  // Negative: with forward = (sin(heading), 0, cos(heading)) in a right-handed
  // world, the bird's right side is -x, so a right turn (positive bank) must
  // DECREASE heading. Positive yaw here would veer the bird toward its left.
  const yawRate = -bankAngle * c.turnRateCoefficient;
  const heading = state.heading + yawRate * dt;

  // --- Speed: dives build it fast, climbs spend it slowly, flapping adds it. ---
  // At the terrain floor, a blocked dive must not generate free energy.
  const canDescend = state.position.y > groundHeightAt(state.position.x, state.position.z) + c.groundClearance + 0.1;
  const sinPitch = Math.sin(pitchAngle);
  let slope = 0;
  if (sinPitch > 0) slope = -sinPitch * c.climbDeceleration;
  else if (canDescend) slope = -sinPitch * c.diveAcceleration;
  const cruise = Math.max(0, c.cruiseSpeed - state.forwardSpeed) * c.cruiseRecovery;
  const windAcceleration = clamp(controls.windAcceleration ?? 0, 0, 14);
  let forwardSpeed = state.forwardSpeed;
  forwardSpeed +=
    (slope + cruise + flapPower * c.flapThrust + windAcceleration - c.dragCoefficient * forwardSpeed * forwardSpeed) * dt;
  forwardSpeed = clamp(forwardSpeed, c.minSpeed, c.maxSpeed);

  // Flapping replaces the glide's gentle sink with real lift. Lift fades in thin air.
  const lift = flapPower * c.flapLift * Math.max(ceilingFactor(state.position.y, c), 0.15);
  const verticalVelocity = forwardSpeed * sinPitch - c.baseSinkRate * (1 - flapPower) + lift;

  const forwardDir = {
    x: Math.sin(heading) * Math.cos(pitchAngle),
    z: Math.cos(heading) * Math.cos(pitchAngle),
  };

  const position = {
    x: state.position.x + forwardDir.x * forwardSpeed * dt,
    y: state.position.y + verticalVelocity * dt,
    z: state.position.z + forwardDir.z * forwardSpeed * dt,
  };
  // Evaluated at this frame's NEW x/z (where the bird is about to be), not
  // state.position.x/z (where it started) — otherwise the collision floor
  // lags one frame behind the bird's actual position.
  const terrainHeight = groundHeightAt(position.x, position.z);
  position.y = Math.max(position.y, terrainHeight + c.groundClearance);

  return { position, heading, pitchAngle, bankAngle, forwardSpeed, flapPower, stamina, flapRest };
}
