// Persistence helpers: serialize workout state, load from storage, handle share links.
import { STORAGE_KEY, ECHO_LEVELS } from './constants.js';
import { state } from './context.js';
import { setActiveGrouping } from './grouping.js';

export const createSet = () => ({
  id: Math.random().toString(36).slice(2),
  reps: '',
  weight: '',
  mode: 'OLD_SCHOOL',
  echoLevel: ECHO_LEVELS[0].value,
  eccentricPct: 100,
  progression: '',
  progressionPercent: ''
});

export const getBuilderSnapshot = () => ({
  order: [...state.builder.order],
  items: state.builder.order
    .map((id) => {
      const entry = state.builder.items.get(id);
      if (!entry) return null;
      return {
        i: id,
        n: entry.exercise.name,
        g: entry.exercise.muscleGroups || [],
        m: entry.exercise.muscles || [],
        q: entry.exercise.equipment || [],
        s: entry.sets.map((set) => [
          set.reps ?? '',
          set.weight ?? '',
          set.mode || 'OLD_SCHOOL',
          set.echoLevel || ECHO_LEVELS[0].value,
          Number.isFinite(Number.parseInt(set.eccentricPct, 10))
            ? Number.parseInt(set.eccentricPct, 10)
            : 100,
          set.progression ?? '',
          set.progressionPercent ?? ''
        ])
      };
    })
    .filter(Boolean)
});

export const applyBuilderSnapshot = (snapshot) => {
  state.builder.order = [];
  state.builder.items.clear();
  if (!snapshot?.order || !snapshot?.items) return;

  const itemMap = new Map();
  snapshot.items.forEach((item) => {
    if (!item) return;
    if (Array.isArray(item.s)) {
      itemMap.set(item.i || item.id, {
        ...item,
        m: Array.isArray(item.m) ? item.m : []
      });
    } else if (Array.isArray(item.sets)) {
      itemMap.set(item.id, {
        i: item.id,
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
          set.progressionPercent ?? ''
        ])
      });
    }
  });

  snapshot.order.forEach((id) => {
    const item = itemMap.get(id);
    if (!item) return;

    const sets = (item.s || []).map((values) => ({
      id: Math.random().toString(36).slice(2),
      reps: values[0] ?? '',
      weight: values[1] ?? '',
      mode: values[2] || 'OLD_SCHOOL',
      echoLevel: values[3] || ECHO_LEVELS[0].value,
      eccentricPct: Number.isFinite(Number.parseInt(values[4], 10))
        ? Number.parseInt(values[4], 10)
        : 100,
      progression: values[5] ?? '',
      progressionPercent: values[6] ?? ''
    }));
    if (!sets.length) sets.push(createSet());

    const catalogue = state.data.find((ex) => ex.id === id);
    const musclesFromItem = Array.isArray(item.m) ? item.m : [];
    const baseExercise = catalogue || {
      id,
      name: item.n || 'Exercise',
      muscleGroups: item.g || [],
      muscles: musclesFromItem,
      equipment: item.q || [],
      videos: item.v || []
    };
    const exercise = {
      ...baseExercise,
      muscleGroups: baseExercise.muscleGroups || [],
      muscles: Array.isArray(baseExercise.muscles) ? baseExercise.muscles : musclesFromItem,
      equipment: baseExercise.equipment || [],
      videos: baseExercise.videos || []
    };

    state.builder.order.push(id);
    state.builder.items.set(id, {
      exercise: {
        id: exercise.id,
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
        weightUnit: state.weightUnit,
        sortMode: state.sortMode,
        shuffleMode: state.shuffleMode,
        groupByEquipment: state.groupByEquipment,
        groupByMuscles: state.groupByMuscles,
        groupByMuscleGroups: state.groupByMuscleGroups
      }
    };
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
      const snapshot = {
        order: payload.b.o || payload.b.order || [],
        items: payload.b.i || payload.b.items || []
      };
      applyBuilderSnapshot(snapshot);
    } else if (payload?.builder) {
      applyBuilderSnapshot(payload.builder);
      if (payload.flags) {
        state.showWorkoutOnly = Boolean(payload.flags.showWorkoutOnly);
        state.includeCheckboxes = Boolean(payload.flags.includeCheckboxes);
        if (payload.flags.activeTab === 'builder') state.activeTab = 'builder';
        if (payload.flags.weightUnit === 'KG') state.weightUnit = 'KG';
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
