// Entry point for the Exercise Library web app.
// Wires together the shared state, feature modules, and DOM events.
import { state, els } from './context.js';
import { niceName } from './utils.js';
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
  setAvailablePlanNames,
  loadPlanIntoBuilder,
  flushPlanNameDebounce,
  buildPlanItems,
  setScheduleStart,
  setScheduleEnd,
  setScheduleInterval,
  toggleScheduleDay,
  applyScheduleFromDate,
  buildPlanSyncPayload,
  handleScrollButtons,
  handleBuilderDragOver,
  handleBuilderDrop,
  handleGroupDragOver,
  handleGroupDrop,
  closeModal,
  applyDeepLink,
  shuffleBuilderOrder,
  registerCustomExerciseHooks,
  setCustomExerciseAvailability,
  showCustomExerciseMessage
} from './builder.js';
import { AnalyticsDashboard } from './analytics-dashboard.js';
import {
  registerRenderHandler as registerLibraryRender,
  buildFilters,
  ensureRandomOrderMap,
  shuffleLibraryExercises,
  filterData,
  renderGrid,
  refreshFilterButtons,
  refreshFilterOptions
} from './library.js';
import { persistState, loadPersistedState, applyWorkoutFromParam } from './storage.js';
import { getActiveGrouping, applyGrouping } from './grouping.js';
import {
  PLAN_INDEX_KEY,
  PLAN_STORAGE_PREFIX,
  normalizePlanName,
  persistPlanLocally,
  removePlanLocally,
  loadLocalPlanEntries
} from './plan-storage.js';
import {
  registerCustomExerciseListeners,
  setBaseExercises,
  setCustomExercises,
  clearCustomExercises,
  buildCustomExerciseEntry,
  getDropboxPayloadForCustomExercises
} from './custom-exercises.js';

const dropboxManager = typeof DropboxManager !== 'undefined' ? new DropboxManager() : null;
let dropboxInitialized = false;

const analyticsDashboard =
  typeof AnalyticsDashboard === 'function'
    ? new AnalyticsDashboard({
        dropboxManager,
        getWeightUnit: () => (state.weightUnit === 'KG' ? 'KG' : 'LBS')
      })
    : null;

const planCache = new Map(); // name -> { source, items }
const PLAN_NAME_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})\b/;

const extractPlanDateFromName = (name) => {
  if (typeof name !== 'string') return null;
  const match = PLAN_NAME_DATE_PATTERN.exec(name.trim());
  return match ? match[1] : null;
};

registerCustomExerciseListeners({
  onCatalogueUpdated: () => {
    refreshFilterOptions();
    render();
  }
});

const updateCustomExerciseSyncStatus = (message, variant = 'info') => {
  if (!els.customExerciseSyncStatus) return;
  els.customExerciseSyncStatus.textContent = message || '';
  els.customExerciseSyncStatus.classList.remove('error', 'success', 'warning');
  if (variant && variant !== 'info' && message) {
    els.customExerciseSyncStatus.classList.add(variant);
  }
};

const setCustomExerciseSyncButtonDisabled = (disabled) => {
  if (els.customExerciseSync) {
    els.customExerciseSync.disabled = Boolean(disabled);
  }
};

const ensureDropboxForCustomExercises = async () => {
  if (!dropboxManager) {
    updateCustomExerciseSyncStatus('Dropbox integration unavailable.', 'error');
    return false;
  }
  await initializeDropbox();
  if (!dropboxManager.isConnected) {
    updateCustomExerciseSyncStatus('Connect Dropbox to sync custom exercises.', 'warning');
    handleDropboxButtonClick();
    return false;
  }
  try {
    await dropboxManager.initializeFolderStructure();
  } catch (error) {
    updateCustomExerciseSyncStatus(`Dropbox init failed: ${error.message}`, 'error');
    return false;
  }
  return true;
};

