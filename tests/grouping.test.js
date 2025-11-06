import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const stubElement = () => ({
  addEventListener: noop,
  appendChild: noop,
  removeChild: noop,
  classList: { add: noop, remove: noop, toggle: noop },
  setAttribute: noop,
  style: {},
  innerHTML: '',
  textContent: ''
});

globalThis.document = {
  getElementById: stubElement,
  createElement: () => stubElement(),
  createDocumentFragment: () => ({ appendChild: noop }),
  body: {
    appendChild: noop,
    removeChild: noop,
    classList: { add: noop, remove: noop, toggle: noop }
  }
};

globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => (typeof fn === 'function' ? fn() : undefined);

const { state, groupColorMap } = await import('../js/context.js');
const {
  applyGrouping,
  getGroupingClusters,
  getGroupColor
} = await import('../js/grouping.js');

const makeExercise = (name, equipment = []) => ({
  exercise: {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    equipment: Array.from(equipment)
  },
  sets: []
});

let snapshot = null;

const captureSnapshot = () => ({
  order: [...state.builder.order],
  items: new Map(state.builder.items),
  flags: {
    equipment: state.groupByEquipment,
    muscles: state.groupByMuscles,
    muscleGroups: state.groupByMuscleGroups
  }
});

const restoreSnapshot = (value) => {
  state.builder.order = [...value.order];
  state.builder.items = new Map(value.items);
  state.groupByEquipment = value.flags.equipment;
  state.groupByMuscles = value.flags.muscles;
  state.groupByMuscleGroups = value.flags.muscleGroups;
};

beforeEach(() => {
  snapshot = captureSnapshot();
  state.builder.order = [];
  state.builder.items = new Map();
  state.groupByEquipment = false;
  state.groupByMuscles = false;
  state.groupByMuscleGroups = false;
  groupColorMap.clear();
});

afterEach(() => {
  restoreSnapshot(snapshot);
  groupColorMap.clear();
});

test('applyGrouping clusters exercises by equipment in stable order', () => {
  state.builder.order = ['row', 'curl', 'squat', 'plank'];
  state.builder.items = new Map([
    ['row', makeExercise('Row', ['Barbell'])],
    ['curl', makeExercise('Curl', ['Dumbbell'])],
    ['squat', makeExercise('Squat', ['Barbell'])],
    ['plank', makeExercise('Plank', [])]
  ]);

  const changed = applyGrouping('equipment');
  assert.equal(changed, true);
  assert.deepEqual(state.builder.order, ['row', 'squat', 'curl', 'plank']);

  const unchanged = applyGrouping('equipment');
  assert.equal(unchanged, false);
});

test('getGroupingClusters returns metadata with consistent colors', () => {
  state.builder.order = ['row', 'squat', 'curl', 'plank'];
  state.builder.items = new Map([
    ['row', makeExercise('Row', ['Barbell'])],
    ['squat', makeExercise('Squat', ['Barbell'])],
    ['curl', makeExercise('Curl', ['Dumbbell'])],
    ['plank', makeExercise('Plank', [])]
  ]);

  const clusters = getGroupingClusters(state.builder.order, state.builder.items, 'equipment');

  assert.equal(clusters.length, 3);
  assert.deepEqual(clusters.map((c) => c.ids), [
    ['row', 'squat'],
    ['curl'],
    ['plank']
  ]);

  assert.equal(clusters[2].label, 'No Equipment');

  clusters.forEach((cluster) => {
    const color = getGroupColor('equipment', cluster.key);
    assert.equal(cluster.color, color);
    assert.ok(typeof color === 'string' && color.length > 0);
  });
});
