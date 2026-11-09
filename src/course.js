// Time Trial course: a fixed, hand-authored sequence of checkpoints, plus pure
// progress/timer logic. No Three.js/DOM refs, so this is unit-testable in
// plain Node — same philosophy as flight.js/controls.js/terrain.js.
//
// Checkpoint coordinates are authored WITHOUT ever calling terrain.heightAt —
// that's the payoff of terrain.js's safe-zone mechanism (see getCourseSafeZones
// below): registering each checkpoint as a safe zone guarantees the terrain is
// flat there regardless of the procedural seed, so a course can be laid out by
// hand with confidence it will never be buried by a random mountain.

export const COURSE_CONSTANTS = {
  checkpointRadius: 18, // generous — leaning/arm controls are imprecise
  safeZoneMargin: 37, // terrain flattens out to (checkpointRadius + this)
};

// A first draft, spaced 150+ units apart (comfortably more than the bird's
// tightest turn radius) in a loop around the origin. Expect to hand-tune after
// playtesting. y is a small fixed height above the (guaranteed-flat, target
// height 0) ground at each checkpoint's location.
export const CHECKPOINTS = [
  { x: 0, z: 150, y: 14, radius: COURSE_CONSTANTS.checkpointRadius },
  { x: 180, z: 320, y: 16, radius: COURSE_CONSTANTS.checkpointRadius },
  { x: 380, z: 280, y: 18, radius: COURSE_CONSTANTS.checkpointRadius },
  { x: 480, z: 80, y: 16, radius: COURSE_CONSTANTS.checkpointRadius },
  { x: 380, z: -120, y: 14, radius: COURSE_CONSTANTS.checkpointRadius },
  { x: 150, z: -220, y: 12, radius: COURSE_CONSTANTS.checkpointRadius },
  { x: -100, z: -120, y: 14, radius: COURSE_CONSTANTS.checkpointRadius },
  { x: -150, z: 80, y: 16, radius: COURSE_CONSTANTS.checkpointRadius },
];

/** Terrain safe zones for every checkpoint (see terrain.js's heightAt). */
export function getCourseSafeZones() {
  return CHECKPOINTS.map((cp) => ({
    x: cp.x,
    z: cp.z,
    radius: cp.radius + COURSE_CONSTANTS.safeZoneMargin,
    targetHeight: 0,
  }));
}

export function createCourseState() {
  return {
    nextCheckpointIndex: 0,
    status: "idle", // 'idle' | 'racing' | 'finished'
    startTime: null,
    finishTime: null,
  };
}

/**
 * Advances course state if the bird has reached its NEXT checkpoint (and only
 * that one — checkpoints can't be skipped by flying near a later one first).
 * @param {object} state - from createCourseState()
 * @param {{x:number,y:number,z:number}} birdPos
 * @param {number} nowSeconds - current time (e.g. performance.now()/1000)
 * @returns {object} new state (unchanged reference if nothing happened)
 */
export function updateCourseState(state, birdPos, nowSeconds) {
  if (state.status === "finished") return state;

  const target = CHECKPOINTS[state.nextCheckpointIndex];
  const d = Math.hypot(birdPos.x - target.x, birdPos.y - target.y, birdPos.z - target.z);
  if (d > target.radius) return state;

  const isFirst = state.nextCheckpointIndex === 0;
  const isLast = state.nextCheckpointIndex === CHECKPOINTS.length - 1;

  return {
    ...state,
    nextCheckpointIndex: state.nextCheckpointIndex + 1,
    status: isLast ? "finished" : "racing",
    startTime: isFirst ? nowSeconds : state.startTime,
    finishTime: isLast ? nowSeconds : state.finishTime,
  };
}

export function resetCourseState() {
  return createCourseState();
}

/** Moves a running race's start forward, so time spent paused isn't counted. */
export function shiftCourseStart(state, seconds) {
  if (state.startTime == null || state.status === "finished") return state;
  return { ...state, startTime: state.startTime + seconds };
}

/** Seconds elapsed so far (live while racing, frozen once finished). */
export function elapsedSeconds(state, nowSeconds) {
  if (state.startTime == null) return 0;
  const end = state.status === "finished" ? state.finishTime : nowSeconds;
  return end - state.startTime;
}
