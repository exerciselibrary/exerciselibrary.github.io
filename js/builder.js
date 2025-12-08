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
  KG_PER_LB,
  LB_PER_KG
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
  base64UrlEncodeUtf8,
  PROGRESSION_MODES,
  PROGRESSION_FREQUENCIES,
  DEFAULT_PROGRESSION_MODE,
  DEFAULT_PROGRESSION_FREQUENCY,
  normalizeProgressionMode,
  normalizeProgressionFrequency
} from './storage.js';

let renderCallback = null;
let planNameDebounceId = null;
const PLAN_NAME_DEBOUNCE_MS = 200;
const CUSTOM_SLOT_LABEL = 'Add Custom Exercise';

const customExerciseHooks = {
  ensureDropboxReady: null,
  saveCustomExercise: null
};

let customExerciseDefaultBanner = {
  text: 'Connect Dropbox to create custom exercises.',
  variant: 'warning'
};
let customExerciseBannerTimeout = null;

const customExerciseModalState = {
  insertIndex: 0,
  busy: false
};

export const registerRenderHandler = (fn) => {
  renderCallback = fn;
};

const triggerRender = () => {
  if (typeof renderCallback === 'function') {
    renderCallback();
  }
};

const applyCustomExerciseBanner = (text, variant = 'info') => {
  if (!els.customExerciseBanner) return;
  const classList = els.customExerciseBanner.classList;
  classList.remove('success', 'error', 'warning');
  if (!text) {
    els.customExerciseBanner.textContent = '';
    return;
  }
  if (variant && variant !== 'info') {
    classList.add(variant);
  }
  els.customExerciseBanner.textContent = text;
};

export const setCustomExerciseAvailability = (connected) => {
  customExerciseDefaultBanner = connected
    ? {
        text: 'Hover above, below, or between exercises to insert a Dropbox-backed custom exercise.',
        variant: 'info'
      }
    : {
        text: 'Connect Dropbox to create and sync custom exercises.',
        variant: 'warning'
      };
  if (!customExerciseBannerTimeout) {
    applyCustomExerciseBanner(customExerciseDefaultBanner.text, customExerciseDefaultBanner.variant);
  }
};

export const showCustomExerciseMessage = (text, variant = 'info', options = {}) => {
  applyCustomExerciseBanner(text, variant);
  if (customExerciseBannerTimeout) {
    clearTimeout(customExerciseBannerTimeout);
    customExerciseBannerTimeout = null;
  }
  if (!options.persist) {
    customExerciseBannerTimeout = setTimeout(() => {
      customExerciseBannerTimeout = null;
      applyCustomExerciseBanner(customExerciseDefaultBanner.text, customExerciseDefaultBanner.variant);
    }, options.duration || 4000);
  }
};

export const registerCustomExerciseHooks = (hooks = {}) => {
  if (hooks.ensureDropboxReady) {
    customExerciseHooks.ensureDropboxReady = hooks.ensureDropboxReady;
  }
  if (hooks.saveCustomExercise) {
    customExerciseHooks.saveCustomExercise = hooks.saveCustomExercise;
  }
};

applyCustomExerciseBanner(customExerciseDefaultBanner.text, customExerciseDefaultBanner.variant);

const formatOptionId = (prefix, value) => {
  const safeValue = typeof value === 'string' ? value.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : '';
  return `${prefix}-${safeValue || Math.random().toString(36).slice(2)}`;
};

const buildCheckboxOptions = (values, container) => {
  if (!container) return;
  container.innerHTML = '';
  const sorted = Array.isArray(values)
    ? [...values].sort((a, b) => niceName(a).localeCompare(niceName(b)))
    : [];
  sorted.forEach((value) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    const id = formatOptionId(container.id || 'custom-option', value);
    input.id = id;
    label.htmlFor = id;
    const text = document.createElement('span');
    text.textContent = niceName(value);
    label.append(input, text);
    container.appendChild(label);
  });
};

const collectSelectedValues = (container) => {
  if (!container) return [];
  const inputs = container.querySelectorAll('input[type="checkbox"]');
  return Array.from(inputs)
    .filter((input) => input.checked)
    .map((input) => input.value)
    .filter(Boolean);
};

const setCustomExerciseModalBusy = (busy) => {
  customExerciseModalState.busy = Boolean(busy);
  const buttons = [els.customExerciseSubmit, els.customExerciseCancel, els.customExerciseClose].filter(Boolean);
  buttons.forEach((button) => {
    button.disabled = Boolean(busy);
  });
};

const setCustomExerciseMessage = (text, variant = 'info') => {
  if (!els.customExerciseMessage) return;
  els.customExerciseMessage.textContent = text || '';
  els.customExerciseMessage.classList.remove('error', 'success');
  if (variant && variant !== 'info' && text) {
    els.customExerciseMessage.classList.add(variant);
  }
};

const populateCustomExerciseOptions = () => {
  buildCheckboxOptions(state.muscles, els.customExerciseMuscleGroups);
  buildCheckboxOptions(state.subMuscles, els.customExerciseMuscles);
  buildCheckboxOptions(state.equipment, els.customExerciseEquipment);
};

const closeCustomExerciseModal = () => {
  if (!els.customExerciseModal) return;
  els.customExerciseModal.classList.add('hidden');
  els.customExerciseModal.setAttribute('aria-hidden', 'true');
  setCustomExerciseModalBusy(false);
  setCustomExerciseMessage('');
};

const openCustomExerciseModal = (insertIndex = state.builder.order.length) => {
  populateCustomExerciseOptions();
  customExerciseModalState.insertIndex = Math.max(0, Math.min(insertIndex, state.builder.order.length));
  if (els.customExerciseName) {
    els.customExerciseName.value = '';
  }
  const checkboxContainers = [
    els.customExerciseMuscleGroups,
    els.customExerciseMuscles,
    els.customExerciseEquipment
  ].filter(Boolean);
  checkboxContainers.forEach((container) => {
    container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
  });
  setCustomExerciseMessage('');
  setCustomExerciseModalBusy(false);
  if (els.customExerciseModal) {
    els.customExerciseModal.classList.remove('hidden');
    els.customExerciseModal.setAttribute('aria-hidden', 'false');
  }
  if (els.customExerciseName) {
    els.customExerciseName.focus();
  }
};

const handleCustomSlotClick = async (insertIndex) => {
  if (typeof customExerciseHooks.ensureDropboxReady === 'function') {
    try {
      const ready = await customExerciseHooks.ensureDropboxReady();
      if (!ready) {
        showCustomExerciseMessage('Connect Dropbox to create custom exercises.', 'warning', { persist: true });
        return;
      }
    } catch (error) {
      showCustomExerciseMessage(error.message || 'Dropbox connection required.', 'error', { persist: true });
      return;
    }
  }
  openCustomExerciseModal(insertIndex);
};

const createCustomExerciseSlot = (insertIndex, options = {}) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'builder-custom-slot';
  if (options.showCard) {
    button.classList.add('placeholder-card');
  }
  button.dataset.insertIndex = String(insertIndex);
  button.setAttribute('aria-label', 'Add custom exercise');
  const label = document.createElement('span');
  label.className = 'slot-label';
  label.textContent = CUSTOM_SLOT_LABEL;
  button.appendChild(label);
  if (options.showCard) {
    const hint = document.createElement('span');
    hint.className = 'slot-hint';
    hint.textContent = options.hint || 'Dropbox required to sync custom exercises.';
    button.appendChild(hint);
  }
  button.addEventListener('click', () => handleCustomSlotClick(insertIndex));
  return button;
};

