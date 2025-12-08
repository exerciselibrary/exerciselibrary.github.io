import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SupersetExecutorV2 } from '../workout-time/superset-executor-v2.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Define a minimal representation of the 'super test' plan inline so tests
// do not depend on an external file being present in the workspace.
const planItems = [
  { name: 'test1', sets: 2, groupNumber: '1' },
  { name: 'test2', sets: 3, groupNumber: '1' },
  { name: 'Test3', sets: 2, groupNumber: '1' },
  { name: 'not super', sets: 2 },
  { name: 'superset2', sets: 3, groupNumber: '2' },
  { name: 'superset2b', sets: 2, groupNumber: '2' },
];

function buildPlanTimeline(items = []) {
  const timeline = [];
  items.forEach((item, itemIndex) => {
    if (!item) return;
    const sets = Math.max(1, Number(item.sets) || 1);
    for (let set = 1; set <= sets; set += 1) {
      timeline.push({ itemIndex, set });
    }
  });
  return timeline;
}

test('superset: super test executes in round-robin order for grouped items', () => {
  const timeline = buildPlanTimeline(planItems);
  const exec = new SupersetExecutorV2(planItems);

  // Collect order of executed item names for group 1 and group 2
  const runNames = [];

  let timelineIndex = 0;
  function findTimelineIndexFor(itemIndex, setNumber) {
    return timeline.findIndex((e) => e.itemIndex === itemIndex && Number(e.set) === Number(setNumber));
  }

  while (timelineIndex < timeline.length) {
    const entry = timeline[timelineIndex];
    const item = planItems[entry.itemIndex];
    runNames.push(`${item.name}#${entry.set}`);

    const nextStep = exec.getNextExercise(entry.itemIndex);

    if (nextStep.action === 'next-exercise') {
      const remaining = exec.getRemainingSets(nextStep.itemIndex);
      const totalSets = Math.max(1, Number(planItems[nextStep.itemIndex].sets) || 1);
      const setToRun = Math.max(1, totalSets - remaining + 1);
      const ti = findTimelineIndexFor(nextStep.itemIndex, setToRun);
      if (ti !== -1) {
        timelineIndex = ti;
        continue;
      }
    }

    if (nextStep.action === 'rest-then-continue') {
      const remaining = exec.getRemainingSets(nextStep.itemIndex);
      const totalSets = Math.max(1, Number(planItems[nextStep.itemIndex].sets) || 1);
      const setToRun = Math.max(1, totalSets - remaining + 1);
      const ti = findTimelineIndexFor(nextStep.itemIndex, setToRun);
      if (ti !== -1) {
        timelineIndex = ti;
        continue;
      }
    }

    // default advance
    timelineIndex += 1;
  }

  // Expected ordering for grouped items (round-robin by set)
  // group 1: test1 (2 sets), test2 (3 sets), Test3 (2 sets)
  const expectedStart = [
    'test1#1', 'test2#1', 'Test3#1',
    'test1#2', 'test2#2', 'Test3#2',
    'test2#3'
  ];

  // Find subsequence of runNames that corresponds to first group's runs
  const joined = runNames.join(',');
  const found = expectedStart.every((label, idx) => runNames[idx] === label);
  assert.ok(found, `Expected first group sequence to start ${expectedStart.join(',')} but got ${runNames.slice(0, expectedStart.length).join(',')}`);
});
