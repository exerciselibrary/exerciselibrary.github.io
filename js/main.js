// Entry point for the Exercise Library web app.
// Wires together the shared state, feature modules, and DOM events.
import { state, els, setSearchIndex } from './context.js';
import { uniq, niceName } from './utils.js';
import { buildSearchIndex } from './search.js';
import {
  registerRenderHandler as registerBuilderRender,
  renderBuilder,
  updateUnitToggle,
  toggleWeightUnit,
  updateBuilderBadge,
  switchTab,
  updateBuilderFilterControl,
  updateGroupingButtons,
  toggleGrouping,
  shareWorkout,
  syncSortControls,
  exportWorkout,
  printWorkout,
  handleScrollButtons,
  handleBuilderDragOver,
  handleBuilderDrop,
  handleGroupDragOver,
  handleGroupDrop,
  closeModal,
  applyDeepLink,
  shuffleBuilderOrder
} from './builder.js';
import {
  registerRenderHandler as registerLibraryRender,
  buildFilters,
  ensureRandomOrderMap,
  shuffleLibraryExercises,
  filterData,
  renderGrid,
  refreshFilterButtons
} from './library.js';
import { persistState, loadPersistedState, applyWorkoutFromParam } from './storage.js';
import { getActiveGrouping, applyGrouping } from './grouping.js';

function render() {
  const filtered = filterData();
  const displayList = state.showWorkoutOnly ? filtered.filter((ex) => state.builder.items.has(ex.id)) : filtered;

  renderGrid(displayList);
  renderBuilder();
  updateUnitToggle();

  const summaryParts = [];
  const muscleCount = state.filters.muscles.size;
  const subMuscleCount = state.filters.subMuscles.size;
  const equipmentCount = state.filters.equipment.size;
  if (muscleCount) summaryParts.push(`${state.filters.mode.muscles === 'AND' ? 'ALL of' : 'ANY of'} ${muscleCount} muscle${muscleCount > 1 ? 's' : ''}`);
  if (subMuscleCount) summaryParts.push(`${state.filters.mode.subMuscles === 'AND' ? 'ALL of' : 'ANY of'} ${subMuscleCount} target muscle${subMuscleCount > 1 ? 's' : ''}`);
  if (equipmentCount) summaryParts.push(`${state.filters.mode.equipment === 'AND' ? 'ALL of' : 'ANY of'} ${equipmentCount} equipment`);
  els.gridTitle.textContent = summaryParts.length ? `Exercises | ${summaryParts.join(' + ')}` : 'Exercises';

  const countText = state.showWorkoutOnly
    ? `${displayList.length} (workout only) shown of ${state.data.length}`
    : `${displayList.length} shown of ${state.data.length}`;
  els.count.textContent = countText;

  const desc = [];
  if (muscleCount) desc.push(`Muscle Groups: ${Array.from(state.filters.muscles).map(niceName).join(', ')}`);
  if (subMuscleCount) desc.push(`Muscles: ${Array.from(state.filters.subMuscles).map(niceName).join(', ')}`);
  if (equipmentCount) desc.push(`Equipment: ${Array.from(state.filters.equipment).map(niceName).join(', ')}`);
  els.activeFilters.textContent = desc.join(' | ');

  updateBuilderBadge();
  updateBuilderFilterControl();
  updateGroupingButtons();
  if (els.includeCheckboxes) els.includeCheckboxes.checked = state.includeCheckboxes;
  handleScrollButtons();
}

registerBuilderRender(render);
registerLibraryRender(render);