const handleCustomExerciseSubmit = async () => {
  if (customExerciseModalState.busy || typeof customExerciseHooks.saveCustomExercise !== 'function') return;
  const name = (els.customExerciseName && els.customExerciseName.value) || '';
  const muscleGroups = collectSelectedValues(els.customExerciseMuscleGroups);
  const muscles = collectSelectedValues(els.customExerciseMuscles);
  const equipment = collectSelectedValues(els.customExerciseEquipment);
  if (!name.trim()) {
    setCustomExerciseMessage('Name is required.', 'error');
    if (els.customExerciseName) els.customExerciseName.focus();
    return;
  }
  setCustomExerciseModalBusy(true);
  setCustomExerciseMessage('Saving custom exercise...', 'info');
  try {
    const exercise = await customExerciseHooks.saveCustomExercise({
      name,
      muscleGroups,
      muscles,
      equipment
    });
    if (exercise) {
      addExerciseToBuilder(exercise, { insertIndex: customExerciseModalState.insertIndex });
      closeCustomExerciseModal();
      showCustomExerciseMessage(`Added "${exercise.name}" to your workout.`, 'success');
      triggerRender();
    } else {
      setCustomExerciseMessage('Unable to save custom exercise.', 'error');
    }
  } catch (error) {
    setCustomExerciseMessage(error.message || 'Failed to save custom exercise.', 'error');
  } finally {
    setCustomExerciseModalBusy(false);
  }
};

if (els.customExerciseSubmit) {
  els.customExerciseSubmit.addEventListener('click', handleCustomExerciseSubmit);
}
if (els.customExerciseCancel) {
  els.customExerciseCancel.addEventListener('click', () => {
    if (!customExerciseModalState.busy) {
      closeCustomExerciseModal();
    }
  });
}
if (els.customExerciseClose) {
  els.customExerciseClose.addEventListener('click', () => {
    if (!customExerciseModalState.busy) {
      closeCustomExerciseModal();
    }
  });
}
if (els.customExerciseModal) {
  els.customExerciseModal.addEventListener('click', (event) => {
    if (event.target === els.customExerciseModal && !customExerciseModalState.busy) {
      closeCustomExerciseModal();
    }
  });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && els.customExerciseModal && !els.customExerciseModal.classList.contains('hidden')) {
        event.preventDefault();
        if (!customExerciseModalState.busy) {
          closeCustomExerciseModal();
        }
      }
    },
    true
  );
}

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
  TIME_UNDER_TENSION_BEAST: 3,
  ECCENTRIC: 4
};
const PROGRAM_MODE_REVERSE_MAP = Object.entries(PROGRAM_MODE_MAP).reduce((acc, [key, value]) => {
  acc[value] = key;
  return acc;
}, {});
const PROGRESSIVE_OVERLOAD_TOOLTIP =
  'Increase the percent lifted per workout for this exercise. Only applies on new days where you do this exercise.';
const INTENSITY_TOOLTIP = [
  'Intensity techniques apply to this set (Dropset on Set 1 adds two rapid lighter micro-sets to that set).',
  'None: leaves the set as-is.',
  'Dropset: last set then ~80% and ~70% micro-sets, zero rest between, progression zeroed.',
  'Rest-Pause: last set repeated twice at the same weight with ~15s pauses, progression zeroed.',
  'Slow negatives: last set repeated twice eccentric-only at the same weight with ~15s pauses, progression zeroed.'
].join('\n');

const DEFAULT_REST_SECONDS = 60;
const MS_PER_DAY = 86400000;

const PROGRESSION_TYPE_LABELS = {
  [PROGRESSION_MODES.NONE]: 'No increase',
  [PROGRESSION_MODES.PERCENT]: '% increase',
  [PROGRESSION_MODES.FLAT]: 'Flat weight'
};

const PROGRESSION_TYPE_SHORT_LABELS = {
  [PROGRESSION_MODES.NONE]: '',
  [PROGRESSION_MODES.PERCENT]: '%',
  [PROGRESSION_MODES.FLAT]: 'Flat'
};

const QUICK_PERCENT_VALUES = ['', '0', '1', '2.5', '5', '7.5', '10', '12.5', '15', '20', '25', '30', '35', '40'];
const QUICK_FLAT_VALUES = ['', '0.5', '1', '2', '5', '10'];
const DEFAULT_INTENSITY = 'none';
const INTENSITY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'dropset', label: 'Dropset' },
  { value: 'restpause', label: 'Rest-Pause' },
  { value: 'slownegatives', label: 'Slow negatives' }
];

const normalizeIntensity = (value) => {
  if (typeof value !== 'string') return DEFAULT_INTENSITY;
  const normalized = value.trim().toLowerCase();
  return INTENSITY_OPTIONS.some((opt) => opt.value === normalized) ? normalized : DEFAULT_INTENSITY;
};

const PROGRESSION_FREQUENCY_LABELS = {
  [PROGRESSION_FREQUENCIES.WORKOUT]: 'Every workout',
  [PROGRESSION_FREQUENCIES.DAILY]: 'Day to day',
  [PROGRESSION_FREQUENCIES.WEEKLY]: 'Week to week',
  [PROGRESSION_FREQUENCIES.MONTHLY]: 'Month to month'
};

const MAX_UNSIGNED_16 = 0xffff;

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

const inferProgressionModeFromValues = (set) => {
  if (!set) return PROGRESSION_MODES.NONE;
  const normalized = normalizeProgressionMode(set.progressionMode);
  if (normalized) return normalized;
  const hasFlat = typeof set.overloadValue === 'string' && set.overloadValue.trim() !== '';
  const hasPercent = typeof set.progressionPercent === 'string' && set.progressionPercent.trim() !== '';
  if (hasFlat && !hasPercent) return PROGRESSION_MODES.FLAT;
  if (hasPercent) return PROGRESSION_MODES.PERCENT;
  return PROGRESSION_MODES.NONE;
};

const applyStoredProgressionConfig = (set, setData = {}, item = {}) => {
  if (!set) return;

  if (set.mode === 'ECHO') {
    set.progressionMode = PROGRESSION_MODES.NONE;
  } else {
    const storedMode =
      normalizeProgressionMode(setData?.progressionMode) ||
      normalizeProgressionMode(item?.progressionMode);
    if (storedMode) {
      set.progressionMode = storedMode;
    } else {
      const inferred = inferProgressionModeFromValues(set);
      set.progressionMode = inferred || PROGRESSION_MODES.NONE;
    }
  }

  const storedFrequency =
    normalizeProgressionFrequency(setData?.progressionFrequency) ||
    normalizeProgressionFrequency(item?.progressionFrequency);
  set.progressionFrequency = storedFrequency || DEFAULT_PROGRESSION_FREQUENCY;
};

const getSetProgressionMode = (set) => {
  if (!set) return PROGRESSION_MODES.NONE;
  const normalized = normalizeProgressionMode(set.progressionMode);
  if (normalized) {
    set.progressionMode = normalized;
    return normalized;
  }
  const inferred = inferProgressionModeFromValues(set) || DEFAULT_PROGRESSION_MODE;
  set.progressionMode = inferred;
  return inferred;
};

const getSetProgressionFrequency = (set) => {
  if (!set) return DEFAULT_PROGRESSION_FREQUENCY;
  const normalized = normalizeProgressionFrequency(set.progressionFrequency);
  if (normalized) {
    set.progressionFrequency = normalized;
    return normalized;
  }
  set.progressionFrequency = DEFAULT_PROGRESSION_FREQUENCY;
  return set.progressionFrequency;
};

