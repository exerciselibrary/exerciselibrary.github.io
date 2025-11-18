// Custom exercises: manage catalogue merging and normalized payloads.
import { state, setSearchIndex } from './context.js';
import { uniq } from './utils.js';
import { buildSearchIndex } from './search.js';

let baseExercises = [];
let customExercises = [];
let highestNumericId = 0;
let onCatalogueUpdated = null;

const toStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const normalizeSummary = (summary, fallbackMuscles, fallbackEquipment) => {
  const source = typeof summary === 'object' && summary !== null ? summary : {};
  const normalized = {
    muscles: toStringArray(source.muscles),
    equipment: toStringArray(source.equipment)
  };
  if (!normalized.muscles.length) normalized.muscles = [...fallbackMuscles];
  if (!normalized.equipment.length) normalized.equipment = [...fallbackEquipment];
  return normalized;
};

const getNumericId = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const integer = Math.trunc(numeric);
  if (integer < 0) return null;
  return integer;
};

const recomputeHighestId = () => {
  let maxId = 0;
  const scan = (list) => {
    list.forEach((exercise) => {
      const numeric = getNumericId(exercise?.id_new);
      if (numeric !== null && numeric > maxId) {
        maxId = numeric;
      }
    });
  };
  scan(baseExercises);
  scan(customExercises);
  highestNumericId = maxId;
};

const cloneExercise = (exercise, overrides = {}) => ({
  ...exercise,
  muscleGroups: Array.isArray(exercise?.muscleGroups) ? [...exercise.muscleGroups] : [],
  muscles: Array.isArray(exercise?.muscles) ? [...exercise.muscles] : [],
  equipment: Array.isArray(exercise?.equipment) ? [...exercise.equipment] : [],
  summary: {
    muscles: Array.isArray(exercise?.summary?.muscles) ? [...exercise.summary.muscles] : [],
    equipment: Array.isArray(exercise?.summary?.equipment) ? [...exercise.summary.equipment] : []
  },
  ...overrides
});

const sanitizeBaseExercise = (exercise) => {
  if (!exercise || typeof exercise !== 'object') return null;
  const numericId = getNumericId(exercise.id_new);
  return cloneExercise(
    {
      ...exercise,
      id_new: numericId !== null ? numericId : null
    },
    { isCustom: false }
  );
};

const sanitizeCustomExercise = (exercise) => {
  if (!exercise || typeof exercise !== 'object') return null;
  const numericId = getNumericId(exercise.id_new);
  const muscleGroups = toStringArray(exercise.muscleGroups);
  const muscles = toStringArray(exercise.muscles);
  const equipment = toStringArray(exercise.equipment);
  const base = {
    id: typeof exercise.id === 'string' && exercise.id.trim() ? exercise.id.trim() : null,
    id_new: numericId,
    name: typeof exercise.name === 'string' && exercise.name.trim() ? exercise.name.trim() : 'Custom Exercise',
    created: typeof exercise.created === 'string' && exercise.created ? exercise.created : new Date().toISOString(),
    muscleGroups,
    muscles,
    equipment,
    summary: normalizeSummary(exercise.summary, muscleGroups, equipment),
    videos: Array.isArray(exercise.videos) ? [...exercise.videos] : [],
    isCustom: true
  };
  if (!base.id_new || base.id_new <= 0) {
    // Placeholder; we will assign during persistence when necessary.
    base.id_new = null;
  }
  const resolvedId = base.id || (base.id_new !== null ? `custom-${base.id_new}` : null);
  base.id = resolvedId || `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return base;
};

const applyCatalogue = () => {
  state.customExercises = customExercises.map((exercise) => cloneExercise(exercise));
  state.data = [...baseExercises, ...customExercises].map((exercise) => cloneExercise(exercise));
  state.muscles = uniq(state.data.flatMap((ex) => ex.muscleGroups || []));
  state.subMuscles = uniq(state.data.flatMap((ex) => ex.muscles || []));
  state.equipment = uniq(state.data.flatMap((ex) => ex.equipment || []));
  state.randomOrderMap = null;
  setSearchIndex(buildSearchIndex(state.data));
  if (typeof onCatalogueUpdated === 'function') {
    onCatalogueUpdated(state.data);
  }
};

export const registerCustomExerciseListeners = ({ onCatalogueUpdated: handler } = {}) => {
  onCatalogueUpdated = typeof handler === 'function' ? handler : null;
};

export const setBaseExercises = (list = []) => {
  baseExercises = list.map((exercise) => sanitizeBaseExercise(exercise)).filter(Boolean);
  recomputeHighestId();
  applyCatalogue();
};

export const setCustomExercises = (list = []) => {
  customExercises = list.map((exercise) => sanitizeCustomExercise(exercise)).filter(Boolean);
  recomputeHighestId();
  applyCatalogue();
};

export const clearCustomExercises = () => {
  if (!customExercises.length) {
    return;
  }
  customExercises = [];
  recomputeHighestId();
  applyCatalogue();
};

export const getCustomExercises = () => customExercises.map((exercise) => cloneExercise(exercise));

export const getNextCustomNumericId = () => {
  highestNumericId = Math.max(highestNumericId + 1, 1);
  return highestNumericId;
};

export const buildCustomExerciseEntry = ({ name, muscleGroups, muscles, equipment }) => {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const finalName = trimmedName || 'Custom Exercise';
  const groupList = toStringArray(muscleGroups);
  const muscleList = toStringArray(muscles);
  const equipmentList = toStringArray(equipment);
  const id_new = getNextCustomNumericId();
  return {
    id: `custom-${id_new}`,
    id_new,
    name: finalName,
    created: new Date().toISOString(),
    muscleGroups: groupList,
    muscles: muscleList,
    equipment: equipmentList,
    summary: {
      muscles: groupList.slice(),
      equipment: equipmentList.slice()
    },
    videos: [],
    isCustom: true
  };
};

export const getDropboxPayloadForCustomExercises = (list = customExercises) =>
  (Array.isArray(list) ? list : []).map((exercise) => ({
    id: exercise.id,
    id_new: exercise.id_new,
    name: exercise.name,
    created: exercise.created,
    muscleGroups: [...(exercise.muscleGroups || [])],
    muscles: [...(exercise.muscles || [])],
    equipment: [...(exercise.equipment || [])],
    summary: {
      muscles: [...(exercise.summary?.muscles || [])],
      equipment: [...(exercise.summary?.equipment || [])]
    },
    videos: Array.isArray(exercise.videos) ? [...exercise.videos] : []
  }));
