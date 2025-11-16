import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEchoWorkout, analyzeMovementPhases } from '../shared/echo-telemetry.js';

test('analyzeEchoWorkout segments concentric and eccentric phases', () => {
  const workout = {
    itemType: 'echo',
    warmupEndTime: '2025-01-01T00:00:10.000Z',
    movementData: [
      { timestamp: '2025-01-01T00:00:05.000Z', loadA: 1, loadB: 1, posA: 0, posB: 0 },
      { timestamp: '2025-01-01T00:00:11.000Z', loadA: 5, loadB: 4, posA: 10, posB: 12 },
      { timestamp: '2025-01-01T00:00:12.000Z', loadA: 6, loadB: 5, posA: 20, posB: 22 },
      { timestamp: '2025-01-01T00:00:13.000Z', loadA: 7, loadB: 6, posA: 32, posB: 34 },
      { timestamp: '2025-01-01T00:00:14.000Z', loadA: 4, loadB: 4, posA: 18, posB: 20 },
      { timestamp: '2025-01-01T00:00:15.000Z', loadA: 5, loadB: 4, posA: 8, posB: 10 },
      { timestamp: '2025-01-01T00:00:16.000Z', loadA: 8, loadB: 7, posA: 24, posB: 26 },
      { timestamp: '2025-01-01T00:00:17.000Z', loadA: 9, loadB: 8, posA: 36, posB: 38 },
      { timestamp: '2025-01-01T00:00:18.000Z', loadA: 6, loadB: 6, posA: 22, posB: 24 },
      { timestamp: '2025-01-01T00:00:19.000Z', loadA: 4, loadB: 4, posA: 12, posB: 14 }
    ]
  };

  const analysis = analyzeEchoWorkout(workout, { minRange: 5 });
  assert.equal(analysis.reps.length, 2);
  assert.equal(analysis.maxConcentricKg, 9);
  assert.equal(analysis.maxEccentricKg, 9);
  assert.equal(analysis.totalConcentricKg, 16); // 7 + 9
  assert.equal(analysis.totalEccentricKg, 16);
  assert(analysis.range.bottom < analysis.range.top);
});

test('analyzeMovementPhases works for non-echo workouts', () => {
  const workout = {
    itemType: 'exercise',
    warmupEndTime: '2025-01-01T00:00:10.000Z',
    movementData: [
      { timestamp: '2025-01-01T00:00:11.000Z', loadA: 5, loadB: 4, posA: 10, posB: 12 },
      { timestamp: '2025-01-01T00:00:12.000Z', loadA: 6, loadB: 5, posA: 20, posB: 22 },
      { timestamp: '2025-01-01T00:00:13.000Z', loadA: 7, loadB: 6, posA: 32, posB: 34 },
      { timestamp: '2025-01-01T00:00:14.000Z', loadA: 4, loadB: 4, posA: 18, posB: 20 },
      { timestamp: '2025-01-01T00:00:15.000Z', loadA: 5, loadB: 4, posA: 8, posB: 10 }
    ]
  };
  const analysis = analyzeMovementPhases(workout, { minRange: 5 });
  assert.equal(analysis.isEcho, false);
  assert.equal(analysis.hasReps, true);
  assert.equal(analysis.reps.length, 1);
  assert(analysis.maxConcentricKg > 0);
  assert(analysis.maxEccentricKg > 0);
});