const getProgressionStepCount = (baseDate, currentDate, frequency, occurrenceIndex = 0) => {
  if (frequency === PROGRESSION_FREQUENCIES.WORKOUT) {
    return Math.max(occurrenceIndex, 0);
  }
  if (!(baseDate instanceof Date) || !(currentDate instanceof Date)) return 0;
  const diffMs = currentDate.getTime() - baseDate.getTime();
  if (diffMs <= 0) return 0;
  if (frequency === PROGRESSION_FREQUENCIES.WEEKLY) {
    return Math.floor(diffMs / (7 * MS_PER_DAY));
  }
  if (frequency === PROGRESSION_FREQUENCIES.MONTHLY) {
    const yearDiff = currentDate.getFullYear() - baseDate.getFullYear();
    const monthDiff = currentDate.getMonth() - baseDate.getMonth();
    let totalMonths = yearDiff * 12 + monthDiff;
    if (currentDate.getDate() < baseDate.getDate()) {
      totalMonths -= 1;
    }
    return Math.max(totalMonths, 0);
  }
  return Math.floor(diffMs / MS_PER_DAY);
};

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

  const defaultDayRef = start || today;
  const dayValues =
    schedule.daysOfWeek && schedule.daysOfWeek.size
      ? Array.from(schedule.daysOfWeek)
          .map((day) => Number(day))
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [defaultDayRef.getDay()];

  const days = Array.from(new Set(dayValues)).sort((a, b) => a - b);

  const cursor = start ? new Date(start) : new Date(today);
  let iterations = 0;

  while (occurrences.length < MAX_SCHEDULE_OCCURRENCES && iterations < 1000) {
    if (end && cursor > end) break;

    const diffDays = Math.floor((cursor - base) / MS_PER_DAY);
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

const parseRestSeconds = (value) => {
  const source = typeof value === 'string' ? value.trim() : value;
  const num = Number.parseInt(source, 10);
  return Number.isFinite(num) && num >= 0 ? num : DEFAULT_REST_SECONDS;
};

const formatRestValue = (value, fallback = DEFAULT_REST_SECONDS) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return String(fallback);
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return String(parsed);
    return String(fallback);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return String(parsed);
  return String(fallback);
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
      if (set.overloadValue) {
        set.overloadValue = convertWeightValue(set.overloadValue, previous, newUnit);
      }
    });
  });
};

const normalizeWeightUnit = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'KG' || normalized === 'KGS' || normalized === 'KILOGRAMS') return 'KG';
  if (normalized === 'LB' || normalized === 'LBS' || normalized === 'POUNDS') return 'LBS';
  return null;
};

const getStateWeightUnit = () => (state.weightUnit === 'KG' ? 'KG' : 'LBS');

const convertWeightStringValue = (value, fromUnit, toUnit) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!fromUnit || !toUnit || fromUnit === toUnit) return trimmed;
  const converted = convertWeightValue(trimmed, fromUnit, toUnit);
  return converted !== '' ? converted : trimmed;
};

const detectPlanWeightUnit = (planItems = []) => {
  for (const item of planItems) {
    if (!item) continue;
    const weightUnit = normalizeWeightUnit(item?.weightUnit);
    if (weightUnit) return weightUnit;
    const progressionUnit = normalizeWeightUnit(item?.progressionUnit);
    if (progressionUnit) return progressionUnit;
    const builderWeightUnit = normalizeWeightUnit(item?.builderMeta?.setData?.weightUnit);
    if (builderWeightUnit) return builderWeightUnit;
    const builderProgressionUnit = normalizeWeightUnit(item?.builderMeta?.setData?.progressionUnit);
    if (builderProgressionUnit) return builderProgressionUnit;
  }
  return null;
};

