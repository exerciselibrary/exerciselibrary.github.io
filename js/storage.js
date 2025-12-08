// Persistence helpers: serialize workout state, load from storage, handle share links.
import { STORAGE_KEY, ECHO_LEVELS } from './constants.js';
import { state } from './context.js';
import { setActiveGrouping } from './grouping.js';
import { getStoredUnitPreference, setStoredUnitPreference } from '../shared/weight-utils.js';

export const PROGRESSION_MODES = {
  NONE: 'NONE',
  PERCENT: 'PERCENT',
  FLAT: 'FLAT'
};

export const PROGRESSION_FREQUENCIES = {
  WORKOUT: 'WORKOUT',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY'
};

const PROGRESSION_MODE_VALUES = new Set(Object.values(PROGRESSION_MODES));
const PROGRESSION_FREQUENCY_VALUES = new Set(Object.values(PROGRESSION_FREQUENCIES));

export const DEFAULT_PROGRESSION_MODE = PROGRESSION_MODES.PERCENT;
export const DEFAULT_PROGRESSION_FREQUENCY = PROGRESSION_FREQUENCIES.WORKOUT;

const MAX_UNSIGNED_16 = 0xffff;

const normalizeSharedUnitToBuilder = (unit) => {
  if (unit === 'lb') return 'LBS';
  if (unit === 'kg') return 'KG';
  return null;
};

const getSharedWeightUnitPreference = () => {
  if (typeof getStoredUnitPreference !== 'function') return null;
  const stored = getStoredUnitPreference();
  return normalizeSharedUnitToBuilder(stored);
};

const persistSharedWeightUnitPreference = (unit) => {
  if (typeof setStoredUnitPreference !== 'function') return;
  const normalized = unit === 'KG' ? 'kg' : unit === 'LBS' ? 'lb' : null;
  if (!normalized) return;
  setStoredUnitPreference(normalized);
};

const toNumericExerciseId = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const integer = Math.trunc(numeric);
  if (integer !== numeric) return null;
  if (integer < 0 || integer > MAX_UNSIGNED_16) return null;
  return integer;
};

const findCatalogueExercise = (legacyId, numericId) => {
  if (!Array.isArray(state.data)) return null;
  const numeric = toNumericExerciseId(numericId);
  if (numeric !== null) {
    const match = state.data.find((ex) => toNumericExerciseId(ex.id_new) === numeric);
    if (match) return match;
  }
  if (legacyId) {
    return state.data.find((ex) => ex.id === legacyId);
  }
  return null;
};

const attachExerciseIdentifiers = (exercise, identifiers = {}) => {
  const resolved = { ...exercise };
  const numericFromSource = toNumericExerciseId(resolved.id_new);
  const numericFromIdentifiers = toNumericExerciseId(identifiers.numericId);
  if (numericFromIdentifiers !== null) {
    resolved.id_new = numericFromIdentifiers;
  } else if (numericFromSource !== null) {
    resolved.id_new = numericFromSource;
  } else {
    delete resolved.id_new;
  }
  return resolved;
};

export const normalizeProgressionMode = (value) => {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase();
  return PROGRESSION_MODE_VALUES.has(upper) ? upper : null;
};

export const normalizeProgressionFrequency = (value) => {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase();
  return PROGRESSION_FREQUENCY_VALUES.has(upper) ? upper : null;
};

export const createSet = () => ({
  id: Math.random().toString(36).slice(2),
  name: '',
  groupNumber: '',
  reps: '',
  weight: '',
  mode: 'OLD_SCHOOL',
  echoLevel: ECHO_LEVELS[0].value,
  eccentricPct: 100,
  progression: '',
  overloadValue: '',
  progressionPercent: '',
  progressionMode: DEFAULT_PROGRESSION_MODE,
  progressionFrequency: DEFAULT_PROGRESSION_FREQUENCY,
  restSec: '60',
  justLift: false,
  stopAtTop: false,
  intensity: 'none'
});

export const getBuilderSnapshot = () => ({
  order: [...state.builder.order],
  items: state.builder.order
    .map((id) => {
      const entry = state.builder.items.get(id);
      if (!entry) return null;
      const numericId = toNumericExerciseId(entry.exercise?.id_new);
      return {
        i: id,
        ...(numericId !== null ? { ni: numericId } : {}),
        n: entry.exercise.name,
        g: entry.exercise.muscleGroups || [],
        m: entry.exercise.muscles || [],
        q: entry.exercise.equipment || [],
        v: entry.exercise.videos || [],
        s: entry.sets.map((set) => [
          set.reps ?? '',
          set.weight ?? '',
          set.mode || 'OLD_SCHOOL',
          set.echoLevel || ECHO_LEVELS[0].value,
          Number.isFinite(Number.parseInt(set.eccentricPct, 10))
            ? Number.parseInt(set.eccentricPct, 10)
            : 100,
          set.progression ?? '',
          set.progressionPercent ?? '',
          normalizeProgressionMode(set.progressionMode) || DEFAULT_PROGRESSION_MODE,
          normalizeProgressionFrequency(set.progressionFrequency) || DEFAULT_PROGRESSION_FREQUENCY,
          set.restSec ?? '60',
          Boolean(set.justLift),
          Boolean(set.stopAtTop),
          set.overloadValue ?? '',
          set.intensity ?? 'none',
          set.name ?? '',
          set.groupNumber ?? ''
        ])
      };
    })
    .filter(Boolean)
});

