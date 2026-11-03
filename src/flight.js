// Pure arcade-style flight physics. No Three.js/DOM references so this is
// unit-testable in plain Node. All units are arbitrary "world units" per second.

export const FLIGHT_CONSTANTS = {
  maxBankAngle: Math.PI / 3, // 60deg max bank from full turn input
  bankResponsiveness: 4, // lerp speed toward target bank angle
  turnRateCoefficient: 1.4, // bank angle -> yaw rate multiplier

  // Asymmetric pitch limits: dives are steeper than climbs, which makes diving
  // feel aggressive while keeping climbs stable. Neither reaches vertical —
  // the arcade physics (and the pose controls) don't support looping.
  maxClimbPitch: Math.PI / 4.5, // 40deg max nose up
  maxDivePitch: Math.PI / 3, // 60deg max nose down
  pitchResponsiveness: 3,

  baseSinkRate: 1.5, // gentle downward drift when gliding (climbInput 0)

  // Soft altitude ceiling ("thin air"): climb strength fades to zero between
  // these heights, so the bird tops out gently instead of hitting a wall.
  softCeilingStart: 220,
  softCeilingEnd: 340,

  pitchToSpeedCoupling: 10, // diving/climbing trades altitude for speed
  minSpeed: 4,
  maxSpeed: 48,
  flapSpeedGain: 4.8,
  flapCooldownSeconds: 0.28,
  cruiseSpeed: 12,
  maxFlaps: 5,
  flapRecoverySeconds: 3,
  flapRechargeDelay: 1.5,
  flapRechargePerSecond: 1,
  dragCoefficient: 0.003,

  groundClearance: 4, // terrain clearance; trees are visual scenery
};

export function createInitialFlightState() {
  return {
    position: { x: 0, y: 30, z: 0 },
    heading: 0, // radians, yaw around Y axis
    pitchAngle: 0, // radians, positive = nose up
    bankAngle: 0, // radians, positive = banking right
    forwardSpeed: FLIGHT_CONSTANTS.cruiseSpeed,
    flapCooldown: 0,
    flapPower: 0,
    flapEnergy: FLIGHT_CONSTANTS.maxFlaps,
    flapRecovery: 0,
    flapRest: 0,
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
 * @param {{turnInput?: number, climbInput?: number, flapImpulse?: number, windAcceleration?: number}} controls - steering in [-1,1];
 *        climbInput +1 = full climb, 0 = glide, -1 = full dive.
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

  // Fast birds can spend momentum on a zoom climb even in thin air.
  const momentumLift = clamp((state.forwardSpeed - c.cruiseSpeed) / 16, 0, 1);
  if (climbInput > 0) {
    climbInput *= Math.max(ceilingFactor(state.position.y, c), momentumLift);
    climbInput *= clamp((state.forwardSpeed - c.minSpeed) / 5, 0, 1);
  }

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

  const flapCooldown = Math.max(0, (state.flapCooldown ?? 0) - dt);
  let flapRecovery = Math.max(0, (state.flapRecovery ?? 0) - dt);
  let flapRest = (state.flapRest ?? 0) + dt;
  let flapEnergy = state.flapEnergy ?? c.maxFlaps;
  const rechargeTime = Math.max(0, flapRest - c.flapRechargeDelay) - Math.max(0, (state.flapRest ?? 0) - c.flapRechargeDelay);
  flapEnergy = Math.min(c.maxFlaps, flapEnergy + rechargeTime * c.flapRechargePerSecond);
  const flapPower = flapCooldown === 0 && flapRecovery === 0 && flapEnergy >= 1
    ? clamp(controls.flapImpulse ?? 0, 0, 1) : 0;
  if (flapPower > 0) {
    flapEnergy = Math.max(0, flapEnergy - 1); flapRest = 0;
    if (flapEnergy < 1) flapRecovery = c.flapRecoverySeconds;
  }
  let forwardSpeed = state.forwardSpeed + flapPower * c.flapSpeedGain;
  // Gravity trades speed for altitude instead of replacing speed with a target.
  // At the terrain floor, a blocked dive must not generate free energy.
  const canDescend = state.position.y > groundHeightAt(state.position.x, state.position.z) + c.groundClearance + 0.1;
  const gravity = pitchAngle < 0 && !canDescend ? 0 : -Math.sin(pitchAngle) * c.pitchToSpeedCoupling;
  const windAcceleration = clamp(controls.windAcceleration ?? 0, 0, 14);
  forwardSpeed += (gravity + windAcceleration - c.dragCoefficient * forwardSpeed * forwardSpeed) * dt;
  forwardSpeed = clamp(forwardSpeed, c.minSpeed, c.maxSpeed);

  const verticalVelocity = forwardSpeed * Math.sin(pitchAngle) - c.baseSinkRate;

  const forwardDir = {
    x: Math.sin(heading) * Math.cos(pitchAngle),
    y: Math.sin(pitchAngle),
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

  return { position, heading, pitchAngle, bankAngle, forwardSpeed, flapCooldown: flapPower > 0 ? c.flapCooldownSeconds : flapCooldown, flapPower, flapEnergy, flapRecovery, flapRest };
}
