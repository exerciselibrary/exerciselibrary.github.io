// Workout builder feature: manages workout state, builder UI, and related actions.
import {
  MAX_CABLE_WEIGHT,
  MAX_CABLE_WEIGHT_KG,
  MODE_OPTIONS,
  MODE_LABELS,
  ECHO_LEVELS,
  SHARE_ICON_HTML,
  SHARE_SUCCESS_HTML,
  SHARE_ERROR_HTML,
  KG_PER_LB
} from './constants.js';
import { state, els, setDragDidDrop, getDragDidDrop } from './context.js';
import { niceName, formatWeight, convertWeightValue, createWorkbookXlsx } from './utils.js';
import { MUSCLE_COVERAGE, MUSCLE_ALIAS_LOOKUP, normalizeMuscleName } from './muscles.js';
import {
  getActiveGrouping,
  setActiveGrouping,
  getGroupingClusters,
  getGroupColor,
  applyGrouping,
  shuffleBuilderOrder,
  GROUPING_LABELS
} from './grouping.js';
import {
  createSet,
  getBuilderSnapshot,
  persistState,
  base64UrlEncodeUtf8
} from './storage.js';

let renderCallback = null;
let planNameDebounceId = null;
const PLAN_NAME_DEBOUNCE_MS = 200;

export const registerRenderHandler = (fn) => {
  renderCallback = fn;
};

const triggerRender = () => {
  if (typeof renderCallback === 'function') {
    renderCallback();
  }
};

const propagateSetValue = (entry, startIndex, apply) => {
  if (!entry || !Array.isArray(entry.sets)) return;
  for (let i = startIndex + 1; i < entry.sets.length; i += 1) {
    apply(entry.sets[i], i);
  }
};

const MAX_SCHEDULE_OCCURRENCES = 12;
const DEFAULT_PLAN_NAME = 'Workout Plan';
const PROGRAM_MODE_MAP = {
  OLD_SCHOOL: 0,
  PUMP: 1,
  TIME_UNDER_TENSION: 2,
  ECCENTRIC: 4
};
const PROGRAM_MODE_REVERSE_MAP = Object.entries(PROGRAM_MODE_MAP).reduce((acc, [key, value]) => {
  acc[value] = key;
  return acc;
}, {});
const PROGRESSIVE_OVERLOAD_TOOLTIP =
  'Increase the percent lifted per workout for this exercise. Only applies on new days where you do this exercise.';

const OCCURRENCE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric'
});

const formatISODate = (date) => {
  if (!(date instanceof Date)) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const sanitizePlanNameForSync = (name) => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    return DEFAULT_PLAN_NAME;
  }

  const withoutLeadingDates = trimmed.replace(/^(?:\d{4}-\d{2}-\d{2}\s+)+/, '').trim();
  if (withoutLeadingDates) {
    return withoutLeadingDates;
  }

  return DEFAULT_PLAN_NAME;
};

