import { collectTokens, tokenizeSearch, levenshteinDistance } from './utils.js';

export const buildSearchEntry = (exercise) => {
  const name = exercise?.name || '';
  const nameLower = name.toLowerCase();
  const nameTokens = tokenizeSearch(name);
  const primarySet = new Set(nameTokens);

  const attributeSources = [
    exercise?.muscleGroups || [],
    exercise?.muscles || [],
    exercise?.equipment || [],
    exercise?.tags || [],
    exercise?.category || '',
    exercise?.mode || ''
  ];
  const secondaryTokens = collectTokens(attributeSources);
  const secondarySet = new Set(secondaryTokens);

  const allTokens = Array.from(new Set([...nameTokens, ...secondaryTokens]));

  const fallbackFields = [
    nameLower,
    (exercise?.muscleGroups || []).join(' ').toLowerCase(),
    (exercise?.muscles || []).join(' ').toLowerCase(),
    (exercise?.equipment || []).join(' ').toLowerCase()
  ];

  return {
    id: exercise?.id,
    nameLower,
    nameTokens,
    primarySet,
    secondarySet,
    allTokens,
    fallbackFields
  };
};

export const buildSearchIndex = (collection) => {
  const index = new Map();
  for (const item of collection) {
    if (!item?.id) continue;
    index.set(item.id, buildSearchEntry(item));
  }
  return index;
};

export const computeSearchScore = (entry, queryTokens) => {
  if (!entry) return 0;
  let score = 0;
  let matched = 0;

  for (const token of queryTokens) {
    if (!token) continue;
    let tokenScore = 0;

    if (entry.primarySet.has(token)) {
      tokenScore = 14;
    } else {
      if (entry.nameTokens.some((word) => word.startsWith(token))) tokenScore = Math.max(tokenScore, 10);
      if (entry.nameLower.includes(token)) tokenScore = Math.max(tokenScore, 7);
    }

    if (entry.secondarySet.has(token)) {
      tokenScore = Math.max(tokenScore, 8);
    }

    if (!tokenScore && token.length > 2) {
      for (const candidate of entry.allTokens) {
        if (Math.abs(candidate.length - token.length) > 2) continue;
        if (levenshteinDistance(candidate, token) <= 1) {
          tokenScore = 4;
          break;
        }
      }
    }

    if (tokenScore) {
      score += tokenScore;
      matched += 1;
    }
  }

  if (!score) {
    const joined = queryTokens.join(' ');
    if (joined) {
      for (const field of entry.fallbackFields) {
        if (field && field.includes(joined)) {
          score = 6;
          break;
        }
      }
    }
  }

  if (matched > 1 && matched === queryTokens.length) {
    score += 6;
  }

  return score;
};

export const searchExercises = (query, candidates, index) => {
  if (!query.trim()) {
    return candidates.map((exercise) => ({ exercise, score: 0 }));
  }
  const tokens = tokenizeSearch(query);
  if (!tokens.length) {
    return candidates.map((exercise) => ({ exercise, score: 0 }));
  }

  const idx = index || new Map();
  const results = [];
  for (const exercise of candidates) {
    const entry = idx.get(exercise.id) || buildSearchEntry(exercise);
    const score = computeSearchScore(entry, tokens);
    if (score > 0) {
      results.push({ exercise, score });
    }
  }

  if (!results.length) {
    const fallback = candidates.filter((exercise) => {
      const name = (exercise?.name || '').toLowerCase();
      return tokens.every((token) => name.includes(token));
    });
    return fallback.map((exercise) => ({ exercise, score: 1 }));
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = (a.exercise?.name || '').toLowerCase();
    const bn = (b.exercise?.name || '').toLowerCase();
    return an.localeCompare(bn);
  });

  return results;
};
