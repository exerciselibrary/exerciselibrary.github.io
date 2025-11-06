import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const documentStub = {
  getElementById: () => null,
  createElement: () => ({
    appendChild() {},
    remove() {},
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    }
  }),
  createDocumentFragment: () => ({
    appendChild() {}
  })
};

globalThis.document = documentStub;

globalThis.window = { location: { href: 'http://localhost' } };

globalThis.history = { replaceState() {} };

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  key(index) {
    return Array.from(storage.keys())[index] ?? null;
  },
  clear() {
    storage.clear();
  },
  get length() {
    return storage.size;
  }
};

const { state } = await import('../js/context.js');
const { loadPlanIntoBuilder } = await import('../js/builder.js');

const snapshotBuilderState = () => ({
  order: [...state.builder.order],
  items: new Map(
    Array.from(state.builder.items.entries()).map(([id, entry]) => [
      id,
      {
        exercise: {
          ...entry.exercise,
          muscleGroups: Array.isArray(entry.exercise?.muscleGroups)
            ? [...entry.exercise.muscleGroups]
            : [],
          muscles: Array.isArray(entry.exercise?.muscles) ? [...entry.exercise.muscles] : [],
          equipment: Array.isArray(entry.exercise?.equipment) ? [...entry.exercise.equipment] : [],
          videos: Array.isArray(entry.exercise?.videos) ? [...entry.exercise.videos] : []
        },
        sets: entry.sets.map((set) => ({ ...set }))
      }
    ])
  )
});

const restoreBuilderState = (snapshot) => {
  state.builder.order.splice(0, state.builder.order.length, ...snapshot.order);
  state.builder.items.clear();
  snapshot.items.forEach((entry, id) => {
    state.builder.items.set(id, {
      exercise: {
        ...entry.exercise,
        muscleGroups: [...entry.exercise.muscleGroups],
        muscles: [...entry.exercise.muscles],
        equipment: [...entry.exercise.equipment],
        videos: [...entry.exercise.videos]
      },
      sets: entry.sets.map((set) => ({ ...set }))
    });
  });
};

let originalBuilderSnapshot;
let originalDataSnapshot;
let originalNow;

beforeEach(() => {
  originalBuilderSnapshot = snapshotBuilderState();
  originalDataSnapshot = state.data.map((exercise) => ({
    ...exercise,
    muscleGroups: Array.isArray(exercise?.muscleGroups) ? [...exercise.muscleGroups] : [],
    muscles: Array.isArray(exercise?.muscles) ? [...exercise.muscles] : [],
    equipment: Array.isArray(exercise?.equipment) ? [...exercise.equipment] : [],
    videos: Array.isArray(exercise?.videos) ? [...exercise.videos] : []
  }));
  originalNow = Date.now;
  Date.now = () => 1700000000000;
  storage.clear();
});

afterEach(() => {
  restoreBuilderState(originalBuilderSnapshot);
  state.data = originalDataSnapshot.map((exercise) => ({
    ...exercise,
    muscleGroups: [...exercise.muscleGroups],
    muscles: [...exercise.muscles],
    equipment: [...exercise.equipment],
    videos: [...exercise.videos]
  }));
  Date.now = originalNow;
  storage.clear();
});

