import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => null
};

const { state } = await import('../js/context.js');
const { buildPlanItems } = await import('../js/builder.js');

test('buildPlanItems normalizes builder entries into plan items', () => {
  const originalWeightUnit = state.weightUnit;
  const originalOrder = [...state.builder.order];
  const originalItems = new Map(state.builder.items);

  try {
    state.weightUnit = 'LBS';
    state.builder.order = ['exercise-1', 'exercise-2'];

    state.builder.items = new Map([
      [
        'exercise-1',
        {
          exercise: {
            id: 'exercise-1',
            name: 'Echo Combo',
            videos: ['https://example.com/echo']
          },
          sets: [
            { mode: 'ECHO', echoLevel: 'EPIC', eccentricPct: '150' },
            {
              mode: 'OLD_SCHOOL',
              reps: '10',
              weight: '40',
              progression: '5',
              progressionPercent: '450'
            }
          ]
        }
      ],
      [
        'exercise-2',
        {
          exercise: {
            id: 'exercise-2',
            name: 'Tempo Pull',
            videos: ['https://example.com/pull']
          },
          sets: [
            { mode: 'ECHO', echoLevel: 'HARDER', eccentricPct: '80' },
            {
              mode: 'TIME_UNDER_TENSION',
              reps: '8',
              weight: '30',
              progression: '-4',
              progressionPercent: '-200'
            }
          ]
        }
      ]
    ]);

    const planItems = buildPlanItems();

    assert.equal(planItems.length, 4);

    const [echoHeavy, weightSet, echoLight, tempoSet] = planItems;

    assert.deepEqual(echoHeavy, {
      type: 'echo',
      name: 'Echo Combo',
      level: 3,
      eccentricPct: 130,
      targetReps: 0,
      sets: 1,
      restSec: 60,
      justLift: true,
      stopAtTop: false,
      videos: ['https://example.com/echo'],
      builderMeta: {
        exerciseId: 'exercise-1',
        exerciseName: 'Echo Combo',
        videos: ['https://example.com/echo'],
        order: 0,
        totalSets: 2,
        setIndex: 0,
        setData: {
          reps: '',
          weight: '',
          mode: 'ECHO',
          echoLevel: 'EPIC',
          eccentricPct: '150',
          progression: '',
          progressionPercent: ''
        }
      }
    });

    assert.deepEqual(weightSet, {
      type: 'exercise',
      name: 'Echo Combo',
      mode: 0,
      perCableKg: 18.144,
      reps: 10,
      sets: 1,
      restSec: 60,
      progressionKg: 2.268,
      progressionDisplay: '5',
      progressionUnit: 'LBS',
      progressionPercent: 400,
      justLift: false,
      stopAtTop: false,
      cables: 2,
      videos: ['https://example.com/echo'],
      builderMeta: {
        exerciseId: 'exercise-1',
        exerciseName: 'Echo Combo',
        videos: ['https://example.com/echo'],
        order: 0,
        totalSets: 2,
        setIndex: 1,
        setData: {
          reps: '10',
          weight: '40',
          mode: 'OLD_SCHOOL',
          echoLevel: 'HARD',
          eccentricPct: '100',
          progression: '5',
          progressionPercent: '450'
        }
      }
    });

    assert.deepEqual(echoLight, {
      type: 'echo',
      name: 'Tempo Pull',
      level: 1,
      eccentricPct: 100,
      targetReps: 0,
      sets: 1,
      restSec: 60,
      justLift: true,
      stopAtTop: false,
      videos: ['https://example.com/pull'],
      builderMeta: {
        exerciseId: 'exercise-2',
        exerciseName: 'Tempo Pull',
        videos: ['https://example.com/pull'],
        order: 1,
        totalSets: 2,
        setIndex: 0,
        setData: {
          reps: '',
          weight: '',
          mode: 'ECHO',
          echoLevel: 'HARDER',
          eccentricPct: '80',
          progression: '',
          progressionPercent: ''
        }
      }
    });

    assert.deepEqual(tempoSet, {
      type: 'exercise',
      name: 'Tempo Pull',
      mode: 2,
      perCableKg: 13.608,
      reps: 8,
      sets: 1,
      restSec: 60,
      progressionKg: -1.814,
      progressionDisplay: '-4',
      progressionUnit: 'LBS',
      progressionPercent: -100,
      justLift: false,
      stopAtTop: false,
      cables: 2,
      videos: ['https://example.com/pull'],
      builderMeta: {
        exerciseId: 'exercise-2',
        exerciseName: 'Tempo Pull',
        videos: ['https://example.com/pull'],
        order: 1,
        totalSets: 2,
        setIndex: 1,
        setData: {
          reps: '8',
          weight: '30',
          mode: 'TIME_UNDER_TENSION',
          echoLevel: 'HARD',
          eccentricPct: '100',
          progression: '-4',
          progressionPercent: '-200'
        }
      }
    });
  } finally {
    state.weightUnit = originalWeightUnit;
    state.builder.order = originalOrder;
    state.builder.items = new Map(originalItems);
  }
});

test('buildPlanItems clamps progression percent and respects metric units', () => {
  const originalWeightUnit = state.weightUnit;
  const originalOrder = [...state.builder.order];
  const originalItems = new Map(state.builder.items);

  try {
    state.weightUnit = 'KG';
    state.builder.order = ['metric-exercise'];

    state.builder.items = new Map([
      [
        'metric-exercise',
        {
          exercise: {
            id: 'metric-exercise',
            name: 'Metric Builder'
          },
          sets: [
            {
              mode: 'PUMP',
              reps: '12',
              weight: '30',
              progression: '1.5',
              progressionPercent: '450'
            },
            {
              mode: 'OLD_SCHOOL',
              reps: '8',
              weight: '28',
              progression: '',
              progressionPercent: '-120'
            },
            {
              mode: 'OLD_SCHOOL',
              reps: '6',
              weight: '24',
              progression: 'not-a-number',
              progressionPercent: 'n/a'
            }
          ]
        }
      ]
    ]);

    const planItems = buildPlanItems();
    assert.equal(planItems.length, 3);

    const [firstSet, secondSet, thirdSet] = planItems;

    assert.equal(firstSet.progressionUnit, 'KG');
    assert.equal(firstSet.progressionDisplay, '1.5');
    assert.equal(firstSet.progressionKg, 1.5);
    assert.equal(firstSet.progressionPercent, 400);

    assert.equal(secondSet.progressionKg, 0);
    assert.equal(secondSet.progressionPercent, -100);

    assert.equal(thirdSet.progressionKg, 0);
    assert.equal(thirdSet.progressionPercent, null);
  } finally {
    state.weightUnit = originalWeightUnit;
    state.builder.order = originalOrder;
    state.builder.items = originalItems;
  }
});