const parseISODate = (value) => {
  if (typeof value !== 'string' || !value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10) - 1;
  const day = Number.parseInt(dayStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const clampPositiveInt = (value, fallback = 1) => {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const computeScheduleOccurrences = (schedule) => {
  const occurrences = [];
  if (!schedule) return occurrences;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = parseISODate(schedule.startDate);
  const base = start || today;
  const end = parseISODate(schedule.endDate);
  const interval = clampPositiveInt(schedule.repeatInterval, 1);

  const defaultDayRef = start && start > today ? start : today;
  const dayValues =
    schedule.daysOfWeek && schedule.daysOfWeek.size
      ? Array.from(schedule.daysOfWeek)
          .map((day) => Number(day))
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [defaultDayRef.getDay()];

  const days = Array.from(new Set(dayValues)).sort((a, b) => a - b);

  const cursor =
    start && start > today ? new Date(start) : new Date(today);
  let iterations = 0;

  while (occurrences.length < MAX_SCHEDULE_OCCURRENCES && iterations < 1000) {
    if (end && cursor > end) break;

    const diffDays = Math.floor((cursor - base) / 86400000);
    const weekIndex = Math.floor(diffDays / 7);

    if (weekIndex % interval === 0 && days.includes(cursor.getDay())) {
      occurrences.push(new Date(cursor));
    }

    cursor.setDate(cursor.getDate() + 1);
    iterations += 1;
  }

  return occurrences;
};

const toPerCableKg = (value) => {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  return state.weightUnit === 'LBS' ? num * KG_PER_LB : num;
};

const roundKg = (value) => Math.round(value * 1000) / 1000;

const sanitizeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseReps = (value) => {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num >= 0 ? num : 0;
};

const clamp = (value, min, max) => {
  return Math.min(Math.max(value, min), max);
};

const convertAllWeights = (newUnit) => {
  const previous = state.weightUnit;
  if (previous === newUnit) return;
  state.builder.items.forEach((entry) => {
    entry.sets.forEach((set) => {
      if (set.weight) {
        set.weight = convertWeightValue(set.weight, previous, newUnit);
      }
      if (set.progression) {
        set.progression = convertWeightValue(set.progression, previous, newUnit);
      }
    });
  });
};

export const updateUnitToggle = () => {
  if (!els.unitToggle) return;
  const label = state.weightUnit === 'LBS' ? 'Units: lbs' : 'Units: kg';
  els.unitToggle.textContent = label;
  els.unitToggle.title = `Switch to ${state.weightUnit === 'LBS' ? 'kilograms' : 'pounds'}`;
};

export const toggleWeightUnit = () => {
  const newUnit = state.weightUnit === 'LBS' ? 'KG' : 'LBS';
  convertAllWeights(newUnit);
  state.weightUnit = newUnit;
  updateUnitToggle();
  persistState();
  triggerRender();
};

const getWeightLabel = () => (state.weightUnit === 'LBS' ? 'lbs' : 'kg');

export const setPlanName = (value, options = {}) => {
  const name = typeof value === 'string' ? value : '';
  state.plan.name = name;
  if (options.fromSelection) {
    state.plan.selectedName = name;
  }

  if (els.planNameSelect) {
    const available = state.availablePlans || [];
    const target = state.plan.name && available.includes(state.plan.name) ? state.plan.name : '';
    if (els.planNameSelect.value !== target) {
      els.planNameSelect.value = target;
    }
  }

  if (els.planNameInput && els.planNameInput.value !== name) {
    els.planNameInput.value = name;
  }

  if (planNameDebounceId) {
    clearTimeout(planNameDebounceId);
  }
  planNameDebounceId = setTimeout(() => {
    persistState();
    triggerRender();
    planNameDebounceId = null;
  }, PLAN_NAME_DEBOUNCE_MS);
};

export const flushPlanNameDebounce = () => {
  if (planNameDebounceId) {
    clearTimeout(planNameDebounceId);
    planNameDebounceId = null;
    persistState();
    triggerRender();
  }
};

export const setScheduleStart = (value) => {
  state.plan.schedule.startDate = value || '';
  persistState();
  triggerRender();
};

export const setScheduleEnd = (value) => {
  state.plan.schedule.endDate = value || '';
  persistState();
  triggerRender();
};

export const setScheduleInterval = (value) => {
  state.plan.schedule.repeatInterval = clampPositiveInt(value, 1);
  persistState();
  triggerRender();
};

export const toggleScheduleDay = (day) => {
  const numeric = Number(day);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 6) return;
  const days = state.plan.schedule.daysOfWeek;
  if (days.has(numeric)) {
    days.delete(numeric);
  } else {
    days.add(numeric);
  }
  persistState();
  triggerRender();
};

const getModeLabel = (set) => {
  if (!set) return '';
  if (set.mode === 'ECHO') {
    const level = ECHO_LEVELS.find((opt) => opt.value === set.echoLevel) || ECHO_LEVELS[0];
    return `${MODE_LABELS.ECHO} - ${level.label}`;
  }
  return MODE_LABELS[set.mode] || MODE_LABELS.OLD_SCHOOL;
};

export const buildPlanItems = () => {
  const items = [];

  state.builder.order.forEach((exerciseId, orderIndex) => {
    const entry = state.builder.items.get(exerciseId);
    if (!entry) return;

    const exerciseName = entry.exercise?.name || 'Exercise';
    const sets = Array.isArray(entry.sets) ? entry.sets : [];
    if (!sets.length) return;

    const videos = Array.isArray(entry.exercise?.videos) ? entry.exercise.videos : [];
    const baseMeta = {
      exerciseId,
      exerciseName,
      videos,
      order: orderIndex,
      totalSets: sets.length
    };

    sets.forEach((set, setIndex) => {
      const mode = set.mode || 'OLD_SCHOOL';
      const displayName = exerciseName;
      const setData = {
        reps: set.reps ?? '',
        weight: set.weight ?? '',
        mode,
        echoLevel: set.echoLevel || ECHO_LEVELS[0].value,
        eccentricPct: String(
          Number.isFinite(Number.parseInt(set.eccentricPct, 10))
            ? Number.parseInt(set.eccentricPct, 10)
            : 100
        ),
        progression: set.progression ?? '',
        progressionPercent: set.progressionPercent ?? ''
      };
      const builderMeta = {
        ...baseMeta,
        setIndex,
        setData
      };

      if (mode === 'ECHO') {
        const levelIndex = (() => {
          const idx = ECHO_LEVELS.findIndex((opt) => opt.value === set.echoLevel);
          return idx >= 0 ? idx : 0;
        })();

        let eccentric = Number.parseInt(set.eccentricPct, 10);
        if (!Number.isFinite(eccentric)) {
          eccentric = 100;
        }
        eccentric = clamp(eccentric, 100, 130);
        eccentric = 100 + Math.round((eccentric - 100) / 5) * 5;

        items.push({
          type: 'echo',
          name: displayName,
          level: levelIndex,
          eccentricPct: eccentric,
          targetReps: 0,
          sets: 1,
          restSec: 60,
          justLift: true,
          stopAtTop: false,
          videos,
          builderMeta
        });
      } else {
        const perCableKg = roundKg(Math.max(0, toPerCableKg(set.weight)));
        const modeCode = PROGRAM_MODE_MAP[mode] ?? PROGRAM_MODE_MAP.OLD_SCHOOL;
        const progressionDisplay = set.progression || '';
        let progressionKg = 0;
        const progressionNumber = Number.parseFloat(progressionDisplay);
        if (Number.isFinite(progressionNumber)) {
          progressionKg = clamp(roundKg(toPerCableKg(progressionNumber)), -3, 3);
        }
        const parsedPercent = Number.parseFloat(set.progressionPercent);
        const progressionPercent = Number.isFinite(parsedPercent) ? clamp(parsedPercent, -100, 400) : null;

        items.push({
          type: 'exercise',
          name: displayName,
          mode: modeCode,
          perCableKg,
          reps: parseReps(set.reps),
          sets: 1,
          restSec: 60,
          progressionKg,
          progressionDisplay: progressionDisplay || '',
          progressionUnit: state.weightUnit,
          progressionPercent,
          justLift: false,
          stopAtTop: false,
          cables: 2,
          videos,
          builderMeta
        });
      }
    });
  });

  return items;
};

const formatWeightForUnit = (kgValue) => {
  const numeric = Number(kgValue);
  if (!Number.isFinite(numeric)) return '';
  const targetUnit = state.weightUnit === 'LBS' ? 'LBS' : 'KG';
  let convertedValue;
  if (targetUnit === 'LBS') {
    convertedValue = numeric * LB_PER_KG;
  } else {
    convertedValue = numeric;
  }
  if (!Number.isFinite(convertedValue)) return '';
  const decimals = targetUnit === 'LBS' ? 1 : 1;
  return convertedValue.toFixed(decimals);
};

const createEntryFromPlanItem = (item, index) => {
  const entryId = `plan-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
  const fallbackName = item && typeof item.name === 'string' && item.name.trim()
    ? item.name.trim()
    : `Plan Item ${index + 1}`;
  const meta = item && typeof item.builderMeta === 'object' ? item.builderMeta : null;
  const exerciseName = meta?.exerciseName && typeof meta.exerciseName === 'string'
    ? meta.exerciseName.trim() || fallbackName
    : fallbackName;
  const sourceVideos = Array.isArray(item?.videos)
    ? item.videos
    : Array.isArray(meta?.videos)
      ? meta.videos
      : [];
  const exerciseId =
    meta && typeof meta.exerciseId === 'string' && meta.exerciseId.trim()
      ? meta.exerciseId.trim()
      : entryId;

  const baseExercise = {
    id: exerciseId,
    name: exerciseName,
    muscleGroups: [],
    muscles: [],
    equipment: [],
    videos: sourceVideos
  };

  const modeValue = Number.isFinite(Number(item?.mode)) ? Number(item.mode) : null;

  const buildSet = () => {
    const set = createSet();
    const setData = meta && meta.setData ? meta.setData : {};

    if (item?.type === 'echo') {
      set.mode = 'ECHO';
      const levelOption =
        typeof setData.echoLevel === 'string' && ECHO_LEVELS.some((opt) => opt.value === setData.echoLevel)
          ? setData.echoLevel
          : Number.isInteger(item.level) && ECHO_LEVELS[item.level]
            ? ECHO_LEVELS[item.level].value
            : ECHO_LEVELS[0].value;
      set.echoLevel = levelOption;
      const eccentric =
        typeof setData.eccentricPct === 'string'
          ? setData.eccentricPct
          : String(Number.isFinite(Number(item.eccentricPct)) ? Number(item.eccentricPct) : 100);
      set.eccentricPct = eccentric;
      const repsValue =
        typeof setData.reps === 'string'
          ? setData.reps
          : String(Number.isFinite(Number(item?.targetReps)) ? Number(item.targetReps) : '');
      set.reps = item?.justLift ? '' : repsValue;
      set.weight = typeof setData.weight === 'string' ? setData.weight : '';
      set.progression = typeof setData.progression === 'string' ? setData.progression : '';
      set.progressionPercent =
        typeof setData.progressionPercent === 'string' ? setData.progressionPercent : '';
    } else {
      const metaMode = typeof setData.mode === 'string' ? setData.mode : null;
      const builderMode =
        metaMode ||
        (modeValue != null && Object.prototype.hasOwnProperty.call(PROGRAM_MODE_REVERSE_MAP, modeValue)
          ? PROGRAM_MODE_REVERSE_MAP[modeValue]
          : 'OLD_SCHOOL');
      set.mode = builderMode;
      const repsValue =
        typeof setData.reps === 'string'
          ? setData.reps
          : Number.isFinite(Number(item?.reps))
            ? String(Number(item.reps))
            : '';
      set.reps = item?.justLift ? '' : repsValue;
      set.weight =
        typeof setData.weight === 'string'
          ? setData.weight
          : formatWeightForUnit(item?.perCableKg);
      set.progression =
        typeof setData.progression === 'string'
          ? setData.progression
          : (() => {
              const progressionKg = Number.isFinite(Number(item?.progressionKg))
                ? Number(item.progressionKg)
                : null;
              return progressionKg == null ? '' : formatWeightForUnit(progressionKg);
            })();
      set.progressionPercent =
        typeof setData.progressionPercent === 'string'
          ? setData.progressionPercent
          : Number.isFinite(Number(item?.progressionPercent))
            ? String(Number(item.progressionPercent))
            : '';
    }
    return set;
  };

  const totalSets = Number.isFinite(Number(item?.sets)) ? Math.max(1, Number(item.sets)) : 1;
  const sets = [];
  for (let i = 0; i < totalSets; i += 1) {
    sets.push(buildSet());
  }

  return {
    id: entryId,
    exercise: baseExercise,
    sets
  };
};

export const setAvailablePlanNames = (names = []) => {
  const unique = Array.from(new Set(names.filter((n) => typeof n === 'string' && n.trim()))).sort((a, b) => a.localeCompare(b));
  state.availablePlans = unique;

  if (els.planNameSelect) {
    const currentValue = els.planNameSelect.value;
    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = unique.length ? 'Select a plan…' : 'No saved plans';
    fragment.appendChild(placeholder);
    unique.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      fragment.appendChild(option);
    });
    els.planNameSelect.innerHTML = '';
    els.planNameSelect.appendChild(fragment);

    const desired = state.plan.name && unique.includes(state.plan.name) ? state.plan.name : '';
    els.planNameSelect.value = desired || (currentValue && unique.includes(currentValue) ? currentValue : '');
  }
};

export const loadPlanIntoBuilder = (planItems = [], options = {}) => {
  if (!Array.isArray(planItems)) {
    return;
  }

  state.builder.order = [];
  state.builder.items.clear();

  const grouped = new Map();
  const legacyItems = [];

  planItems.forEach((item, index) => {
    if (!item) return;
    const meta = item && typeof item.builderMeta === 'object' ? item.builderMeta : null;
    if (meta && typeof meta.exerciseId === 'string' && meta.exerciseId.trim()) {
      const exerciseId = meta.exerciseId.trim();
      if (!grouped.has(exerciseId)) {
        grouped.set(exerciseId, {
          meta,
          items: []
        });
      }
      grouped.get(exerciseId).items.push({ item, index, meta });
    } else {
      legacyItems.push({ item, index });
    }
  });

  const combinedEntries = [];

  grouped.forEach((group, exerciseId) => {
    const order = Number.isFinite(Number(group.meta?.order))
      ? Number(group.meta.order)
      : group.items[0]?.index ?? 0;
    combinedEntries.push({ type: 'group', order, exerciseId, group });
  });

  legacyItems.forEach(({ item, index }) => {
    combinedEntries.push({ type: 'legacy', order: index, item, index });
  });

  combinedEntries
    .sort((a, b) => a.order - b.order)
    .forEach((entry) => {
      if (entry.type === 'group') {
        const { group, exerciseId } = entry;
        const primaryItem = group.items[0];
        const videos = Array.isArray(group.meta?.videos)
          ? group.meta.videos
          : Array.isArray(primaryItem.item?.videos)
            ? primaryItem.item.videos
            : [];
        const exerciseName = group.meta?.exerciseName || primaryItem.item?.name || `Exercise`;
        const catalogue = state.data?.find ? state.data.find((ex) => ex.id === exerciseId) : null;
        const resolvedExercise = catalogue
          ? {
              ...catalogue,
              videos: videos.length ? videos : Array.isArray(catalogue.videos) ? catalogue.videos : []
            }
          : {
              id: exerciseId,
              name: exerciseName,
              muscleGroups: [],
              muscles: [],
              equipment: [],
              videos
            };

        const sortedSets = group.items
          .slice()
          .sort((a, b) => {
            const idxA = Number.isFinite(Number(a.meta?.setIndex)) ? Number(a.meta.setIndex) : a.index;
            const idxB = Number.isFinite(Number(b.meta?.setIndex)) ? Number(b.meta.setIndex) : b.index;
            return idxA - idxB;
          })
          .map(({ meta: itemMeta, item }) => {
            const set = createSet();
            const setData = itemMeta.setData || {};
            const type = item?.type === 'echo' || setData.mode === 'ECHO' ? 'ECHO' : 'PROGRAM';

            if (type === 'ECHO') {
              set.mode = 'ECHO';
              const levelValue =
                typeof setData.echoLevel === 'string' && ECHO_LEVELS.some((opt) => opt.value === setData.echoLevel)
                  ? setData.echoLevel
                  : set.echoLevel;
              set.echoLevel = levelValue;
              set.eccentricPct = typeof setData.eccentricPct === 'string' ? setData.eccentricPct : set.eccentricPct;
            } else {
              set.mode = typeof setData.mode === 'string' ? setData.mode : set.mode;
            }

            set.reps = typeof setData.reps === 'string' ? setData.reps : set.reps;
            set.weight = typeof setData.weight === 'string' ? setData.weight : set.weight;
            set.progression = typeof setData.progression === 'string' ? setData.progression : set.progression;
            set.progressionPercent =
              typeof setData.progressionPercent === 'string'
                ? setData.progressionPercent
                : set.progressionPercent;

            return set;
          });

        const sets = sortedSets.length ? sortedSets : [createSet()];

        state.builder.order.push(resolvedExercise.id);
        state.builder.items.set(resolvedExercise.id, {
          exercise: {
            id: resolvedExercise.id,
            name: resolvedExercise.name,
            muscleGroups: resolvedExercise.muscleGroups || [],
            muscles: Array.isArray(resolvedExercise.muscles) ? resolvedExercise.muscles : [],
            equipment: Array.isArray(resolvedExercise.equipment) ? resolvedExercise.equipment : [],
            videos: resolvedExercise.videos || []
          },
          sets
        });
      } else {
        const { item, index } = entry;
        const legacyEntry = createEntryFromPlanItem(item, index);
        state.builder.order.push(legacyEntry.exercise.id);
        state.builder.items.set(legacyEntry.exercise.id, {
          exercise: legacyEntry.exercise,
          sets: legacyEntry.sets
        });
      }
    });

  triggerRender();
  persistState();
};

const updateScheduleCalendar = () => {
  if (!els.scheduleCalendar) return;

  const container = els.scheduleCalendar;
  const planItems = buildPlanItems();

  if (!planItems.length) {
    container.innerHTML = '<div class="schedule-entry muted small">Add exercises to preview your training calendar.</div>';
    return;
  }

  const occurrences = computeScheduleOccurrences(state.plan.schedule);
  if (!occurrences.length) {
    container.innerHTML = '<div class="schedule-entry muted small">Select a start date or training days to generate a schedule.</div>';
    return;
  }

  const baseName = state.plan.name.trim() || DEFAULT_PLAN_NAME;
  const setCount = planItems.length;
  container.innerHTML = occurrences
    .map((date) => {
      const label = OCCURRENCE_FORMATTER.format(date);
      const details = `${baseName} • ${setCount} set${setCount === 1 ? '' : 's'}`;
      return `<div class="schedule-entry"><span class="date">${label}</span><span class="details">${details}</span></div>`;
    })
    .join('');
};

export const syncPlanControls = () => {
  if (els.planNameSelect) {
    const desired = state.plan.name || '';
    if (els.planNameSelect.value !== desired) {
      const available = state.availablePlans || [];
      if (desired && !available.includes(desired)) {
        els.planNameSelect.value = '';
      } else {
        els.planNameSelect.value = desired;
      }
    }
  }

  if (els.planNameInput && els.planNameInput.value !== state.plan.name) {
    els.planNameInput.value = state.plan.name || '';
  }

  if (els.scheduleStart) {
    const start = state.plan.schedule.startDate || '';
    const picker = els.scheduleStart._flatpickr;
    if (picker) {
      if (start) {
        if (picker.input.value !== start) {
          picker.setDate(start, false);
        }
      } else if (picker.input.value !== '') {
        picker.clear();
      }
    } else if (els.scheduleStart.value !== start) {
      els.scheduleStart.value = start;
    }
  }

  if (els.scheduleEnd) {
    const end = state.plan.schedule.endDate || '';
    const picker = els.scheduleEnd._flatpickr;
    if (picker) {
      if (end) {
        if (picker.input.value !== end) {
          picker.setDate(end, false);
        }
      } else if (picker.input.value !== '') {
        picker.clear();
      }
    } else if (els.scheduleEnd.value !== end) {
      els.scheduleEnd.value = end;
    }
  }

  if (els.scheduleInterval) {
    const intervalValue = String(state.plan.schedule.repeatInterval || 1);
    if (els.scheduleInterval.value !== intervalValue) {
      els.scheduleInterval.value = intervalValue;
    }
  }

  if (els.scheduleDays) {
    const days = state.plan.schedule.daysOfWeek;
    els.scheduleDays
      .querySelectorAll('button[data-day]')
      .forEach((button) => {
        const day = Number(button.dataset.day);
        const active = days.has(day);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
  }
};

export const renderSchedulePreview = () => {
  updateScheduleCalendar();
};

export const renderSetRow = (exerciseId, set, index) => {
  const entry = state.builder.items.get(exerciseId);
  const tr = document.createElement('tr');

  if (!Number.isFinite(Number.parseInt(set.eccentricPct, 10))) {
    set.eccentricPct = 100;
  }
  if (set.progression === undefined || set.progression === null) {
    set.progression = '';
  }
  if (set.progressionPercent === undefined || set.progressionPercent === null) {
    set.progressionPercent = '';
  }

  const setCell = document.createElement('td');
  setCell.textContent = index + 1;

  if (!set.mode) set.mode = 'OLD_SCHOOL';
  if (!set.echoLevel) set.echoLevel = ECHO_LEVELS[0].value;

  const modeCell = document.createElement('td');
  modeCell.className = 'mode-cell';
  const modeSelect = document.createElement('select');
  MODE_OPTIONS.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = set.mode === opt.value;
    modeSelect.appendChild(option);
  });
  modeCell.appendChild(modeSelect);

  const echoSelect = document.createElement('select');
  echoSelect.className = 'mode-echo-select';
  ECHO_LEVELS.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = set.echoLevel === opt.value;
    echoSelect.appendChild(option);
  });
  echoSelect.addEventListener('change', () => {
    set.echoLevel = echoSelect.value;
    persistState();
  });
  const echoWrapper = document.createElement('div');
  echoWrapper.className = 'mode-echo';
  echoWrapper.appendChild(echoSelect);

  const repsCell = document.createElement('td');
  const repsInput = document.createElement('input');
  repsInput.type = 'number';
  repsInput.min = '0';
  repsInput.placeholder = 'e.g. 12';
  repsInput.value = set.reps;
  repsInput.addEventListener('input', () => {
    set.reps = repsInput.value;
  });
  repsInput.addEventListener('change', () => {
    const newValue = repsInput.value;
    set.reps = newValue;
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.reps !== newValue) {
        target.reps = newValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  const repsWrapper = document.createElement('div');
  repsWrapper.appendChild(repsInput);
  repsCell.appendChild(repsWrapper);

  const eccentricWrapper = document.createElement('div');
  eccentricWrapper.className = 'eccentric-select';
  eccentricWrapper.style.display = 'none';
  const eccentricSelect = document.createElement('select');
  for (let pct = 100; pct <= 130; pct += 5) {
    const option = document.createElement('option');
    option.value = String(pct);
    option.textContent = `${pct}%`;
    if (Number.parseInt(set.eccentricPct, 10) === pct) {
      option.selected = true;
    }
    eccentricSelect.appendChild(option);
  }
  eccentricSelect.addEventListener('change', () => {
    const value = Number.parseInt(eccentricSelect.value, 10);
    set.eccentricPct = Number.isFinite(value) ? value : 100;
    persistState();
  });
  eccentricWrapper.appendChild(eccentricSelect);
  repsCell.appendChild(eccentricWrapper);

  const weightCell = document.createElement('td');
  const weightInput = document.createElement('input');
  weightInput.type = 'number';
  weightInput.min = '0';
  weightInput.max = String(state.weightUnit === 'LBS' ? MAX_CABLE_WEIGHT : MAX_CABLE_WEIGHT_KG);
  weightInput.step = state.weightUnit === 'KG' ? '0.1' : '0.5';
  weightInput.placeholder = getWeightLabel();
  weightInput.value = set.weight;
  const applyWeightValue = () => {
    const max = state.weightUnit === 'LBS' ? MAX_CABLE_WEIGHT : MAX_CABLE_WEIGHT_KG;
    const value = Number(weightInput.value || 0);
    if (value > max) {
      weightInput.value = String(max);
      set.weight = String(max);
    } else {
      set.weight = weightInput.value;
    }
    return set.weight;
  };
  weightInput.addEventListener('input', () => {
    applyWeightValue();
  });
  weightInput.addEventListener('change', () => {
    const finalValue = applyWeightValue();
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.weight !== finalValue) {
        target.weight = finalValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  const weightWrapper = document.createElement('div');
  weightWrapper.appendChild(weightInput);
  weightCell.appendChild(weightWrapper);
  const echoNote = document.createElement('span');
  echoNote.className = 'muted';
  echoNote.textContent = 'Not used for Echo Mode';

  const progressionCell = document.createElement('td');
  const progressionInput = document.createElement('input');
  progressionInput.type = 'number';
  progressionInput.step = weightInput.step;
  progressionInput.min = '-100';
  progressionInput.max = weightInput.max;
  progressionInput.placeholder = `Δ ${getWeightLabel()}`;
  progressionInput.value = set.progression;
  progressionInput.addEventListener('input', () => {
    set.progression = progressionInput.value;
  });
  progressionInput.addEventListener('change', () => {
    const finalValue = progressionInput.value;
    set.progression = finalValue;
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.progression !== finalValue) {
        target.progression = finalValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  const progressionWrapper = document.createElement('div');
  progressionWrapper.appendChild(progressionInput);
  progressionCell.appendChild(progressionWrapper);

  const progressionPercentCell = document.createElement('td');
  const progressionPercentInput = document.createElement('input');
  progressionPercentInput.type = 'number';
  progressionPercentInput.step = '0.5';
  progressionPercentInput.min = '-100';
  progressionPercentInput.max = '400';
  progressionPercentInput.placeholder = '%';
  progressionPercentInput.value = set.progressionPercent;
  progressionPercentInput.title = PROGRESSIVE_OVERLOAD_TOOLTIP;
  progressionPercentInput.addEventListener('input', () => {
    set.progressionPercent = progressionPercentInput.value;
  });
  progressionPercentInput.addEventListener('change', () => {
    const finalValue = progressionPercentInput.value;
    set.progressionPercent = finalValue;
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.progressionPercent !== finalValue) {
        target.progressionPercent = finalValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  const progressionPercentWrapper = document.createElement('div');
  progressionPercentWrapper.appendChild(progressionPercentInput);
  progressionPercentCell.appendChild(progressionPercentWrapper);

  const updateWeightVisibility = () => {
    const isEcho = set.mode === 'ECHO';
    if (isEcho) {
      weightWrapper.style.display = 'none';
      progressionWrapper.style.display = 'none';
      progressionPercentWrapper.style.display = 'none';
      if (!modeCell.contains(echoWrapper)) modeCell.appendChild(echoWrapper);
      if (!echoNote.parentElement) weightCell.appendChild(echoNote);
    } else {
      weightWrapper.style.display = '';
      progressionWrapper.style.display = '';
      progressionPercentWrapper.style.display = '';
      if (echoWrapper.parentElement === modeCell) echoWrapper.remove();
      if (echoNote.parentElement === weightCell) echoNote.remove();
      weightInput.value = set.weight || '';
      progressionInput.value = set.progression || '';
      progressionPercentInput.value = set.progressionPercent || '';
    }
  };

  const updateRepEditor = () => {
    const isEcho = set.mode === 'ECHO';
    repsWrapper.style.display = isEcho ? 'none' : '';
    eccentricWrapper.style.display = isEcho ? '' : 'none';
  };

  modeSelect.addEventListener('change', () => {
    set.mode = modeSelect.value;
    if (set.mode === 'ECHO' && !Number.isFinite(Number.parseInt(set.eccentricPct, 10))) {
      set.eccentricPct = 100;
    }
    persistState();
    triggerRender();
  });

  updateWeightVisibility();
  updateRepEditor();

  const actionsCell = document.createElement('td');
  actionsCell.className = 'set-actions';
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn danger small';
  removeBtn.textContent = 'Delete';
  removeBtn.addEventListener('click', () => {
    entry.sets = entry.sets.filter((s) => s.id !== set.id);
    if (entry.sets.length === 0) entry.sets.push(createSet());
    triggerRender();
    persistState();
  });
  actionsCell.appendChild(removeBtn);

  tr.append(setCell, modeCell, repsCell, weightCell, progressionCell, progressionPercentCell, actionsCell);
  return tr;
};

export const addExerciseToBuilder = (exercise) => {
  if (state.builder.items.has(exercise.id)) return;
  const entry = {
    exercise: {
      id: exercise.id,
      name: exercise.name,
      muscleGroups: exercise.muscleGroups || [],
      muscles: exercise.muscles || [],
      equipment: exercise.equipment || [],
      videos: exercise.videos || []
    },
    sets: [createSet()]
  };
  state.builder.items.set(exercise.id, entry);

  const grouping = getActiveGrouping();
  if (grouping) {
    const key = getGroupingKey(entry.exercise, grouping);
    let inserted = false;
    for (let i = 0; i < state.builder.order.length; i += 1) {
      const currentId = state.builder.order[i];
      const currentEntry = state.builder.items.get(currentId);
      if (!currentEntry) continue;
      const currentKey = getGroupingKey(currentEntry.exercise, grouping);
      if (currentKey === key) {
        let insertPos = i;
        while (insertPos < state.builder.order.length) {
          const nextEntry = state.builder.items.get(state.builder.order[insertPos]);
          if (!nextEntry || getGroupingKey(nextEntry.exercise, grouping) !== key) break;
          insertPos += 1;
        }
        state.builder.order.splice(insertPos, 0, exercise.id);
        inserted = true;
        break;
      }
    }
    if (!inserted) state.builder.order.push(exercise.id);
    applyGrouping(grouping);
  } else {
    state.builder.order.push(exercise.id);
  }
  persistState();
};

const getGroupingKey = (exercise, type) => {
  if (type === 'equipment') return Array.isArray(exercise?.equipment) ? exercise.equipment.sort().join('|') : '__none__';
  if (type === 'muscles') return Array.isArray(exercise?.muscles) ? exercise.muscles.sort().join('|') : '__none__';
  if (type === 'muscleGroups') return Array.isArray(exercise?.muscleGroups) ? exercise.muscleGroups.sort().join('|') : '__none__';
  return '__none__';
};

export const removeExerciseFromBuilder = (id) => {
  state.builder.items.delete(id);
  state.builder.order = state.builder.order.filter((val) => val !== id);
  persistState();
};

export const updateBuilderBadge = () => {
  const count = state.builder.order.length;
  if (els.builderCount) els.builderCount.textContent = count;

  const isBuilder = state.activeTab === 'builder';
  const isLibrary = !isBuilder;

  if (els.tabBuilder) els.tabBuilder.classList.toggle('active', isBuilder);
  if (els.tabLibrary) els.tabLibrary.classList.toggle('active', isLibrary);

  if (els.builderPanel) els.builderPanel.classList.toggle('active', isBuilder);
  if (els.libraryPanel) els.libraryPanel.classList.toggle('active', isLibrary);

  document.body.classList.toggle('builder-active', isBuilder);
};

export const switchTab = (tab) => {
  state.activeTab = tab === 'builder' ? 'builder' : 'library';
  updateBuilderBadge();
  persistState();
  triggerRender();
};

export const updateBuilderFilterControl = () => {
  if (!els.toggleBuilderFilter) return;
  els.toggleBuilderFilter.textContent = state.showWorkoutOnly ? 'Show Full Library' : 'Show Workout Only';
  els.toggleBuilderFilter.classList.toggle('active', state.showWorkoutOnly);
  els.toggleBuilderFilter.setAttribute('aria-pressed', state.showWorkoutOnly ? 'true' : 'false');
};

export const updateGroupingButtons = () => {
  if (!els.groupEquipment || !els.groupMuscles || !els.groupMuscleGroups) return;
  const active = getActiveGrouping();
  els.groupEquipment.classList.toggle('active', active === 'equipment');
  els.groupMuscles.classList.toggle('active', active === 'muscles');
  els.groupMuscleGroups.classList.toggle('active', active === 'muscleGroups');
};

export const toggleGrouping = (type) => {
  const active = getActiveGrouping();
  if (active === type) {
    setActiveGrouping(null);
  } else {
    setActiveGrouping(type);
    applyGrouping(type);
  }
  updateGroupingButtons();
  persistState();
  triggerRender();
};

export const buildPlanSyncPayload = () => {
  const planItems = buildPlanItems();
  const baseName = state.plan.name.trim() || DEFAULT_PLAN_NAME;
  const syncBaseName = sanitizePlanNameForSync(baseName);

  if (!planItems.length) {
    return {
      plans: [],
      baseName,
      occurrences: [],
      displayOccurrences: [],
      itemCount: 0
    };
  }

  const occurrences = computeScheduleOccurrences(state.plan.schedule);

  if (!occurrences.length) {
    return {
      plans: [
        {
          name: syncBaseName,
          items: planItems.map((item) => ({ ...item }))
        }
      ],
      baseName,
      occurrences: [],
      displayOccurrences: [],
      itemCount: planItems.length
    };
  }

  const plans = occurrences.map((date, occurrenceIndex) => {
    const iso = formatISODate(date);
    const items = planItems.map((item) => {
      if (item.type !== 'exercise') {
        return { ...item };
      }

      const copy = { ...item };
      const percent = Number.parseFloat(item.progressionPercent);
      const hasProgressiveOverload = Number.isFinite(percent) && percent !== 0;

      if (hasProgressiveOverload && occurrenceIndex > 0) {
        const factor = Math.pow(1 + percent / 100, occurrenceIndex);
        copy.perCableKg = roundKg(item.perCableKg * factor);
      }

      return copy;
    });

    const finalBaseName = syncBaseName || baseName;
    return {
      name: `${iso} ${finalBaseName}`,
      date: iso,
      items
    };
  });

  return {
    plans,
    baseName,
    occurrences: plans.map((plan) => plan.date),
    displayOccurrences: occurrences.map((date) => OCCURRENCE_FORMATTER.format(date)),
    itemCount: planItems.length
  };
};

const copyToClipboard = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
};

export const shareExercise = async (exercise, button) => {
  if (!exercise) return;
  const url = new URL(window.location.href);
  url.searchParams.set('exercise', exercise.id);
  try {
    await copyToClipboard(url.toString());
    if (button) {
      button.innerHTML = SHARE_SUCCESS_HTML;
      setTimeout(() => {
        button.innerHTML = SHARE_ICON_HTML;
      }, 1500);
    }
  } catch (err) {
    console.warn('Share failed', err);
    if (button) {
      button.innerHTML = SHARE_ERROR_HTML;
      setTimeout(() => {
        button.innerHTML = SHARE_ICON_HTML;
      }, 1500);
    }
  }
  document.querySelectorAll('.card.highlight').forEach((el) => {
    if (el.dataset.exerciseId !== exercise.id) el.classList.remove('highlight');
  });
  const card = button?.closest('.card');
  if (card) card.classList.add('highlight');
};

export const shareWorkout = async () => {
  if (!state.builder.order.length) {
    alert('Add exercises to the workout before sharing.');
    return;
  }

  const snapshot = getBuilderSnapshot();
  const payload = {
    u: state.weightUnit === 'KG' ? 1 : 0,
    f: state.showWorkoutOnly ? 1 : 0,
    c: state.includeCheckboxes ? 1 : 0,
    b: { o: snapshot.order, i: snapshot.items }
  };

  try {
    const json = JSON.stringify(payload);
    const encoded = base64UrlEncodeUtf8(json);
    const url = new URL(window.location.href);
    url.searchParams.set('workout', encoded);
    window.history.replaceState({}, '', url.toString());
    await copyToClipboard(url.toString());
    alert('Workout link copied to clipboard.');
  } catch (err) {
    console.warn('Failed to share workout', err);
    alert('Unable to generate share link.');
  }
};

export const pickPreviewVideo = (videos) => {
  if (!Array.isArray(videos) || videos.length === 0) return null;
  const mp4 = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  return mp4 ? mp4.video : null;
};

const pickBestVideo = (videos) => {
  if (!Array.isArray(videos)) return null;
  const mp4 = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  if (mp4) return { type: 'mp4', url: mp4.video };
  const hls = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.m3u8'));
  if (hls) return { type: 'hls', url: hls.video };
  if (videos.length) return { type: 'unknown', url: videos[0].video || videos[0].url };
  return null;
};

const supportsNativeHls = (videoEl) => {
  if (!videoEl) return false;
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) return true;
  if (videoEl.canPlayType('application/x-mpegurl')) return true;
  return false;
};

export const openExerciseModal = (exercise) => {
  const best = pickBestVideo(exercise.videos || []);
  els.modalVideo.pause();
  els.modalVideo.removeAttribute('src');
  els.modalVideo.load();
  els.modalNotice.textContent = '';

  if (!best) {
    els.modalNotice.textContent = 'No playable video source available for this exercise.';
  } else if (best.type === 'mp4' || (best.type === 'hls' && supportsNativeHls(els.modalVideo))) {
    els.modalVideo.src = best.url;
  } else if (best.type === 'hls') {
    els.modalNotice.innerHTML = `This video is an HLS stream (.m3u8) which may not play in this browser. Try Safari or open directly: <a href="${best.url}" target="_blank" rel="noopener">open stream</a>.`;
  } else {
    els.modalNotice.innerHTML = `Video format not recognised. You can try opening directly: <a href="${best.url}" target="_blank" rel="noopener">open stream</a>.`;
  }

  els.modal.classList.remove('hidden');
  els.modal.setAttribute('aria-hidden', 'false');
  els.modalVideo.play().catch(() => {});
};

export const closeModal = () => {
  els.modalVideo.pause();
  els.modalVideo.removeAttribute('src');
  els.modalVideo.load();
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
  state.highlightId = null;
  state.highlightHandled = false;
  document.querySelectorAll('.card.highlight').forEach((el) => el.classList.remove('highlight'));
  resetExerciseUrl();
};

export const syncSortControls = () => {
  if (!els.sortToggle) return;
  const label = state.sortMode === 'ZA' ? 'Z-A' : 'A-Z';
  els.sortToggle.textContent = label;
  els.sortToggle.classList.remove('asc', 'desc', 'shuffled');
  if (state.sortMode === 'ZA') {
    els.sortToggle.classList.add('desc');
  } else {
    els.sortToggle.classList.add('asc');
  }
  if (state.shuffleMode) {
    els.sortToggle.classList.add('shuffled');
    els.sortToggle.title = `${label} (showing shuffled order until you toggle)`;
  } else {
    els.sortToggle.title = `Currently ${label} (click to toggle)`;
  }
  els.sortToggle.setAttribute('aria-pressed', state.sortMode === 'ZA' ? 'true' : 'false');
};

export const exportWorkout = () => {
  if (!state.builder.order.length) {
    alert('Add exercises to the workout before exporting.');
    return;
  }

  const rows = [
    [
      'Exercise',
      'Set',
      'Mode',
      'Reps / Ecc%',
      `Weight (${getWeightLabel()})`,
      `Progression (${getWeightLabel()})`,
      'Progressive Overload %',
      'Muscle Groups',
      'Equipment'
    ]
  ];

  state.builder.order.forEach((id) => {
    const entry = state.builder.items.get(id);
    if (!entry) return;
    entry.sets.forEach((set, idx) => {
      const weightValue = set.mode === 'ECHO' ? '' : (set.weight || '');
      const eccentricValue = Number.isFinite(Number.parseInt(set.eccentricPct, 10))
        ? Number.parseInt(set.eccentricPct, 10)
        : 100;
      const repsDisplay = set.mode === 'ECHO' ? `${eccentricValue}% ecc` : (set.reps || '');
      const progressionValue = set.mode === 'ECHO' ? '' : (set.progression || '');
      const progressionPercentValue = set.mode === 'ECHO' ? '' : (set.progressionPercent || '');
      rows.push([
        entry.exercise.name,
        (idx + 1).toString(),
        getModeLabel(set),
        repsDisplay,
        weightValue,
        progressionValue,
        progressionPercentValue,
        (entry.exercise.muscleGroups || []).map(niceName).join(', '),
        (entry.exercise.equipment || []).map(niceName).join(', ')
      ]);
    });
  });

  const workbook = createWorkbookXlsx(rows);
  const blob = new Blob([workbook], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const now = new Date();
  const pad = (val) => String(val).padStart(2, '0');
  const nameStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStamp = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `workout-${nameStamp}-${timeStamp}.xlsx`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
};

export const printWorkout = () => {
  if (!state.builder.order.length) {
    alert('Add exercises to the workout before printing.');
    return;
  }

  const weightLabel = getWeightLabel();
  const sections = state.builder.order.map((id) => {
    const entry = state.builder.items.get(id);
    if (!entry) return '';
    const checkboxHeader = state.includeCheckboxes ? '<th>Complete</th>' : '';
    const rows = entry.sets
      .map((set, idx) => {
        const checkboxCell = state.includeCheckboxes ? '<td>&#9744;</td>' : '';
        const weightValue = set.mode === 'ECHO' ? '' : (set.weight || '');
        const eccentricValue = Number.isFinite(Number.parseInt(set.eccentricPct, 10))
          ? Number.parseInt(set.eccentricPct, 10)
          : 100;
        const repsDisplay = set.mode === 'ECHO' ? `${eccentricValue}% ecc` : (set.reps || '');
        const progressionValue = set.mode === 'ECHO' ? '' : (set.progression || '');
        const progressionPercentValue = set.mode === 'ECHO' ? '' : (set.progressionPercent || '');
        return `<tr><td>${idx + 1}</td><td>${getModeLabel(set)}</td><td>${repsDisplay}</td><td>${weightValue}</td><td>${progressionValue}</td><td>${progressionPercentValue}</td>${checkboxCell}</tr>`;
      })
      .join('');
    const metaParts = [];
    if (entry.exercise.muscleGroups?.length) {
      metaParts.push(`Muscle Groups: ${entry.exercise.muscleGroups.map(niceName).join(', ')}`);
    }
    if (entry.exercise.equipment?.length) {
      metaParts.push(`Equipment: ${entry.exercise.equipment.map(niceName).join(', ')}`);
    }
    const metaHtml = metaParts.length ? `<p>${metaParts.join(' | ')}</p>` : '';
    return `
      <section>
        <h2>${entry.exercise.name}</h2>
        ${metaHtml}
        <table>
          <thead><tr><th>Set</th><th>Mode</th><th>Reps / Ecc%</th><th>Weight (${weightLabel})</th><th>Progression (${weightLabel})</th><th>Progressive Overload %</th>${checkboxHeader}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  const printHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Workout</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { margin-bottom: 8px; }
      section { margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
      th { background: #f4f4f4; }
    </style>
  </head><body>
    <h1>Workout Plan</h1>
    <p>Generated ${new Date().toLocaleString()}</p>
    ${sections}
  </body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const printWindow = iframe.contentWindow;
  if (!printWindow) {
    iframe.remove();
    alert('Unable to open print preview.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();

  const cleanup = () => {
    iframe.remove();
    window.focus();
  };

  let fallbackTimer;
  const finalize = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    cleanup();
  };

  fallbackTimer = setTimeout(finalize, 60000);

  printWindow.addEventListener('afterprint', finalize, { once: true });
  printWindow.addEventListener('pagehide', finalize, { once: true });

  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 50);
};

export const computeMuscleSummary = () => {
  const hits = new Set();
  state.builder.order.forEach((id) => {
    const entry = state.builder.items.get(id);
    if (!entry) return;
    let muscles = entry.exercise.muscles;
    if (!Array.isArray(muscles) || muscles.length === 0) {
      const fallback = state.data.find((ex) => ex.id === id);
      muscles = fallback?.muscles || [];
    }
    muscles.forEach((muscle) => {
      const normalized = normalizeMuscleName(muscle);
      if (!normalized) return;
      const key = MUSCLE_ALIAS_LOOKUP.get(normalized);
      if (key) hits.add(key);
    });
  });

  return {
    hitCount: hits.size,
    total: MUSCLE_COVERAGE.length,
    hits,
    muscles: MUSCLE_COVERAGE.map((group) => ({
      key: group.key,
      label: group.label,
      active: hits.has(group.key)
    }))
  };
};

export const renderMuscleSummary = () => {
  if (!els.builderMuscles) return;

  const summary = computeMuscleSummary();
  const pieces = summary.muscles.map((muscle) => {
    const cls = muscle.active ? 'muscle-flag hit' : 'muscle-flag miss';
    return `<span class="${cls}"><strong>${muscle.label}</strong></span>`;
  });
  const listHtml = pieces.join('');

  els.builderMuscles.innerHTML = `<span class="muscle-summary-label">Muscles:</span>${listHtml}<span class="muscle-summary-count">(${summary.hitCount}/${summary.total})</span>`;
};

export const attachGroupDragEvents = (groupEl, handle, type) => {
  if (!groupEl || !handle) return;
  groupEl.dataset.groupType = type;
  handle.draggable = true;
  handle.addEventListener('dragstart', (evt) => {
    if (getActiveGrouping() !== type) {
      evt.preventDefault();
      return;
    }
    setDragDidDrop(false);
    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', groupEl.dataset.groupKey || '');
    groupEl.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    groupEl.classList.remove('dragging');
    if (!getDragDidDrop()) triggerRender();
    setDragDidDrop(false);
  });
};

export const attachGroupBodyEvents = (body, type, groupKey) => {
  if (!body) return;
  body.dataset.groupType = type;
  body.dataset.groupKey = groupKey;
  body.addEventListener('dragover', handleGroupedCardDragOver);
  body.addEventListener('drop', handleGroupedCardDrop);
};

const getDragAfterElement = (container, y) => {
  const elements = [...container.querySelectorAll('.builder-card:not(.dragging)')];
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  elements.forEach((child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = child;
    }
  });
  return closest;
};

const getGroupAfterElement = (container, y) => {
  const elements = [...container.querySelectorAll('.builder-group:not(.dragging)')];
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  elements.forEach((child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = child;
    }
  });
  return closest;
};

export const handleGroupedCardDragOver = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping) return;
  evt.preventDefault();
  const body = evt.currentTarget;
  if (body.dataset.groupType !== grouping) return;
  const afterElement = getDragAfterElement(body, evt.clientY);
  const dragging = body.querySelector('.builder-card.dragging');
  if (!dragging) return;
  if (!afterElement) {
    body.appendChild(dragging);
  } else if (afterElement !== dragging) {
    body.insertBefore(dragging, afterElement);
  }
};

