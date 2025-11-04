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
  syncPlanControls,
  renderSchedulePreview,
  setPlanName,
  setScheduleStart,
  setScheduleEnd,
  setScheduleInterval,
  toggleScheduleDay,
  buildPlanSyncPayload,
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

const dropboxManager = typeof DropboxManager !== 'undefined' ? new DropboxManager() : null;
let dropboxInitialized = false;

function setupSchedulePickers() {
  if (typeof flatpickr === 'undefined') {
    return;
  }

  if (els.scheduleStart) {
    flatpickr(els.scheduleStart, {
      dateFormat: 'Y-m-d',
      allowInput: true,
      defaultDate: state.plan.schedule.startDate || null,
      onChange: (selectedDates, dateStr) => {
        setScheduleStart(dateStr || '');
      }
    });
  }

  if (els.scheduleEnd) {
    flatpickr(els.scheduleEnd, {
      dateFormat: 'Y-m-d',
      allowInput: true,
      defaultDate: state.plan.schedule.endDate || null,
      onChange: (selectedDates, dateStr) => {
        setScheduleEnd(dateStr || '');
      }
    });
  }
}

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
  syncPlanControls();
  renderSchedulePreview();
  refreshDropboxButton();
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
  els.tabWorkout?.addEventListener('click', () => {
    window.location.href = 'workout-time/index.html';
  });

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

  els.planNameInput?.addEventListener('input', () => setPlanName(els.planNameInput.value));
  els.scheduleStart?.addEventListener('change', (event) => setScheduleStart(event.target.value));
  els.scheduleEnd?.addEventListener('change', (event) => setScheduleEnd(event.target.value));
  els.scheduleInterval?.addEventListener('change', (event) => setScheduleInterval(event.target.value));
  if (els.scheduleDays) {
    els.scheduleDays.querySelectorAll('button[data-day]').forEach((button) => {
      button.addEventListener('click', () => toggleScheduleDay(button.dataset.day));
    });
  }

  els.connectDropbox?.addEventListener('click', handleDropboxButtonClick);
  els.syncToDropbox?.addEventListener('click', handleSyncToDropbox);

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

const updateSyncStatus = (message, status) => {
  if (!els.builderSyncStatus) return;
  els.builderSyncStatus.textContent = message || '';
  els.builderSyncStatus.classList.remove('success', 'error', 'pending');
  if (status) {
    els.builderSyncStatus.classList.add(status);
  }
};

const setSyncButtonDisabled = (disabled) => {
  if (els.syncToDropbox) {
    els.syncToDropbox.disabled = Boolean(disabled);
  }
};

const refreshDropboxButton = () => {
  if (!els.connectDropbox) return;
  if (!dropboxManager) {
    els.connectDropbox.disabled = true;
    els.connectDropbox.textContent = 'Dropbox unavailable';
    return;
  }
  els.connectDropbox.disabled = false;
  if (dropboxManager.isConnected) {
    const name = dropboxManager.account?.name?.display_name || 'Dropbox';
    els.connectDropbox.textContent = `Disconnect ${name}`;
    els.connectDropbox.setAttribute('aria-pressed', 'true');
  } else {
    els.connectDropbox.textContent = 'Connect Dropbox';
    els.connectDropbox.setAttribute('aria-pressed', 'false');
  }
};

const initializeDropbox = async () => {
  if (!dropboxManager || dropboxInitialized) {
    refreshDropboxButton();
    return;
  }

  dropboxManager.onConnectionChange = () => {
    refreshDropboxButton();
    if (!dropboxManager.isConnected) {
      setSyncButtonDisabled(false);
      updateSyncStatus('Disconnected from Dropbox.', null);
    } else {
      const name = dropboxManager.account?.name?.display_name || 'Dropbox';
      updateSyncStatus(`Connected to Dropbox as ${name}.`, 'success');
    }
  };
  dropboxManager.onLog = (message, type) => {
    if (type === 'error') {
      updateSyncStatus(message, 'error');
    }
  };

  try {
    await dropboxManager.init();
    dropboxInitialized = true;
    if (dropboxManager.isConnected) {
      await dropboxManager.initializeFolderStructure();
    }
  } catch (error) {
    console.error('Dropbox initialization failed:', error);
    updateSyncStatus(`Dropbox init failed: ${error.message}`, 'error');
  } finally {
    setSyncButtonDisabled(false);
    refreshDropboxButton();
  }
};

const handleDropboxButtonClick = () => {
  if (!dropboxManager) {
    updateSyncStatus('Dropbox integration unavailable.', 'error');
    return;
  }
  if (dropboxManager.isConnected) {
    dropboxManager.disconnect();
    updateSyncStatus('Disconnected from Dropbox.', null);
    refreshDropboxButton();
    return;
  }
  updateSyncStatus('Redirecting to Dropbox...', 'pending');
  try {
    dropboxManager.connect();
  } catch (error) {
    updateSyncStatus(`Dropbox connect failed: ${error.message}`, 'error');
  }
};

const handleSyncToDropbox = async () => {
  if (!dropboxManager) {
    updateSyncStatus('Dropbox integration unavailable.', 'error');
    return;
  }

  const payload = buildPlanSyncPayload();
  if (!payload.plans.length) {
    updateSyncStatus('Add exercises and a schedule before syncing to Dropbox.', 'error');
    return;
  }

  await initializeDropbox();
  if (!dropboxManager.isConnected) {
    handleDropboxButtonClick();
    return;
  }

  try {
    setSyncButtonDisabled(true);
    updateSyncStatus(`Syncing ${payload.plans.length} plan${payload.plans.length === 1 ? '' : 's'}...`, 'pending');
    await dropboxManager.initializeFolderStructure();
    let successCount = 0;
    for (const plan of payload.plans) {
      await dropboxManager.savePlan(plan.name, plan.items);
      successCount += 1;
    }
    updateSyncStatus(`Synced ${successCount} plan${successCount === 1 ? '' : 's'} to Dropbox.`, 'success');
  } catch (error) {
    updateSyncStatus(`Dropbox sync failed: ${error.message}`, 'error');
  } finally {
    setSyncButtonDisabled(false);
    refreshDropboxButton();
  }
};

async function init() {
  const params = new URLSearchParams(window.location.search);
  const deepLink = params.get('exercise');
  const workoutParam = params.get('workout');
  if (deepLink) state.highlightId = deepLink;

  await initializeDropbox();

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
      setupSchedulePickers();
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

setSyncButtonDisabled(false);
refreshDropboxButton();
init();
