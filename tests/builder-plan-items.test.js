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
            id_new: 101,
            name: 'Echo Combo',
            videos: ['https://example.com/echo']
          },
          sets: [
            { mode: 'ECHO', echoLevel: 'EPIC', eccentricPct: '150', restSec: '45', stopAtTop: true },
            {
              mode: 'OLD_SCHOOL',
              reps: '10',
              weight: '40',
              progression: '5',
              progressionPercent: '450',
              restSec: '75',
              justLift: true,
              stopAtTop: false
            }
          ]
        }
      ],
      [
        'exercise-2',
        {
          exercise: {
            id: 'exercise-2',
            id_new: 102,
            name: 'Tempo Pull',
            videos: ['https://example.com/pull']
          },
          sets: [
            { mode: 'ECHO', echoLevel: 'HARDER', eccentricPct: '80', restSec: '30', stopAtTop: false },
            {
              mode: 'TIME_UNDER_TENSION',
              reps: '8',
              weight: '30',
              progression: '-4',
              progressionPercent: '-200',
              restSec: '90',
              justLift: false,
              stopAtTop: true
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
      restSec: 45,
      justLift: true,
      stopAtTop: true,
      videos: ['https://example.com/echo'],
      weightUnit: 'LBS',
      exerciseIdNew: 101,
      builderMeta: {
        exerciseId: 'exercise-1',
        exerciseIdNew: 101,
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
          overloadValue: '',
          progressionPercent: '',
          progressionMode: 'NONE',
          progressionFrequency: 'WORKOUT',
          weightUnit: 'LBS',
          progressionUnit: 'LBS',
          restSec: '45',
          justLift: false,
          stopAtTop: true
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
      restSec: 75,
      progressionKg: 2.268,
      progressionDisplay: '5',
      progressionUnit: 'LBS',
      progressionPercent: 400,
      progressiveOverloadKg: 0,
      progressiveOverloadDisplay: '',
      progressiveOverloadUnit: 'LBS',
      progressiveOverloadPercent: 400,
      progressionMode: 'PERCENT',
      progressionFrequency: 'WORKOUT',
      justLift: true,
      stopAtTop: false,
      cables: 2,
      videos: ['https://example.com/echo'],
      weightUnit: 'LBS',
      exerciseIdNew: 101,
      builderMeta: {
        exerciseId: 'exercise-1',
        exerciseIdNew: 101,
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
          overloadValue: '',
          progressionPercent: '450',
          progressionMode: 'PERCENT',
          progressionFrequency: 'WORKOUT',
          weightUnit: 'LBS',
          progressionUnit: 'LBS',
          restSec: '75',
          justLift: true,
          stopAtTop: false
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
      restSec: 30,
      justLift: true,
      stopAtTop: false,
      videos: ['https://example.com/pull'],
      weightUnit: 'LBS',
      exerciseIdNew: 102,
      builderMeta: {
        exerciseId: 'exercise-2',
        exerciseIdNew: 102,
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
          overloadValue: '',
          progressionPercent: '',
          progressionMode: 'NONE',
          progressionFrequency: 'WORKOUT',
          weightUnit: 'LBS',
          progressionUnit: 'LBS',
          restSec: '30',
          justLift: false,
          stopAtTop: false
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
      restSec: 90,
      progressionKg: -1.814,
      progressionDisplay: '-4',
      progressionUnit: 'LBS',
      progressionPercent: -100,
      progressiveOverloadKg: 0,
      progressiveOverloadDisplay: '',
      progressiveOverloadUnit: 'LBS',
      progressiveOverloadPercent: -100,
      progressionMode: 'PERCENT',
      progressionFrequency: 'WORKOUT',
      justLift: false,
      stopAtTop: true,
      cables: 2,
      videos: ['https://example.com/pull'],
      weightUnit: 'LBS',
      exerciseIdNew: 102,
      builderMeta: {
        exerciseId: 'exercise-2',
        exerciseIdNew: 102,
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
          overloadValue: '',
          progressionPercent: '-200',
          progressionMode: 'PERCENT',
          progressionFrequency: 'WORKOUT',
          weightUnit: 'LBS',
          progressionUnit: 'LBS',
          restSec: '90',
          justLift: false,
          stopAtTop: true
        }
      }
    });
  } finally {
    state.weightUnit = originalWeightUnit;
    state.builder.order = originalOrder;
    state.builder.items = new Map(originalItems);
  }
});

test('buildPlanItems encodes Time Under Tension Beast Mode correctly', () => {
  const originalWeightUnit = state.weightUnit;
  const originalOrder = [...state.builder.order];
  const originalItems = new Map(state.builder.items);

  try {
    state.weightUnit = 'KG';
    state.builder.order = ['exercise-beast'];
    state.builder.items = new Map([
      [
        'exercise-beast',
        {
          exercise: {
            id: 'exercise-beast',
            name: 'Beast Tempo',
            videos: []
          },
          sets: [
            {
              mode: 'TIME_UNDER_TENSION_BEAST',
              reps: '6',
              weight: '40',
              progression: '',
              progressionPercent: '',
              restSec: '80',
              justLift: false,
              stopAtTop: true
            }
          ]
        }
      ]
    ]);

    const planItems = buildPlanItems();
    assert.equal(planItems.length, 1);
    const [beastSet] = planItems;
    assert.equal(beastSet.mode, 3);
    assert.equal(beastSet.reps, 6);
  } finally {
    state.weightUnit = originalWeightUnit;
    state.builder.order = originalOrder;
    state.builder.items = new Map(originalItems);
  }
});