export const reorderGroupBlock = (type, groupKey, newIds) => {
  if (!type || !groupKey || !Array.isArray(newIds) || !newIds.length) return false;
  const currentOrder = state.builder.order;
  const items = state.builder.items;
  let start = -1;
  let end = -1;
  for (let i = 0; i < currentOrder.length; i += 1) {
    const entry = items.get(currentOrder[i]);
    if (!entry) continue;
    const key = getGroupingKey(entry.exercise, type);
    if (key === groupKey) {
      if (start === -1) start = i;
      end = i;
    } else if (start !== -1) {
      break;
    }
  }
  if (start === -1) return false;
  end += 1;
  const block = currentOrder.slice(start, end);
  if (block.length !== newIds.length) return false;
  const sameMembers = block.every((id) => newIds.includes(id));
  if (!sameMembers) return false;
  const changed = block.some((id, idx) => id !== newIds[idx]);
  if (!changed) return false;
  state.builder.order = [
    ...currentOrder.slice(0, start),
    ...newIds,
    ...currentOrder.slice(end)
  ];
  return true;
};

export const handleGroupedCardDrop = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping) return;
  evt.preventDefault();
  evt.stopPropagation();
  const body = evt.currentTarget;
  if (body.dataset.groupType !== grouping) return;
  const groupKey = body.dataset.groupKey;
  const dragging = body.querySelector('.builder-card.dragging');
  if (dragging) dragging.classList.remove('dragging');
  const newIds = Array.from(body.querySelectorAll('.builder-card'))
    .map((node) => node.dataset.exerciseId)
    .filter(Boolean);
  const changed = reorderGroupBlock(grouping, groupKey, newIds);
  if (changed) persistState();
  triggerRender();
  setDragDidDrop(true);
};