export const updateUnitToggle = () => {
  const label = state.weightUnit === 'LBS' ? 'Units: lbs' : 'Units: kg';
  const title = `Switch to ${state.weightUnit === 'LBS' ? 'kilograms' : 'pounds'}`;
  [els.unitToggle, els.analyticsUnitToggle].forEach((button) => {
    if (!button) return;
    button.textContent = label;
    button.title = title;
  });
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

export const applyScheduleFromDate = (value) => {
  const parsed = parseISODate(value);
  if (!parsed) return false;
  const iso = formatISODate(parsed);
  state.plan.schedule.startDate = iso;
  state.plan.schedule.endDate = iso;
  state.plan.schedule.repeatInterval = 1;
  state.plan.schedule.daysOfWeek = new Set([parsed.getDay()]);
  persistState();
  triggerRender();
  return true;
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
  const currentUnit = getStateWeightUnit();

  const normalizeNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const normalizeBool = (value) => value === true;

const canMergePlanItems = (prev, next) => {
  if (!prev || !next || prev.type !== next.type) return false;

  const prevId = prev.builderMeta?.exerciseId;
  const nextId = next.builderMeta?.exerciseId;
  if (prevId && nextId && prevId !== nextId) return false;

  const prevIntensity = normalizeIntensity(prev.intensity || DEFAULT_INTENSITY);
  const nextIntensity = normalizeIntensity(next.intensity || DEFAULT_INTENSITY);
  if (prevIntensity !== DEFAULT_INTENSITY || nextIntensity !== DEFAULT_INTENSITY) {
    return false;
  }

  if (prev.type === 'exercise') {
    return (
      normalizeNumber(prev.mode) === normalizeNumber(next.mode) &&
      normalizeNumber(prev.perCableKg) === normalizeNumber(next.perCableKg) &&
      normalizeNumber(prev.reps) === normalizeNumber(next.reps) &&
        normalizeNumber(prev.restSec) === normalizeNumber(next.restSec) &&
        normalizeNumber(prev.progressionKg) === normalizeNumber(next.progressionKg) &&
        normalizeNumber(prev.progressionPercent) === normalizeNumber(next.progressionPercent) &&
        (prev.progressionMode || PROGRESSION_MODES.NONE) === (next.progressionMode || PROGRESSION_MODES.NONE) &&
        (prev.progressionFrequency || DEFAULT_PROGRESSION_FREQUENCY) ===
          (next.progressionFrequency || DEFAULT_PROGRESSION_FREQUENCY) &&
        normalizeNumber(prev.progressiveOverloadKg) === normalizeNumber(next.progressiveOverloadKg) &&
        normalizeNumber(prev.progressiveOverloadPercent) === normalizeNumber(next.progressiveOverloadPercent) &&
        normalizeBool(prev.justLift) === normalizeBool(next.justLift) &&
        normalizeBool(prev.stopAtTop) === normalizeBool(next.stopAtTop) &&
        (prev.intensity || DEFAULT_INTENSITY) === (next.intensity || DEFAULT_INTENSITY) &&
        normalizeNumber(prev.cables) === normalizeNumber(next.cables)
      );
    }

    // Echo mode comparison
    return (
      normalizeNumber(prev.level) === normalizeNumber(next.level) &&
      normalizeNumber(prev.eccentricPct) === normalizeNumber(next.eccentricPct) &&
      normalizeNumber(prev.targetReps) === normalizeNumber(next.targetReps) &&
      normalizeNumber(prev.restSec) === normalizeNumber(next.restSec) &&
      normalizeBool(prev.justLift) === normalizeBool(next.justLift) &&
      normalizeBool(prev.stopAtTop) === normalizeBool(next.stopAtTop) &&
      (prev.intensity || DEFAULT_INTENSITY) === (next.intensity || DEFAULT_INTENSITY)
    );
  };

  state.builder.order.forEach((exerciseId, orderIndex) => {
    const entry = state.builder.items.get(exerciseId);
    if (!entry) return;

    const exerciseName = entry.exercise?.name || 'Exercise';
    const exerciseNumericId = toNumericExerciseId(entry.exercise?.id_new);
    const sets = Array.isArray(entry.sets) ? entry.sets : [];
    if (!sets.length) return;

    const videos = Array.isArray(entry.exercise?.videos) ? entry.exercise.videos : [];
    const baseMeta = {
      exerciseId,
      exerciseName,
      videos,
      order: orderIndex,
      totalSets: sets.length,
      exerciseIdNew: exerciseNumericId
    };

    let previousPlanItem = null;

    sets.forEach((set, setIndex) => {
      const mode = set.mode || 'OLD_SCHOOL';
      const displayName = exerciseName;
      const restSeconds = parseRestSeconds(set.restSec);
      const restString = formatRestValue(set.restSec, restSeconds);
      const justLift = Boolean(set.justLift);
      const stopAtTop = Boolean(set.stopAtTop);
      const progressionMode = mode === 'ECHO' ? PROGRESSION_MODES.NONE : getSetProgressionMode(set);
      const progressionFrequency = getSetProgressionFrequency(set);
      const intensity = mode === 'ECHO' ? DEFAULT_INTENSITY : normalizeIntensity(set.intensity);
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
        overloadValue: set.overloadValue ?? '',
        progressionPercent: set.progressionPercent ?? '',
        progressionMode,
        progressionFrequency,
        weightUnit: currentUnit,
        progressionUnit: currentUnit,
        restSec: restString,
        justLift,
        stopAtTop,
        intensity
      };
      const builderMeta = {
        ...baseMeta,
        setIndex,
        setData
      };

      let planItem = null;

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

        planItem = {
          type: 'echo',
          name: displayName,
          setName: set.name || '',
          groupNumber: set.groupNumber || '',
          level: levelIndex,
          eccentricPct: eccentric,
          targetReps: 0,
          sets: 1,
          restSec: restSeconds,
          justLift: true,
          stopAtTop,
          videos,
          intensity: DEFAULT_INTENSITY,
          builderMeta,
          weightUnit: currentUnit,
          exerciseIdNew: exerciseNumericId
        };
      } else {
        const perCableKg = roundKg(Math.max(0, toPerCableKg(set.weight)));
        const modeCode = PROGRAM_MODE_MAP[mode] ?? PROGRAM_MODE_MAP.OLD_SCHOOL;
        const progressionDisplay = set.progression || '';
        let progressionKg = 0;
        const progressionNumber = Number.parseFloat(progressionDisplay);
        if (Number.isFinite(progressionNumber)) {
          progressionKg = clamp(roundKg(toPerCableKg(progressionNumber)), -3, 3);
        }
        const overloadDisplay = set.overloadValue || '';
        let progressiveOverloadKg = 0;
        const overloadNumber = Number.parseFloat(overloadDisplay);
        if (Number.isFinite(overloadNumber)) {
          progressiveOverloadKg = clamp(roundKg(toPerCableKg(overloadNumber)), -3, 3);
        }
        const parsedPercent = Number.parseFloat(set.progressionPercent);
        const progressionPercent = Number.isFinite(parsedPercent) ? clamp(parsedPercent, -100, 400) : null;

        planItem = {
          type: 'exercise',
          name: displayName,
          setName: set.name || '',
          groupNumber: set.groupNumber || '',
          mode: modeCode,
          perCableKg,
          reps: parseReps(set.reps),
          sets: 1,
          restSec: restSeconds,
          progressionKg,
          progressionDisplay: progressionDisplay || '',
          progressionUnit: currentUnit,
          progressionPercent,
          progressiveOverloadKg,
          progressiveOverloadDisplay: overloadDisplay || '',
          progressiveOverloadUnit: currentUnit,
          progressiveOverloadPercent: progressionPercent,
          progressionMode,
          progressionFrequency,
          justLift,
          stopAtTop,
          intensity,
          cables: 2,
          videos,
          builderMeta,
          weightUnit: currentUnit,
          exerciseIdNew: exerciseNumericId
        };
      }

      if (previousPlanItem && canMergePlanItems(previousPlanItem, planItem)) {
        previousPlanItem.sets = (previousPlanItem.sets || 1) + 1;
        previousPlanItem.builderMeta.setCount = (previousPlanItem.builderMeta.setCount || 1) + 1;
      } else {
        planItem.builderMeta.setCount = 1;
        items.push(planItem);
        previousPlanItem = planItem;
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
  const numericIdFromItem =
    toNumericExerciseId(item?.exerciseIdNew) ??
    toNumericExerciseId(meta?.exerciseIdNew);
  let exerciseId =
    meta && typeof meta.exerciseId === 'string' && meta.exerciseId.trim()
      ? meta.exerciseId.trim()
      : entryId;
  const catalogueMatch = findCatalogueExercise(exerciseId, numericIdFromItem);
  const resolvedNumericId = toNumericExerciseId(catalogueMatch?.id_new) ?? numericIdFromItem;
  if ((!exerciseId || exerciseId === entryId) && catalogueMatch?.id) {
    exerciseId = catalogueMatch.id;
  }

  const baseExercise = {
    id: exerciseId,
    name: exerciseName,
    muscleGroups: [],
    muscles: [],
    equipment: [],
    videos: sourceVideos
  };
  if (resolvedNumericId !== null) {
    baseExercise.id_new = resolvedNumericId;
  }

  const modeValue = Number.isFinite(Number(item?.mode)) ? Number(item.mode) : null;
  const targetUnit = getStateWeightUnit();

  const buildSet = () => {
    const set = createSet();
    const setData = meta && meta.setData ? meta.setData : {};
    const fallbackRest = Number.isFinite(Number(item?.restSec)) ? Number(item.restSec) : DEFAULT_REST_SECONDS;
    const storedWeightUnit =
      normalizeWeightUnit(item?.weightUnit) ||
      normalizeWeightUnit(item?.progressionUnit) ||
      normalizeWeightUnit(setData.weightUnit);
    const storedProgressionUnit =
      normalizeWeightUnit(item?.progressionUnit) ||
      normalizeWeightUnit(item?.weightUnit) ||
      normalizeWeightUnit(setData.progressionUnit) ||
      storedWeightUnit;

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
      set.weight =
        typeof setData.weight === 'string'
          ? convertWeightStringValue(setData.weight, storedWeightUnit, targetUnit)
          : '';
      set.progression =
        typeof setData.progression === 'string'
          ? convertWeightStringValue(setData.progression, storedProgressionUnit, targetUnit)
          : '';
      set.progressionPercent =
        typeof setData.progressionPercent === 'string' ? setData.progressionPercent : '';
      set.overloadValue =
        typeof setData.overloadValue === 'string'
          ? convertWeightStringValue(setData.overloadValue, storedProgressionUnit, targetUnit)
          : '';
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
      if (typeof setData.weight === 'string' && setData.weight.trim()) {
        set.weight = convertWeightStringValue(setData.weight, storedWeightUnit, targetUnit);
      } else {
        set.weight = formatWeightForUnit(item?.perCableKg);
      }
      set.progression =
        typeof setData.progression === 'string' && setData.progression.trim()
          ? convertWeightStringValue(setData.progression, storedProgressionUnit, targetUnit)
          : (() => {
              const progressionKg = Number.isFinite(Number(item?.progressionKg))
                ? Number(item.progressionKg)
                : null;
              return progressionKg == null ? '' : formatWeightForUnit(progressionKg);
            })();
      set.overloadValue =
        typeof setData.overloadValue === 'string' && setData.overloadValue.trim()
          ? convertWeightStringValue(setData.overloadValue, storedProgressionUnit, targetUnit)
          : (() => {
              const overloadKg = Number.isFinite(Number(item?.progressiveOverloadKg))
                ? Number(item.progressiveOverloadKg)
                : null;
              return overloadKg == null || overloadKg === 0 ? '' : formatWeightForUnit(overloadKg);
            })();
      set.progressionPercent =
        typeof setData.progressionPercent === 'string'
          ? setData.progressionPercent
          : Number.isFinite(Number(item?.progressionPercent))
            ? String(Number(item.progressionPercent))
            : '';
    }
    set.restSec = formatRestValue(setData.restSec, fallbackRest);
    set.justLift =
      typeof setData.justLift === 'boolean'
        ? setData.justLift
        : Boolean(item?.justLift);
    set.stopAtTop =
      typeof setData.stopAtTop === 'boolean'
        ? setData.stopAtTop
        : Boolean(item?.stopAtTop);
    if (set.mode === 'ECHO') {
      set.stopAtTop = false;
      set.intensity = DEFAULT_INTENSITY;
    } else {
      const rawIntensity = setData.intensity ?? item?.intensity ?? DEFAULT_INTENSITY;
      set.intensity = normalizeIntensity(rawIntensity);
    }
    applyStoredProgressionConfig(set, setData, item);
    return set;
  };

  const totalSets = Number.isFinite(Number(item?.sets)) ? Math.max(1, Number(item.sets)) : 1;
  const sets = [];
  for (let i = 0; i < totalSets; i += 1) {
    sets.push(buildSet());
  }

  return {
    id: entryId,
    exercise: attachExerciseIdentifiers(baseExercise, { numericId: resolvedNumericId }),
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

  const detectedUnit = detectPlanWeightUnit(planItems);
  if (detectedUnit && detectedUnit !== state.weightUnit) {
    state.weightUnit = detectedUnit;
  }
  const targetUnit = getStateWeightUnit();

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
        const fallbackNumericId = toNumericExerciseId(group.meta?.exerciseIdNew);
        const catalogue = findCatalogueExercise(exerciseId, fallbackNumericId);
        const resolvedExercise = attachExerciseIdentifiers(
          catalogue
            ? {
                ...catalogue,
                videos: videos.length ? videos : Array.isArray(catalogue.videos) ? catalogue.videos : []
              }
            : (() => {
                const base = {
                  id: exerciseId,
                  name: exerciseName,
                  muscleGroups: [],
                  muscles: [],
                  equipment: [],
                  videos
                };
                if (fallbackNumericId !== null) base.id_new = fallbackNumericId;
                return base;
              })(),
          { numericId: fallbackNumericId }
        );

        const sortedSets = group.items
          .slice()
          .sort((a, b) => {
            const idxA = Number.isFinite(Number(a.meta?.setIndex)) ? Number(a.meta.setIndex) : a.index;
            const idxB = Number.isFinite(Number(b.meta?.setIndex)) ? Number(b.meta.setIndex) : b.index;
            return idxA - idxB;
          });

        const sets = [];
        sortedSets.forEach(({ meta: itemMeta, item }) => {
          const setData = itemMeta.setData || {};
          const type = item?.type === 'echo' || setData.mode === 'ECHO' ? 'ECHO' : 'PROGRAM';
          const storedWeightUnit =
            normalizeWeightUnit(setData.weightUnit) ||
            normalizeWeightUnit(item?.weightUnit) ||
            normalizeWeightUnit(item?.progressionUnit);
          const storedProgressionUnit =
            normalizeWeightUnit(setData.progressionUnit) ||
            normalizeWeightUnit(item?.progressionUnit) ||
            storedWeightUnit;

          const setCount =
            Math.max(
              1,
              Number.isFinite(Number(item?.sets))
                ? Number(item.sets)
                : Number.isFinite(Number(itemMeta?.setCount))
                  ? Number(itemMeta.setCount)
                  : 1
            );

          for (let repeat = 0; repeat < setCount; repeat += 1) {
            const set = createSet();
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
            if (typeof setData.weight === 'string' && setData.weight.trim()) {
              set.weight = convertWeightStringValue(setData.weight, storedWeightUnit, targetUnit);
            }
            if (typeof setData.progression === 'string' && setData.progression.trim()) {
              set.progression = convertWeightStringValue(setData.progression, storedProgressionUnit, targetUnit);
            }
            if (typeof setData.overloadValue === 'string' && setData.overloadValue.trim()) {
              set.overloadValue = convertWeightStringValue(setData.overloadValue, storedProgressionUnit, targetUnit);
            } else {
              const overloadKg = Number.isFinite(Number(item?.progressiveOverloadKg))
                ? Number(item.progressiveOverloadKg)
                : null;
              if (overloadKg !== null && overloadKg !== 0) {
                set.overloadValue = formatWeightForUnit(overloadKg);
              }
            }
            set.progressionPercent =
              typeof setData.progressionPercent === 'string'
                ? setData.progressionPercent
                : set.progressionPercent;
            applyStoredProgressionConfig(set, setData, item);
            const fallbackRest = Number.isFinite(Number(item?.restSec)) ? Number(item.restSec) : DEFAULT_REST_SECONDS;
            set.restSec = formatRestValue(setData.restSec, fallbackRest);
            set.justLift =
              typeof setData.justLift === 'boolean'
                ? setData.justLift
                : Boolean(item?.justLift);
            set.stopAtTop =
              typeof setData.stopAtTop === 'boolean'
                ? setData.stopAtTop
                : Boolean(item?.stopAtTop);
            if (set.mode === 'ECHO') {
              set.stopAtTop = false;
            }
            set.name = typeof item?.setName === 'string' ? item.setName : '';
            set.groupNumber = typeof item?.groupNumber === 'string' ? item.groupNumber : '';

            sets.push(set);
          }
        });

        if (!sets.length) {
          sets.push(createSet());
        }

        state.builder.order.push(resolvedExercise.id);
        state.builder.items.set(resolvedExercise.id, {
          exercise: {
            id: resolvedExercise.id,
            id_new: resolvedExercise.id_new,
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
          exercise: attachExerciseIdentifiers(legacyEntry.exercise),
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
  const setCount = planItems.reduce((total, item) => {
    const setsValue = Number(item?.sets);
    return total + (Number.isFinite(setsValue) && setsValue > 0 ? setsValue : 1);
  }, 0);
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
  if (set.overloadValue === undefined || set.overloadValue === null) {
    set.overloadValue = '';
  }
  if (
    !set.overloadValue &&
    typeof set.progressionMode === 'string' &&
    set.progressionMode === PROGRESSION_MODES.FLAT &&
    typeof set.progression === 'string' &&
    set.progression.trim()
  ) {
    set.overloadValue = set.progression;
    set.progression = '';
  }
  if (set.restSec === undefined || set.restSec === null || set.restSec === '') {
    set.restSec = String(DEFAULT_REST_SECONDS);
  }
  if (typeof set.justLift !== 'boolean') {
    set.justLift = set.justLift === true || set.justLift === 'true' || set.justLift === 1 || set.justLift === '1';
  }
  if (typeof set.stopAtTop !== 'boolean') {
    set.stopAtTop =
      set.stopAtTop === true || set.stopAtTop === 'true' || set.stopAtTop === 1 || set.stopAtTop === '1';
  }
  if (set.mode === 'ECHO') {
    set.stopAtTop = false;
  }
  set.intensity = normalizeIntensity(set.intensity);

  const setCell = document.createElement('td');
  setCell.textContent = index + 1;

  if (!set.mode) set.mode = 'OLD_SCHOOL';
  if (!set.echoLevel) set.echoLevel = ECHO_LEVELS[0].value;

  const nameCell = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'e.g., A1, Exercise, Echo Block';
  nameInput.value = set.name || '';
  nameInput.addEventListener('input', () => {
    set.name = nameInput.value;
  });
  nameInput.addEventListener('change', () => {
    const finalValue = nameInput.value;
    set.name = finalValue;
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.name !== finalValue) {
        target.name = finalValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  nameCell.appendChild(nameInput);

  const groupCell = document.createElement('td');
  const groupInput = document.createElement('input');
  groupInput.type = 'text';
  groupInput.placeholder = 'e.g., 1, 2, 3';
  groupInput.value = set.groupNumber || '';
  groupInput.addEventListener('input', () => {
    set.groupNumber = groupInput.value;
  });
  groupInput.addEventListener('change', () => {
    const finalValue = groupInput.value;
    set.groupNumber = finalValue;
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.groupNumber !== finalValue) {
        target.groupNumber = finalValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  groupCell.appendChild(groupInput);

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

  const repProgressionCell = document.createElement('td');
  const repProgressionWrapper = document.createElement('div');
  const repProgressionInput = document.createElement('input');
  repProgressionInput.type = 'number';
  repProgressionInput.step = weightInput.step;
  repProgressionInput.min = '-100';
  repProgressionInput.max = weightInput.max;
  repProgressionInput.placeholder = `Δ ${getWeightLabel()}`;
  repProgressionInput.value = set.progression;
  repProgressionInput.addEventListener('input', () => {
    set.progression = repProgressionInput.value;
  });
  repProgressionInput.addEventListener('change', () => {
    const finalValue = repProgressionInput.value;
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
  repProgressionWrapper.appendChild(repProgressionInput);
  repProgressionCell.appendChild(repProgressionWrapper);

  const progressionCell = document.createElement('td');
  progressionCell.className = 'progression-cell';
  const progressionFlatWrapper = document.createElement('div');
  progressionFlatWrapper.className = 'progression-input flat';
  const progressionInput = document.createElement('input');
  progressionInput.type = 'number';
  progressionInput.step = weightInput.step;
  progressionInput.min = '-100';
  progressionInput.max = weightInput.max;
  progressionInput.placeholder = `Δ ${getWeightLabel()}`;
  progressionInput.value = set.overloadValue;
  progressionInput.addEventListener('input', () => {
    set.overloadValue = progressionInput.value;
  });
  progressionInput.addEventListener('change', () => {
    const finalValue = progressionInput.value;
    set.overloadValue = finalValue;
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.overloadValue !== finalValue) {
        target.overloadValue = finalValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  progressionFlatWrapper.appendChild(progressionInput);

  const progressionPercentWrapper = document.createElement('div');
  progressionPercentWrapper.className = 'progression-input percent';
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
  progressionPercentWrapper.appendChild(progressionPercentInput);

  const progressionEmptyLabel = document.createElement('span');
  progressionEmptyLabel.className = 'muted progression-placeholder';
  progressionEmptyLabel.textContent = '—';

  progressionCell.append(progressionPercentWrapper, progressionFlatWrapper, progressionEmptyLabel);

  const updateProgressionInputs = () => {
    const modeValue = getSetProgressionMode(set);
    const showFlat = modeValue === PROGRESSION_MODES.FLAT;
    const showPercent = modeValue === PROGRESSION_MODES.PERCENT;
    progressionFlatWrapper.style.display = showFlat ? '' : 'none';
    progressionPercentWrapper.style.display = showPercent ? '' : 'none';
    progressionEmptyLabel.textContent = '—';
    progressionEmptyLabel.style.display = modeValue === PROGRESSION_MODES.NONE ? '' : 'none';
  };

  updateProgressionInputs();

  const intensityCell = document.createElement('td');
  intensityCell.className = 'intensity-cell';
  const intensityWrapper = document.createElement('div');
  intensityWrapper.className = 'intensity-select';
  const intensitySelect = document.createElement('select');
  INTENSITY_OPTIONS.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = opt.value === set.intensity;
    intensitySelect.appendChild(option);
  });
  intensitySelect.addEventListener('change', () => {
    const chosen = normalizeIntensity(intensitySelect.value);
    set.intensity = chosen;
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.mode === 'ECHO') {
        target.intensity = DEFAULT_INTENSITY;
        return;
      }
      const normalized = normalizeIntensity(target.intensity);
      if (normalized !== chosen) {
        target.intensity = chosen;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  intensityWrapper.appendChild(intensitySelect);
  intensityCell.appendChild(intensityWrapper);

  const restCell = document.createElement('td');
  const restWrapper = document.createElement('div');
  const restInput = document.createElement('input');
  restInput.type = 'number';
  restInput.min = '0';
  restInput.step = '1';
  restInput.placeholder = String(DEFAULT_REST_SECONDS);
  restInput.setAttribute('aria-label', 'Rest time in seconds');
  restInput.value = formatRestValue(set.restSec, parseRestSeconds(set.restSec));
  restInput.addEventListener('input', () => {
    set.restSec = restInput.value;
  });
  const applyRestValue = () => {
    const sanitized = formatRestValue(restInput.value, DEFAULT_REST_SECONDS);
    restInput.value = sanitized;
    set.restSec = sanitized;
    return sanitized;
  };
  restInput.addEventListener('change', () => {
    const finalValue = applyRestValue();
    let updated = false;
    propagateSetValue(entry, index, (target) => {
      if (target.restSec !== finalValue) {
        target.restSec = finalValue;
        updated = true;
      }
    });
    persistState();
    if (updated) {
      triggerRender();
    }
  });
  restWrapper.appendChild(restInput);
  restCell.appendChild(restWrapper);

  const justLiftCell = document.createElement('td');
  justLiftCell.className = 'set-flag';
  const justLiftWrapper = document.createElement('div');
  justLiftWrapper.className = 'flag-control';
  const justLiftCheckbox = document.createElement('input');
  justLiftCheckbox.type = 'checkbox';
  justLiftCheckbox.checked = Boolean(set.justLift);
  justLiftCheckbox.setAttribute('aria-label', 'Enable Just Lift (no target reps)');
  justLiftCheckbox.addEventListener('change', () => {
    set.justLift = justLiftCheckbox.checked;
    if (set.justLift && set.mode !== 'ECHO') {
      set.reps = '';
      repsInput.value = '';
    }
    persistState();
    updateRepEditor();
  });
  justLiftWrapper.appendChild(justLiftCheckbox);
  const justLiftNote = document.createElement('div');
  justLiftNote.className = 'flag-note muted small';
  justLiftNote.textContent = 'Always on in Echo Mode';
  justLiftCell.append(justLiftWrapper, justLiftNote);

  const stopAtTopCell = document.createElement('td');
  stopAtTopCell.className = 'set-flag';
  const stopAtTopWrapper = document.createElement('div');
  stopAtTopWrapper.className = 'flag-control';
  const stopAtTopCheckbox = document.createElement('input');
  stopAtTopCheckbox.type = 'checkbox';
  stopAtTopCheckbox.checked = Boolean(set.stopAtTop);
  stopAtTopCheckbox.setAttribute('aria-label', 'Stop at the top of your final rep');
  stopAtTopCheckbox.addEventListener('change', () => {
    set.stopAtTop = stopAtTopCheckbox.checked;
    persistState();
  });
  stopAtTopWrapper.appendChild(stopAtTopCheckbox);
  const stopAtTopNote = document.createElement('div');
  stopAtTopNote.className = 'flag-note muted small';
  stopAtTopNote.textContent = 'Disabled in Echo Mode';
  stopAtTopNote.style.display = 'none';
  stopAtTopCell.append(stopAtTopWrapper, stopAtTopNote);

  const updateWeightVisibility = () => {
    const isEcho = set.mode === 'ECHO';
    if (isEcho) {
      weightWrapper.style.display = 'none';
      repProgressionWrapper.style.display = 'none';
      progressionFlatWrapper.style.display = 'none';
      progressionPercentWrapper.style.display = 'none';
      progressionEmptyLabel.textContent = 'Echo';
      progressionEmptyLabel.style.display = '';
      if (!modeCell.contains(echoWrapper)) modeCell.appendChild(echoWrapper);
      if (!echoNote.parentElement) weightCell.appendChild(echoNote);
    } else {
      weightWrapper.style.display = '';
       repProgressionWrapper.style.display = '';
      updateProgressionInputs();
      if (echoWrapper.parentElement === modeCell) echoWrapper.remove();
      if (echoNote.parentElement === weightCell) echoNote.remove();
      weightInput.value = set.weight || '';
      repProgressionInput.value = set.progression || '';
      progressionInput.value = set.overloadValue || '';
      progressionPercentInput.value = set.progressionPercent || '';
    }
  };

  const updateRepEditor = () => {
    const isEcho = set.mode === 'ECHO';
    const hideReps = isEcho || Boolean(set.justLift);
    repsWrapper.style.display = hideReps ? 'none' : '';
    eccentricWrapper.style.display = isEcho ? '' : 'none';
  };

  const updateJustLiftControl = () => {
    const isEcho = set.mode === 'ECHO';
    justLiftWrapper.style.display = isEcho ? 'none' : '';
    justLiftCheckbox.disabled = isEcho;
    justLiftNote.style.display = isEcho ? '' : 'none';
  };

  const updateStopAtTopControl = () => {
    const isEcho = set.mode === 'ECHO';
    stopAtTopWrapper.style.display = isEcho ? 'none' : '';
    stopAtTopCheckbox.disabled = isEcho;
    stopAtTopNote.style.display = isEcho ? '' : 'none';
    if (isEcho && set.stopAtTop) {
      set.stopAtTop = false;
      stopAtTopCheckbox.checked = false;
    }
  };

  const updateIntensityControl = () => {
    const isEcho = set.mode === 'ECHO';
    intensityWrapper.style.display = isEcho ? 'none' : '';
    intensitySelect.disabled = isEcho;
    if (isEcho) {
      set.intensity = DEFAULT_INTENSITY;
      intensitySelect.value = DEFAULT_INTENSITY;
    } else {
      intensitySelect.value = set.intensity || DEFAULT_INTENSITY;
    }
  };

  modeSelect.addEventListener('change', () => {
    set.mode = modeSelect.value;
    if (set.mode === 'ECHO' && !Number.isFinite(Number.parseInt(set.eccentricPct, 10))) {
      set.eccentricPct = 100;
    }
    if (set.mode === 'ECHO' && set.stopAtTop) {
      set.stopAtTop = false;
      stopAtTopCheckbox.checked = false;
    }
    updateIntensityControl();
    persistState();
    triggerRender();
  });

  updateWeightVisibility();
  updateRepEditor();
  updateJustLiftControl();
  updateStopAtTopControl();
  updateIntensityControl();

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

  tr.append(
    setCell,
    nameCell,
    groupCell,
    modeCell,
    repsCell,
    weightCell,
    repProgressionCell,
    progressionCell,
    intensityCell,
    restCell,
    justLiftCell,
    stopAtTopCell,
    actionsCell
  );
  return tr;
};

export const addExerciseToBuilder = (exercise, options = {}) => {
  const normalized = attachExerciseIdentifiers(exercise);
  const targetId = normalized.id;
  if (!targetId || state.builder.items.has(targetId)) return;
  const entry = {
    exercise: {
      id: normalized.id,
      id_new: normalized.id_new,
      name: normalized.name,
      muscleGroups: normalized.muscleGroups || [],
      muscles: normalized.muscles || [],
      equipment: normalized.equipment || [],
      videos: normalized.videos || []
    },
    sets: [createSet()]
  };
  state.builder.items.set(targetId, entry);

  const grouping = getActiveGrouping();
  const insertIndex = Number.isInteger(options.insertIndex)
    ? Math.max(0, Math.min(options.insertIndex, state.builder.order.length))
    : null;
  if (insertIndex !== null) {
    state.builder.order.splice(insertIndex, 0, targetId);
  } else if (grouping) {
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
        state.builder.order.splice(insertPos, 0, targetId);
        inserted = true;
        break;
      }
    }
    if (!inserted) state.builder.order.push(targetId);
  } else {
    state.builder.order.push(targetId);
  }
  if (grouping) {
    applyGrouping(grouping);
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

  const isAnalytics = state.activePanel === 'analytics';
  const isBuilder = !isAnalytics && state.activeTab === 'builder';
  const isLibrary = !isAnalytics && !isBuilder;

  if (els.tabBuilder) els.tabBuilder.classList.toggle('active', isBuilder);
  if (els.tabLibrary) els.tabLibrary.classList.toggle('active', isLibrary);
  if (els.tabAnalytics) els.tabAnalytics.classList.toggle('active', isAnalytics);

  if (els.builderPanel) els.builderPanel.classList.toggle('active', isBuilder);
  if (els.libraryPanel) els.libraryPanel.classList.toggle('active', isLibrary);
  if (els.analyticsPanel) els.analyticsPanel.classList.toggle('active', isAnalytics);

  document.body.classList.toggle('builder-active', isBuilder);
  document.body.classList.toggle('analytics-active', isAnalytics);
};

export const switchTab = (tab) => {
  state.activePanel = 'library';
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
  const totalPlannedSets = planItems.reduce((total, item) => {
    const setsValue = Number(item?.sets);
    return total + (Number.isFinite(setsValue) && setsValue > 0 ? setsValue : 1);
  }, 0);

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
      itemCount: totalPlannedSets
    };
  }

  const baseOccurrenceDate = occurrences.length ? occurrences[0] : null;
  const plans = occurrences.map((date, occurrenceIndex) => {
    const iso = formatISODate(date);
    const items = planItems.map((item) => {
      if (item.type !== 'exercise') {
        return { ...item };
      }

      const copy = { ...item };
      const progressionMode = normalizeProgressionMode(item.progressionMode) || PROGRESSION_MODES.NONE;
      const progressionFrequency =
        normalizeProgressionFrequency(item.progressionFrequency) || DEFAULT_PROGRESSION_FREQUENCY;
      const percent = Number.isFinite(item.progressiveOverloadPercent)
        ? item.progressiveOverloadPercent
        : Number.isFinite(item.progressionPercent)
          ? item.progressionPercent
          : null;
      const flatKg = Number.isFinite(item.progressiveOverloadKg) ? item.progressiveOverloadKg : 0;
      const hasPercent =
        progressionMode === PROGRESSION_MODES.PERCENT && percent !== null && percent !== 0;
      const hasFlat = progressionMode === PROGRESSION_MODES.FLAT && flatKg !== 0;

      if (baseOccurrenceDate && (hasPercent || hasFlat)) {
        const steps = getProgressionStepCount(
          baseOccurrenceDate,
          date,
          progressionFrequency,
          occurrenceIndex
        );
        if (steps > 0) {
          const basePerCableKg = item.perCableKg;
          let nextWeight = basePerCableKg;
          if (hasPercent) {
            nextWeight = basePerCableKg * (1 + (percent / 100) * steps);
          } else if (hasFlat && basePerCableKg > 0) {
            nextWeight = basePerCableKg + flatKg * steps;
          }
          copy.perCableKg = roundKg(Math.max(0, nextWeight));
        }
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
    itemCount: totalPlannedSets
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
      'Progressive Overload Type',
      'Progressive Overload Value',
      'Every',
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
      const progressionMode = set.mode === 'ECHO' ? PROGRESSION_MODES.NONE : getSetProgressionMode(set);
      const progressionTypeLabel =
        progressionMode === PROGRESSION_MODES.NONE ? '' : PROGRESSION_TYPE_LABELS[progressionMode];
      const progressionValue =
        set.mode === 'ECHO'
          ? ''
          : set.progression || '';
      const overloadValue =
        progressionMode === PROGRESSION_MODES.PERCENT
          ? set.progressionPercent
            ? `${set.progressionPercent}%`
            : ''
          : progressionMode === PROGRESSION_MODES.FLAT
            ? set.overloadValue || ''
            : '';
      const progressionFrequency =
        progressionMode === PROGRESSION_MODES.NONE
          ? ''
          : PROGRESSION_FREQUENCY_LABELS[getSetProgressionFrequency(set)] || '';
      rows.push([
        entry.exercise.name,
        (idx + 1).toString(),
        getModeLabel(set),
        repsDisplay,
        weightValue,
        progressionValue,
        progressionTypeLabel,
        overloadValue,
        progressionFrequency,
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
        const progressionMode = set.mode === 'ECHO' ? PROGRESSION_MODES.NONE : getSetProgressionMode(set);
        const perRepProgression = set.mode === 'ECHO' ? '' : (set.progression || '');
        let overloadDisplay = '';
        if (progressionMode === PROGRESSION_MODES.PERCENT && set.progressionPercent) {
          overloadDisplay = `${PROGRESSION_TYPE_SHORT_LABELS[PROGRESSION_MODES.PERCENT]}: ${set.progressionPercent}%`;
        } else if (progressionMode === PROGRESSION_MODES.FLAT && set.overloadValue) {
          overloadDisplay = `${PROGRESSION_TYPE_SHORT_LABELS[PROGRESSION_MODES.FLAT]}: ${set.overloadValue} ${weightLabel}`;
        }
        const overloadFrequencyLabel =
          progressionMode === PROGRESSION_MODES.NONE
            ? ''
            : PROGRESSION_FREQUENCY_LABELS[getSetProgressionFrequency(set)] || '';
        return `<tr><td>${idx + 1}</td><td>${getModeLabel(set)}</td><td>${repsDisplay}</td><td>${weightValue}</td><td>${perRepProgression}</td><td>${overloadDisplay}</td><td>${overloadFrequencyLabel}</td>${checkboxCell}</tr>`;
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
          <thead><tr><th>Set</th><th>Mode</th><th>Reps / Ecc%</th><th>Weight (${weightLabel})</th><th>Progression (${weightLabel})</th><th>Progressive Overload</th><th>Every</th>${checkboxHeader}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  const printHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Workout</title>
    <style>
      @page {
        size: landscape;
        margin: 0.5in;
      }
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { margin-bottom: 8px; }
      section { margin-bottom: 24px; page-break-inside: avoid; }
      section table { margin-top: 8px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
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
  const renderedSlots = new Set();
  const appendSlot = (parent, index, options = {}) => {
    if (!parent || renderedSlots.has(index)) return;
    parent.appendChild(createCustomExerciseSlot(index, options));
    renderedSlots.add(index);
  };
  if (!order.length) {
    els.builderList.classList.remove('grouped');
    els.builderList.innerHTML = '<div class="empty">Add exercises from the library to build a custom workout.</div>';
    const slotWrapper = document.createElement('div');
    slotWrapper.className = 'builder-custom-empty-wrapper';
    slotWrapper.appendChild(
      createCustomExerciseSlot(0, { showCard: true, hint: 'Hover to add a Dropbox custom exercise.' })
    );
    els.builderList.appendChild(slotWrapper);
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
        appendSlot(body, orderIndexMap.get(id) ?? displayIndex - 1);
        const { card, setCount } = buildBuilderCard(entry, displayIndex, {
          groupColor: group.color,
          groupKey: group.key,
          orderIndex: orderIndexMap.get(id) ?? displayIndex - 1,
          totalCount
        });
        setTotal += setCount;
        body.appendChild(card);
        appendSlot(body, (orderIndexMap.get(id) ?? displayIndex - 1) + 1);
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
      appendSlot(els.builderList, idx);
      const { card, setCount } = buildBuilderCard(entry, idx + 1, {
        orderIndex: idx,
        totalCount
      });
      setTotal += setCount;
      els.builderList.appendChild(card);
      appendSlot(els.builderList, idx + 1);
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

  const getSharedProgressionMode = () => {
    if (!entry.sets.length) return PROGRESSION_MODES.NONE;
    const base = getSetProgressionMode(entry.sets[0]);
    return entry.sets.every((set) => getSetProgressionMode(set) === base) ? base : null;
  };

  const getSharedFrequency = () => {
    if (!entry.sets.length) return DEFAULT_PROGRESSION_FREQUENCY;
    const base = getSetProgressionFrequency(entry.sets[0]);
    return entry.sets.every((set) => getSetProgressionFrequency(set) === base) ? base : null;
  };

  const buildToggleGroup = (options, onSelect) => {
    const group = document.createElement('div');
    group.className = 'btn-toggle-group';
    const buttons = options.map((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-toggle';
      btn.textContent = opt.label;
      btn.dataset.value = opt.value;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        onSelect(opt.value);
      });
      group.appendChild(btn);
      return btn;
    });
    return { group, buttons };
  };

  const modeControl = document.createElement('div');
  modeControl.className = 'bulk-control';
  const modeLabel = document.createElement('span');
  modeLabel.textContent = 'Progressive Overload';
  modeLabel.title =
    'Automatically increase your working weight each workout, day, week, or month using % or flat increments.';
  const progressionOptions = [
    { value: PROGRESSION_MODES.NONE, label: 'No Increase' },
    { value: PROGRESSION_MODES.PERCENT, label: '%' },
    { value: PROGRESSION_MODES.FLAT, label: 'Flat' }
  ];
  const { group: modeGroup, buttons: modeButtons } = buildToggleGroup(progressionOptions, (value) => {
    entry.sets.forEach((set) => {
      set.progressionMode = value;
    });
    persistState();
    triggerRender();
  });
  modeControl.append(modeLabel, modeGroup);
  bulkControls.appendChild(modeControl);

  const frequencyControl = document.createElement('div');
  frequencyControl.className = 'bulk-control';
  const frequencyLabel = document.createElement('span');
  frequencyLabel.textContent = 'Every';
  const frequencyOptions = [
    { value: PROGRESSION_FREQUENCIES.WORKOUT, label: 'Workout' },
    { value: PROGRESSION_FREQUENCIES.DAILY, label: 'Day' },
    { value: PROGRESSION_FREQUENCIES.WEEKLY, label: 'Week' },
    { value: PROGRESSION_FREQUENCIES.MONTHLY, label: 'Month' }
  ];
  const { group: frequencyGroup, buttons: frequencyButtons } = buildToggleGroup(frequencyOptions, (value) => {
    entry.sets.forEach((set) => {
      set.progressionFrequency = value;
    });
    persistState();
    triggerRender();
  });
  frequencyControl.append(frequencyLabel, frequencyGroup);
  bulkControls.appendChild(frequencyControl);

  const quickControl = document.createElement('div');
  quickControl.classList.add('bulk-control');
  quickControl.title = PROGRESSIVE_OVERLOAD_TOOLTIP;
  const quickLabel = document.createElement('span');
  quickLabel.textContent = 'Quick %';
  const quickSelect = document.createElement('select');
  quickControl.append(quickLabel, quickSelect);
  bulkControls.appendChild(quickControl);

  let activeQuickMode = PROGRESSION_MODES.FLAT;
  const refreshQuickOptions = (mode) => {
    activeQuickMode = mode === PROGRESSION_MODES.PERCENT ? PROGRESSION_MODES.PERCENT : PROGRESSION_MODES.FLAT;
    const isPercent = activeQuickMode === PROGRESSION_MODES.PERCENT;
    quickLabel.textContent = isPercent ? 'Quick %' : 'Quick Flat';
    const values = isPercent ? QUICK_PERCENT_VALUES : QUICK_FLAT_VALUES;
    quickSelect.innerHTML = '';
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      if (!value) {
        option.textContent = 'Custom';
      } else if (isPercent) {
        option.textContent = `${value}%`;
      } else {
        option.textContent = `${value} ${getWeightLabel()}`;
      }
      quickSelect.appendChild(option);
    });
    quickSelect.value = '';
  };

  quickSelect.addEventListener('change', () => {
    const chosen = quickSelect.value;
    if (!chosen) return;
    entry.sets.forEach((set) => {
      if (activeQuickMode === PROGRESSION_MODES.PERCENT) {
        set.progressionPercent = chosen;
        set.overloadValue = '';
        set.progressionMode = PROGRESSION_MODES.PERCENT;
      } else {
        set.overloadValue = chosen;
        set.progressionPercent = '';
        set.progressionMode = PROGRESSION_MODES.FLAT;
      }
    });
    quickSelect.value = '';
    persistState();
    triggerRender();
  });

  const updateBulkControls = () => {
    const sharedMode = getSharedProgressionMode();
    const effectiveMode = sharedMode || PROGRESSION_MODES.NONE;
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', sharedMode === btn.dataset.value);
    });
    const sharedFrequency = getSharedFrequency();
    frequencyButtons.forEach((btn) => {
      btn.classList.toggle('active', sharedFrequency === btn.dataset.value);
      btn.disabled = effectiveMode === PROGRESSION_MODES.NONE;
    });
    frequencyControl.classList.toggle('disabled', effectiveMode === PROGRESSION_MODES.NONE);
    const quickMode = effectiveMode === PROGRESSION_MODES.PERCENT ? PROGRESSION_MODES.PERCENT : PROGRESSION_MODES.FLAT;
    refreshQuickOptions(quickMode);
  };

  updateBulkControls();
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
  thead.innerHTML = `<tr>
    <th>Set</th>
    <th>Name</th>
    <th>Group</th>
    <th>Mode</th>
    <th>Reps / Ecc%</th>
    <th>Weight (${getWeightLabel()})</th>
    <th>Progression (${getWeightLabel()})</th>
    <th>Progressive Overload</th>
    <th>
      <span class="intensity-label">
        Intensity
        <button class="info-icon" type="button" aria-label="${INTENSITY_TOOLTIP}" title="${INTENSITY_TOOLTIP}">i</button>
      </span>
    </th>
    <th class="rest-col">Rest (sec)</th>
    <th>Just Lift</th>
    <th>Stop at Top</th>
    <th></th>
  </tr>`;
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
      newSet.progressionMode = getSetProgressionMode(lastSet);
      newSet.progressionFrequency = getSetProgressionFrequency(lastSet);
      newSet.restSec = lastSet.restSec;
      newSet.justLift = lastSet.justLift;
      newSet.stopAtTop = lastSet.stopAtTop;
      newSet.intensity = lastSet.intensity;
    }
    entry.sets.push(newSet);
    triggerRender();
    persistState();
  });

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'sets-table-wrapper';
  tableWrapper.appendChild(table);

  card.append(tableWrapper, addSetBtn);

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