const coerceBooleanFlag = (value) => value === true || value === 1 || value === '1' || value === 'true';

const inferProgressionModeFromStoredValues = (set) => {
  if (!set) return PROGRESSION_MODES.NONE;
  if (set.mode === 'ECHO') return PROGRESSION_MODES.NONE;

  const percentValue = typeof set.progressionPercent === 'string' ? set.progressionPercent.trim() : '';
  if (percentValue) return PROGRESSION_MODES.PERCENT;

  const overloadValue = typeof set.overloadValue === 'string' ? set.overloadValue.trim() : '';
  if (overloadValue) return PROGRESSION_MODES.FLAT;

  const legacyProgression = typeof set.progression === 'string' ? set.progression.trim() : '';
  if (legacyProgression) return PROGRESSION_MODES.FLAT;

  return PROGRESSION_MODES.NONE;
};

export const applyBuilderSnapshot = (snapshot) => {
  state.builder.order = [];
  state.builder.items.clear();
  if (!snapshot?.order || !snapshot?.items) return;

  const itemMap = new Map();
  snapshot.items.forEach((item) => {
    if (!item) return;
    if (Array.isArray(item.s)) {
      const numericId = toNumericExerciseId(item.ni ?? item.id_new);
      itemMap.set(item.i || item.id, {
        ...item,
        ni: numericId,
        m: Array.isArray(item.m) ? item.m : []
      });
    } else if (Array.isArray(item.sets)) {
      const numericId = toNumericExerciseId(item.ni ?? item.exercise?.id_new);
      itemMap.set(item.id, {
        i: item.id,
        ni: numericId,
        n: item.exercise?.name,
        g: item.exercise?.muscleGroups || [],
        m: item.exercise?.muscles || [],
        q: item.exercise?.equipment || [],
        s: item.sets.map((set) => [
          set.reps ?? '',
          set.weight ?? '',
          set.mode || 'OLD_SCHOOL',
          set.echoLevel || ECHO_LEVELS[0].value,
          Number.isFinite(Number.parseInt(set.eccentricPct, 10))
            ? Number.parseInt(set.eccentricPct, 10)
            : 100,
          set.progression ?? '',
          set.progressionPercent ?? '',
          normalizeProgressionMode(set.progressionMode) || DEFAULT_PROGRESSION_MODE,
          normalizeProgressionFrequency(set.progressionFrequency) || DEFAULT_PROGRESSION_FREQUENCY,
          set.restSec ?? '60',
          Boolean(set.justLift),
          Boolean(set.stopAtTop),
          set.overloadValue ?? '',
          set.intensity ?? 'none',
          set.name ?? '',
          set.groupNumber ?? ''
        ])
      });
    }
  });

  snapshot.order.forEach((id) => {
    const item = itemMap.get(id);
    if (!item) return;

    const sets = (item.s || []).map((values) => {
      const setValues = Array.isArray(values) ? values : [];
      const legacySet = setValues.length <= 10;
      const restIndex = legacySet ? 7 : 9;
      const justLiftIndex = legacySet ? 8 : 10;
      const stopAtTopIndex = legacySet ? 9 : 11;
      const intensityIndex = legacySet ? null : 13;
      const nameIndex = 14;
      const groupNumberIndex = 15;

      const set = {
        id: Math.random().toString(36).slice(2),
        name: setValues[nameIndex] ?? '',
        groupNumber: setValues[groupNumberIndex] ?? '',
        reps: setValues[0] ?? '',
        weight: setValues[1] ?? '',
        mode: setValues[2] || 'OLD_SCHOOL',
        echoLevel: setValues[3] || ECHO_LEVELS[0].value,
        eccentricPct: Number.isFinite(Number.parseInt(setValues[4], 10))
          ? Number.parseInt(setValues[4], 10)
          : 100,
        progression: setValues[5] ?? '',
        progressionPercent: setValues[6] ?? '',
        progressionMode: PROGRESSION_MODES.NONE,
        progressionFrequency: DEFAULT_PROGRESSION_FREQUENCY,
        restSec: (() => {
          const rawRest = setValues[restIndex];
          if (rawRest === undefined || rawRest === null || rawRest === '') return '60';
          return String(rawRest);
        })(),
        justLift: coerceBooleanFlag(setValues[justLiftIndex]),
        stopAtTop: coerceBooleanFlag(setValues[stopAtTopIndex]),
        overloadValue: ''
      };

      const rawOverload = legacySet ? item?.overloadValue : setValues[12];
      if (typeof rawOverload === 'string' && rawOverload.trim()) {
        set.overloadValue = rawOverload;
      } else if (typeof rawOverload === 'number' && Number.isFinite(rawOverload)) {
        set.overloadValue = String(rawOverload);
      }

      const rawMode = !legacySet && setValues[7] !== undefined ? setValues[7] : item?.progressionMode;
      const normalizedMode = normalizeProgressionMode(rawMode);
      if (normalizedMode) {
        set.progressionMode = normalizedMode;
      } else {
        set.progressionMode = inferProgressionModeFromStoredValues(set);
      }

      const rawFrequency = !legacySet && setValues[8] !== undefined ? setValues[8] : item?.progressionFrequency;
      const normalizedFrequency = normalizeProgressionFrequency(rawFrequency);
      set.progressionFrequency = normalizedFrequency || DEFAULT_PROGRESSION_FREQUENCY;

      const rawIntensity =
        intensityIndex !== null && setValues[intensityIndex] !== undefined
          ? setValues[intensityIndex]
          : item?.intensity;
      if (typeof rawIntensity === 'string' && rawIntensity.trim()) {
        set.intensity = rawIntensity;
      } else {
        set.intensity = 'none';
      }

      return set;
    });
    if (!sets.length) sets.push(createSet());

    const numericId = toNumericExerciseId(item?.ni);
    const catalogue = findCatalogueExercise(id, numericId);
    const musclesFromItem = Array.isArray(item.m) ? item.m : [];
    const baseExercise = catalogue || (() => {
      const fallback = {
        id,
        name: item.n || 'Exercise',
        muscleGroups: item.g || [],
        muscles: musclesFromItem,
        equipment: item.q || [],
        videos: item.v || []
      };
      if (numericId !== null) fallback.id_new = numericId;
      return fallback;
    })();
    const exercise = attachExerciseIdentifiers(
      {
        ...baseExercise,
        muscleGroups: baseExercise.muscleGroups || [],
        muscles: Array.isArray(baseExercise.muscles) ? baseExercise.muscles : musclesFromItem,
        equipment: baseExercise.equipment || [],
        videos: baseExercise.videos || []
      },
      { numericId }
    );

    state.builder.order.push(exercise.id);
    state.builder.items.set(exercise.id, {
      exercise: {
        id: exercise.id,
        id_new: exercise.id_new,
        name: exercise.name,
        muscleGroups: exercise.muscleGroups || [],
        muscles: exercise.muscles || musclesFromItem,
        equipment: exercise.equipment || [],
        videos: exercise.videos || []
      },
      sets
    });
  });
};

