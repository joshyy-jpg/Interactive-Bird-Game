import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKPOINTS,
  COURSE_CONSTANTS,
  createCourseState,
  updateCourseState,
  resetCourseState,
  elapsedSeconds,
  getCourseSafeZones,
  shiftCourseStart,
} from "../../src/course.js";

test("a single crossing advances exactly one checkpoint, even if fed repeatedly", () => {
  let state = createCourseState();
  const cp0 = CHECKPOINTS[0];
  const posAtCp0 = { x: cp0.x, y: cp0.y, z: cp0.z };

  state = updateCourseState(state, posAtCp0, 10);
  state = updateCourseState(state, posAtCp0, 10.1);
  state = updateCourseState(state, posAtCp0, 10.2);

  assert.equal(state.nextCheckpointIndex, 1);
});

test("crossing the first checkpoint starts the timer", () => {
  let state = createCourseState();
  const cp0 = CHECKPOINTS[0];
  state = updateCourseState(state, { x: cp0.x, y: cp0.y, z: cp0.z }, 100);
  assert.equal(state.startTime, 100);
  assert.equal(state.status, "racing");
});

test("driving through every checkpoint in order finishes the course with correct elapsed time", () => {
  let state = createCourseState();
  let t = 0;
  for (const cp of CHECKPOINTS) {
    t += 5;
    state = updateCourseState(state, { x: cp.x, y: cp.y, z: cp.z }, t);
  }
  assert.equal(state.status, "finished");
  assert.equal(state.nextCheckpointIndex, CHECKPOINTS.length);
  const expectedElapsed = t - 5; // finishTime - startTime = last t - first t
  assert.ok(Math.abs(elapsedSeconds(state, t + 999) - expectedElapsed) < 1e-9);
});

test("checkpoints can't be skipped: being near a later checkpoint does nothing while an earlier one is still next", () => {
  let state = createCourseState();
  const cp2 = CHECKPOINTS[2];
  state = updateCourseState(state, { x: cp2.x, y: cp2.y, z: cp2.z }, 5);
  assert.equal(state.nextCheckpointIndex, 0, "should not have advanced past checkpoint 0");
  assert.equal(state.status, "idle");
});

test("being outside every checkpoint's radius changes nothing", () => {
  const state = createCourseState();
  const farAway = { x: 99999, y: 99999, z: 99999 };
  const after = updateCourseState(state, farAway, 5);
  assert.deepEqual(after, state);
});

test("resetCourseState returns a completely fresh state after partial or full progress", () => {
  let state = createCourseState();
  const cp0 = CHECKPOINTS[0];
  state = updateCourseState(state, { x: cp0.x, y: cp0.y, z: cp0.z }, 10);
  assert.equal(state.nextCheckpointIndex, 1);

  const reset = resetCourseState();
  assert.equal(reset.nextCheckpointIndex, 0);
  assert.equal(reset.status, "idle");
  assert.equal(reset.startTime, null);
  assert.equal(reset.finishTime, null);

  // And behaves exactly like a brand new run from here.
  const after = updateCourseState(reset, { x: cp0.x, y: cp0.y, z: cp0.z }, 500);
  assert.equal(after.startTime, 500);
});

test("elapsedSeconds is 0 before the course has started", () => {
  const state = createCourseState();
  assert.equal(elapsedSeconds(state, 12345), 0);
});

test("getCourseSafeZones covers every checkpoint with a wider, flat-target zone", () => {
  const zones = getCourseSafeZones();
  assert.equal(zones.length, CHECKPOINTS.length);
  zones.forEach((zone, i) => {
    assert.equal(zone.x, CHECKPOINTS[i].x);
    assert.equal(zone.z, CHECKPOINTS[i].z);
    assert.equal(zone.targetHeight, 0);
    assert.ok(zone.radius > CHECKPOINTS[i].radius);
    assert.equal(zone.radius, CHECKPOINTS[i].radius + COURSE_CONSTANTS.safeZoneMargin);
  });
});

test("time spent paused doesn't count against a running race", () => {
  const racing = { ...createCourseState(), status: "racing", startTime: 100 };
  const shifted = shiftCourseStart(racing, 30);
  assert.equal(elapsedSeconds(racing, 140), 40);
  assert.equal(elapsedSeconds(shifted, 170), 40);
  assert.equal(racing.startTime, 100, "must not mutate the original state");
});

test("pausing before the race starts or after it ends changes nothing", () => {
  const idle = createCourseState();
  assert.equal(shiftCourseStart(idle, 30), idle);
  const finished = { ...idle, status: "finished", startTime: 100, finishTime: 150 };
  assert.equal(shiftCourseStart(finished, 30), finished);
});