export const handleGroupDragOver = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping || !els.builderList) return;
  evt.preventDefault();
  evt.stopPropagation();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
  const dragging = els.builderList.querySelector('.builder-group.dragging');
  if (!dragging) return;
  if (dragging.dataset.groupType !== grouping) return;
  const afterElement = getGroupAfterElement(els.builderList, evt.clientY);
  if (!afterElement) {
    els.builderList.appendChild(dragging);
  } else if (afterElement !== dragging) {
    els.builderList.insertBefore(dragging, afterElement);
  }
};

export const handleGroupDrop = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping || !els.builderList) return;
  evt.preventDefault();
  evt.stopPropagation();
  const dragging = els.builderList.querySelector('.builder-group.dragging');
  if (dragging) dragging.classList.remove('dragging');
  const orderKeys = Array.from(els.builderList.querySelectorAll('.builder-group'))
    .filter((node) => node.dataset.groupType === grouping)
    .map((node) => node.dataset.groupKey);
  const clusters = getGroupingClusters(state.builder.order, state.builder.items, grouping);
  const map = new Map(clusters.map((group) => [group.key, group.ids]));
  const newOrder = [];
  const keySet = new Set(orderKeys);
  orderKeys.forEach((key) => {
    if (!key) return;
    const ids = map.get(key);
    if (ids) newOrder.push(...ids);
  });
  map.forEach((ids, key) => {
    if (!keySet.has(key) && ids) newOrder.push(...ids);
  });
  const changed = newOrder.length === state.builder.order.length
    ? newOrder.some((id, idx) => id !== state.builder.order[idx])
    : true;
  if (newOrder.length && changed) {
    state.builder.order = newOrder;
    persistState();
    triggerRender();
  } else {
    triggerRender();
  }
  setDragDidDrop(true);
};