const loadCustomExercisesFromDropbox = async (options = {}) => {
  if (options.requireConnection) {
    const ready = await ensureDropboxForCustomExercises();
    if (!ready) {
      return;
    }
  }
  if (!dropboxManager || !dropboxManager.isConnected) {
    clearCustomExercises();
    if (!options.silent) {
      updateCustomExerciseSyncStatus('Connect Dropbox to sync custom exercises.', 'warning');
    }
    setCustomExerciseAvailability(false);
    return;
  }
  const interactive = options.interactive !== false;
  try {
    if (interactive) {
      setCustomExerciseSyncButtonDisabled(true);
    }
    if (!options.silent) {
      updateCustomExerciseSyncStatus('Syncing custom exercises...', 'info');
    }
    await dropboxManager.initializeFolderStructure();
    const list = await dropboxManager.loadCustomExercises();
    setCustomExercises(list);
    const message = `Loaded ${list.length} custom exercise${list.length === 1 ? '' : 's'}.`;
    updateCustomExerciseSyncStatus(message, 'success');
    setCustomExerciseAvailability(true);
  } catch (error) {
    updateCustomExerciseSyncStatus(`Failed to sync custom exercises: ${error.message}`, 'error');
    showCustomExerciseMessage(error.message || 'Dropbox custom exercise sync failed.', 'error', {
      persist: true
    });
  } finally {
    if (interactive) {
      setCustomExerciseSyncButtonDisabled(false);
    }
  }
};

const handleSaveCustomExercise = async (payload = {}) => {
  const ready = await ensureDropboxForCustomExercises();
  if (!ready) {
    throw new Error('Connect Dropbox to create custom exercises.');
  }
  const entry = buildCustomExerciseEntry({
    name: payload.name,
    muscleGroups: payload.muscleGroups,
    muscles: payload.muscles,
    equipment: payload.equipment
  });

  let latestRemoteEntries = [];
  try {
    latestRemoteEntries = await dropboxManager.loadCustomExercises();
  } catch (error) {
    updateCustomExerciseSyncStatus(`Failed to fetch latest custom exercises: ${error.message}`, 'error');
    throw error;
  }

  // Ensure local state reflects the freshest Dropbox data before appending.
  setCustomExercises(latestRemoteEntries);

  const existing = getDropboxPayloadForCustomExercises();
  const entryPayload = getDropboxPayloadForCustomExercises([entry])[0];
  const nextPayload = existing.concat(entryPayload);

  await dropboxManager.saveCustomExercises(nextPayload);
  setCustomExercises(nextPayload);
  updateCustomExerciseSyncStatus(`Saved "${entry.name}" to Dropbox.`, 'success');
  return entry;
};

registerCustomExerciseHooks({
  ensureDropboxReady: ensureDropboxForCustomExercises,
  saveCustomExercise: handleSaveCustomExercise
});
setCustomExerciseAvailability(Boolean(dropboxManager && dropboxManager.isConnected));
updateCustomExerciseSyncStatus('Connect Dropbox to sync custom exercises.', 'warning');
setCustomExerciseSyncButtonDisabled(false);

const showAnalyticsPanel = () => {
  if (state.activePanel === 'analytics') return;
  state.activePanel = 'analytics';
  updateBuilderBadge();
  persistState();
  if (analyticsDashboard && typeof window !== 'undefined') {
    window.requestAnimationFrame(() => analyticsDashboard.refreshChartSize());
  }
};

const notifyAnalyticsDropboxState = () => {
  if (!analyticsDashboard) return;
  analyticsDashboard.handleDropboxStateChange(Boolean(dropboxManager && dropboxManager.isConnected));
};

const initAnalyticsDashboard = () => {
  if (!analyticsDashboard) return;
  analyticsDashboard.init();
  notifyAnalyticsDropboxState();
};

const setLocalPlanCacheEntry = (name, items) => {
  const trimmed = normalizePlanName(name);
  if (!trimmed) return;
  planCache.set(trimmed, { source: 'local', items: Array.isArray(items) ? items : [] });
};

const removeLocalPlanCacheEntry = (name) => {
  const trimmed = normalizePlanName(name);
  if (!trimmed) return;
  const existing = planCache.get(trimmed);
  if (existing && existing.source === 'local') {
    planCache.delete(trimmed);
  }
};
const collectPlanNames = () => Array.from(new Set(planCache.keys())).sort((a, b) => a.localeCompare(b));

const clonePlanItems = (items) => JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));

