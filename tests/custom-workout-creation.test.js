import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createWindowStub } from './helpers/vitruvian-test-utils.js';

const windowStub = createWindowStub();
globalThis.window = windowStub;
globalThis.document = windowStub.document;
globalThis.localStorage = windowStub.localStorage;

const { state, getSearchIndex, setSearchIndex } = await import('../js/context.js');
const {
  setBaseExercises,
  setCustomExercises,
  getCustomExercises,
  buildCustomExerciseEntry,
  getNextCustomNumericId,
  getDropboxPayloadForCustomExercises
} = await import('../js/custom-exercises.js');

const cloneExercise = (exercise) => {
  if (!exercise || typeof exercise !== 'object') return exercise;
  return {
    ...exercise,
    muscleGroups: Array.isArray(exercise.muscleGroups) ? [...exercise.muscleGroups] : undefined,
    muscles: Array.isArray(exercise.muscles) ? [...exercise.muscles] : undefined,
    equipment: Array.isArray(exercise.equipment) ? [...exercise.equipment] : undefined,
    summary: exercise.summary
      ? {
          muscles: Array.isArray(exercise.summary.muscles) ? [...exercise.summary.muscles] : [],
          equipment: Array.isArray(exercise.summary.equipment) ? [...exercise.summary.equipment] : []
        }
      : undefined,
    videos: Array.isArray(exercise.videos) ? [...exercise.videos] : undefined
  };
};

const cloneExerciseList = (list) => (Array.isArray(list) ? list.map((exercise) => cloneExercise(exercise)) : []);

let originalState;
let originalSearchIndex;

beforeEach(() => {
  originalState = {
    data: cloneExerciseList(state.data),
    baseExercises: cloneExerciseList(state.data.filter((exercise) => !exercise?.isCustom)),
    muscles: [...state.muscles],
    subMuscles: [...state.subMuscles],
    equipment: [...state.equipment],
    customExercises: cloneExerciseList(state.customExercises),
    randomOrderMap: state.randomOrderMap instanceof Map ? new Map(state.randomOrderMap) : state.randomOrderMap ?? null
  };
  originalSearchIndex = getSearchIndex();
  setBaseExercises([]);
  setCustomExercises([]);
});

afterEach(() => {
  setBaseExercises(originalState.baseExercises);
  setCustomExercises(originalState.customExercises);
  state.data = cloneExerciseList(originalState.data);
  state.muscles = [...originalState.muscles];
  state.subMuscles = [...originalState.subMuscles];
  state.equipment = [...originalState.equipment];
  state.customExercises = cloneExerciseList(originalState.customExercises);
  state.randomOrderMap =
    originalState.randomOrderMap instanceof Map
      ? new Map(originalState.randomOrderMap)
      : originalState.randomOrderMap ?? null;
  setSearchIndex(originalSearchIndex);
});

test('setCustomExercises merges Dropbox entries so custom workouts show up in the builder catalogue', () => {
  const baseExercises = [
    {
      id: 'deadlift',
      id_new: 410,
      name: 'Conventional Deadlift',
      muscleGroups: ['Posterior Chain'],
      muscles: ['Spinal Erectors'],
      equipment: ['Barbell'],
      summary: {
        muscles: ['Posterior Chain'],
        equipment: ['Barbell']
      }
    },
    {
      id: 'splitSquat',
      id_new: 411,
      name: 'Split Squat',
      muscleGroups: ['Legs'],
      muscles: ['Quads'],
      equipment: ['Dumbbell'],
      summary: {
        muscles: ['Legs'],
        equipment: ['Dumbbell']
      }
    }
  ];
  const remoteCustomExercises = [
    {
      id: 'custom-612',
      id_new: 612,
      name: 'Tempo Row',
      muscleGroups: ['Back'],
      muscles: [],
      equipment: ['Cable'],
      summary: {
        muscles: [],
        equipment: []
      }
    }
  ];

  setBaseExercises(baseExercises);
  setCustomExercises(remoteCustomExercises);

  assert.deepStrictEqual(
    state.data.map((exercise) => exercise.id),
    ['deadlift', 'splitSquat', 'custom-612'],
    'builder catalogue should include base + custom exercises'
  );

  const catalogueCustom = state.data.find((exercise) => exercise.id === 'custom-612');
  assert.ok(catalogueCustom?.isCustom, 'custom entries should be tagged');
  assert.deepStrictEqual(
    catalogueCustom?.summary,
    { muscles: ['Back'], equipment: ['Cable'] },
    'missing summary data should fall back to chosen tags so filters stay in sync'
  );

  assert.deepStrictEqual(
    [...state.muscles].sort(),
    ['Back', 'Legs', 'Posterior Chain'],
    'muscle group filters should reflect the merged catalogue'
  );
  assert.deepStrictEqual(
    [...state.equipment].sort(),
    ['Barbell', 'Cable', 'Dumbbell'],
    'equipment filters should reflect the merged catalogue'
  );

  const searchIndex = getSearchIndex();
  assert.ok(searchIndex instanceof Map, 'custom entries should trigger a rebuilt search index');
  assert.ok(searchIndex.has('custom-612'), 'custom entries should be searchable for workout creation');

  const exportedCustomExercises = getCustomExercises();
  assert.notStrictEqual(
    exportedCustomExercises[0],
    state.customExercises[0],
    'callers should receive a clone so builder mutations cannot affect Dropbox payloads'
  );

  // Mutate the exported copy and verify it does not leak back into state.
  exportedCustomExercises[0].name = 'Modified Tempo Row';
  assert.notStrictEqual(
    exportedCustomExercises[0].name,
    state.customExercises[0].name,
    'state should remain unchanged when consumers edit the exported list'
  );
});