export const handleBuilderDragOver = (evt) => {
  if (!els.builderList || getActiveGrouping()) return;
  evt.preventDefault();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
  const dragging = els.builderList.querySelector('.builder-card.dragging');
  if (!dragging) return;
  const afterElement = getDragAfterElement(els.builderList, evt.clientY);
  if (!afterElement) {
    els.builderList.appendChild(dragging);
  } else if (afterElement !== dragging) {
    els.builderList.insertBefore(dragging, afterElement);
  }
};

export const handleBuilderDrop = (evt) => {
  if (!els.builderList || getActiveGrouping()) return;
  evt.preventDefault();
  const dragging = els.builderList.querySelector('.builder-card.dragging');
  if (dragging) dragging.classList.remove('dragging');
  const order = Array.from(els.builderList.querySelectorAll('.builder-card'))
    .map((node) => node.dataset.exerciseId)
    .filter(Boolean);
  const changed = order.some((id, idx) => id !== state.builder.order[idx]);
  if (changed) {
    state.builder.order = order;
    persistState();
    triggerRender();
  } else {
    triggerRender();
  }
  setDragDidDrop(true);
};

const moveBuilderEntry = (exerciseId, offset) => {
  if (!exerciseId || !Number.isInteger(offset)) return false;
  const order = state.builder.order;
  const currentIndex = order.indexOf(exerciseId);
  if (currentIndex < 0) return false;
  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= order.length) return false;

  const nextOrder = order.slice();
  const [removed] = nextOrder.splice(currentIndex, 1);
  nextOrder.splice(targetIndex, 0, removed);
  state.builder.order = nextOrder;
  persistState();
  triggerRender();
  return true;
};

