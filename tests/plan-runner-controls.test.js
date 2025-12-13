import test from 'node:test';
import assert from 'node:assert/strict';

import { createWindowStub } from './helpers/vitruvian-test-utils.js';

// Minimal window/document stubs for plan-runner
const windowStub = createWindowStub();
globalThis.window = windowStub;
globalThis.document = windowStub.document;
globalThis.localStorage = windowStub.localStorage;
globalThis.performance = windowStub.performance;

await import('../workout-time/plan-runner.js');
const PlanRunnerPrototype = windowStub.PlanRunnerPrototype;

const createRunner = () => {
  const runner = Object.create(PlanRunnerPrototype);
  runner.planActive = true;
  runner.planPaused = false;
  runner.planTimeline = [
    { itemIndex: 0, set: 1 },
    { itemIndex: 0, set: 2 },
  ];
  runner.planTimelineIndex = 1;
  runner._restState = { totalSec: 30, remainingSec: 30 };
  runner._planSetInProgress = false;
  runner.addLogEntry = () => {};
  runner._restClears = [];
  runner._clearRestState = (options = {}) => {
    runner._restClears.push(options);
    runner._restState = null;
  };
  return runner;
};

test('Next stays enabled while resting before the final set', () => {
  const runner = createRunner();

  // Reset button state to a known baseline
  const nextBtn = document.getElementById('planNextBtn');
  const nextBtnMobile = document.getElementById('planNextBtnMobile');
  nextBtn.disabled = undefined;
  nextBtnMobile.disabled = undefined;

  runner.updatePlanControlsState();

  assert.equal(nextBtn.disabled, false);
  assert.equal(nextBtnMobile.disabled, false);
});

test('skipPlanForward clears rest when invoked during final rest period', async () => {
  const runner = createRunner();

  const result = await runner.skipPlanForward();

  assert.equal(result, true);
  assert.equal(runner._restState, null);
  assert.deepEqual(runner._restClears, [{ signalDone: true, reason: 'skipped' }]);
});