const resolvePlanNameInput = () => {
  const directValue = normalizePlanName(els.planNameInput ? els.planNameInput.value : '');
  if (directValue) return directValue;
  return normalizePlanName(state.plan.name);
};

const refreshPlanNameOptions = () => {
  setAvailablePlanNames(collectPlanNames());
  syncPlanControls();
};

const removeDropboxPlansFromCache = () => {
  for (const [name, entry] of planCache.entries()) {
    if (entry && entry.source === 'dropbox') {
      planCache.delete(name);
    }
  }
};

const loadLocalPlansIntoCache = () => {
  for (const [name, entry] of planCache.entries()) {
    if (entry && entry.source === 'local') {
      planCache.delete(name);
    }
  }

  const entries = loadLocalPlanEntries();
  entries.forEach(({ name, items }) => {
    setLocalPlanCacheEntry(name, items);
  });
};

async function fetchDropboxPlans(options = {}) {
  if (!dropboxManager || !dropboxManager.isConnected) {
    state.dropboxPlanNames = [];
    refreshPlanNameOptions();
    if (!options.silent) {
      updateSyncStatus('Connect Dropbox to load plan names.', 'error');
    }
    return;
  }

  try {
    const index = await dropboxManager.loadPlansIndex();
    const plans = index.plans || {};
    const names = Object.keys(plans).sort((a, b) => a.localeCompare(b));
    state.dropboxPlanNames = names;
    names.forEach((name) => {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) return;
      const items = Array.isArray(plans[name]) ? plans[name] : [];
      planCache.set(trimmed, { source: 'dropbox', items });
    });
    refreshPlanNameOptions();
    if (!options.silent) {
      updateSyncStatus(`Loaded ${names.length} plan${names.length === 1 ? '' : 's'} from Dropbox.`, 'success');
    }
  } catch (error) {
    if (!options.silent) {
      updateSyncStatus(`Failed to load plan names: ${error.message}`, 'error');
    }
  }
}

const loadPlanByName = async (name) => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    setPlanName('', { fromSelection: true });
    loadPlanIntoBuilder([], { silent: true });
    renderSchedulePreview();
    return;
  }

  let entry = planCache.get(trimmed);
  if (!entry && dropboxManager && dropboxManager.isConnected) {
    await fetchDropboxPlans({ silent: true });
    entry = planCache.get(trimmed);
  }

  if (!entry) {
    updateSyncStatus(`Plan "${trimmed}" not found.`, 'error');
    return;
  }

  setPlanName(trimmed, { fromSelection: true });
  flushPlanNameDebounce();
  loadPlanIntoBuilder(Array.isArray(entry.items) ? entry.items : []);
  if (entry.source === 'dropbox') {
    const isoDate = extractPlanDateFromName(trimmed);
    if (isoDate) {
      applyScheduleFromDate(isoDate);
    }
  }
  renderSchedulePreview();
  updateSyncStatus(`Loaded plan "${trimmed}" into Workout Builder.`, 'success');
};

const refreshPlanNameSources = (options = {}) => {
  loadLocalPlansIntoCache();
  refreshPlanNameOptions();
  if (dropboxManager && dropboxManager.isConnected) {
    return fetchDropboxPlans(options);
  }
  return Promise.resolve();
};

async function handleDeletePlanFromBuilder() {
  if (!dropboxManager || !dropboxManager.isConnected) {
    updateSyncStatus('Connect Dropbox before deleting plans.', 'error');
    return;
  }

  const select = els.planNameSelect;
  const name = (select && select.value ? select.value : '').trim();
  if (!name) {
    updateSyncStatus('Select a plan to delete.', 'error');
    return;
  }

  if (!state.dropboxPlanNames.includes(name)) {
    updateSyncStatus(`Plan "${name}" not found on Dropbox.`, 'error');
    return;
  }

  if (typeof window !== 'undefined' && !window.confirm(`Delete plan "${name}" from Dropbox? This cannot be undone.`)) {
    return;
  }

  try {
    await dropboxManager.deletePlan(name);
    state.dropboxPlanNames = state.dropboxPlanNames.filter((planName) => planName !== name);
    if (planCache.has(name) && planCache.get(name).source === 'dropbox') {
      planCache.delete(name);
    }
    refreshPlanNameOptions();
    updateSyncStatus(`Deleted plan "${name}" from Dropbox.`, 'success');
    if (state.plan.name === name) {
      setPlanName('', { fromSelection: true });
      loadPlanIntoBuilder([], { silent: true });
      renderSchedulePreview();
    }
  } catch (error) {
    updateSyncStatus(`Failed to delete plan "${name}": ${error.message}`, 'error');
  }
}