export const renderBuilder = () => {
  const { order, items } = state.builder;
  if (!order.length) {
    els.builderList.classList.remove('grouped');
    els.builderList.innerHTML = '<div class="empty">Add exercises from the library to build a custom workout.</div>';
    els.builderSummary.textContent = 'No exercises selected yet.';
    renderMuscleSummary();
    return;
  }

  let setTotal = 0;
  let summaryExtra = '';
  let displayIndex = 0;
  const grouping = getActiveGrouping();
  const orderIndexMap = new Map(order.map((id, idx) => [id, idx]));
  const totalCount = order.length;

  if (grouping) {
    const groups = getGroupingClusters(order, items, grouping);
    els.builderList.classList.add('grouped');
    els.builderList.innerHTML = '';

    groups.forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'builder-group';
      groupEl.dataset.groupKey = group.key;
      groupEl.dataset.groupType = grouping;
      groupEl.dataset.count = String(group.ids.length);
      groupEl.style.setProperty('--group-color', group.color);

      const head = document.createElement('div');
      head.className = 'builder-group-head';
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = group.label;
      const handle = document.createElement('div');
      handle.className = 'builder-group-handle';
      handle.textContent = 'Drag Group';
      head.append(label, handle);

      const body = document.createElement('div');
      body.className = 'builder-group-body';
      attachGroupBodyEvents(body, grouping, group.key);

      group.ids.forEach((id) => {
        const entry = items.get(id);
        if (!entry) return;
        displayIndex += 1;
        const { card, setCount } = buildBuilderCard(entry, displayIndex, {
          groupColor: group.color,
          groupKey: group.key,
          orderIndex: orderIndexMap.get(id) ?? displayIndex - 1,
          totalCount
        });
        setTotal += setCount;
        body.appendChild(card);
      });

      groupEl.append(head, body);
      attachGroupDragEvents(groupEl, handle, grouping);
      els.builderList.appendChild(groupEl);
    });

    if (groups.length) {
      const labelBase = GROUPING_LABELS[grouping] || 'group';
      summaryExtra = ` | ${groups.length} ${labelBase}${groups.length === 1 ? '' : 's'}`;
    }
  } else {
    els.builderList.classList.remove('grouped');
    els.builderList.innerHTML = '';
    order.forEach((id, idx) => {
      const entry = items.get(id);
      if (!entry) return;
      const { card, setCount } = buildBuilderCard(entry, idx + 1, {
        orderIndex: idx,
        totalCount
      });
      setTotal += setCount;
      els.builderList.appendChild(card);
    });
  }

  const exerciseWord = order.length === 1 ? 'exercise' : 'exercises';
  const setWord = setTotal === 1 ? 'set' : 'sets';
  const baseSummary = `${order.length} ${exerciseWord} | ${setTotal} ${setWord}${summaryExtra}`;
  const planName = state.plan.name.trim();
  const occurrences = computeScheduleOccurrences(state.plan.schedule);
  const nextOccurrence = occurrences.length ? OCCURRENCE_FORMATTER.format(occurrences[0]) : null;

  const summaryParts = [];
  if (planName) summaryParts.push(planName);
  summaryParts.push(baseSummary);
  if (nextOccurrence) summaryParts.push(`Next: ${nextOccurrence}`);

  els.builderSummary.textContent = summaryParts.join(' | ');

  renderMuscleSummary();
};

