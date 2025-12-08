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
      setName: '',
      groupNumber: '',
      level: 3,
      eccentricPct: 130,
      targetReps: 0,
      sets: 1,
      restSec: 45,
      justLift: true,
      stopAtTop: true,
      intensity: 'none',
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
        setCount: 1,
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
          stopAtTop: true,
          intensity: 'none'
        }
      }
    });

    assert.deepEqual(weightSet, {
      type: 'exercise',
      name: 'Echo Combo',
      setName: '',
      groupNumber: '',
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
      intensity: 'none',
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
        setCount: 1,
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
          stopAtTop: false,
          intensity: 'none'
        }
      }
    });

    assert.deepEqual(echoLight, {
      type: 'echo',
      name: 'Tempo Pull',
      setName: '',
      groupNumber: '',
      level: 1,
      eccentricPct: 100,
      targetReps: 0,
      sets: 1,
      restSec: 30,
      justLift: true,
      stopAtTop: false,
      intensity: 'none',
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
        setCount: 1,
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
          stopAtTop: false,
          intensity: 'none'
        }
      }
    });

    assert.deepEqual(tempoSet, {
      type: 'exercise',
      name: 'Tempo Pull',
      setName: '',
      groupNumber: '',
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
      intensity: 'none',
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
        setCount: 1,
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
          stopAtTop: true,
          intensity: 'none'
        }
      }
    });
  } finally {
    state.weightUnit = originalWeightUnit;
    state.builder.order = originalOrder;
    state.builder.items = new Map(originalItems);
  }
});

test('collapses consecutive identical sets into grouped plan items', () => {
  const originalWeightUnit = state.weightUnit;
  const originalOrder = [...state.builder.order];
  const originalItems = new Map(state.builder.items);

  try {
    state.weightUnit = 'KG';
    state.builder.order = ['bench'];
    state.builder.items = new Map([
      [
        'bench',
        {
          exercise: {
            id: 'bench',
            id_new: 201,
            name: 'Bench Press'
          },
          sets: [
            {
              reps: '5',
              weight: '4.5',
              mode: 'OLD_SCHOOL',
              progression: '',
              progressionPercent: '',
              restSec: '60',
              justLift: false,
              stopAtTop: false,
              intensity: 'none'
            },
            {
              reps: '5',
              weight: '4.5',
              mode: 'OLD_SCHOOL',
              progression: '',
              progressionPercent: '',
              restSec: '60',
              justLift: false,
              stopAtTop: false,
              intensity: 'none'
            },
            {
              reps: '6',
              weight: '4.5',
              mode: 'OLD_SCHOOL',
              progression: '',
              progressionPercent: '',
              restSec: '60',
              justLift: false,
              stopAtTop: false,
              intensity: 'none'
            }
          ]
        }
      ]
    ]);

    const planItems = buildPlanItems();
    assert.equal(planItems.length, 2);

    const [grouped, finalSet] = planItems;
    assert.equal(grouped.sets, 2);
    assert.equal(grouped.builderMeta.setCount, 2);
    assert.equal(grouped.builderMeta.totalSets, 3);
    assert.equal(grouped.builderMeta.setIndex, 0);
    assert.equal(grouped.reps, 5);
    assert.equal(grouped.perCableKg, 4.5);
    assert.equal(grouped.restSec, 60);

    assert.equal(finalSet.sets, 1);
    assert.equal(finalSet.builderMeta.setCount, 1);
    assert.equal(finalSet.builderMeta.setIndex, 2);
    assert.equal(finalSet.reps, 6);
  } finally {
    state.weightUnit = originalWeightUnit;
    state.builder.order = originalOrder;
    state.builder.items = new Map(originalItems);
  }
});

test('does not merge consecutive sets when an intensity technique is applied', () => {
  const originalWeightUnit = state.weightUnit;
  const originalOrder = [...state.builder.order];
  const originalItems = new Map(state.builder.items);

  try {
    state.weightUnit = 'KG';
    state.builder.order = ['bench'];
    state.builder.items = new Map([
      [
        'bench',
        {
          exercise: {
            id: 'bench',
            id_new: 201,
            name: 'Bench Press'
          },
          sets: [
            {
              reps: '8',
              weight: '20',
              mode: 'OLD_SCHOOL',
              progression: '',
              progressionPercent: '',
              restSec: '90',
              justLift: false,
              stopAtTop: false,
              intensity: 'dropset'
            },
            {
              reps: '8',
              weight: '20',
              mode: 'OLD_SCHOOL',
              progression: '',
              progressionPercent: '',
              restSec: '90',
              justLift: false,
              stopAtTop: false,
              intensity: 'dropset'
            }
          ]
        }
      ]
    ]);

    const planItems = buildPlanItems();
    assert.equal(planItems.length, 2);

    const [first, second] = planItems;
    assert.equal(first.sets, 1);
    assert.equal(second.sets, 1);
    assert.equal(first.intensity, 'dropset');
    assert.equal(second.intensity, 'dropset');
    assert.equal(first.builderMeta.setIndex, 0);
    assert.equal(second.builderMeta.setIndex, 1);
    assert.equal(first.builderMeta.setCount, 1);
    assert.equal(second.builderMeta.setCount, 1);
    assert.equal(first.builderMeta.totalSets, 2);
    assert.equal(second.builderMeta.totalSets, 2);
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
