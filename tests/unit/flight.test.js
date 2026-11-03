import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialFlightState,
  updateFlight,
  FLIGHT_CONSTANTS,
} from "../../src/flight.js";

const dt = 1 / 60;

function simulate(controls, steps) {
  let state = createInitialFlightState();
  for (let i = 0; i < steps; i++) {
    state = updateFlight(state, controls, dt);
  }
  return state;
}

test("sustained climb input gains altitude", () => {
  const startY = createInitialFlightState().position.y;
  const climbing = simulate({ turnInput: 0, climbInput: 0.8 }, 120);
  assert.ok(
    climbing.position.y > startY,
    `expected climb above ${startY}, got ${climbing.position.y}`
  );
});

test("glide (climbInput 0) slowly loses altitude", () => {
  const startY = createInitialFlightState().position.y;
  const gliding = simulate({ turnInput: 0, climbInput: 0 }, 120);
  assert.ok(
    gliding.position.y < startY,
    `expected gentle descent below ${startY}, got ${gliding.position.y}`
  );
});

test("full dive input drops faster than a glide", () => {
  const gliding = simulate({ turnInput: 0, climbInput: 0 }, 120);
  const diving = simulate({ turnInput: 0, climbInput: -1 }, 120);
  assert.ok(
    diving.position.y < gliding.position.y,
    `dive (${diving.position.y}) should drop below glide (${gliding.position.y})`
  );
});

test("more climb input climbs higher than less", () => {
  const weak = simulate({ turnInput: 0, climbInput: 0.4 }, 120);
  const strong = simulate({ turnInput: 0, climbInput: 0.9 }, 120);
  assert.ok(
    strong.position.y > weak.position.y,
    `strong (${strong.position.y}) should out-climb weak (${weak.position.y})`
  );
});

test("diving increases forward speed via pitch coupling", () => {
  const startSpeed = createInitialFlightState().forwardSpeed;
  const diving = simulate({ turnInput: 0, climbInput: -1 }, 120);
  assert.ok(
    diving.forwardSpeed > startSpeed,
    `dive should speed up from ${startSpeed}, got ${diving.forwardSpeed}`
  );
});

test("positive turn input banks right and veers toward the bird's right (-x)", () => {
  // With forward = (sin h, 0, cos h) and heading 0 facing +z, the bird's right
  // is world -x, so a right turn means heading DECREASES and x goes negative.
  const turned = simulate({ turnInput: 1, climbInput: 0.5 }, 120);
  assert.ok(turned.bankAngle > 0, `expected positive bank, got ${turned.bankAngle}`);
  assert.ok(turned.heading < 0, `right turn should decrease heading, got ${turned.heading}`);
  assert.ok(turned.position.x < 0, `right turn should veer toward -x, got ${turned.position.x}`);
});

test("negative turn input mirrors positive (banks and veers left, +x)", () => {
  const left = simulate({ turnInput: -1, climbInput: 0.5 }, 120);
  assert.ok(left.bankAngle < 0);
  assert.ok(left.heading > 0, `left turn should increase heading, got ${left.heading}`);
  assert.ok(left.position.x > 0, `left turn should veer toward +x, got ${left.position.x}`);
});

test("altitude never drops below ground clearance", () => {
  let state = createInitialFlightState();
  state.position.y = 1;
  for (let i = 0; i < 600; i++) {
    state = updateFlight(state, { turnInput: 0, climbInput: -1 }, dt);
  }
  assert.ok(state.position.y >= FLIGHT_CONSTANTS.groundClearance - 1e-9);
});

test("speed stays within min/max bounds", () => {
  const fast = simulate({ turnInput: 0, climbInput: -1 }, 600);
  assert.ok(fast.forwardSpeed <= FLIGHT_CONSTANTS.maxSpeed + 1e-6);
  assert.ok(fast.forwardSpeed >= FLIGHT_CONSTANTS.minSpeed - 1e-6);
});