const handleSavePlanLocally = () => {
  const desiredName = resolvePlanNameInput();
  if (!desiredName) {
    updateSyncStatus('Enter a plan name before saving.', 'error');
    return;
  }

  const items = buildPlanItems();
  if (!items.length) {
    updateSyncStatus('Add at least one exercise before saving a plan.', 'error');
    return;
  }

  const planItems = clonePlanItems(items);
  let savedName = null;
  try {
    ({ name: savedName } = persistPlanLocally(desiredName, planItems));
  } catch (error) {
    updateSyncStatus(error.message || 'Failed to save plan.', 'error');
    return;
  }

  const finalName = savedName || normalizePlanName(desiredName);
  setLocalPlanCacheEntry(finalName, planItems);
  state.plan.selectedName = finalName;
  setPlanName(finalName, { fromSelection: true });
  refreshPlanNameOptions();
  renderSchedulePreview();
  flushPlanNameDebounce();
  updateSyncStatus(`Saved plan "${finalName}" locally.`, 'success');
};

const handleRenamePlan = async () => {
  const previousName = normalizePlanName(state.plan.selectedName);
  if (!previousName) {
    handleSavePlanLocally();
    return;
  }

  const desiredName = resolvePlanNameInput();
  if (!desiredName) {
    updateSyncStatus('Enter a new plan name to rename.', 'error');
    return;
  }

  if (desiredName === previousName) {
    updateSyncStatus('Plan name is unchanged.', 'pending');
    return;
  }

  const items = buildPlanItems();
  if (!items.length) {
    updateSyncStatus('Add at least one exercise before renaming the plan.', 'error');
    return;
  }

  const planItems = clonePlanItems(items);
  const existingEntry = planCache.get(previousName);
  const existingSnapshot = existingEntry
    ? {
        source: existingEntry.source,
        items: clonePlanItems(existingEntry.items || [])
      }
    : null;
  const wasDropbox = existingEntry?.source === 'dropbox';

  let savedName = null;
  try {
    ({ name: savedName } = persistPlanLocally(desiredName, planItems));
  } catch (error) {
    updateSyncStatus(error.message || 'Failed to create renamed plan.', 'error');
    return;
  }

  const finalName = savedName || normalizePlanName(desiredName);

  removePlanLocally(previousName);
  removeLocalPlanCacheEntry(previousName);

  setLocalPlanCacheEntry(finalName, planItems);
  state.plan.selectedName = finalName;
  setPlanName(finalName, { fromSelection: true });
  renderSchedulePreview();
  flushPlanNameDebounce();

  let dropboxMessage = null;
  let dropboxRenamed = false;

  if (wasDropbox) {
    if (dropboxManager && dropboxManager.isConnected) {
      try {
        await dropboxManager.savePlan(finalName, planItems);
        await dropboxManager.deletePlan(previousName);
        state.dropboxPlanNames = state.dropboxPlanNames
          .filter((name) => name !== previousName)
          .concat(finalName)
          .sort((a, b) => a.localeCompare(b));
        dropboxRenamed = true;
      } catch (error) {
        dropboxMessage = `Dropbox rename failed: ${error.message}`;
      }
    } else {
      dropboxMessage = 'Connect Dropbox and refresh plan names to update the cloud copy.';
    }
  }

  if (wasDropbox) {
    if (dropboxRenamed) {
      planCache.delete(previousName);
      planCache.set(finalName, { source: 'dropbox', items: planItems });
    } else if (existingSnapshot) {
      planCache.set(previousName, existingSnapshot);
    }
  }

  refreshPlanNameOptions();

  if (dropboxMessage) {
    updateSyncStatus(`Renamed locally to "${finalName}", but ${dropboxMessage}`, 'error');
  } else {
    updateSyncStatus(`Renamed plan to "${finalName}".`, 'success');
  }
};