function bindGlobalEvents() {
  els.searchInput.addEventListener('input', () => {
    const value = els.searchInput.value || '';
    state.search = value;
    if (value.trim() && state.shuffleMode) {
      state.shuffleMode = false;
      state.randomOrderMap = null;
      syncSortControls();
    }
    render();
  });
  els.searchClear.addEventListener('click', () => {
    state.search = '';
    els.searchInput.value = '';
    render();
  });
  els.sortToggle.addEventListener('click', () => {
    state.sortMode = state.sortMode === 'AZ' ? 'ZA' : 'AZ';
    state.shuffleMode = false;
    state.randomOrderMap = null;
    syncSortControls();
    render();
    persistState();
  });

  els.randomizeLibrary?.addEventListener('click', () => {
    shuffleLibraryExercises();
    syncSortControls();
    render();
    persistState();
  });

  els.unitToggle?.addEventListener('click', toggleWeightUnit);

  els.toggleBuilderFilter.addEventListener('click', () => {
    state.showWorkoutOnly = !state.showWorkoutOnly;
    updateBuilderFilterControl();
    render();
    persistState();
  });

  els.tabLibrary.addEventListener('click', () => switchTab('library'));
  els.tabBuilder.addEventListener('click', () => switchTab('builder'));

  els.exportWorkout.addEventListener('click', exportWorkout);
  els.printWorkout.addEventListener('click', printWorkout);
  els.shareWorkout.addEventListener('click', shareWorkout);
  els.shuffleBuilder?.addEventListener('click', () => {
    if (shuffleBuilderOrder()) {
      persistState();
      render();
    }
  });
  els.groupEquipment?.addEventListener('click', () => toggleGrouping('equipment'));
  els.groupMuscles?.addEventListener('click', () => toggleGrouping('muscles'));
  els.groupMuscleGroups?.addEventListener('click', () => toggleGrouping('muscleGroups'));
  els.clearWorkout.addEventListener('click', () => {
    state.builder.order = [];
    state.builder.items.clear();
    render();
    persistState();
  });
  els.includeCheckboxes.addEventListener('change', () => {
    state.includeCheckboxes = els.includeCheckboxes.checked;
    persistState();
    render();
  });

  if (els.builderList) {
    els.builderList.addEventListener('dragover', handleBuilderDragOver);
    els.builderList.addEventListener('drop', handleBuilderDrop);
    els.builderList.addEventListener('dragover', handleGroupDragOver);
    els.builderList.addEventListener('drop', handleGroupDrop);
  }

  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (evt) => {
    if (evt.target === els.modal) closeModal();
  });

  window.addEventListener('scroll', handleScrollButtons);
  els.scrollUp.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  els.scrollDown.addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));

  window.addEventListener('keydown', (evt) => {
    const activeTag = evt.target?.tagName?.toLowerCase();
    const typing = activeTag === 'input' || activeTag === 'textarea' || evt.isComposing;
    if (evt.key === '/' && !typing) {
      evt.preventDefault();
      els.searchInput.focus();
    } else if (evt.key === 'Escape') {
      if (!els.modal.classList.contains('hidden')) {
        closeModal();
        return;
      }
      if (state.search) {
        state.search = '';
        els.searchInput.value = '';
        render();
      }
    } else if ((evt.key === 's' || evt.key === 'S') && !typing) {
      evt.preventDefault();
      state.sortMode = state.sortMode === 'AZ' ? 'ZA' : 'AZ';
      state.shuffleMode = false;
      state.randomOrderMap = null;
      syncSortControls();
      render();
      persistState();
    } else if ((evt.key === 'b' || evt.key === 'B') && !typing) {
      evt.preventDefault();
      switchTab('builder');
    }
  });
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const deepLink = params.get('exercise');
  const workoutParam = params.get('workout');
  if (deepLink) state.highlightId = deepLink;

  fetch('exercise_dump.json')
    .then((res) => res.json())
    .then((json) => {
      state.data = Array.isArray(json) ? json : [];
      state.muscles = uniq(state.data.flatMap((ex) => ex.muscleGroups || []));
      state.subMuscles = uniq(state.data.flatMap((ex) => ex.muscles || []));
      state.equipment = uniq(state.data.flatMap((ex) => ex.equipment || []));
      setSearchIndex(buildSearchIndex(state.data));

      if (workoutParam) applyWorkoutFromParam(workoutParam);
      else loadPersistedState();

      const initialGrouping = getActiveGrouping();
      if (initialGrouping) applyGrouping(initialGrouping);
      if (state.shuffleMode) ensureRandomOrderMap();

      buildFilters();
      refreshFilterButtons();
      bindGlobalEvents();
      syncSortControls();
      updateUnitToggle();
      updateBuilderFilterControl();
      updateGroupingButtons();
      if (els.includeCheckboxes) els.includeCheckboxes.checked = state.includeCheckboxes;
      if (els.searchInput && state.search) {
        els.searchInput.value = state.search;
      }
      render();
      applyDeepLink();
    })
    .catch((err) => {
      console.error('Failed to load exercise_dump.json', err);
      document.body.insertAdjacentHTML('afterbegin', '<div class="container">Failed to load exercise_dump.json. Please serve files via a local web server.</div>');
    });
}

init();
