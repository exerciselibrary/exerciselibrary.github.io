import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const stubElement = () => ({
  addEventListener: noop,
  appendChild: noop,
  classList: { add: noop, remove: noop, toggle: noop },
  setAttribute: noop,
  innerHTML: ''
});

global.document = {
  getElementById: stubElement,
  createElement: stubElement,
  createDocumentFragment: () => ({ appendChild: noop })
};

global.window = { innerHeight: 0 };

global.document.body = {
  appendChild: noop,
  removeChild: noop,
  classList: { add: noop, remove: noop, toggle: noop }
};

global.document.documentElement = { scrollHeight: 0 };

global.document.querySelectorAll = () => ({ forEach: noop });

global.document.execCommand = noop;

Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true
});

global.requestAnimationFrame = (fn) => (typeof fn === 'function' ? fn() : undefined);

const { state, filterData, ensureRandomOrderMap } = await import('../js/library.js');

const seedExercises = [
  {
    id: 'atlas-push',
    name: 'Atlas Push-Up',
    muscleGroups: ['Chest', 'Arms'],
    muscles: ['pectoralis major', 'triceps brachii'],
    equipment: ['Bodyweight']
  },
  {
    id: 'bent-row',
    name: 'Bent Row',
    muscleGroups: ['Back'],
    muscles: ['latissimus dorsi', 'biceps brachii'],
    equipment: ['Barbell']
  },
  {
    id: 'cable-fly',
    name: 'Cable Fly',
    muscleGroups: ['Chest'],
    muscles: ['pectoralis major'],
    equipment: ['Cable Machine']
  },
  {
    id: 'chest-supported-row',
    name: 'Chest Supported Row',
    muscleGroups: ['Back', 'Chest'],
    muscles: ['latissimus dorsi', 'pectoralis major'],
    equipment: ['Dumbbell', 'Bench']
  },
  {
    id: 'goblet-squat',
    name: 'Goblet Squat',
    muscleGroups: ['Legs'],
    muscles: ['quadriceps'],
    equipment: ['Dumbbell']
  },
  {
    id: 'hang-clean',
    name: 'Hang Clean',
    muscleGroups: ['Back', 'Legs'],
    muscles: ['hamstrings', 'trapezius'],
    equipment: ['Barbell']
  }
];

const cloneExercise = (exercise) => ({
  ...exercise,
  muscleGroups: Array.from(exercise.muscleGroups),
  muscles: Array.from(exercise.muscles),
  equipment: Array.from(exercise.equipment)
});

let snapshot;

const captureState = () => ({
  data: state.data.map(cloneExercise),
  filters: {
    muscles: new Set(state.filters.muscles),
    subMuscles: new Set(state.filters.subMuscles),
    equipment: new Set(state.filters.equipment),
    mode: { ...state.filters.mode }
  },
  sortMode: state.sortMode,
  shuffleMode: state.shuffleMode,
  randomOrderMap: state.randomOrderMap instanceof Map ? new Map(state.randomOrderMap) : state.randomOrderMap
});

const restoreState = (value) => {
  state.data = value.data.map(cloneExercise);
  state.filters.muscles = new Set(value.filters.muscles);
  state.filters.subMuscles = new Set(value.filters.subMuscles);
  state.filters.equipment = new Set(value.filters.equipment);
  state.filters.mode = { ...value.filters.mode };
  state.sortMode = value.sortMode;
  state.shuffleMode = value.shuffleMode;
  state.randomOrderMap = value.randomOrderMap instanceof Map ? new Map(value.randomOrderMap) : value.randomOrderMap;
};

beforeEach(() => {
  snapshot = captureState();
  state.data = seedExercises.map(cloneExercise);
  state.filters.muscles = new Set();
  state.filters.subMuscles = new Set();
  state.filters.equipment = new Set();
  state.filters.mode = { muscles: 'OR', subMuscles: 'OR', equipment: 'OR' };
  state.search = '';
  state.sortMode = 'AZ';
  state.shuffleMode = false;
  state.randomOrderMap = null;
});

afterEach(() => {
  restoreState(snapshot);
});

test('filterData respects AND/OR modes for muscles, sub-muscles, and equipment', () => {
  state.filters.muscles = new Set(['Chest', 'Back']);
  state.filters.mode.muscles = 'OR';

  let results = filterData().map((exercise) => exercise.id);
  assert.deepStrictEqual(results, ['atlas-push', 'bent-row', 'cable-fly', 'chest-supported-row', 'hang-clean']);

  state.filters.mode.muscles = 'AND';
  results = filterData().map((exercise) => exercise.id);
  assert.deepStrictEqual(results, ['chest-supported-row']);

  state.filters.muscles.clear();
  state.filters.mode.muscles = 'OR';
  state.filters.subMuscles = new Set(['latissimus dorsi', 'pectoralis major']);
  state.filters.mode.subMuscles = 'OR';

  results = filterData().map((exercise) => exercise.id);
  assert.deepStrictEqual(results, ['atlas-push', 'bent-row', 'cable-fly', 'chest-supported-row']);

  state.filters.mode.subMuscles = 'AND';
  results = filterData().map((exercise) => exercise.id);
  assert.deepStrictEqual(results, ['chest-supported-row']);

  state.filters.subMuscles.clear();
  state.filters.mode.subMuscles = 'OR';
  state.filters.equipment = new Set(['Dumbbell', 'Bench']);
  state.filters.mode.equipment = 'OR';

  results = filterData().map((exercise) => exercise.id);
  assert.deepStrictEqual(results, ['chest-supported-row', 'goblet-squat']);

  state.filters.mode.equipment = 'AND';
  results = filterData().map((exercise) => exercise.id);
  assert.deepStrictEqual(results, ['chest-supported-row']);
});

test('filterData uses cached random order when shuffle mode is enabled', () => {
  const originalRandom = Math.random;
  const sequence = [0.9, 0.2, 0.5, 0.1, 0.7, 0.3];
  let index = 0;
  Math.random = () => {
    const value = sequence[index % sequence.length];
    index += 1;
    return value;
  };

  state.shuffleMode = true;
  ensureRandomOrderMap();
  Math.random = originalRandom;

  const expectedShuffleOrder = Array.from(state.randomOrderMap.entries())
    .sort(([, a], [, b]) => a - b)
    .map(([id]) => id);

  let results = filterData().map((exercise) => exercise.id);
  assert.deepStrictEqual(results, expectedShuffleOrder);

  state.shuffleMode = false;
  results = filterData().map((exercise) => exercise.id);
  const expectedAlphaOrder = [...state.data]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((exercise) => exercise.id);
  assert.deepStrictEqual(results, expectedAlphaOrder);
});