export const persistState = (options = {}) => {
  try {
    const snapshot = {
      builder: getBuilderSnapshot(),
      plan: {
        name: state.plan.name || '',
        selectedName: state.plan.selectedName || '',
        schedule: {
          startDate: state.plan.schedule.startDate || null,
          endDate: state.plan.schedule.endDate || null,
          repeatInterval: state.plan.schedule.repeatInterval || 1,
          daysOfWeek: Array.from(state.plan.schedule.daysOfWeek || [])
        }
      },
      flags: {
        showWorkoutOnly: state.showWorkoutOnly,
        includeCheckboxes: state.includeCheckboxes,
        activeTab: state.activeTab,
        activePanel: state.activePanel === 'analytics' ? 'analytics' : 'library',
        weightUnit: state.weightUnit,
        sortMode: state.sortMode,
        shuffleMode: state.shuffleMode,
        groupByEquipment: state.groupByEquipment,
        groupByMuscles: state.groupByMuscles,
        groupByMuscleGroups: state.groupByMuscleGroups
      }
    };
    persistSharedWeightUnitPreference(state.weightUnit);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    if (!options.skipCleanup) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('workout')) {
        url.searchParams.delete('workout');
        history.replaceState({}, '', url.toString());
      }
    }
  } catch (err) {
    console.warn('Persist failed', err);
  }
};