test('collapses grouped plan items into a single builder entry with ordered sets', () => {
  state.data = [
    {
      id: 'deadlift',
      name: 'Catalogue Deadlift',
      muscleGroups: ['Back'],
      muscles: ['Lats'],
      equipment: ['Barbell'],
      videos: ['catalog-deadlift.mp4']
    }
  ];

  const planItems = [
    {
      name: 'Deadlift Variation',
      builderMeta: {
        exerciseId: 'deadlift',
        exerciseName: 'Meta Deadlift',
        order: 3,
        videos: ['shared-deadlift.mp4'],
        setIndex: 2,
        setData: {
          reps: '7',
          weight: '315',
          mode: 'OLD_SCHOOL',
          progression: '5',
          progressionPercent: '15'
        }
      }
    },
    {
      name: 'Deadlift Variation',
      builderMeta: {
        exerciseId: 'deadlift',
        exerciseName: 'Meta Deadlift',
        order: 3,
        videos: ['shared-deadlift.mp4'],
        setIndex: 0,
        setData: {
          reps: '5',
          weight: '275',
          mode: 'OLD_SCHOOL',
          progression: '2',
          progressionPercent: '5'
        }
      }
    },
    {
      name: 'Deadlift Variation',
      builderMeta: {
        exerciseId: 'deadlift',
        exerciseName: 'Meta Deadlift',
        order: 3,
        videos: ['shared-deadlift.mp4'],
        setIndex: 1,
        setData: {
          reps: '6',
          weight: '295',
          mode: 'ECHO',
          echoLevel: 'HARDEST',
          eccentricPct: '120',
          progression: '3',
          progressionPercent: '10'
        }
      }
    }
  ];

  loadPlanIntoBuilder(planItems);

  assert.deepStrictEqual(state.builder.order, ['deadlift']);
  const entry = state.builder.items.get('deadlift');
  assert(entry, 'expected builder entry for deadlift');

  assert.deepStrictEqual(entry.exercise, {
    id: 'deadlift',
    name: 'Catalogue Deadlift',
    muscleGroups: ['Back'],
    muscles: ['Lats'],
    equipment: ['Barbell'],
    videos: ['shared-deadlift.mp4']
  });

  const setShape = entry.sets.map((set) => ({
    reps: set.reps,
    weight: set.weight,
    mode: set.mode,
    echoLevel: set.echoLevel,
    eccentricPct: set.eccentricPct,
    progression: set.progression,
    progressionPercent: set.progressionPercent
  }));

  assert.deepStrictEqual(setShape, [
    {
      reps: '5',
      weight: '275',
      mode: 'OLD_SCHOOL',
      echoLevel: 'HARD',
      eccentricPct: 100,
      progression: '2',
      progressionPercent: '5'
    },
    {
      reps: '6',
      weight: '295',
      mode: 'ECHO',
      echoLevel: 'HARDEST',
      eccentricPct: '120',
      progression: '3',
      progressionPercent: '10'
    },
    {
      reps: '7',
      weight: '315',
      mode: 'OLD_SCHOOL',
      echoLevel: 'HARD',
      eccentricPct: 100,
      progression: '5',
      progressionPercent: '15'
    }
  ]);
});

test('creates a fallback entry for legacy plan items without builder metadata IDs', () => {
  state.data = [
    {
      id: 'press',
      name: 'Overhead Press',
      muscleGroups: ['Shoulders'],
      muscles: ['Delts'],
      equipment: ['Dumbbell'],
      videos: ['press-catalog.mp4']
    }
  ];

  const planItems = [
    {
      name: 'Press Builder Item',
      builderMeta: {
        exerciseId: 'press',
        exerciseName: 'Meta Press',
        order: 4,
        videos: ['press-meta.mp4'],
        setIndex: 0,
        setData: {
          reps: '8',
          weight: '60',
          mode: 'TIME_UNDER_TENSION',
          progression: '2',
          progressionPercent: '8'
        }
      }
    },
    {
      name: 'Custom Finisher',
      videos: ['legacy-finisher.mp4'],
      sets: 2,
      reps: 12,
      perCableKg: 30,
      builderMeta: {
        exerciseName: 'Custom Finisher',
        setData: {
          reps: '12',
          weight: '50',
          mode: 'PUMP',
          progression: '1',
          progressionPercent: '5'
        }
      }
    }
  ];

  loadPlanIntoBuilder(planItems);

  assert.strictEqual(state.builder.order.length, 2);
  const [legacyId, groupedId] = state.builder.order;
  assert.strictEqual(groupedId, 'press');
  assert.ok(legacyId.startsWith('plan-1700000000000-1-'));

  const legacyEntry = state.builder.items.get(legacyId);
  assert(legacyEntry, 'expected legacy entry to be added');
  assert.deepStrictEqual(legacyEntry.exercise, {
    id: legacyId,
    name: 'Custom Finisher',
    muscleGroups: [],
    muscles: [],
    equipment: [],
    videos: ['legacy-finisher.mp4']
  });

  assert.strictEqual(legacyEntry.sets.length, 2);
  legacyEntry.sets.forEach((set) => {
    assert.deepStrictEqual(
      {
        reps: set.reps,
        weight: set.weight,
        mode: set.mode,
        progression: set.progression,
        progressionPercent: set.progressionPercent
      },
      {
        reps: '12',
        weight: '50',
        mode: 'PUMP',
        progression: '1',
        progressionPercent: '5'
      }
    );
  });

  const groupedEntry = state.builder.items.get('press');
  assert(groupedEntry, 'expected grouped press entry to be added');
  assert.deepStrictEqual(groupedEntry.exercise, {
    id: 'press',
    name: 'Overhead Press',
    muscleGroups: ['Shoulders'],
    muscles: ['Delts'],
    equipment: ['Dumbbell'],
    videos: ['press-meta.mp4']
  });
  assert.deepStrictEqual(
    groupedEntry.sets.map((set) => ({
      reps: set.reps,
      weight: set.weight,
      mode: set.mode,
      progression: set.progression,
      progressionPercent: set.progressionPercent
    })),
    [
      {
        reps: '8',
        weight: '60',
        mode: 'TIME_UNDER_TENSION',
        progression: '2',
        progressionPercent: '8'
      }
    ]
  );
});