test("dives reach a steeper pitch than climbs (and neither goes vertical)", () => {
  const climbing = simulate({ turnInput: 0, climbInput: 1 }, 600);
  const diving = simulate({ turnInput: 0, climbInput: -1 }, 600);
  assert.ok(
    Math.abs(diving.pitchAngle) > climbing.pitchAngle,
    `dive (${diving.pitchAngle}) should be steeper than climb (${climbing.pitchAngle})`
  );
  assert.ok(Math.abs(diving.pitchAngle) < Math.PI / 2, "no vertical dive");
  assert.ok(climbing.pitchAngle < Math.PI / 2, "no vertical climb (no backflips)");
});

test("soft ceiling: full climb above the ceiling stalls and sinks back down", () => {
  let state = createInitialFlightState();
  state.position.y = FLIGHT_CONSTANTS.softCeilingEnd + 10;
  const startY = state.position.y;
  for (let i = 0; i < 300; i++) {
    state = updateFlight(state, { turnInput: 0, climbInput: 1 }, dt);
  }
  assert.ok(
    state.position.y < startY,
    `climbing above the ceiling should sink, got ${state.position.y} from ${startY}`
  );
});

test("soft ceiling: climbing below the ceiling is unaffected", () => {
  const low = simulate({ turnInput: 0, climbInput: 0.8 }, 120); // starts at y=30
  assert.ok(low.position.y > 30, "normal climb still works below the ceiling");
});

test("terrain collision: with no groundHeightAt arg, behaves exactly like the flat floor (regression)", () => {
  let state = createInitialFlightState();
  state.position.y = 1;
  for (let i = 0; i < 300; i++) {
    state = updateFlight(state, { turnInput: 0, climbInput: -1 }, dt); // no 4th arg
  }
  assert.ok(Math.abs(state.position.y - FLIGHT_CONSTANTS.groundClearance) < 1e-9);
});

test("terrain collision: an elevated flat plateau raises the floor by exactly its height", () => {
  let state = createInitialFlightState();
  state.position.y = 1;
  const plateauHeight = 50;
  for (let i = 0; i < 300; i++) {
    state = updateFlight(state, { turnInput: 0, climbInput: -1 }, dt, () => plateauHeight);
  }
  assert.ok(
    Math.abs(state.position.y - (plateauHeight + FLIGHT_CONSTANTS.groundClearance)) < 1e-9,
    `expected floor at ${plateauHeight + FLIGHT_CONSTANTS.groundClearance}, got ${state.position.y}`
  );
});

test("terrain collision: a step-function terrain clamps the bird exactly where the step is", () => {
  // Terrain is 0 for x<=100, jumps to 40 for x>100. Fly a straight, level line
  // in +x (no turn, climbInput 0 so pitch relaxes to 0 and speed stays simple)
  // and confirm the floor jumps at the right spot.
  const stepAt = 100;
  const stepHeight = 40;
  const groundHeightAt = (x) => (x > stepAt ? stepHeight : 0);

  let state = createInitialFlightState();
  state.position = { x: 0, y: FLIGHT_CONSTANTS.groundClearance, z: 0 };
  state.forwardSpeed = FLIGHT_CONSTANTS.maxSpeed;
  state.heading = Math.PI / 2; // face +x for a simple straight-line test

  let sawLowFloor = false;
  let sawHighFloor = false;
  // Generous budget: even decaying to minSpeed (4/s), 2500 steps (~41.7s) covers
  // well past stepAt + margin, so this doesn't depend on exact speed dynamics.
  for (let i = 0; i < 2500; i++) {
    state = updateFlight(state, { turnInput: 0, climbInput: 0 }, dt, groundHeightAt);
    if (state.position.x <= stepAt) {
      assert.ok(
        state.position.y <= FLIGHT_CONSTANTS.groundClearance + 1e-6,
        `before the step, floor should stay low, got y=${state.position.y} at x=${state.position.x}`
      );
      sawLowFloor = true;
    } else {
      assert.ok(
        Math.abs(state.position.y - (stepHeight + FLIGHT_CONSTANTS.groundClearance)) < 1e-6,
        `after the step, floor should jump to ${stepHeight + FLIGHT_CONSTANTS.groundClearance}, got y=${state.position.y} at x=${state.position.x}`
      );
      sawHighFloor = true;
      if (state.position.x > stepAt + 20) break;
    }
  }
  assert.ok(sawLowFloor && sawHighFloor, "test should have observed both sides of the step");
});