test('buildCustomExerciseEntry normalizes metadata for newly created custom workouts', () => {
  setBaseExercises([
    {
      id: 'baseBench',
      id_new: 700,
      name: 'Base Bench',
      muscleGroups: ['Chest'],
      muscles: ['Pecs'],
      equipment: ['Barbell']
    }
  ]);
  setCustomExercises([
    {
      id: 'custom-701',
      id_new: 701,
      name: 'Existing Custom',
      muscleGroups: ['Arms'],
      muscles: ['Biceps'],
      equipment: ['Cable']
    }
  ]);

  const RealDate = Date;
  const fixedDate = new RealDate('2024-01-02T03:04:05.000Z');
  // eslint-disable-next-line no-global-assign
  Date = class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        return new RealDate(fixedDate);
      }
      return new RealDate(...args);
    }
    static now() {
      return fixedDate.getTime();
    }
    static parse(value) {
      return RealDate.parse(value);
    }
    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  };

  try {
    const entry = buildCustomExerciseEntry({
      name: '  tempo pull  ',
      muscleGroups: [' Back ', 'Core', '', null],
      muscles: [' Lats', 'Upper Back'],
      equipment: [' Cable ', ' Bench', '']
    });

    assert.equal(entry.id_new, 702, 'new custom workouts should use the next numeric id');
    assert.equal(entry.id, 'custom-702');
    assert.equal(entry.name, 'tempo pull', 'names should be trimmed but otherwise preserved');
    assert.equal(entry.created, fixedDate.toISOString());
    assert.deepStrictEqual(entry.muscleGroups, ['Back', 'Core']);
    assert.deepStrictEqual(entry.muscles, ['Lats', 'Upper Back']);
    assert.deepStrictEqual(entry.equipment, ['Cable', 'Bench']);
    assert.deepStrictEqual(
      entry.summary,
      {
        muscles: ['Back', 'Core'],
        equipment: ['Cable', 'Bench']
      },
      'summary should mirror the picker selections when no explicit summary is supplied'
    );
    assert.deepStrictEqual(entry.videos, []);
    assert.equal(entry.isCustom, true);

    const nextId = getNextCustomNumericId();
    assert.equal(nextId, 703, 'custom workout ids should continue incrementing after entry creation');

    const syncPayload = getDropboxPayloadForCustomExercises([entry]);
    assert.deepStrictEqual(syncPayload, [
      {
        id: 'custom-702',
        id_new: 702,
        name: 'tempo pull',
        created: fixedDate.toISOString(),
        muscleGroups: ['Back', 'Core'],
        muscles: ['Lats', 'Upper Back'],
        equipment: ['Cable', 'Bench'],
        summary: {
          muscles: ['Back', 'Core'],
          equipment: ['Cable', 'Bench']
        },
        videos: []
      }
    ]);
  } finally {
    // eslint-disable-next-line no-global-assign
    Date = RealDate;
  }
});
