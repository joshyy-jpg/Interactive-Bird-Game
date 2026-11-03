import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleWind, nearbyWindStreams, WIND_TILE } from '../../src/wind.js';

test('wind boosts aligned flight and does not boost reverse or outside flight', () => {
  const center = { x:0,y:32,z:110 };
  assert.equal(sampleWind(center,0,0).acceleration,12);
  assert.equal(sampleWind(center,Math.PI,0).acceleration,0);
  assert.equal(sampleWind({...center,x:15},0,0).acceleration,0);
  assert.equal(sampleWind({...center,z:201},0,0).acceleration,0);
  assert.ok(sampleWind({...center,x:13},0,0).acceleration < 12);
  assert.ok(sampleWind({...center,z:21},0,0).acceleration < 12);
});

test('wind repeats at distant world coordinates and rendered definitions match sampling', () => {
  const p={x:WIND_TILE*11,y:32,z:110-WIND_TILE*8};
  assert.equal(sampleWind(p,0,0).strength,1);
  assert.equal(sampleWind(p,0,0,nearbyWindStreams(p)).strength,1);
});
