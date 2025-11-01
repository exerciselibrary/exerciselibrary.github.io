// Shared application state and common DOM references.
// Import from this module whenever you need to read or mutate global state.

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
  highlightId: null,
  highlightHandled: false,
  activeTab: 'library',
  showWorkoutOnly: false,
  groupByEquipment: false,
  groupByMuscles: false,
  groupByMuscleGroups: false,
  includeCheckboxes: false,
  weightUnit: 'LBS'
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
  libraryPanel: document.getElementById('libraryPanel'),
  builderPanel: document.getElementById('builderPanel'),
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
  modal: document.getElementById('modal'),
  modalVideo: document.getElementById('modalVideo'),
  modalNotice: document.getElementById('modalNotice'),
  modalClose: document.getElementById('modalClose'),
  scrollUp: document.getElementById('scrollUp'),
  scrollDown: document.getElementById('scrollDown')
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