export const loadPersistedState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.plan) {
      state.plan.name = parsed.plan.name || '';
      state.plan.selectedName = parsed.plan.selectedName || '';
      const sched = parsed.plan.schedule || {};
      state.plan.schedule.startDate = sched.startDate || state.plan.schedule.startDate || null;
      state.plan.schedule.endDate = sched.endDate || null;
      const interval = parseInt(sched.repeatInterval, 10);
      state.plan.schedule.repeatInterval = Number.isFinite(interval) && interval > 0 ? interval : 1;
      const days = Array.isArray(sched.daysOfWeek) ? sched.daysOfWeek : [];
      state.plan.schedule.daysOfWeek = new Set(
        days
          .map((val) => Number(val))
          .filter((val) => Number.isInteger(val) && val >= 0 && val <= 6)
      );
    }
    if (parsed?.flags) {
      state.showWorkoutOnly = Boolean(parsed.flags.showWorkoutOnly);
      state.includeCheckboxes = Boolean(parsed.flags.includeCheckboxes);
      state.activePanel = parsed.flags.activePanel === 'analytics' ? 'analytics' : 'library';
      if (parsed.flags.activeTab === 'builder') {
        state.activeTab = 'builder';
      } else {
        state.activeTab = 'library';
      }
      state.weightUnit = parsed.flags.weightUnit === 'KG' ? 'KG' : 'LBS';
      if (parsed.flags.sortMode === 'ZA' || parsed.flags.sortMode === 'AZ') {
        state.sortMode = parsed.flags.sortMode;
      } else if (parsed.flags.sortMode === 'RANDOM') {
        state.sortMode = 'AZ';
        state.shuffleMode = true;
      } else {
        state.sortMode = 'AZ';
      }
      if (Object.prototype.hasOwnProperty.call(parsed.flags, 'shuffleMode')) {
        state.shuffleMode = Boolean(parsed.flags.shuffleMode);
      }
      const equipmentActive = Boolean(parsed.flags.groupByEquipment);
      const musclesActive = Boolean(parsed.flags.groupByMuscles);
      const muscleGroupsActive = Boolean(parsed.flags.groupByMuscleGroups);
      if (equipmentActive) setActiveGrouping('equipment');
      else if (musclesActive) setActiveGrouping('muscles');
      else if (muscleGroupsActive) setActiveGrouping('muscleGroups');
      else setActiveGrouping(null);
    }
    const sharedUnit = getSharedWeightUnitPreference();
    if (sharedUnit) {
      state.weightUnit = sharedUnit;
    }
    persistSharedWeightUnitPreference(state.weightUnit);
    if (parsed?.builder) applyBuilderSnapshot(parsed.builder);
  } catch (err) {
    console.warn('Failed to load saved state', err);
  }
};

const encodeBase64 = (text) => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const decodeBase64 = (text) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
};

const base64UrlEncode = (str) => {
  return encodeBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlDecode = (str) => {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return decodeBase64(base64);
};

export const base64UrlEncodeUtf8 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const applyWorkoutFromParam = (encoded) => {
  try {
    let decoded;
    try {
      decoded = base64UrlDecode(encoded);
    } catch (err) {
      decoded = decodeBase64(encoded);
    }
    const payload = JSON.parse(decoded);

    if (payload?.b) {
      state.weightUnit = payload.u ? 'KG' : 'LBS';
      state.showWorkoutOnly = Boolean(payload.f);
      state.includeCheckboxes = Boolean(payload.c);
      state.activeTab = 'builder';
      state.activePanel = 'library';
      const snapshot = {
        order: payload.b.o || payload.b.order || [],
        items: payload.b.i || payload.b.items || []
      };
      applyBuilderSnapshot(snapshot);
    } else if (payload?.builder) {
      applyBuilderSnapshot(payload.builder);
      state.activePanel = 'library';
      if (payload.flags) {
        state.showWorkoutOnly = Boolean(payload.flags.showWorkoutOnly);
        state.includeCheckboxes = Boolean(payload.flags.includeCheckboxes);
        if (payload.flags.activeTab === 'builder') state.activeTab = 'builder';
        if (payload.flags.weightUnit === 'KG') state.weightUnit = 'KG';
        state.activePanel = payload.flags.activePanel === 'analytics' ? 'analytics' : 'library';
        if (Object.prototype.hasOwnProperty.call(payload.flags, 'groupByEquipment')
          || Object.prototype.hasOwnProperty.call(payload.flags, 'groupByMuscles')
          || Object.prototype.hasOwnProperty.call(payload.flags, 'groupByMuscleGroups')) {
          if (payload.flags.groupByEquipment) setActiveGrouping('equipment');
          else if (payload.flags.groupByMuscles) setActiveGrouping('muscles');
          else if (payload.flags.groupByMuscleGroups) setActiveGrouping('muscleGroups');
          else setActiveGrouping(null);
        }
      }
    }
    persistState({ skipCleanup: true });
  } catch (err) {
    console.warn('Failed to apply workout from link', err);
  }
};