function advance(state, controls, seconds, step = 1/60) {
  for(let i=0;i<Math.round(seconds/step);i++) state = updateFlight(state,controls,step);
  return state;
}

test("a fast approach climbs higher and preserves speed through pull-up", () => {
  const slow = createInitialFlightState(), fast = createInitialFlightState();
  slow.forwardSpeed = 9; fast.forwardSpeed = 32;
  const first = updateFlight(fast,{climbInput:1},dt);
  assert.ok(first.forwardSpeed > 31, "no instantaneous slowdown on pitch input");
  const a = advance(slow,{climbInput:1},3), b = advance(fast,{climbInput:1},3);
  assert.ok(b.position.y > a.position.y+20);
  assert.ok(b.forwardSpeed > a.forwardSpeed+5);
  assert.ok(b.forwardSpeed < fast.forwardSpeed, "climbing spends momentum");
});

test("five flaps exhaust energy; cooldown blocks flaps but permits wind", () => {
  let state = createInitialFlightState();
  for(let i=0;i<5;i++) {
    state = updateFlight(state,{flapImpulse:1},dt);
    assert.equal(state.flapPower,1);
    if(i<4) state=advance(state,{},0.3);
  }
  assert.equal(state.flapEnergy,0);
  assert.equal(state.flapRecovery,3);
  const boosted=updateFlight(state,{flapImpulse:1,windAcceleration:12},dt);
  assert.equal(boosted.flapPower,0);
  assert.ok(boosted.forwardSpeed > state.forwardSpeed);
  state=advance(state,{},3.2);
  assert.equal(state.flapRecovery,0);
  assert.ok(state.flapEnergy >= 1);
  assert.equal(updateFlight(state,{flapImpulse:1},dt).flapPower,1);
  assert.equal(advance(state,{},6).flapEnergy,5);
});

test("rapid duplicate flap events cannot bypass stroke cooldown", () => {
  const first=updateFlight(createInitialFlightState(),{flapImpulse:1},dt);
  const second=updateFlight(first,{flapImpulse:1},dt);
  assert.equal(second.flapEnergy,4); assert.equal(second.flapPower,0);
});

test("leaving a wind stream retains momentum and drag gradually slows it", () => {
  const boosted=advance(createInitialFlightState(),{windAcceleration:12},1);
  const coast=updateFlight(boosted,{},dt);
  assert.ok(coast.forwardSpeed > boosted.forwardSpeed-0.1);
  assert.ok(advance(coast,{},2).forwardSpeed < coast.forwardSpeed);
});

test("ground-blocked dives cannot farm speed", () => {
  let state=createInitialFlightState(); state.position.y=FLIGHT_CONSTANTS.groundClearance;
  state.pitchAngle=-1;
  assert.ok(advance(state,{climbInput:-1},3).forwardSpeed < state.forwardSpeed);
});

test("speed and recovery behave consistently at 30 and 120 fps", () => {
  const initial=updateFlight(createInitialFlightState(),{flapImpulse:1},dt);
  const a=advance(initial,{climbInput:0.6},2,1/30), b=advance(initial,{climbInput:0.6},2,1/120);
  assert.ok(Math.abs(a.forwardSpeed-b.forwardSpeed)<0.2);
  assert.ok(Math.abs(a.position.y-b.position.y)<0.3);
  assert.ok(Math.abs(a.flapEnergy-b.flapEnergy)<0.01);
});