function setupSchedulePickers() {
  if (typeof flatpickr === 'undefined') {
    return;
  }

  if (els.scheduleStart) {
    flatpickr(els.scheduleStart, {
      dateFormat: 'Y-m-d',
      allowInput: true,
      disableMobile: true,
      monthSelectorType: 'dropdown',
      shorthandCurrentMonth: false,
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
      disableMobile: true,
      monthSelectorType: 'dropdown',
      shorthandCurrentMonth: false,
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

  if (els.randomizeLibrary) {
    els.randomizeLibrary.addEventListener('click', () => {
      shuffleLibraryExercises();
      syncSortControls();
      render();
      persistState();
    });
  }

  const bindUnitToggle = (button) => {
    if (!button) return;
    button.addEventListener('click', () => {
      toggleWeightUnit();
      if (analyticsDashboard) {
        analyticsDashboard.handleUnitChange();
      }
    });
  };
  bindUnitToggle(els.unitToggle);
  bindUnitToggle(els.analyticsUnitToggle);

  els.toggleBuilderFilter.addEventListener('click', () => {
    state.showWorkoutOnly = !state.showWorkoutOnly;
    updateBuilderFilterControl();
    render();
    persistState();
  });

  els.tabLibrary.addEventListener('click', () => switchTab('library'));
  els.tabBuilder.addEventListener('click', () => switchTab('builder'));
  if (els.tabAnalytics) {
    els.tabAnalytics.addEventListener('click', showAnalyticsPanel);
  }
  if (els.tabWorkout) {
    els.tabWorkout.addEventListener('click', () => {
      window.location.href = 'workout-time/index.html';
    });
  }

  els.exportWorkout.addEventListener('click', exportWorkout);
  els.printWorkout.addEventListener('click', printWorkout);
  els.shareWorkout.addEventListener('click', shareWorkout);
  if (els.shuffleBuilder) {
    els.shuffleBuilder.addEventListener('click', () => {
      if (shuffleBuilderOrder()) {
        persistState();
        render();
      }
    });
  }
  if (els.customExerciseSync) {
    els.customExerciseSync.addEventListener('click', () => {
      loadCustomExercisesFromDropbox({ requireConnection: true });
    });
  }
  if (els.groupEquipment) {
    els.groupEquipment.addEventListener('click', () => toggleGrouping('equipment'));
  }
  if (els.groupMuscles) {
    els.groupMuscles.addEventListener('click', () => toggleGrouping('muscles'));
  }
  if (els.groupMuscleGroups) {
    els.groupMuscleGroups.addEventListener('click', () => toggleGrouping('muscleGroups'));
  }
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

  if (els.planNameSelect) {
    els.planNameSelect.addEventListener('change', (event) => {
      const selected = event.target && event.target.value ? event.target.value : '';
      loadPlanByName(selected);
    });
  }
  if (els.planNameInput) {
    els.planNameInput.addEventListener('input', (event) => {
      setPlanName(event.target.value);
    });
    els.planNameInput.addEventListener('blur', () => {
      flushPlanNameDebounce();
    });
  }
  if (els.planSaveButton) {
    els.planSaveButton.addEventListener('click', handleSavePlanLocally);
  }
  if (els.planRenameButton) {
    els.planRenameButton.addEventListener('click', () => {
      handleRenamePlan();
    });
  }
  if (els.refreshPlanNames) {
    els.refreshPlanNames.addEventListener('click', () => {
      refreshPlanNameSources();
    });
  }
  if (els.deletePlanFromBuilder) {
    els.deletePlanFromBuilder.addEventListener('click', handleDeletePlanFromBuilder);
  }
  if (els.scheduleStart) {
    els.scheduleStart.addEventListener('change', (event) => setScheduleStart(event.target.value));
  }
  if (els.scheduleEnd) {
    els.scheduleEnd.addEventListener('change', (event) => setScheduleEnd(event.target.value));
  }
  if (els.scheduleInterval) {
    els.scheduleInterval.addEventListener('change', (event) => setScheduleInterval(event.target.value));
  }
  if (els.scheduleDays) {
    els.scheduleDays.querySelectorAll('button[data-day]').forEach((button) => {
      button.addEventListener('click', () => toggleScheduleDay(button.dataset.day));
    });
  }

  if (els.connectDropbox) {
    els.connectDropbox.addEventListener('click', handleDropboxButtonClick);
  }
  if (els.analyticsConnectDropbox) {
    els.analyticsConnectDropbox.addEventListener('click', handleDropboxButtonClick);
  }
  if (els.syncToDropbox) {
    els.syncToDropbox.addEventListener('click', handleSyncToDropbox);
  }

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
    const target = evt.target;
    const activeTag = target && target.tagName ? target.tagName.toLowerCase() : null;
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

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event || !event.key) return;
    if (event.key === PLAN_INDEX_KEY || event.key.startsWith(PLAN_STORAGE_PREFIX)) {
      loadLocalPlansIntoCache();
      refreshPlanNameOptions();
      if (state.plan.name && !planCache.has(state.plan.name)) {
        setPlanName('', { fromSelection: true });
        flushPlanNameDebounce();
        loadPlanIntoBuilder([], { silent: true });
        renderSchedulePreview();
      }
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
  const buttons = [els.connectDropbox, els.analyticsConnectDropbox].filter(Boolean);
  if (!buttons.length) return;
  if (!dropboxManager) {
    buttons.forEach((button) => {
      button.disabled = true;
      button.textContent = 'Dropbox unavailable';
      button.removeAttribute('aria-pressed');
    });
    return;
  }
  const connected = dropboxManager.isConnected;
  const name = dropboxManager.account?.name?.display_name || 'Dropbox';
  buttons.forEach((button) => {
    button.disabled = false;
    if (connected) {
      button.textContent = `Disconnect ${name}`;
      button.setAttribute('aria-pressed', 'true');
    } else {
      button.textContent = 'Connect Dropbox';
      button.setAttribute('aria-pressed', 'false');
    }
  });
};

const initializeDropbox = async () => {
  if (!dropboxManager || dropboxInitialized) {
    refreshDropboxButton();
    return;
  }

  dropboxManager.onConnectionChange = () => {
    refreshDropboxButton();
    notifyAnalyticsDropboxState();
    if (!dropboxManager.isConnected) {
      setSyncButtonDisabled(false);
      updateSyncStatus('Disconnected from Dropbox.', null);
      state.dropboxPlanNames = [];
      removeDropboxPlansFromCache();
      refreshPlanNameOptions();
      clearCustomExercises();
      setCustomExerciseAvailability(false);
      updateCustomExerciseSyncStatus('Connect Dropbox to sync custom exercises.', 'warning');
      setCustomExerciseSyncButtonDisabled(false);
    } else {
      const name = dropboxManager.account?.name?.display_name || 'Dropbox';
      updateSyncStatus(`Connected to Dropbox as ${name}.`, 'success');
      fetchDropboxPlans({ silent: true });
      setCustomExerciseAvailability(true);
      setCustomExerciseSyncButtonDisabled(false);
      loadCustomExercisesFromDropbox({ silent: true, interactive: false });
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
      await fetchDropboxPlans({ silent: true });
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

  flushPlanNameDebounce();

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
    await fetchDropboxPlans({ silent: true });
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
  const requestedPanel = (params.get('panel') || '').toLowerCase();
  const forceAnalyticsPanel = requestedPanel === 'analytics';
  if (deepLink) state.highlightId = deepLink;

  loadLocalPlansIntoCache();
  refreshPlanNameOptions();
  await initializeDropbox();
  if (dropboxManager && dropboxManager.isConnected) {
    await fetchDropboxPlans({ silent: true });
  }
  fetch('exercise_dump.json')
    .then((res) => res.json())
    .then((json) => {
      setBaseExercises(Array.isArray(json) ? json : []);

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
      if (forceAnalyticsPanel) {
        showAnalyticsPanel();
      }
      applyDeepLink();
    })
    .catch((err) => {
      console.error('Failed to load exercise_dump.json', err);
      document.body.insertAdjacentHTML('afterbegin', '<div class="container">Failed to load exercise_dump.json. Please serve files via a local web server.</div>');
    });
}

initAnalyticsDashboard();
setSyncButtonDisabled(false);
refreshDropboxButton();
init();
