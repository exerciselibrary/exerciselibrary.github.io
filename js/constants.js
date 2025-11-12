// Centralized constants for the Exercise Library app.
// Keeping these in one place makes it easier to tweak labels or limits
// without digging through the feature code.
import { KG_PER_LB as SHARED_KG_PER_LB, LB_PER_KG as SHARED_LB_PER_KG } from '../shared/weight-utils.js';

export const MAX_CABLE_WEIGHT = 220;
export const MAX_CABLE_WEIGHT_KG = Math.round(MAX_CABLE_WEIGHT * 0.45359237);

export const STORAGE_KEY = 'exercise-library-state-v1';

export const MODE_OPTIONS = [
  { value: 'OLD_SCHOOL', label: 'Old School' },
  { value: 'TIME_UNDER_TENSION', label: 'Time Under Tension' },
  { value: 'TIME_UNDER_TENSION_BEAST', label: 'Time Under Tension Beast Mode' },
  { value: 'PUMP', label: 'Pump' },
  { value: 'ECCENTRIC', label: 'Eccentric' },
  { value: 'ECHO', label: 'Echo Mode' }
];

export const MODE_LABELS = MODE_OPTIONS.reduce((acc, opt) => {
  acc[opt.value] = opt.label;
  return acc;
}, {});

export const ECHO_LEVELS = [
  { value: 'HARD', label: 'Hard' },
  { value: 'HARDER', label: 'Harder' },
  { value: 'HARDEST', label: 'Hardest' },
  { value: 'EPIC', label: 'Epic' }
];

export const SHARE_ICON_HTML = '<span aria-hidden="true">&#128279;</span><span class="sr-only">Share</span>';
export const SHARE_SUCCESS_HTML = '<span aria-hidden="true">&#10003;</span><span class="sr-only">Copied</span>';
export const SHARE_ERROR_HTML = '<span aria-hidden="true">!</span><span class="sr-only">Copy failed</span>';

export const EQUIPMENT_COLORS = [
  '#7aa2f7',
  '#22d3ee',
  '#34d399',
  '#facc15',
  '#f472b6',
  '#fb923c',
  '#a855f7',
  '#f87171',
  '#38bdf8',
  '#fbbf24'
];

export const GROUPING_LABELS = {
  equipment: 'equipment group',
  muscles: 'muscle cluster',
  muscleGroups: 'muscle group'
};

export const KG_PER_LB = SHARED_KG_PER_LB;
export const LB_PER_KG = SHARED_LB_PER_KG;
