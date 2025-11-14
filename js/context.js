// Shared application state and common DOM references.
// Import from this module whenever you need to read or mutate global state.

const todayISO = (() => {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
})();

const queryAll = (selector) => {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return [];
  }
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch (error) {
    console.warn('queryAll failed for selector', selector, error);
    return [];
  }
};

export const state = {
  data: [],
  muscles: [],
  subMuscles: [],
  equipment: [],
  filters: {
    muscles: new Set(),
    subMuscles: new Set(),
    equipment: new Set(),
    mode: { muscles: 'OR', subMuscles: 'OR', equipment: 'OR' }
  },
  buttons: { muscles: new Map(), subMuscles: new Map(), equipment: new Map() },
  search: '',
  sortMode: 'AZ',
  shuffleMode: false,
  randomOrderMap: null,
  builder: { order: [], items: new Map() },
  dropboxPlanNames: [],
  availablePlans: [],
  highlightId: null,
  highlightHandled: false,
  activeTab: 'library',
  showWorkoutOnly: false,
  groupByEquipment: false,
  groupByMuscles: false,
  groupByMuscleGroups: false,
  includeCheckboxes: false,
  weightUnit: 'LBS',
  plan: {
    name: '',
    selectedName: '',
    schedule: {
      startDate: todayISO,
      endDate: todayISO,
      repeatInterval: 1,
      daysOfWeek: new Set()
    }
  },
  insights: {
    exercise: '__all__',
    interval: 'week'
  }
};

export const els = {
  muscleFilters: document.getElementById('muscleFilters'),
  subMuscleFilters: document.getElementById('subMuscleFilters'),
  equipmentFilters: document.getElementById('equipmentFilters'),
  clearMuscles: document.getElementById('clearMuscles'),
  clearSubMuscles: document.getElementById('clearSubMuscles'),
  clearEquipment: document.getElementById('clearEquipment'),
  muscleModeBar: document.getElementById('muscleModeBar'),
  muscleModeOR: document.getElementById('muscleModeOR'),
  muscleModeAND: document.getElementById('muscleModeAND'),
  subMuscleModeBar: document.getElementById('subMuscleModeBar'),
  subMuscleModeOR: document.getElementById('subMuscleModeOR'),
  subMuscleModeAND: document.getElementById('subMuscleModeAND'),
  equipmentModeBar: document.getElementById('equipmentModeBar'),
  equipmentModeOR: document.getElementById('equipmentModeOR'),
  equipmentModeAND: document.getElementById('equipmentModeAND'),
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  sortToggle: document.getElementById('sortToggle'),
  randomizeLibrary: document.getElementById('randomizeLibrary'),
  unitToggle: document.getElementById('unitToggle'),
  toggleBuilderFilter: document.getElementById('toggleBuilderFilter'),
  grid: document.getElementById('exerciseGrid'),
  gridTitle: document.getElementById('gridTitle'),
  count: document.getElementById('count'),
  activeFilters: document.getElementById('activeFilters'),
  tabLibrary: document.getElementById('tabLibrary'),
  tabBuilder: document.getElementById('tabBuilder'),
  tabWorkout: document.getElementById('tabWorkout'),
  tabInsights: document.getElementById('tabInsights'),
  libraryPanel: document.getElementById('libraryPanel'),
  builderPanel: document.getElementById('builderPanel'),
  insightsPanel: document.getElementById('insightsPanel'),
  builderList: document.getElementById('builderList'),
  builderSummary: document.getElementById('builderSummary'),
  builderCount: document.getElementById('builderCount'),
  builderMuscles: document.getElementById('builderMuscles'),
  exportWorkout: document.getElementById('exportWorkout'),
  printWorkout: document.getElementById('printWorkout'),
  shareWorkout: document.getElementById('shareWorkout'),
  shuffleBuilder: document.getElementById('shuffleBuilder'),
  groupEquipment: document.getElementById('groupEquipment'),
  groupMuscles: document.getElementById('groupMuscles'),
  groupMuscleGroups: document.getElementById('groupMuscleGroups'),
  clearWorkout: document.getElementById('clearWorkout'),
  includeCheckboxes: document.getElementById('includeCheckboxes'),
  planNameSelect: document.getElementById('planNameSelect'),
  planNameInput: document.getElementById('planNameInput'),
  planSaveButton: document.getElementById('planSaveButton'),
  planRenameButton: document.getElementById('planRenameButton'),
  refreshPlanNames: document.getElementById('refreshPlanNames'),
  deletePlanFromBuilder: document.getElementById('deletePlanFromBuilder'),
  scheduleStart: document.getElementById('scheduleStart'),
  scheduleEnd: document.getElementById('scheduleEnd'),
  scheduleInterval: document.getElementById('scheduleInterval'),
  scheduleDays: document.getElementById('scheduleDays'),
  scheduleCalendar: document.getElementById('scheduleCalendar'),
  connectDropboxButtons: queryAll('[data-role="connect-dropbox"]'),
  syncToDropbox: document.getElementById('syncToDropbox'),
  builderSyncStatus: document.getElementById('builderSyncStatus'),
  modal: document.getElementById('modal'),
  modalVideo: document.getElementById('modalVideo'),
  modalNotice: document.getElementById('modalNotice'),
  modalClose: document.getElementById('modalClose'),
  scrollUp: document.getElementById('scrollUp'),
  scrollDown: document.getElementById('scrollDown'),
  insightsEmptyState: document.getElementById('insightsEmptyState'),
  insightsExerciseSelect: document.getElementById('insightsExerciseSelect'),
  insightsIntervalControls: document.getElementById('insightsIntervalControls'),
  insightsTotalVolume: document.getElementById('insightsTotalVolume'),
  insightsTotalSessions: document.getElementById('insightsTotalSessions'),
  insightsAverageLoad: document.getElementById('insightsAverageLoad'),
  insightsAverageDuration: document.getElementById('insightsAverageDuration'),
  insightsChange: document.getElementById('insightsChange'),
  insightsChangeDetail: document.getElementById('insightsChangeDetail'),
  insightsChartSubtitle: document.getElementById('insightsChartSubtitle'),
  insightsLegendLabel: document.getElementById('insightsLegendLabel'),
  insightsRecentList: document.getElementById('insightsRecentList'),
  insightsVolumeChart: document.getElementById('insightsVolumeChart'),
  insightsDistributionChart: document.getElementById('insightsDistributionChart'),
  insightsBody: document.getElementById('insightsBody')
};

export const groupColorMap = new Map();

let dragDidDrop = false;
export const setDragDidDrop = (value) => {
  dragDidDrop = value;
};
export const getDragDidDrop = () => dragDidDrop;

let searchIndex = null;
export const setSearchIndex = (value) => {
  searchIndex = value;
};
export const getSearchIndex = () => searchIndex;
