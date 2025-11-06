import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const planRunnerPath = path.join(__dirname, '..', 'workout-time', 'plan-runner.js');

const windowStub = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  alert: () => {},
  document: { getElementById: () => null },
  requestAnimationFrame: (fn) => (typeof fn === 'function' ? fn() : undefined),
  cancelAnimationFrame: noop,
  performance: { now: () => 0 }
};

function noop() {}

windowStub.window = windowStub;
windowStub.globalThis = windowStub;

vm.runInNewContext(await readFile(planRunnerPath, 'utf8'), windowStub, { filename: 'plan-runner.js' });

const PlanRunnerPrototype = windowStub.PlanRunnerPrototype;

test('buildPlanTimeline coerces invalid set counts', () => {
  const items = [
    { type: 'exercise', sets: 0 },
    { type: 'exercise', sets: 3 },
    null,
    { type: 'echo', sets: '2' }
  ];

  const timeline = PlanRunnerPrototype.buildPlanTimeline.call({ planItems: items }, items);

  assert.deepEqual(timeline, [
    { itemIndex: 0, set: 1 },
    { itemIndex: 1, set: 1 },
    { itemIndex: 1, set: 2 },
    { itemIndex: 1, set: 3 },
    { itemIndex: 3, set: 1 },
    { itemIndex: 3, set: 2 }
  ]);
});

test('describePlanItem notes unlimited reps for Just Lift blocks', () => {
  const summary = PlanRunnerPrototype.describePlanItem.call(
    {
      getUnitLabel: () => 'kg',
      convertKgToDisplay: (value) => value,
      getWeightInputDecimals: () => 1
    },
    {
      type: 'exercise',
      name: 'Unlimited Pump',
      mode: 1,
      perCableKg: 20,
      reps: 0,
      justLift: true,
      cables: 2
    }
  );

  assert.match(summary, /Unlimited reps/);
});
