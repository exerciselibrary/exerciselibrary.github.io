import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSearchScore, searchExercises, buildSearchEntry } from '../js/search.js';

const FIXTURES = {
  benchPress: {
    id: 'benchPress',
    name: 'Barbell Bench Press',
    muscleGroups: ['Chest'],
    equipment: ['Barbell']
  },
  hingeDrill: {
    id: 'hingeDrill',
    name: 'Hip Extension Drill',
    muscleGroups: ['Posterior Chain'],
    equipment: ['Kettlebell']
  },
  gobletSquat: {
    id: 'gobletSquat',
    name: 'Goblet Squat',
    muscleGroups: ['Posterior Chain'],
    equipment: ['Kettlebell']
  },
  posteriorFocus: {
    id: 'posteriorFocus',
    name: 'Crossover Primer',
    muscleGroups: ['Shoulders'],
    equipment: ['Posteriorchain Focus']
  },
  alphaPress: {
    id: 'alphaPress',
    name: 'Alpha Press',
    muscleGroups: ['Chest'],
    equipment: ['Barbell']
  },
  betaPress: {
    id: 'betaPress',
    name: 'Beta Press',
    muscleGroups: ['Chest'],
    equipment: ['Barbell']
  }
};

test('computeSearchScore prioritises direct matches and applies bonuses', () => {
  const primaryEntry = buildSearchEntry(FIXTURES.benchPress);
  const secondaryEntry = buildSearchEntry(FIXTURES.hingeDrill);
  const fuzzyEntry = buildSearchEntry(FIXTURES.gobletSquat);
  const fallbackEntry = buildSearchEntry(FIXTURES.posteriorFocus);

  const primaryScore = computeSearchScore(primaryEntry, ['bench']);
  const prefixScore = computeSearchScore(primaryEntry, ['ben']);
  const secondaryScore = computeSearchScore(secondaryEntry, ['posterior']);
  const fuzzyScore = computeSearchScore(fuzzyEntry, ['squats']);
  const fallbackScore = computeSearchScore(fallbackEntry, ['posteriorchain focus']);

  assert.ok(primaryScore > secondaryScore, 'primary tokens should outrank secondary matches');
  assert.ok(primaryScore > fuzzyScore, 'primary tokens should outrank fuzzy matches');
  assert.ok(prefixScore < primaryScore, 'prefix matches should score lower than exact matches');
  assert.ok(secondaryScore > fuzzyScore, 'secondary matches should outrank Levenshtein matches');
  assert.ok(fallbackScore > 0, 'fallback substring match should return a positive score');
  assert.ok(fallbackScore < secondaryScore, 'fallback matches should rank below secondary matches');
  assert.ok(fuzzyScore > 0, 'Levenshtein matches should score positively');

  const pairedScore = computeSearchScore(primaryEntry, ['barbell', 'press']);
  const extendedScore = computeSearchScore(primaryEntry, ['barbell', 'press', 'ghost']);

  assert.strictEqual(pairedScore, extendedScore + 6, 'matching every query token should earn the multi-token bonus');
});

test('searchExercises falls back to substring matches scored as 1', () => {
  const fallbackCandidate = {
    id: 'posteriorFocus',
    name: 'Posteriorchain Focus Builder',
    muscleGroups: ['Back'],
    equipment: ['Cable']
  };

  const staleIndex = new Map([
    [
      fallbackCandidate.id,
      {
        id: fallbackCandidate.id,
        nameLower: '',
        nameTokens: [],
        primarySet: new Set(),
        secondarySet: new Set(),
        allTokens: [],
        fallbackFields: []
      }
    ]
  ]);

  const results = searchExercises('posteriorchain focus', [fallbackCandidate], staleIndex);

  assert.deepStrictEqual(results, [
    {
      exercise: fallbackCandidate,
      score: 1
    }
  ]);
});

test('searchExercises orders tied scores alphabetically', () => {
  const candidates = [
    FIXTURES.betaPress,
    FIXTURES.alphaPress,
    FIXTURES.benchPress
  ];

  const results = searchExercises('press', candidates);

  const orderedNames = results.map((result) => result.exercise.name);

  assert.deepStrictEqual(orderedNames, [
    'Alpha Press',
    'Barbell Bench Press',
    'Beta Press'
  ]);
});