const buildBuilderCard = (entry, displayIndex, options = {}) => {
  const {
    groupColor = null,
    groupKey = null,
    orderIndex = 0,
    totalCount = state.builder.order.length
  } = options;
  const id = entry.exercise.id;
  const card = document.createElement('div');
  card.className = 'builder-card';
  if (groupColor) card.style.setProperty('--group-color', groupColor);
  if (groupKey) {
    card.classList.add('grouped');
    card.dataset.groupKey = groupKey;
  }
  card.dataset.exerciseId = id;

  const controls = document.createElement('div');
  controls.className = 'builder-controls';

  const header = document.createElement('div');
  header.className = 'builder-header-main';
  header.tabIndex = 0;

  const title = document.createElement('h3');
  title.textContent = `${displayIndex}. ${entry.exercise.name}`;
  const meta = document.createElement('div');
  meta.className = 'builder-meta';

  const metaFragments = [];
  if (entry.exercise.muscleGroups?.length) {
    const span = document.createElement('span');
    span.innerHTML = `<strong>Groups:</strong> ${entry.exercise.muscleGroups.map(niceName).join(', ')}`;
    metaFragments.push(span);
  }
  if (entry.exercise.muscles?.length) {
    const span = document.createElement('span');
    span.innerHTML = `<strong>Muscles:</strong> ${entry.exercise.muscles.map(niceName).join(', ')}`;
    metaFragments.push(span);
  }
  if (entry.exercise.equipment?.length) {
    const span = document.createElement('span');
    span.innerHTML = `<strong>Equipment:</strong> ${entry.exercise.equipment.map(niceName).join(', ')}`;
    metaFragments.push(span);
  }

  metaFragments.forEach((fragment, index) => {
    meta.appendChild(fragment);
    if (index < metaFragments.length - 1) {
      meta.appendChild(document.createTextNode(' | '));
    }
  });
  header.append(title, meta);

  const thumbUrl = entry.exercise.videos?.[0]?.thumbnail || entry.exercise.thumbnail || '';
  if (thumbUrl) {
    const preview = document.createElement('img');
    preview.className = 'builder-thumb';
    preview.src = thumbUrl;
    preview.alt = '';
    preview.loading = 'lazy';
    header.appendChild(preview);
  }

  const openReference = () => {
    openExerciseModal(entry.exercise);
  };
  header.addEventListener('click', openReference);
  header.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      openReference();
    }
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn danger small';
  removeBtn.textContent = 'Remove';
  removeBtn.type = 'button';
  removeBtn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    removeExerciseFromBuilder(id);
    triggerRender();
  });

  const moveWrapper = document.createElement('div');
  moveWrapper.className = 'builder-move-buttons';

  const isFirst = orderIndex <= 0;
  const isLast = orderIndex >= totalCount - 1;

  const buildMoveHandler = (direction) => (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    moveBuilderEntry(id, direction);
  };

  const moveUpBtn = document.createElement('button');
  moveUpBtn.className = 'btn icon small builder-move-up';
  moveUpBtn.type = 'button';
  moveUpBtn.innerHTML = '<span aria-hidden="true">↑</span>';
  moveUpBtn.setAttribute('aria-label', 'Move exercise up');
  moveUpBtn.title = isFirst ? 'Already at top' : 'Move up';
  moveUpBtn.disabled = isFirst;
  if (!isFirst) {
    moveUpBtn.addEventListener('click', buildMoveHandler(-1));
  }

  const moveDownBtn = document.createElement('button');
  moveDownBtn.className = 'btn icon small builder-move-down';
  moveDownBtn.type = 'button';
  moveDownBtn.innerHTML = '<span aria-hidden="true">↓</span>';
  moveDownBtn.setAttribute('aria-label', 'Move exercise down');
  moveDownBtn.title = isLast ? 'Already at bottom' : 'Move down';
  moveDownBtn.disabled = isLast;
  if (!isLast) {
    moveDownBtn.addEventListener('click', buildMoveHandler(1));
  }

  moveWrapper.append(moveUpBtn, moveDownBtn);

  const actions = document.createElement('div');
  actions.className = 'builder-control-actions';
  actions.append(moveWrapper, removeBtn);

  controls.append(header, actions);
  card.appendChild(controls);

  const bulkControls = document.createElement('div');
  bulkControls.className = 'builder-bulk-controls';
  const percentLabel = document.createElement('label');
  percentLabel.textContent = 'Progressive Overload %';
  percentLabel.title = PROGRESSIVE_OVERLOAD_TOOLTIP;
  const percentSelect = document.createElement('select');
  const percentOptions = ['', '0', '2.5', '5', '7.5', '10', '12.5', '15', '20', '25', '30', '35', '40'];
  percentOptions.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value ? `${value}%` : 'Custom';
    percentSelect.appendChild(option);
  });
  const sharedPercent = entry.sets.length
    ? entry.sets.every((set) => (set.progressionPercent || '') === (entry.sets[0].progressionPercent || ''))
      ? (entry.sets[0].progressionPercent || '')
      : ''
    : '';
  percentSelect.value = sharedPercent ?? '';
  percentSelect.title = PROGRESSIVE_OVERLOAD_TOOLTIP;
  percentSelect.addEventListener('change', () => {
    const chosen = percentSelect.value;
    entry.sets.forEach((set) => {
      set.progressionPercent = chosen;
    });
    persistState();
    triggerRender();
  });
  percentLabel.appendChild(percentSelect);
  bulkControls.appendChild(percentLabel);
  card.appendChild(bulkControls);

  card.draggable = true;
  card.addEventListener('dragstart', (evt) => {
    setDragDidDrop(false);
    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    if (!getDragDidDrop()) triggerRender();
    setDragDidDrop(false);
  });

  const table = document.createElement('table');
  table.className = 'sets-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>Set</th><th>Mode</th><th>Reps / Ecc%</th><th>Weight (${getWeightLabel()})</th><th>Progression (${getWeightLabel()})</th><th>Progressive Overload %</th><th></th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let setCount = 0;
  entry.sets.forEach((set, index) => {
    setCount += 1;
    tbody.appendChild(renderSetRow(id, set, index));
  });
  table.appendChild(tbody);

  const addSetBtn = document.createElement('button');
  addSetBtn.className = 'btn small add-set';
  addSetBtn.textContent = 'Add Set';
  addSetBtn.addEventListener('click', () => {
    const newSet = createSet();
    const lastSet = entry.sets[entry.sets.length - 1];
    if (lastSet) {
      newSet.mode = lastSet.mode;
      newSet.echoLevel = lastSet.echoLevel;
      newSet.eccentricPct = lastSet.eccentricPct;
      newSet.reps = lastSet.reps;
      newSet.weight = lastSet.weight;
      newSet.progression = lastSet.progression;
      newSet.progressionPercent = lastSet.progressionPercent;
    }
    entry.sets.push(newSet);
    triggerRender();
    persistState();
  });

  card.append(table, addSetBtn);

  return { card, setCount };
};

export const handleScrollButtons = () => {
  const scrollY = window.scrollY;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollY > 400) {
    els.scrollUp.classList.add('show');
  } else {
    els.scrollUp.classList.remove('show');
  }
  if (scrollY < maxY - 400) {
    els.scrollDown.classList.add('show');
  } else {
    els.scrollDown.classList.remove('show');
  }
};

export const applyDeepLink = () => {
  if (!state.highlightId || state.highlightHandled) return;
  const target = document.getElementById(`exercise-${state.highlightId}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const exercise = state.data.find((ex) => ex.id === state.highlightId);
    if (exercise) openExerciseModal(exercise);
    state.highlightHandled = true;
  }
};

export function updateUrlExercise(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('exercise', id);
  history.replaceState({}, '', url.toString());
}

export function resetExerciseUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('exercise')) return;
  url.searchParams.delete('exercise');
  history.replaceState({}, '', url.toString());
}

export { shuffleBuilderOrder, getGroupColor };
