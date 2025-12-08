// analytics-dashboard.js - Dropbox-powered charts for the main site
import { analyzeMovementPhases, isEchoWorkout as sharedIsEchoWorkout } from '../shared/echo-telemetry.js';

const LB_PER_KG = 2.2046226218488;
const ANALYTICS_COLORS = [
  '#7aa2f7', '#22c55e', '#f59e0b', '#f472b6', '#3bc9db', '#d97706', '#a855f7', '#f87171', '#0ea5e9', '#14b8a6',
  '#fbbf24', '#c084fc', '#fb7185', '#34d399', '#60a5fa', '#ef4444', '#c2410c', '#a3e635', '#facc15', '#fb923c',
  '#38bdf8', '#e879f9', '#a16207', '#f5d0fe', '#fde68a', '#bbf7d0', '#d946ef', '#fff3bf', '#9d4edd', '#0f172a'
];
const ANALYTICS_CACHE_KEY = 'vitruvian.analyticsWorkouts';
const ANALYTICS_CACHE_META_KEY = 'vitruvian.analyticsMeta';
const ANALYTICS_CACHE_LIMIT = 400;
const MONTHLY_BAR_MAX_HEIGHT = 240;
const PROGRAM_MODE_VALUE_MAP = new Map([
  [0, 'OLD_SCHOOL'],
  [1, 'PUMP'],
  [2, 'TIME_UNDER_TENSION'],
  [3, 'TIME_UNDER_TENSION_BEAST'],
  [4, 'ECCENTRIC']
]);
const WORKLOAD_BREAKDOWN_CATEGORIES = [
  { key: 'ECHO', label: 'Echo Mode', color: '#f97316' },
  { key: 'OLD_SCHOOL', label: 'Old School', color: '#10b981' },
  { key: 'TIME_UNDER_TENSION', label: 'Time Under Tension', color: '#eab308' },
  { key: 'TIME_UNDER_TENSION_BEAST', label: 'TUT Beast Mode', color: '#a855f7' },
  { key: 'ECCENTRIC', label: 'Eccentric', color: '#ef4444' }
];
const WORKLOAD_OTHER_CATEGORY = { key: 'OTHER', label: 'Other', color: '#64748b' };

export class AnalyticsDashboard {
  constructor(options = {}) {
    this.dropboxManager = options.dropboxManager || null;
    this._getWeightUnit = typeof options.getWeightUnit === 'function' ? options.getWeightUnit : () => 'KG';
    this.workouts = [];
    this.exerciseOptions = [];
    this.exerciseOptionMap = new Map();
    this.exercisePeakMap = new Map();
    this.currentExerciseKey = '';
    this.currentRange = '30';
    this.dropboxConnected = false;
    this.pendingSync = false;
    this.chart = null;
    this.chartEl = null;
    this.chartWrapper = null;
    this.emptyStateEl = null;
    this.exerciseSelect = null;
    this.syncButton = null;
    this.alignIdsButton = null;
    this.syncStatusEl = null;
    this.rangeButtons = [];
    this.selectionLabelEl = null;
    this.rangeLabelEl = null;
    this.pointCountEl = null;
    this.chartUnitEl = null;
    this.exerciseHintEl = null;
    this.peakConcentricValueEl = null;
    this.peakConcentricDateEl = null;
    this.peakEccentricValueEl = null;
    this.peakEccentricDateEl = null;
    this.baselineConcentricValueEl = null;
    this.baselineConcentricDateEl = null;
    this.baselineEccentricValueEl = null;
    this.baselineEccentricDateEl = null;
    this.deltaConcentricValueEl = null;
    this.deltaConcentricPctEl = null;
    this.deltaEccentricValueEl = null;
    this.deltaEccentricPctEl = null;
    this.monthlyChartWrapper = null;
    this.monthlyChartEl = null;
    this.monthlyLegendEl = null;
    this.monthlyEmptyEl = null;
    this.monthlyAxisEl = null;
    this.monthlyPeakLineEl = null;
    this.monthlyPeakLabelEl = null;
    this.monthlyXAxisEl = null;
    this.monthlyTooltipEl = null;
    this.monthlyTooltipLabelEl = null;
    this.monthlyTooltipValueEl = null;
    this.monthlyTooltipMetaEl = null;
    this.activeMonthlyTooltipSegment = null;
    this.cachedAt = null;
    this.resizeObserver = null;
    this.boundResizeHandler = null;
    this.filterEventName = 'vitruvian-analytics-filter-change';
    this.rangeMeta = {
      '30': { label: 'Past 30 days' },
      '90': { label: 'Past 3 months' },
      '180': { label: 'Past 6 months' },
      '365': { label: 'Past 365 days' }
    };
    this.colorMap = new Map();
    this._autoSyncRequested = false;
    this.pendingDropboxWrite = false;
    this.alignPromptState = null;
    this.boundMonthlySegmentEnter = this.handleMonthlySegmentEnter.bind(this);
    this.boundMonthlySegmentMove = this.handleMonthlySegmentMove.bind(this);
    this.boundMonthlySegmentLeave = this.handleMonthlySegmentLeave.bind(this);
    this.boundMonthlySegmentFocus = this.handleMonthlySegmentFocus.bind(this);
    this.boundMonthlySegmentBlur = this.handleMonthlySegmentBlur.bind(this);
    this.workloadMetricEl = null;
    this.workloadTriggerEl = null;
    this.totalVolumeEl = null;
    this.totalRepsEl = null;
    this.averageLoadEl = null;
    this.workloadTooltipEl = null;
    this.workloadTooltipTotalEl = null;
    this.workloadPieEl = null;
    this.workloadBreakdownEl = null;
    this.workloadAvgConcentricEl = null;
    this.workloadAvgEccentricEl = null;
    this.workloadHideTimeout = null;
    this.currentWorkloadStats = null;
  }

  init() {
    if (typeof document === 'undefined') return;

    this.chartEl = document.getElementById('analyticsPrChart');
    this.chartWrapper = document.getElementById('analyticsChartWrapper');
    this.emptyStateEl = document.getElementById('analyticsEmptyState');
    this.exerciseSelect = document.getElementById('analyticsExerciseFilter');
    this.syncButton = document.getElementById('analyticsSyncButton');
    this.alignIdsButton = document.getElementById('analyticsAlignIdsButton');
    this.syncStatusEl = document.getElementById('analyticsSyncStatus');
    this.rangeButtons = Array.from(document.querySelectorAll('[data-analytics-range]'));
    this.selectionLabelEl = document.getElementById('analyticsSelectionLabel');
    this.rangeLabelEl = document.getElementById('analyticsRangeLabel');
    this.pointCountEl = document.getElementById('analyticsPointCount');
    this.chartUnitEl = document.getElementById('analyticsChartUnit');
    this.exerciseHintEl = document.getElementById('analyticsExerciseHint');
    this.peakConcentricValueEl = document.getElementById('analyticsPeakConcentric');
    this.peakConcentricDateEl = document.getElementById('analyticsPeakConcentricDate');
    this.peakEccentricValueEl = document.getElementById('analyticsPeakEccentric');
    this.peakEccentricDateEl = document.getElementById('analyticsPeakEccentricDate');
    this.baselineConcentricValueEl = document.getElementById('analyticsBaselineConcentric');
    this.baselineConcentricDateEl = document.getElementById('analyticsBaselineConcentricDate');
    this.baselineEccentricValueEl = document.getElementById('analyticsBaselineEccentric');
    this.baselineEccentricDateEl = document.getElementById('analyticsBaselineEccentricDate');
    this.deltaConcentricPctEl = document.getElementById('analyticsDeltaConcentricPct');
    this.deltaConcentricValueEl = document.getElementById('analyticsDeltaConcentricValue');
    this.deltaEccentricPctEl = document.getElementById('analyticsDeltaEccentricPct');
    this.deltaEccentricValueEl = document.getElementById('analyticsDeltaEccentricValue');
    this.monthlyChartWrapper = document.getElementById('analyticsMonthlyChartWrapper');
    this.monthlyChartEl = document.getElementById('analyticsMonthlyChart');
    this.monthlyLegendEl = document.getElementById('analyticsMonthlyLegend');
    this.monthlyEmptyEl = document.getElementById('analyticsMonthlyEmpty');
    this.monthlyAxisEl = document.getElementById('analyticsMonthlyAxis');
    this.monthlyPeakLineEl = document.getElementById('analyticsMonthlyPeakLine');
    this.monthlyPeakLabelEl = document.getElementById('analyticsMonthlyPeakLabel');
    this.monthlyXAxisEl = document.getElementById('analyticsMonthlyXAxis');
    this.workloadMetricEl = document.getElementById('analyticsWorkloadMetric');
    this.workloadTriggerEl = document.getElementById('analyticsWorkloadTrigger');
    this.totalVolumeEl = document.getElementById('analyticsTotalVolume');
    this.totalRepsEl = document.getElementById('analyticsTotalReps');
    this.averageLoadEl = document.getElementById('analyticsAverageLoad');
    this.workloadTooltipEl = document.getElementById('analyticsWorkloadTooltip');
    this.workloadTooltipTotalEl = document.getElementById('analyticsWorkloadTooltipTotal');
    this.workloadPieEl = document.getElementById('analyticsWorkloadPie');
    this.workloadBreakdownEl = document.getElementById('analyticsWorkloadBreakdown');
    this.workloadAvgConcentricEl = document.getElementById('analyticsWorkloadAvgConcentric');
    this.workloadAvgEccentricEl = document.getElementById('analyticsWorkloadAvgEccentric');

    if (this.exerciseSelect) {
      this.exerciseSelect.addEventListener('change', () => this.handleExerciseChange());
    }

    this.rangeButtons.forEach((button) => {
      button.addEventListener('click', () => this.setRange(button.dataset.analyticsRange));
    });

    this.bindWorkloadTooltipEvents();

    if (this.syncButton) {
      this.syncButton.addEventListener('click', () => this.handleSyncRequest());
      this.syncButton.disabled = true;
    }
    if (this.alignIdsButton) {
      this.alignIdsButton.addEventListener('click', () => this.handleAlignIdsRequest());
      this.alignIdsButton.disabled = true;
    }

    this.loadCachedWorkouts();
    this.updateRangeButtons();
    if (!this.workouts.length) {
      this.refreshExerciseOptions();
      this.updateChart();
    }
  }

  setWorkouts(workouts = []) {
    this.workouts = Array.isArray(workouts) ? workouts.filter(Boolean) : [];
    this.clearDropboxAlignPrompt();
    this.colorMap.clear();
    this.recomputeExercisePeaks();
    this.refreshExerciseOptions();
    this.updateChart();
    this.saveWorkoutsCache();
    this.updateAlignIdsButtonState();
  }

  maybeAutoSync(options = {}) {
    const force = options.force === true;
    if ((this._autoSyncRequested && !force) || !this.dropboxConnected) {
      return false;
    }
    if (!force && this.workouts.length) {
      this.showCachedDataStatus();
      return false;
    }
    this._autoSyncRequested = true;
    this.handleSyncRequest();
    return true;
  }

  async handleSyncRequest() {
    if (this.pendingSync) return;
    if (!this.dropboxManager) {
      this.showSyncStatus('Dropbox integration unavailable.', 'error');
      return;
    }
    if (!this.dropboxManager.isConnected) {
      this.showSyncStatus('Connect Dropbox to sync analytics.', 'warning');
      return;
    }

    this.pendingSync = true;
    this.updateSyncButtonState();
    this.showSyncStatus('Syncing Dropbox workouts…', 'info');

    try {
      const workouts = await this.dropboxManager.loadWorkouts({ maxEntries: Infinity });
      this.setWorkouts(workouts);
      const summary = workouts.length === 1 ? 'Loaded 1 workout.' : `Loaded ${workouts.length} workouts.`;
      this.showSyncStatus(summary, 'success');
    } catch (error) {
      const message = error?.message || 'Unknown error';
      this.showSyncStatus(`Sync failed: ${message}`, 'error');
    } finally {
      this.pendingSync = false;
      this.updateSyncButtonState();
    }
  }

  handleAlignIdsRequest() {
    if (!Array.isArray(this.workouts) || this.workouts.length === 0) {
      this.showSyncStatus('Sync Dropbox workouts before aligning IDs.');
      return;
    }
    this.clearDropboxAlignPrompt();
    const result = this.alignWorkoutIdsBySetName();
    if (result.updatedCount > 0) {
      this.recomputeExercisePeaks();
      this.refreshExerciseOptions();
      this.updateChart();
      this.saveWorkoutsCache();
      const workoutLabel = result.updatedCount === 1 ? 'workout' : 'workouts';
      const setLabel = result.affectedSets === 1 ? 'set' : 'sets';
      this.showSyncStatus(
        `Aligned IDs for ${result.updatedCount} ${workoutLabel} across ${result.affectedSets} ${setLabel}.`
      );
      const dropboxCandidates = this.getDropboxWritableWorkouts(result.updatedWorkouts);
      const canPersistToDropbox = dropboxCandidates.length > 0 &&
        Boolean(this.dropboxManager && this.dropboxManager.isConnected);
      if (canPersistToDropbox) {
        this.renderDropboxWritePrompt(dropboxCandidates);
      }
    } else {
      this.showSyncStatus('All workouts already share IDs for their set names.');
    }
  }

  handleDropboxStateChange(isConnected) {
    this.dropboxConnected = isConnected === true;
    this.updateSyncButtonState();
    if (!this.dropboxConnected) {
      this.showSyncStatus('Connect Dropbox to sync analytics.', 'info');
      this._autoSyncRequested = false;
      this.clearDropboxAlignPrompt();
    }
    this.renderEmptyState();
    this.updateExerciseHint(this.exerciseOptions.length);
    if (this.dropboxConnected) {
      if (this.workouts.length) {
        this.showCachedDataStatus();
      }
      this.maybeAutoSync();
    }
  }

  updateSyncButtonState() {
    if (!this.syncButton) return;
    this.syncButton.disabled = !this.dropboxConnected || this.pendingSync;
  }

  updateAlignIdsButtonState() {
    if (!this.alignIdsButton) return;
    const hasWorkouts = Array.isArray(this.workouts) && this.workouts.length > 0;
    this.alignIdsButton.disabled = !hasWorkouts || this.pendingDropboxWrite;
  }

  showSyncStatus(message) {
    if (this.syncStatusEl) {
      this.syncStatusEl.textContent = message || '';
    }
  }

  showCachedDataStatus() {
    const label = this.cachedAt
      ? `Last synced ${this.cachedAt.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        })}.`
      : 'Last synced using cached Dropbox workouts.';
    this.showSyncStatus(label);
  }

  alignWorkoutIdsBySetName(workouts = this.workouts) {
    if (!Array.isArray(workouts) || workouts.length === 0) {
      return { updatedCount: 0, affectedSets: 0, updatedWorkouts: [] };
    }
    const ordered = workouts
      .map((workout, index) => {
        const timestamp = this.getWorkoutTimestamp(workout);
        const hasTimestamp = timestamp instanceof Date && !Number.isNaN(timestamp.getTime());
        const timeValue = hasTimestamp ? timestamp.getTime() : -Number.MAX_SAFE_INTEGER + index;
        return { workout, timeValue };
      })
      .sort((a, b) => b.timeValue - a.timeValue);

    const setMap = new Map();
    let updatedCount = 0;
    const affectedSets = new Set();
    const updatedWorkouts = [];

    ordered.forEach(({ workout }) => {
      if (!workout) return;
      const setName = typeof workout.setName === 'string' ? workout.setName.trim() : '';
      if (!setName) {
        return;
      }

      const normalizedSet = setName.toLowerCase();
      const stored = setMap.get(normalizedSet) || { exerciseId: null, exerciseIdNew: null };
      const legacyId = this.normalizeLegacyExerciseId(workout.exerciseId);
      const numericId = this.toNumericExerciseId(workout.exerciseIdNew);

      let mutated = false;
      if (!legacyId && stored.exerciseId) {
        workout.exerciseId = stored.exerciseId;
        mutated = true;
      }
      if (numericId === null && stored.exerciseIdNew !== null && stored.exerciseIdNew !== undefined) {
        workout.exerciseIdNew = stored.exerciseIdNew;
        mutated = true;
      }

      const resolvedLegacyId = this.normalizeLegacyExerciseId(workout.exerciseId);
      const resolvedNumericId = this.toNumericExerciseId(workout.exerciseIdNew);
      setMap.set(normalizedSet, {
        exerciseId: stored.exerciseId || resolvedLegacyId || null,
        exerciseIdNew: stored.exerciseIdNew ?? resolvedNumericId ?? null,
      });

      if (mutated) {
        updatedCount += 1;
        affectedSets.add(normalizedSet);
        updatedWorkouts.push(workout);
      }
    });

    return { updatedCount, affectedSets: affectedSets.size, updatedWorkouts };
  }

  getDropboxWritableWorkouts(workouts = []) {
    if (!Array.isArray(workouts) || workouts.length === 0) {
      return [];
    }
    return workouts.filter((workout) => Boolean(this.getDropboxPathFromWorkout(workout)));
  }

  renderDropboxWritePrompt(workouts) {
    if (!Array.isArray(workouts) || workouts.length === 0) {
      return;
    }
    if (!this.dropboxManager || !this.dropboxManager.isConnected) {
      return;
    }
    if (typeof document === 'undefined') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        const shouldPersist = window.confirm('Update Dropbox workouts with aligned IDs?');
        if (shouldPersist) {
          this.persistAlignedWorkoutsToDropbox(workouts);
        } else {
          this.showSyncStatus('Aligned IDs applied locally. Dropbox workouts unchanged.');
        }
      }
      return;
    }

    this.clearDropboxAlignPrompt();
    const overlay = document.createElement('div');
    overlay.className = 'analytics-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.tabIndex = -1;

    const dialog = document.createElement('div');
    dialog.className = 'analytics-dialog';

    const title = document.createElement('h3');
    title.className = 'analytics-dialog__title';
    title.textContent = 'Align Dropbox Workout IDs';

    const body = document.createElement('p');
    const workoutLabel = workouts.length === 1 ? 'this Dropbox workout' : `${workouts.length} Dropbox workouts`;
    body.innerHTML = `Apply the aligned IDs back to ${workoutLabel}? This overwrites the original <code>.json</code> files.`;
    body.className = 'analytics-dialog__body';

    const actions = document.createElement('div');
    actions.className = 'analytics-dialog__actions';

    const yesButton = document.createElement('button');
    yesButton.type = 'button';
    yesButton.className = 'btn primary';
    yesButton.textContent = 'Yes, update Dropbox';

    const noButton = document.createElement('button');
    noButton.type = 'button';
    noButton.className = 'btn subtle';
    noButton.textContent = 'No, keep local only';

    actions.appendChild(noButton);
    actions.appendChild(yesButton);

    dialog.appendChild(title);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    if (typeof overlay.focus === 'function') {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => overlay.focus());
      } else {
        overlay.focus();
      }
    }

    const handleSelection = (shouldPersist) => {
      this.clearDropboxAlignPrompt();
      if (shouldPersist) {
        this.persistAlignedWorkoutsToDropbox(workouts);
      } else {
        this.showSyncStatus('Aligned IDs applied locally. Dropbox workouts unchanged.');
      }
    };

    yesButton.addEventListener('click', () => handleSelection(true));
    noButton.addEventListener('click', () => handleSelection(false));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        handleSelection(false);
      }
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleSelection(false);
      }
    });

    this.alignPromptState = { overlay };
  }

  clearDropboxAlignPrompt() {
    const state = this.alignPromptState;
    if (!state) {
      return;
    }
    const elements = ['wrapper', 'overlay'];
    elements.forEach((key) => {
      const el = state[key];
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
    this.alignPromptState = null;
  }

  setDropboxWritePending(isPending) {
    this.pendingDropboxWrite = isPending === true;
    this.updateAlignIdsButtonState();
  }

  async persistAlignedWorkoutsToDropbox(workouts = []) {
    if (!this.dropboxManager || !this.dropboxManager.isConnected) {
      this.showSyncStatus('Connect Dropbox to update workouts with aligned IDs.');
      return;
    }
    if (typeof this.dropboxManager.overwriteWorkoutFile !== 'function') {
      this.showSyncStatus('Dropbox integration does not yet support overwriting workouts.');
      return;
    }
    const candidates = this.getDropboxWritableWorkouts(workouts);
    if (!candidates.length) {
      this.showSyncStatus('No Dropbox workout files available to update.');
      return;
    }
    this.setDropboxWritePending(true);
    this.showSyncStatus('Updating Dropbox workouts with aligned IDs…');
    try {
      let updated = 0;
      for (const workout of candidates) {
        const path = this.getDropboxPathFromWorkout(workout);
        if (!path) {
          continue;
        }
        await this.dropboxManager.overwriteWorkoutFile(path, workout);
        updated += 1;
      }
      this.showSyncStatus(
        `Updated ${updated} Dropbox workout${updated === 1 ? '' : 's'} with aligned IDs.`
      );
    } catch (error) {
      const message = error?.message || 'Unknown error';
      this.showSyncStatus(`Failed to update Dropbox workouts: ${message}`);
    } finally {
      this.setDropboxWritePending(false);
    }
  }

  getDropboxMetadataFromWorkout(workout) {
    if (!workout || typeof workout !== 'object') {
      return null;
    }
    const metadata = workout._dropboxMetadata;
    if (metadata && typeof metadata === 'object') {
      return metadata;
    }
    return null;
  }

  getDropboxPathFromWorkout(workout) {
    const metadata = this.getDropboxMetadataFromWorkout(workout);
    const path = metadata?.path || metadata?.path_lower;
    if (typeof path === 'string' && path.trim().length > 0) {
      return path;
    }
    return null;
  }

  setRange(value) {
    const normalized = Object.prototype.hasOwnProperty.call(this.rangeMeta, value) ? value : this.currentRange;
    if (normalized === this.currentRange) {
      this.updateRangeButtons();
      return;
    }

    this.currentRange = normalized;
    this.updateRangeButtons();
    this.updateChart();
    this.notifyFilterChange();
  }

  updateRangeButtons() {
    const target = this.currentRange;
    this.rangeButtons.forEach((button) => {
      const isActive = button.dataset.analyticsRange === target;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  handleExerciseChange() {
    if (!this.exerciseSelect) return;
    this.currentExerciseKey = this.exerciseSelect.value || '';
    this.updateSelectionLabel();
    this.updateChart();
    this.notifyFilterChange();
  }

  refreshExerciseOptions() {
    if (!this.exerciseSelect) return;

    const options = this.buildExerciseOptions();
    this.exerciseOptions = options;
    this.exerciseOptionMap = new Map(options.map((opt) => [opt.key, opt]));

    const previousKey = this.currentExerciseKey;
    const hasPrevious = previousKey && this.exerciseOptionMap.has(previousKey);
    const preferredKey = !hasPrevious ? this.getHeaviestExerciseKey(options) : null;
    const shouldSelectFirst = !hasPrevious && !preferredKey && options.length > 0;

    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = options.length
      ? 'All exercises (default)'
      : this.dropboxConnected
        ? 'Sync Dropbox to load workouts'
        : 'Connect Dropbox to load workouts';
    fragment.appendChild(placeholder);

    options.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.key;
      optionEl.textContent = opt.label;
      if (typeof opt.numericId === 'number') {
        optionEl.dataset.exerciseIdNew = String(opt.numericId);
      }
      if (opt.name) {
        optionEl.dataset.exerciseName = opt.name;
      }
      fragment.appendChild(optionEl);
    });

    this.exerciseSelect.innerHTML = '';
    this.exerciseSelect.appendChild(fragment);
    this.exerciseSelect.disabled = options.length === 0;

    if (hasPrevious) {
      this.exerciseSelect.value = previousKey;
    } else if (preferredKey) {
      this.currentExerciseKey = preferredKey;
      this.exerciseSelect.value = preferredKey;
    } else if (shouldSelectFirst) {
      const fallbackKey = options[0]?.key || '';
      this.currentExerciseKey = fallbackKey;
      this.exerciseSelect.value = fallbackKey;
    } else {
      this.currentExerciseKey = '';
      this.exerciseSelect.value = '';
    }

    this.updateExerciseHint(options.length);
    this.updateSelectionLabel();
    this.notifyFilterChange();
  }

  updateExerciseHint(count) {
    if (!this.exerciseHintEl) return;

    if (count > 0) {
      const noun = count === 1 ? 'exercise' : 'exercises';
      this.exerciseHintEl.textContent = `${count} ${noun} detected from Dropbox workout history.`;
      return;
    }

    this.exerciseHintEl.textContent = this.dropboxConnected
      ? 'Sync Dropbox workouts to populate exercises.'
      : 'Connect Dropbox to populate exercises automatically.';
  }

  buildExerciseOptions() {
    if (!Array.isArray(this.workouts) || this.workouts.length === 0) {
      return [];
    }

    const map = new Map();

    for (const workout of this.workouts) {
      const details = this.extractExerciseDetails(workout);
      if (!details) {
        continue;
      }

      const existing = map.get(details.key);
      if (!existing) {
        map.set(details.key, details);
      } else if (!existing.hasName && details.hasName) {
        map.set(details.key, details);
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.sortLabel.localeCompare(b.sortLabel, undefined, { sensitivity: 'base' }),
    );
  }

  getHeaviestExerciseKey(options) {
    if (!Array.isArray(options) || !options.length || !this.exercisePeakMap) {
      return null;
    }
    let bestKey = null;
    let bestValue = -Infinity;
    options.forEach((opt) => {
      const peakKg = this.exercisePeakMap.get(opt.key);
      if (Number.isFinite(peakKg) && peakKg > bestValue) {
        bestValue = peakKg;
        bestKey = opt.key;
      }
    });
    return bestKey;
  }

  extractExerciseDetails(workout) {
    if (!workout) {
      return null;
    }

    const identity = this.getWorkoutIdentityInfo(workout);
    if (!identity || !identity.key) {
      return null;
    }

    const numericId = this.resolveNumericId(workout, identity);
    const name = this.resolveExerciseName(workout, identity);
    const rawLabel = identity.label || name || null;
    const labelParts = [];
    if (name) {
      labelParts.push(name);
    } else if (rawLabel) {
      labelParts.push(rawLabel);
    }
    if (numericId !== null) {
      labelParts.push(`#${numericId}`);
    }
    const label = labelParts.length > 0
      ? labelParts.join(' ')
      : `Exercise ${numericId !== null ? numericId : ''}`;

    return {
      key: identity.key,
      label,
      numericId,
      name: name || null,
      sortLabel: (name || rawLabel || label).toLowerCase(),
      hasName: Boolean(name)
    };
  }

  resolveNumericId(workout, identity) {
    const candidates = [
      workout?.exerciseIdNew,
      workout?.planExerciseIdNew,
      workout?.builderMeta?.exerciseIdNew,
      workout?.builderMeta?.exerciseNumericId,
      workout?.builderMeta?.exercise?.id_new,
      identity?.key?.startsWith('exercise:') ? Number(identity.key.split(':')[1]) : null
    ];

    for (const candidate of candidates) {
      const numeric = this.toNumericExerciseId(candidate);
      if (numeric !== null) {
        return numeric;
      }
    }

    return null;
  }

  resolveExerciseName(workout, identity) {
    const candidates = [
      workout?.builderMeta?.exercise?.name,
      workout?.builderMeta?.exerciseName,
      workout?.builderMeta?.name,
      workout?.exerciseName,
      workout?.planExerciseName,
      workout?.setName
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }

    if (identity?.label && !/^exercise\s+/i.test(identity.label)) {
      return identity.label;
    }

    return null;
  }

  updateSelectionLabel() {
    if (!this.selectionLabelEl) {
      return;
    }

    const option = this.getSelectedExercise();
    if (option) {
      this.selectionLabelEl.textContent = `Tracking: ${option.label}`;
    } else {
      this.selectionLabelEl.textContent = 'Select an exercise to populate trends.';
    }
  }

  getSelectedExercise() {
    if (!this.currentExerciseKey) {
      return null;
    }
    return this.exerciseOptionMap.get(this.currentExerciseKey) || null;
  }

  updateChart() {
    if (!this.chartEl) {
      return;
    }

    const filteredWorkouts = this.filterWorkoutsByRange(this.filterWorkoutsByExercise());
    const scopedWorkouts = this.currentExerciseKey ? filteredWorkouts : [];

    if (!this.currentExerciseKey) {
      this.hideChart(this.dropboxConnected
        ? 'Select an exercise to load analytics.'
        : null);
      this.updateSummary([]);
      this.updateMeta([]);
      this.updateWorkloadMetrics([]);
      this.renderMonthlyChart(filteredWorkouts);
      return;
    }

    const allEntries = this.buildSeriesForExercise(this.currentExerciseKey);
    const visibleEntries = this.filterSeriesByRange(allEntries);

    if (visibleEntries.length === 0) {
      const message = this.dropboxConnected
        ? 'No workouts in the selected range. Try syncing or expanding the range.'
        : null;
      this.hideChart(message);
      this.updateSummary([]);
      this.updateMeta([]);
      this.updateWorkloadMetrics(scopedWorkouts);
      this.renderMonthlyChart(filteredWorkouts);
      return;
    }

    this.showChart();
    const data = this.buildChartData(visibleEntries);
    this.ensureChart();
    if (this.chart) {
      this.chart.setData(data);
      this.refreshChartSize();
    }

    this.updateSummary(visibleEntries);
    this.updateMeta(visibleEntries);
    this.updateWorkloadMetrics(scopedWorkouts);
    this.renderMonthlyChart(filteredWorkouts);
  }

  filterWorkoutsByExercise() {
    const key = this.currentExerciseKey;
    if (!key) {
      return Array.isArray(this.workouts) ? [...this.workouts] : [];
    }
    return (Array.isArray(this.workouts) ? this.workouts : []).filter((workout) => {
      const identity = this.getWorkoutIdentityInfo(workout);
      return identity?.key === key;
    });
  }

  filterWorkoutsByRange(workouts = []) {
    const days = this.getRangeDays();
    if (!Number.isFinite(days) || days <= 0) {
      return workouts;
    }
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return workouts.filter((workout) => {
      const timestamp = this.getWorkoutTimestamp(workout);
      return timestamp instanceof Date && !Number.isNaN(timestamp.getTime()) && timestamp.getTime() >= cutoff;
    });
  }

  buildSeriesForExercise(exerciseKey) {
    if (!Array.isArray(this.workouts) || this.workouts.length === 0) {
      return [];
    }

    const dayMap = new Map();

    for (const workout of this.workouts) {
      if (!workout) {
        continue;
      }
      const identity = this.getWorkoutIdentityInfo(workout);
      if (!identity || identity.key !== exerciseKey) {
        continue;
      }

      const timestamp = this.getWorkoutTimestamp(workout);
      if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
        continue;
      }

      // compute peaks and rep/volume totals for this workout
      const peaks = this.getWorkoutPhasePeaks(workout);
      const concKg = Number(peaks.concentricKg) || 0;
      const eccKg = Number(peaks.eccentricKg) || 0;
      // Skip workouts with no measurable peaks
      if (concKg <= 0 && eccKg <= 0) {
        continue;
      }

      // Compute per-workout averages (kg) to contribute to per-day means.
      // Prefer stored per-workout average fields when present, otherwise
      // fall back to rep-derived values.
      const repDetails = this.getWorkoutRepDetails(workout);
      const reps = Number(repDetails.count) || 0;

      const storedAvgTotal = Number(workout.averageLoad) || Number(workout.averageTotal) || 0;
      const storedAvgLeft = Number(workout.averageLoadLeft) || Number(workout.averageLeft) || 0;
      const storedAvgRight = Number(workout.averageLoadRight) || Number(workout.averageRight) || 0;

      const perWorkoutAvgKgFromReps = (function () {
        const totalConcentricKg = Number(repDetails.totalConcentricKg) || 0;
        const totalEccentricKg = Number(repDetails.totalEccentricKg) || 0;
        const totalVol = Math.max(totalConcentricKg, totalEccentricKg, 0);
        return reps > 0 ? totalVol / reps : 0;
      })();

      // Determine per-workout averages (kg), preferring stored fields
      const perWorkoutAvgKg = storedAvgTotal > 0 ? storedAvgTotal : perWorkoutAvgKgFromReps || 0;
      const perWorkoutAvgLeftKg = storedAvgLeft > 0 ? storedAvgLeft : 0;
      const perWorkoutAvgRightKg = storedAvgRight > 0 ? storedAvgRight : 0;

      const dayStart = this.getDayStart(timestamp);
      const existing = dayMap.get(dayStart);
      if (!existing) {
        dayMap.set(dayStart, {
          day: dayStart,
          weightKg: concKg,
          concentricKg: concKg,
          eccentricKg: eccKg,
          timestamp,
          // accumulate per-day workout-average sums and counts
          dayAvgTotalSumKg: perWorkoutAvgKg > 0 ? perWorkoutAvgKg : 0,
          dayAvgLeftSumKg: perWorkoutAvgLeftKg > 0 ? perWorkoutAvgLeftKg : 0,
          dayAvgRightSumKg: perWorkoutAvgRightKg > 0 ? perWorkoutAvgRightKg : 0,
          dayWorkoutCountTotal: perWorkoutAvgKg > 0 ? 1 : 0,
          dayWorkoutCountLeft: perWorkoutAvgLeftKg > 0 ? 1 : 0,
          dayWorkoutCountRight: perWorkoutAvgRightKg > 0 ? 1 : 0
        });
        continue;
      }

      // update peaks if this workout contributes a higher peak
      if (concKg > existing.concentricKg) {
        existing.concentricKg = concKg;
        existing.weightKg = concKg;
        existing.timestamp = timestamp;
      }
      if (eccKg > existing.eccentricKg) {
        existing.eccentricKg = eccKg;
      }

      // accumulate per-day workout-average sums and counts
      existing.dayAvgTotalSumKg = (existing.dayAvgTotalSumKg || 0) + (perWorkoutAvgKg > 0 ? perWorkoutAvgKg : 0);
      existing.dayAvgLeftSumKg = (existing.dayAvgLeftSumKg || 0) + (perWorkoutAvgLeftKg > 0 ? perWorkoutAvgLeftKg : 0);
      existing.dayAvgRightSumKg = (existing.dayAvgRightSumKg || 0) + (perWorkoutAvgRightKg > 0 ? perWorkoutAvgRightKg : 0);
      existing.dayWorkoutCountTotal = (existing.dayWorkoutCountTotal || 0) + (perWorkoutAvgKg > 0 ? 1 : 0);
      existing.dayWorkoutCountLeft = (existing.dayWorkoutCountLeft || 0) + (perWorkoutAvgLeftKg > 0 ? 1 : 0);
      existing.dayWorkoutCountRight = (existing.dayWorkoutCountRight || 0) + (perWorkoutAvgRightKg > 0 ? 1 : 0);
    }

    // Convert accumulated map to array and compute per-day averages
    const results = Array.from(dayMap.values()).map((entry) => {
      const totalSum = Number(entry.dayAvgTotalSumKg) || 0;
      const totalCount = Number(entry.dayWorkoutCountTotal) || 0;
      const avgTotalKg = totalCount > 0 ? totalSum / totalCount : 0;

      const leftSum = Number(entry.dayAvgLeftSumKg) || 0;
      const leftCount = Number(entry.dayWorkoutCountLeft) || 0;
      const avgLeftKg = leftCount > 0 ? leftSum / leftCount : 0;

      const rightSum = Number(entry.dayAvgRightSumKg) || 0;
      const rightCount = Number(entry.dayWorkoutCountRight) || 0;
      const avgRightKg = rightCount > 0 ? rightSum / rightCount : 0;

      return {
        day: entry.day,
        weightKg: entry.weightKg,
        concentricKg: entry.concentricKg,
        eccentricKg: entry.eccentricKg,
        timestamp: entry.timestamp,
        averageTotalKg: avgTotalKg,
        averageLeftKg: avgLeftKg,
        averageRightKg: avgRightKg
      };
    });

    return results.sort((a, b) => a.day - b.day);
  }

  getDayStart(date) {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized.getTime();
  }

  filterSeriesByRange(entries) {
    const days = this.getRangeDays();
    if (!Number.isFinite(days) || days <= 0) {
      return entries;
    }
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return entries.filter((entry) => entry.day >= cutoff);
  }

  buildChartData(entries) {
    const unit = this.getUnitLabel();
    const timestamps = [];
    const concentric = [];
    const eccentric = [];
    const avgSeries = [];
    entries.forEach((entry) => {
      const concKg = Number(entry.concentricKg ?? entry.weightKg) || 0;
      const eccKg = Number(entry.eccentricKg ?? entry.weightKg) || 0;
      const entryAvgKg = Number(entry.averageTotalKg) || 0;
      timestamps.push(entry.day / 1000);
      concentric.push(this.convertKgToDisplay(concKg, unit));
      eccentric.push(this.convertKgToDisplay(eccKg, unit));
      avgSeries.push(this.convertKgToDisplay(entryAvgKg, unit));
    });

    return [timestamps, concentric, eccentric, avgSeries];
  }

  ensureChart() {
    if (this.chart || typeof window === 'undefined' || typeof window.uPlot !== 'function') {
      this.setupResizeObserver();
      return;
    }
    if (!this.chartEl) {
      return;
    }

    const width = this.chartWrapper?.clientWidth || 600;
    const unitLabel = this.getUnitLabel().toUpperCase();
    const opts = {
      width,
      height: 360,
      scales: {
        x: { time: true },
        y: {
          auto: true,
          range: (u, min, max) => {
            const upper = Number.isFinite(max) && max > 0 ? max : 10;
            const pad = upper * 0.15;
            return [0, upper + pad];
          }
        }
      },
      series: [
        {
          label: 'Date',
          value: (u, v) => {
            if (v == null) return '-';
            const date = new Date(v * 1000);
            return date.toLocaleDateString();
          }
        },
        {
          label: `Concentric (${unitLabel})`,
          stroke: '#7aa2f7',
          width: 2,
          value: (u, v) => (v == null ? '-' : v.toFixed(this.getDisplayDecimals()))
        },
        {
          label: `Eccentric (${unitLabel})`,
          stroke: '#f472b6',
          width: 2,
          value: (u, v) => (v == null ? '-' : v.toFixed(this.getDisplayDecimals()))
        },
        {
          label: `Avg Total Load (${unitLabel})`,
          stroke: '#38bdf8',
          width: 2,
          dash: [6, 6],
          value: (u, v) => (v == null ? '-' : v.toFixed(this.getDisplayDecimals())),
          points: { show: false },
        }
      ],
      axes: [
        {
          stroke: '#6b7280',
          grid: { show: true, stroke: '#1f2737' },
          values: (u, splits) => this.buildAxisDayLabels(splits)
        },
        {
          stroke: '#6b7280',
          grid: { show: true, stroke: '#1f2737' },
          side: 3
        }
      ]
    };

    this.chart = new window.uPlot(opts, [[], [], [], []], this.chartEl);
    this.setupResizeObserver();
  }

  setupResizeObserver() {
    if (typeof window === 'undefined' || !this.chartWrapper) {
      return;
    }

    if (typeof window.ResizeObserver === 'function') {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      this.resizeObserver = new window.ResizeObserver(() => this.refreshChartSize());
      this.resizeObserver.observe(this.chartWrapper);
      return;
    }

    if (!this.boundResizeHandler) {
      this.boundResizeHandler = () => this.refreshChartSize();
      window.addEventListener('resize', this.boundResizeHandler);
    }
  }

  refreshChartSize() {
    if (!this.chart || !this.chartWrapper) {
      return;
    }
    const width = this.chartWrapper.clientWidth || 600;
    this.chart.setSize({ width, height: 360 });
  }

  bindWorkloadTooltipEvents() {
    if (this.workloadTriggerEl) {
      this.workloadTriggerEl.addEventListener('pointerenter', () => this.showWorkloadTooltip());
      this.workloadTriggerEl.addEventListener('pointerleave', () => this.scheduleHideWorkloadTooltip());
      this.workloadTriggerEl.addEventListener('focus', () => this.showWorkloadTooltip());
      this.workloadTriggerEl.addEventListener('blur', () => this.scheduleHideWorkloadTooltip());
    }
    if (this.workloadTooltipEl) {
      this.workloadTooltipEl.addEventListener('pointerenter', () => this.showWorkloadTooltip());
      this.workloadTooltipEl.addEventListener('pointerleave', () => this.scheduleHideWorkloadTooltip());
    }
  }

  showWorkloadTooltip() {
    if (!this.workloadTooltipEl || !this.workloadTriggerEl || this.workloadTriggerEl.disabled) {
      return;
    }
    this.clearWorkloadHideTimeout();
    this.workloadTooltipEl.classList.add('is-visible');
    this.workloadTooltipEl.setAttribute('aria-hidden', 'false');
    this.workloadTriggerEl.setAttribute('aria-expanded', 'true');
  }

  hideWorkloadTooltip(immediate = false) {
    if (!this.workloadTooltipEl || !this.workloadTriggerEl) {
      return;
    }
    this.clearWorkloadHideTimeout();
    if (immediate) {
      this.workloadTooltipEl.classList.remove('is-visible');
      this.workloadTooltipEl.setAttribute('aria-hidden', 'true');
      this.workloadTriggerEl.setAttribute('aria-expanded', 'false');
      return;
    }
    this.workloadTooltipEl.classList.remove('is-visible');
    this.workloadTooltipEl.setAttribute('aria-hidden', 'true');
    this.workloadTriggerEl.setAttribute('aria-expanded', 'false');
  }

  scheduleHideWorkloadTooltip() {
    if (!this.workloadTooltipEl) {
      return;
    }
    this.clearWorkloadHideTimeout();
    this.workloadHideTimeout = setTimeout(() => {
      this.hideWorkloadTooltip(true);
    }, 120);
  }

  clearWorkloadHideTimeout() {
    if (this.workloadHideTimeout) {
      clearTimeout(this.workloadHideTimeout);
      this.workloadHideTimeout = null;
    }
  }

  handleUnitChange() {
    this.updateChart();
  }

  hideChart(message = null) {
    if (this.chartEl) {
      this.chartEl.classList.add('is-hidden');
    }
    this.renderEmptyState(message);
  }

  showChart() {
    if (this.chartEl) {
      this.chartEl.classList.remove('is-hidden');
    }
    this.renderEmptyState(null, true);
  }

  renderEmptyState(message = null, hide = false) {
    if (!this.emptyStateEl) {
      return;
    }

    if (hide) {
      this.emptyStateEl.classList.add('hidden');
      return;
    }

    const fallback = this.buildDefaultEmptyMessage();
    this.emptyStateEl.textContent = message || fallback;
    this.emptyStateEl.classList.remove('hidden');
  }

  buildDefaultEmptyMessage() {
    if (!this.dropboxConnected) {
      return 'Connect Dropbox and sync to view analytics.';
    }
    if (!Array.isArray(this.workouts) || this.workouts.length === 0) {
      return 'No Dropbox workouts synced yet.';
    }
    if (!this.currentExerciseKey) {
      return 'Select an exercise to populate trends.';
    }
    return 'No workouts in the selected range.';
  }

  updateSummary(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      this.setDualMetricPlaceholders();
      return;
    }

    let peakConcentricEntry = null;
    let peakEccentricEntry = null;
    let baselineEntry = null;
    let baselineTime = Infinity;

    entries.forEach((entry) => {
      const conc = Number(entry.concentricKg ?? entry.weightKg) || 0;
      const ecc = Number(entry.eccentricKg) || 0;
      if (!peakConcentricEntry || conc > (Number(peakConcentricEntry.concentricKg ?? peakConcentricEntry.weightKg) || 0)) {
        peakConcentricEntry = entry;
      }
      if (!peakEccentricEntry || ecc > (Number(peakEccentricEntry.eccentricKg) || 0)) {
        peakEccentricEntry = entry;
      }
      const dayValue = Number(entry.day);
      const timeValue = Number.isFinite(dayValue)
        ? dayValue
        : entry.timestamp instanceof Date && !Number.isNaN(entry.timestamp.getTime())
          ? entry.timestamp.getTime()
          : Infinity;
      if (timeValue < baselineTime) {
        baselineEntry = entry;
        baselineTime = timeValue;
      }
    });

    if (!baselineEntry) {
      baselineEntry = entries[0];
    }

    const baselineConcentric = Number(baselineEntry?.concentricKg ?? baselineEntry?.weightKg) || 0;
    const baselineEccentric = Number(baselineEntry?.eccentricKg ?? baselineEntry?.weightKg) || 0;
    const baselineDate = baselineEntry?.timestamp || baselineEntry?.day || null;

    const peakConcentric = Number(peakConcentricEntry?.concentricKg ?? peakConcentricEntry?.weightKg) || 0;
    const peakEccentric = Number(peakEccentricEntry?.eccentricKg ?? peakConcentricEntry?.eccentricKg) || 0;

    this.setDualMetricValue(this.peakConcentricValueEl, peakConcentric);
    this.setDualMetricValue(this.peakEccentricValueEl, peakEccentric);
    this.setDualMetricDate(this.peakConcentricDateEl, peakConcentricEntry);
    this.setDualMetricDate(this.peakEccentricDateEl, peakEccentricEntry);

    this.setDualMetricValue(this.baselineConcentricValueEl, baselineConcentric);
    this.setDualMetricValue(this.baselineEccentricValueEl, baselineEccentric);
    this.setDualMetricDateValue(this.baselineConcentricDateEl, baselineDate);
    this.setDualMetricDateValue(this.baselineEccentricDateEl, baselineDate);

    this.setStrengthGainMetrics(
      this.deltaConcentricPctEl,
      this.deltaConcentricValueEl,
      peakConcentric,
      baselineConcentric
    );
    this.setStrengthGainMetrics(
      this.deltaEccentricPctEl,
      this.deltaEccentricValueEl,
      peakEccentric,
      baselineEccentric
    );
  }

  updateWorkloadMetrics(workouts) {
    if (!this.totalVolumeEl || !this.totalRepsEl || !this.averageLoadEl) {
      return;
    }
    const stats = this.calculateWorkloadStats(workouts);
    this.currentWorkloadStats = stats;
    if (!stats.hasWorkouts) {
      this.totalVolumeEl.textContent = '—';
      this.totalRepsEl.textContent = '—';
      this.averageLoadEl.textContent = '—';
      if (this.workloadTriggerEl) {
        this.workloadTriggerEl.disabled = true;
      }
      this.updateWorkloadSummary(stats);
      this.renderWorkloadBreakdown(stats);
      return;
    }
    const volumeDisplay = stats.totalVolumeKg > 0
      ? this.formatVolumeValue(stats.totalVolumeKg)
      : this.formatVolumeValue(0);
    this.totalVolumeEl.textContent = volumeDisplay;
    this.totalRepsEl.textContent = stats.totalReps > 0 ? this.formatCount(stats.totalReps) : '0';
    this.averageLoadEl.textContent =
      stats.totalReps > 0 && stats.averageLoadKg > 0 ? this.formatWeight(stats.averageLoadKg) : '—';
    if (this.workloadTriggerEl) {
      const disabled = !(stats.totalVolumeKg > 0);
      this.workloadTriggerEl.disabled = disabled;
      if (disabled) {
        this.hideWorkloadTooltip(true);
      }
    }
    this.updateWorkloadSummary(stats);
    this.renderWorkloadBreakdown(stats);
  }

  updateWorkloadSummary(stats) {
    if (!this.workloadAvgConcentricEl || !this.workloadAvgEccentricEl) {
      return;
    }
    const avgConc = Number(stats?.averageConcentricKg) || 0;
    const avgEcc = Number(stats?.averageEccentricKg) || 0;
    this.workloadAvgConcentricEl.textContent = avgConc > 0 ? this.formatWeight(avgConc) : '—';
    this.workloadAvgEccentricEl.textContent = avgEcc > 0 ? this.formatWeight(avgEcc) : '—';
  }

  renderWorkloadBreakdown(stats) {
    if (!this.workloadBreakdownEl || !this.workloadPieEl) {
      return;
    }
    const totalVolume = Number(stats?.totalVolumeKg) || 0;
    if (this.workloadTooltipTotalEl) {
      this.workloadTooltipTotalEl.textContent =
        totalVolume > 0 ? this.formatVolumeValue(totalVolume) : '—';
    }
    if (!stats?.hasWorkouts || totalVolume <= 0) {
      this.workloadPieEl.style.background = '#182036';
      this.workloadBreakdownEl.innerHTML = '';
      const empty = document.createElement('p');
      empty.className = 'analytics-workload-breakdown__empty';
      empty.textContent = this.currentExerciseKey
        ? 'No working volume recorded for this range.'
        : 'Select an exercise to view rep mix.';
      this.workloadBreakdownEl.appendChild(empty);
      return;
    }
    const segments = this.buildWorkloadSegments(stats.breakdown, totalVolume);
    this.applyWorkloadPieSegments(segments, totalVolume);
    const visibleSegments = segments.filter((segment) => segment.valueKg > 0 || segment.reps > 0);
    if (!visibleSegments.length) {
      this.workloadBreakdownEl.innerHTML = '';
      const empty = document.createElement('p');
      empty.className = 'analytics-workload-breakdown__empty';
      empty.textContent = 'No rep breakdown available for this range.';
      this.workloadBreakdownEl.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    visibleSegments.forEach((segment) => {
      const row = document.createElement('div');
      row.className = 'analytics-workload-breakdown__row';
      const label = document.createElement('div');
      label.className = 'analytics-workload-breakdown__label';
      const swatch = document.createElement('span');
      swatch.className = 'analytics-workload-breakdown__swatch';
      swatch.style.backgroundColor = segment.color;
      label.appendChild(swatch);
      const text = document.createElement('span');
      text.textContent = segment.label;
      label.appendChild(text);
      const percent = document.createElement('strong');
      percent.className = 'analytics-workload-breakdown__percent';
      percent.textContent = this.formatPercent(segment.percent);
      const details = document.createElement('div');
      details.className = 'analytics-workload-breakdown__details';
      const volumeLine = document.createElement('span');
      volumeLine.textContent = this.formatVolumeValue(segment.valueKg);
      const repsLine = document.createElement('span');
      repsLine.textContent = `${this.formatCount(segment.reps)} reps`;
      const avgConcLine = document.createElement('span');
      avgConcLine.textContent = `Avg Con ${this.formatAverageLoad(segment.avgConcentricKg)}`;
      const avgEccLine = document.createElement('span');
      avgEccLine.textContent = `Avg Ecc ${this.formatAverageLoad(segment.avgEccentricKg)}`;
      details.appendChild(volumeLine);
      details.appendChild(repsLine);
      details.appendChild(avgConcLine);
      details.appendChild(avgEccLine);
      row.appendChild(label);
      row.appendChild(percent);
      row.appendChild(details);
      fragment.appendChild(row);
    });
    this.workloadBreakdownEl.innerHTML = '';
    this.workloadBreakdownEl.appendChild(fragment);
  }

  buildWorkloadSegments(breakdownMap, totalVolumeKg) {
    const map = breakdownMap instanceof Map ? breakdownMap : new Map();
    const trackedKeys = new Set(WORKLOAD_BREAKDOWN_CATEGORIES.map((category) => category.key));
    const segments = WORKLOAD_BREAKDOWN_CATEGORIES.map((category) => {
      const entry = map.get(category.key) || {
        volumeKg: 0,
        reps: 0,
        concentricKg: 0,
        eccentricKg: 0
      };
      const reps = Number(entry.reps) || 0;
      const conc = Number(entry.concentricKg) || 0;
      const ecc = Number(entry.eccentricKg) || 0;
      const volumeKg = Number(entry.volumeKg) || 0;
      return {
        key: category.key,
        label: category.label,
        color: category.color,
        valueKg: volumeKg,
        reps,
        percent: totalVolumeKg > 0 ? (volumeKg / totalVolumeKg) * 100 : 0,
        avgConcentricKg: reps > 0 ? conc / reps : 0,
        avgEccentricKg: reps > 0 ? ecc / reps : 0
      };
    });
    const otherEntry = {
      volumeKg: 0,
      reps: 0,
      concentricKg: 0,
      eccentricKg: 0
    };
    map.forEach((entry, key) => {
      if (trackedKeys.has(key)) {
        return;
      }
      otherEntry.volumeKg += Number(entry?.volumeKg) || 0;
      otherEntry.reps += Number(entry?.reps) || 0;
      otherEntry.concentricKg += Number(entry?.concentricKg) || 0;
      otherEntry.eccentricKg += Number(entry?.eccentricKg) || 0;
    });
    const captured = segments.reduce((sum, entry) => sum + entry.valueKg, 0) + otherEntry.volumeKg;
    const remainderKg = Math.max(0, totalVolumeKg - captured);
    if (remainderKg > 0.01) {
      otherEntry.volumeKg += remainderKg;
    }
    if (otherEntry.volumeKg > 0.01 || otherEntry.reps > 0) {
      const reps = Number(otherEntry.reps) || 0;
      segments.push({
        key: WORKLOAD_OTHER_CATEGORY.key,
        label: WORKLOAD_OTHER_CATEGORY.label,
        color: WORKLOAD_OTHER_CATEGORY.color,
        valueKg: otherEntry.volumeKg,
        reps,
        percent: totalVolumeKg > 0 ? (otherEntry.volumeKg / totalVolumeKg) * 100 : 0,
        avgConcentricKg: reps > 0 ? (otherEntry.concentricKg || 0) / reps : 0,
        avgEccentricKg: reps > 0 ? (otherEntry.eccentricKg || 0) / reps : 0
      });
    }
    return segments;
  }

  applyWorkloadPieSegments(segments, totalVolumeKg) {
    if (!this.workloadPieEl) {
      return;
    }
    const validSegments = segments.filter((segment) => segment.valueKg > 0);
    if (!validSegments.length || !Number.isFinite(totalVolumeKg) || totalVolumeKg <= 0) {
      this.workloadPieEl.style.background = '#182036';
      return;
    }
    let offset = 0;
    const gradientStops = validSegments.map((segment) => {
      const share = segment.valueKg / totalVolumeKg;
      const start = offset * 360;
      offset += share;
      const end = Math.min(360, offset * 360);
      return `${segment.color} ${start}deg ${end}deg`;
    });
    this.workloadPieEl.style.background = `conic-gradient(${gradientStops.join(', ')})`;
  }

  calculateWorkloadStats(workouts = []) {
    const hasWorkouts = Array.isArray(workouts) && workouts.length > 0;
    const stats = {
      totalVolumeKg: 0,
      totalReps: 0,
      averageLoadKg: 0,
      totalConcentricKg: 0,
      totalEccentricKg: 0,
      averageConcentricKg: 0,
      averageEccentricKg: 0,
      breakdown: new Map(),
      hasWorkouts
    };
    if (!hasWorkouts) {
      return stats;
    }
    workouts.forEach((workout) => {
      if (!workout) {
        return;
      }
      const repDetails = this.getWorkoutRepDetails(workout);
      const reps = repDetails.count;
      if (reps > 0) {
        stats.totalReps += reps;
        stats.totalConcentricKg += repDetails.totalConcentricKg;
        stats.totalEccentricKg += repDetails.totalEccentricKg;
      }
      const category = this.getWorkoutModeCategory(workout);
      const bucket = stats.breakdown.get(category) || {
        volumeKg: 0,
        reps: 0,
        concentricKg: 0,
        eccentricKg: 0
      };
      const volumeKg = this.getWorkoutVolumeKg(workout);
      if (Number.isFinite(volumeKg) && volumeKg > 0) {
        stats.totalVolumeKg += volumeKg;
        bucket.volumeKg += volumeKg;
      }
      if (reps > 0) {
        bucket.reps += reps;
        bucket.concentricKg += repDetails.totalConcentricKg;
        bucket.eccentricKg += repDetails.totalEccentricKg;
      }
      stats.breakdown.set(category, bucket);
    });
    stats.averageLoadKg = stats.totalReps > 0 ? stats.totalVolumeKg / stats.totalReps : 0;
    stats.averageConcentricKg = stats.totalReps > 0 ? stats.totalConcentricKg / stats.totalReps : 0;
    stats.averageEccentricKg = stats.totalReps > 0 ? stats.totalEccentricKg / stats.totalReps : 0;
    return stats;
  }

  getWorkoutRepDetails(workout) {
    if (!workout || typeof workout !== 'object') {
      return { count: 0, totalConcentricKg: 0, totalEccentricKg: 0 };
    }
    const analysis = this.ensurePhaseAnalysis(workout);
    if (this.hasPhaseReps(analysis)) {
      const count = analysis.reps.length;
      const conc = Number(analysis.totalConcentricKg) || 0;
      const ecc = Number(analysis.totalEccentricKg) || 0;
      return {
        count,
        totalConcentricKg: conc,
        totalEccentricKg: ecc
      };
    }
    const stored = Number(workout.reps);
    if (Number.isFinite(stored) && stored > 0) {
      const totalLoadKg = this.getWorkoutTotalLoadKg(workout);
      const volume = Number.isFinite(totalLoadKg) && totalLoadKg > 0 ? totalLoadKg * stored : 0;
      return {
        count: stored,
        totalConcentricKg: volume,
        totalEccentricKg: volume
      };
    }
    const builderReps = Number(workout.builderMeta?.reps);
    if (Number.isFinite(builderReps) && builderReps > 0) {
      const totalLoadKg = this.getWorkoutTotalLoadKg(workout);
      const volume = Number.isFinite(totalLoadKg) && totalLoadKg > 0 ? totalLoadKg * builderReps : 0;
      return {
        count: builderReps,
        totalConcentricKg: volume,
        totalEccentricKg: volume
      };
    }
    return { count: 0, totalConcentricKg: 0, totalEccentricKg: 0 };
  }

  getWorkoutRepCount(workout) {
    const details = this.getWorkoutRepDetails(workout);
    return details.count;
  }

  getWorkoutModeCategory(workout) {
    if (!workout) {
      return WORKLOAD_OTHER_CATEGORY.key;
    }
    if (this.isEchoWorkout(workout)) {
      return 'ECHO';
    }
    const resolved = this.resolveWorkoutModeValue(workout);
    if (!resolved) {
      return WORKLOAD_OTHER_CATEGORY.key;
    }
    if (resolved === 'ECHO') return 'ECHO';
    if (resolved === 'TIME_UNDER_TENSION_BEAST' || resolved === 'TUT_BEAST') {
      return 'TIME_UNDER_TENSION_BEAST';
    }
    if (resolved === 'TIME_UNDER_TENSION' || resolved === 'TUT') {
      return 'TIME_UNDER_TENSION';
    }
    if (resolved === 'ECCENTRIC' || resolved === 'ECCENTRIC_ONLY') {
      return 'ECCENTRIC';
    }
    if (resolved === 'OLD_SCHOOL' || resolved === 'JUST_LIFT' || resolved === 'PUMP') {
      return 'OLD_SCHOOL';
    }
    if (resolved.includes('BEAST')) {
      return 'TIME_UNDER_TENSION_BEAST';
    }
    if (resolved.includes('TUT')) {
      return 'TIME_UNDER_TENSION';
    }
    if (resolved.includes('ECCENTRIC')) {
      return 'ECCENTRIC';
    }
    if (resolved.includes('OLD') || resolved.includes('JUST') || resolved.includes('PUMP')) {
      return 'OLD_SCHOOL';
    }
    if (resolved.includes('ECHO')) {
      return 'ECHO';
    }
    return WORKLOAD_OTHER_CATEGORY.key;
  }

  resolveWorkoutModeValue(workout) {
    const candidates = [
      workout?.mode,
      workout?.builderMeta?.mode,
      workout?.builderMeta?.modeLabel,
      workout?.planMode,
      workout?.itemType,
      workout?.programMode,
      workout?.builderMeta?.programMode
    ];
    for (const candidate of candidates) {
      const normalized = this.normalizeModeValue(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  normalizeModeValue(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      return PROGRAM_MODE_VALUE_MAP.get(value) || null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const upper = trimmed.toUpperCase();
      if (upper.includes('ECHO')) {
        return 'ECHO';
      }
      if (upper === 'TUT') {
        return 'TIME_UNDER_TENSION';
      }
      if (upper === 'TUT_BEAST') {
        return 'TIME_UNDER_TENSION_BEAST';
      }
      if (upper === 'ECCENTRIC_ONLY') {
        return 'ECCENTRIC';
      }
      if (upper.includes('JUST') && upper.includes('LIFT')) {
        return 'OLD_SCHOOL';
      }
      return upper.replace(/[^A-Z0-9]+/g, '_');
    }
    return null;
  }

  formatVolumeValue(kg) {
    const unit = this.getUnitLabel();
    const display = this.convertKgToDisplay(kg, unit);
    if (!Number.isFinite(display) || display <= 0) {
      return `0 ${unit}`;
    }
    return `${this.formatCompactValue(display)} ${unit}`;
  }

  formatCount(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return '0';
    }
    return Math.round(value).toLocaleString();
  }

  formatPercent(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return '0%';
    }
    if (value >= 99.5) {
      return '100%';
    }
    if (value >= 10) {
      return `${Math.round(value)}%`;
    }
    return `${value.toFixed(1)}%`;
  }

  formatGrowthPercent(value) {
    if (!Number.isFinite(value) || value === 0) {
      return '0%';
    }
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }

  formatDeltaWeight(deltaKg) {
    if (!Number.isFinite(deltaKg)) {
      return '—';
    }
    const unit = this.getUnitLabel();
    const display = Math.abs(this.convertKgToDisplay(deltaKg, unit));
    const decimals = this.getDisplayDecimals();
    const sign = deltaKg > 0 ? '+' : deltaKg < 0 ? '-' : '';
    return `${sign}${display.toFixed(decimals)} ${unit}`;
  }

  formatAverageLoad(kg) {
    if (!Number.isFinite(kg) || kg <= 0) {
      return '—';
    }
    return this.formatWeight(kg);
  }

  updateMeta(entries) {
    if (this.rangeLabelEl) {
      this.rangeLabelEl.textContent = this.rangeMeta[this.currentRange]?.label || 'Custom range';
    }
    if (this.pointCountEl) {
      const count = entries.length || 0;
      const noun = count === 1 ? 'day' : 'days';
      this.pointCountEl.textContent = `${count} ${noun} recorded`;
    }
    if (this.chartUnitEl) {
      this.chartUnitEl.textContent = this.getUnitLabel();
    }
  }

  renderMonthlyChart(workouts = []) {
    if (!this.monthlyChartEl || !this.monthlyLegendEl || !this.monthlyEmptyEl) {
      return;
    }

    if (!Array.isArray(workouts) || workouts.length === 0) {
      this.monthlyChartEl.innerHTML = '';
      this.monthlyLegendEl.innerHTML = '';
      this.monthlyEmptyEl.classList.remove('hidden');
      this.clearMonthlyAxis();
      this.clearMonthlyXAxis();
      this.renderPeakLine(null, null);
      this.hideMonthlyTooltip();
      return;
    }

    const series = this.buildMonthlyTotals(workouts);
    if (!series.months.length || !series.totalOrder.length) {
      this.monthlyChartEl.innerHTML = '';
      this.monthlyLegendEl.innerHTML = '';
      this.monthlyEmptyEl.classList.remove('hidden');
      this.clearMonthlyAxis();
      this.clearMonthlyXAxis();
      this.renderPeakLine(null, null);
      this.hideMonthlyTooltip();
      return;
    }

    this.monthlyEmptyEl.classList.add('hidden');
    this.hideMonthlyTooltip();

    const fragment = document.createDocumentFragment();
    const maxTotalKg = Math.max(...series.months.map((month) => month.totalKg), 1);
    this.renderMonthlyAxis(maxTotalKg);
    const maxBarHeight = MONTHLY_BAR_MAX_HEIGHT;
    series.months.forEach((month) => {
      const bar = document.createElement('div');
      bar.className = 'analytics-bar';

      const stack = document.createElement('div');
      stack.className = 'analytics-bar__stack';
      const normalizedHeight = Math.max(0.05, month.totalKg / maxTotalKg);
      stack.style.height = `${Math.max(8, normalizedHeight * maxBarHeight)}px`;

      const orderedSegments = [...series.totalOrder].reverse();
      orderedSegments.forEach((entry, reverseIndex) => {
        const colorIndex = series.totalOrder.length - reverseIndex - 1;
        const valueKg = month.byExercise.get(entry.key) || 0;
        if (valueKg <= 0) {
          return;
        }
        const segment = document.createElement('div');
        segment.className = 'analytics-bar-segment';
        segment.style.backgroundColor = this.getExerciseColor(entry.key, colorIndex);
        const stackShare = month.totalKg > 0 ? (valueKg / month.totalKg) * 100 : 0;
        segment.style.height = `${Math.max(2, stackShare)}%`;
        const exerciseLabel = entry.label || this.getFallbackLabelForKey(entry.key);
        const formattedWeight = this.formatMonthlyWeight(valueKg);
        const monthLabel = month.label || '';
        const ariaLabel = monthLabel ? `${exerciseLabel}: ${formattedWeight} in ${monthLabel}` : `${exerciseLabel}: ${formattedWeight}`;
        if (stackShare >= 20) {
          segment.textContent = formattedWeight;
        }
        segment.setAttribute('aria-label', ariaLabel);
        segment.setAttribute('role', 'img');
        segment.dataset.exerciseLabel = exerciseLabel;
        segment.dataset.monthLabel = monthLabel;
        segment.dataset.valueKg = String(valueKg);
        segment.tabIndex = 0;
        segment.addEventListener('pointerenter', this.boundMonthlySegmentEnter);
        segment.addEventListener('pointermove', this.boundMonthlySegmentMove);
        segment.addEventListener('pointerleave', this.boundMonthlySegmentLeave);
        segment.addEventListener('focus', this.boundMonthlySegmentFocus);
        segment.addEventListener('blur', this.boundMonthlySegmentBlur);
        stack.appendChild(segment);
      });

      if (!stack.children.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'analytics-bar-segment';
        placeholder.style.width = '100%';
        placeholder.style.backgroundColor = '#1f2737';
        placeholder.textContent = 'No data';
        stack.appendChild(placeholder);
      }
      bar.appendChild(stack);
      fragment.appendChild(bar);
    });

    this.monthlyChartEl.innerHTML = '';
    this.monthlyChartEl.appendChild(fragment);

    const legendFragment = document.createDocumentFragment();
    series.totalOrder.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'analytics-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'analytics-legend-swatch';
      swatch.style.backgroundColor = this.getExerciseColor(entry.key, index);
      item.appendChild(swatch);
      const text = document.createElement('span');
      text.textContent = entry.label;
      item.appendChild(text);
      legendFragment.appendChild(item);
    });
    this.monthlyLegendEl.innerHTML = '';
    this.monthlyLegendEl.appendChild(legendFragment);
    this.renderMonthlyXAxis(series.months);
    this.renderPeakLine(series.peakMonth, maxTotalKg);
  }

  ensureMonthlyTooltip() {
    if (this.monthlyTooltipEl) {
      return this.monthlyTooltipEl;
    }
    if (!this.monthlyChartWrapper) {
      return null;
    }
    const tooltip = document.createElement('div');
    tooltip.className = 'analytics-bar-tooltip';
    tooltip.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'analytics-bar-tooltip__label';
    const value = document.createElement('strong');
    value.className = 'analytics-bar-tooltip__value';
    const meta = document.createElement('span');
    meta.className = 'analytics-bar-tooltip__meta';
    meta.hidden = true;
    tooltip.appendChild(label);
    tooltip.appendChild(value);
    tooltip.appendChild(meta);
    this.monthlyChartWrapper.appendChild(tooltip);
    this.monthlyTooltipEl = tooltip;
    this.monthlyTooltipLabelEl = label;
    this.monthlyTooltipValueEl = value;
    this.monthlyTooltipMetaEl = meta;
    return tooltip;
  }

  setMonthlyTooltipVisibility(visible) {
    const tooltip = visible ? this.ensureMonthlyTooltip() : this.monthlyTooltipEl;
    if (!tooltip) {
      return;
    }
    if (visible) {
      tooltip.classList.add('is-visible');
      tooltip.setAttribute('aria-hidden', 'false');
    } else {
      tooltip.classList.remove('is-visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }
  }

  updateMonthlyTooltipContent(segment) {
    if (!segment) {
      return;
    }
    if (!this.ensureMonthlyTooltip() || !this.monthlyTooltipLabelEl || !this.monthlyTooltipValueEl || !this.monthlyTooltipMetaEl) {
      return;
    }
    const exerciseLabel = segment.dataset.exerciseLabel || 'Exercise';
    const rawValue = Number(segment.dataset.valueKg);
    const safeValue = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
    const monthLabel = segment.dataset.monthLabel || '';
    this.monthlyTooltipLabelEl.textContent = exerciseLabel;
    this.monthlyTooltipValueEl.textContent = this.formatMonthlyWeight(safeValue);
    if (monthLabel) {
      this.monthlyTooltipMetaEl.hidden = false;
      this.monthlyTooltipMetaEl.textContent = monthLabel;
    } else {
      this.monthlyTooltipMetaEl.hidden = true;
      this.monthlyTooltipMetaEl.textContent = '';
    }
  }

  positionMonthlyTooltip(event, segment) {
    const tooltip = this.monthlyTooltipEl;
    if (!tooltip || !this.monthlyChartWrapper) {
      return;
    }
    const wrapperRect = this.monthlyChartWrapper.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 0;
    const tooltipHeight = tooltip.offsetHeight || 0;
    let clientX;
    let clientY;
    if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (segment) {
      const rect = segment.getBoundingClientRect();
      clientX = rect.left + rect.width / 2;
      clientY = rect.top + rect.height / 2;
    } else {
      return;
    }
    const offset = 16;
    const padding = 8;
    let left = clientX - wrapperRect.left - tooltipWidth / 2;
    let top = clientY - wrapperRect.top - tooltipHeight - offset;
    if (top < padding) {
      top = clientY - wrapperRect.top + offset;
    }
    const maxLeft = wrapperRect.width - tooltipWidth - padding;
    const maxTop = wrapperRect.height - tooltipHeight - padding;
    if (!Number.isFinite(left)) {
      left = padding;
    }
    if (!Number.isFinite(top)) {
      top = padding;
    }
    left = Math.max(padding, Math.min(maxLeft, left));
    top = Math.max(padding, Math.min(maxTop, top));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  handleMonthlySegmentEnter(event) {
    const segment = event?.currentTarget;
    if (!segment) {
      return;
    }
    this.activeMonthlyTooltipSegment = segment;
    this.updateMonthlyTooltipContent(segment);
    this.positionMonthlyTooltip(event, segment);
    this.setMonthlyTooltipVisibility(true);
  }

  handleMonthlySegmentMove(event) {
    if (!this.activeMonthlyTooltipSegment) {
      return;
    }
    this.positionMonthlyTooltip(event, this.activeMonthlyTooltipSegment);
  }

  handleMonthlySegmentLeave(event) {
    if (event?.currentTarget !== this.activeMonthlyTooltipSegment) {
      return;
    }
    this.hideMonthlyTooltip();
  }

  handleMonthlySegmentFocus(event) {
    const segment = event?.currentTarget;
    if (!segment) {
      return;
    }
    this.activeMonthlyTooltipSegment = segment;
    this.updateMonthlyTooltipContent(segment);
    this.positionMonthlyTooltip(null, segment);
    this.setMonthlyTooltipVisibility(true);
  }

  handleMonthlySegmentBlur(event) {
    if (event?.currentTarget !== this.activeMonthlyTooltipSegment) {
      return;
    }
    this.hideMonthlyTooltip();
  }

  hideMonthlyTooltip() {
    this.activeMonthlyTooltipSegment = null;
    this.setMonthlyTooltipVisibility(false);
  }

  buildMonthlyTotals(workouts) {
    const months = new Map();
    const exerciseTotals = new Map();

    for (const workout of workouts) {
      const timestamp = this.getWorkoutTimestamp(workout);
      if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
        continue;
      }
      const monthKey = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = timestamp.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      const identity = this.getWorkoutIdentityInfo(workout) || { key: 'unknown', label: 'Unknown Exercise' };
      const exerciseKey = identity.key;
      const exerciseLabel = identity.label;
      const volumeKg = this.getWorkoutVolumeKg(workout);
      const contribution = Number.isFinite(volumeKg) && volumeKg > 0
        ? volumeKg
        : this.calculateTotalLoadPeakKg(workout);
      if (!Number.isFinite(contribution) || contribution <= 0) {
        continue;
      }

      if (!months.has(monthKey)) {
        months.set(monthKey, {
          key: monthKey,
          label: monthLabel,
          byExercise: new Map(),
          totalKg: 0,
          sortKey: timestamp.getFullYear() * 100 + (timestamp.getMonth() + 1)
        });
      }

      const monthEntry = months.get(monthKey);
      monthEntry.byExercise.set(exerciseKey, (monthEntry.byExercise.get(exerciseKey) || 0) + contribution);
      monthEntry.totalKg += contribution;
      exerciseTotals.set(exerciseKey, (exerciseTotals.get(exerciseKey) || 0) + contribution);
      if (!this.exerciseOptionMap.has(exerciseKey)) {
        this.exerciseOptionMap.set(exerciseKey, { key: exerciseKey, label: exerciseLabel });
      }
    }

    const monthList = Array.from(months.values()).sort((a, b) => a.sortKey - b.sortKey);
    const totalOrder = Array.from(exerciseTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => ({ key, label: this.exerciseOptionMap.get(key)?.label || this.getFallbackLabelForKey(key) }));

    const peakMonth =
      monthList.reduce((acc, month) => {
        if (!acc || month.totalKg > acc.totalKg) {
          return month;
        }
        return acc;
      }, null) || null;

    return { months: monthList, totalOrder, peakMonth };
  }

  renderMonthlyAxis(maxTotalKg) {
    if (!this.monthlyAxisEl) {
      return;
    }
    if (!Number.isFinite(maxTotalKg) || maxTotalKg <= 0) {
      this.clearMonthlyAxis();
      return;
    }

    const unit = this.getUnitLabel();
    const ticks = this.buildMonthlyAxisTicks(maxTotalKg);
    const fragment = document.createDocumentFragment();

    const label = document.createElement('div');
    label.className = 'analytics-axis-label';
    label.textContent = `Monthly Volume (${unit})`;
    fragment.appendChild(label);

    const rail = document.createElement('div');
    rail.className = 'analytics-axis-rail';
    rail.style.height = `${MONTHLY_BAR_MAX_HEIGHT}px`;
    fragment.appendChild(rail);

    ticks.forEach((tick) => {
      const tickEl = document.createElement('div');
      tickEl.className = 'analytics-axis-tick';
      tickEl.style.bottom = `${tick.percent * 100}%`;
      const line = document.createElement('span');
      line.className = 'analytics-axis-tick__line';
      const text = document.createElement('span');
      text.className = 'analytics-axis-tick__label';
      text.textContent = this.formatAxisValue(tick.valueKg);
      tickEl.appendChild(line);
      tickEl.appendChild(text);
      rail.appendChild(tickEl);
    });

    this.monthlyAxisEl.innerHTML = '';
    this.monthlyAxisEl.appendChild(fragment);
    this.monthlyAxisEl.classList.remove('hidden');
  }

  clearMonthlyAxis() {
    if (!this.monthlyAxisEl) {
      return;
    }
    this.monthlyAxisEl.innerHTML = '';
    this.monthlyAxisEl.classList.add('hidden');
  }

  renderMonthlyXAxis(months) {
    if (!this.monthlyXAxisEl) {
      return;
    }
    if (!Array.isArray(months) || !months.length) {
      this.clearMonthlyXAxis();
      return;
    }
    const fragment = document.createDocumentFragment();
    months.forEach((month) => {
      const label = document.createElement('div');
      label.className = 'analytics-x-label';
      label.textContent = month.label;
      fragment.appendChild(label);
    });
    this.monthlyXAxisEl.innerHTML = '';
    this.monthlyXAxisEl.appendChild(fragment);
    this.monthlyXAxisEl.classList.remove('hidden');
  }

  clearMonthlyXAxis() {
    if (!this.monthlyXAxisEl) {
      return;
    }
    this.monthlyXAxisEl.innerHTML = '';
    this.monthlyXAxisEl.classList.add('hidden');
  }

  renderPeakLine(peakMonth, maxTotalKg) {
    if (!this.monthlyPeakLineEl || !this.monthlyPeakLabelEl) {
      return;
    }
    if (!peakMonth || !Number.isFinite(maxTotalKg) || maxTotalKg <= 0) {
      this.monthlyPeakLineEl.classList.remove('visible');
      this.monthlyPeakLineEl.removeAttribute('aria-label');
      this.monthlyPeakLabelEl.classList.remove('visible');
      this.monthlyPeakLabelEl.textContent = '';
      this.monthlyPeakLabelEl.removeAttribute('style');
      return;
    }
    const ratio = Math.min(1, Math.max(0, peakMonth.totalKg / maxTotalKg));
    const offset = ratio * MONTHLY_BAR_MAX_HEIGHT;
    const text = `${peakMonth.label || 'Peak'}: ${this.formatMonthlyWeight(peakMonth.totalKg)}`;
    this.monthlyPeakLineEl.style.bottom = `${offset}px`;
    this.monthlyPeakLineEl.classList.add('visible');
    this.monthlyPeakLineEl.setAttribute('aria-label', text);
    this.monthlyPeakLabelEl.style.bottom = `${offset}px`;
    this.monthlyPeakLabelEl.textContent = text;
    this.monthlyPeakLabelEl.classList.add('visible');
  }

  buildMonthlyAxisTicks(maxTotalKg) {
    const steps = 4;
    const ticks = [];
    for (let i = 0; i <= steps; i += 1) {
      const ratio = i / steps;
      ticks.push({
        valueKg: maxTotalKg * ratio,
        percent: ratio
      });
    }
    return ticks;
  }

  loadCachedWorkouts() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(ANALYTICS_CACHE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) {
        return;
      }
      const restored = parsed
        .map((entry) => this.deserializeCachedWorkout(entry))
        .filter(Boolean);
      if (restored.length) {
        this.workouts = restored;
        this.clearDropboxAlignPrompt();
        this.cachedAt = this.loadCacheMetaTimestamp();
        this.recomputeExercisePeaks();
        this.refreshExerciseOptions();
        this.updateChart();
        this.updateAlignIdsButtonState();
      }
    } catch (
      error
    ) {
      console.warn('Failed to load analytics cache', error);
    }
  }

  saveWorkoutsCache() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const sorted = [...this.workouts].sort((a, b) => {
        const timeA = this.getWorkoutTimestamp(a)?.getTime() || 0;
        const timeB = this.getWorkoutTimestamp(b)?.getTime() || 0;
        return timeB - timeA;
      });
      const limited = sorted.slice(0, ANALYTICS_CACHE_LIMIT);
      const payload = limited
        .map((workout) => this.serializeCachedWorkout(workout))
        .filter(Boolean);
      window.localStorage.setItem(ANALYTICS_CACHE_KEY, JSON.stringify(payload));
      const cachedAt = new Date().toISOString();
      window.localStorage.setItem(
        ANALYTICS_CACHE_META_KEY,
        JSON.stringify({ updatedAt: cachedAt, workoutCount: limited.length })
      );
      this.cachedAt = new Date(cachedAt);
    } catch (
      error
    ) {
      console.warn('Failed to cache analytics data', error);
    }
  }

  loadCacheMetaTimestamp() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(ANALYTICS_CACHE_META_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.updatedAt) {
        const date = new Date(parsed.updatedAt);
        if (!Number.isNaN(date.getTime())) {
          return date;
        }
      }
    } catch (error) {
      console.warn('Failed to read analytics cache metadata', error);
    }
    return null;
  }

  cloneSerializable(value) {
    if (value === null || value === undefined) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      console.warn('Failed to clone analytics data for cache', error);
    }
    return null;
  }

  serializeMovementTelemetry(movementData) {
    if (!Array.isArray(movementData) || !movementData.length) {
      return null;
    }
    const trimmed = movementData
      .map((point) => {
        if (!point || typeof point !== 'object') {
          return null;
        }
        const loadA = Number(point.loadA);
        const loadB = Number(point.loadB);
        const payload = {};
        if (Number.isFinite(loadA)) {
          payload.loadA = loadA;
        }
        if (Number.isFinite(loadB)) {
          payload.loadB = loadB;
        }
        return Object.keys(payload).length ? payload : null;
      })
      .filter(Boolean);
    return trimmed.length ? trimmed : null;
  }

  deserializeMovementTelemetry(data) {
    if (!Array.isArray(data) || !data.length) {
      return null;
    }
    const restored = data
      .map((point) => {
        if (!point || typeof point !== 'object') {
          return null;
        }
        const loadA = Number(point.loadA);
        const loadB = Number(point.loadB);
        const payload = {};
        if (Number.isFinite(loadA)) {
          payload.loadA = loadA;
        }
        if (Number.isFinite(loadB)) {
          payload.loadB = loadB;
        }
        return Object.keys(payload).length ? payload : null;
      })
      .filter(Boolean);
    return restored.length ? restored : null;
  }

  serializeCachedWorkout(workout) {
    try {
      const timestamp = this.getWorkoutTimestamp(workout);
      const phaseAnalysis =
        this.cloneSerializable(workout.phaseAnalysis || workout.echoAnalysis || null);
      return {
        timestamp: timestamp instanceof Date ? timestamp.toISOString() : null,
        weightKg: Number(workout.weightKg) || 0,
        totalLoadKg: Number(workout.totalLoadKg) || 0,
        cablePeakKg: Number(workout.cablePeakKg) || 0,
        totalLoadPeakKg:
          Number(workout.totalLoadPeakKg) || Number(workout.cablePeakKg) || 0,
        reps: Number(workout.reps) || 0,
        cableCount: Number(workout.cableCount ?? workout.cables) || null,
        setName: workout.setName || null,
        mode: workout.mode || null,
        planName: workout.planName || null,
        exerciseId: workout.exerciseId || null,
        exerciseIdNew: Number.isFinite(workout.exerciseIdNew)
          ? workout.exerciseIdNew
          : workout.exerciseIdNew ?? null,
        itemType: workout.itemType || null,
        movementData: this.serializeMovementTelemetry(workout.movementData),
        phaseAnalysis,
        echoAnalysis: this.cloneSerializable(workout.echoAnalysis || null),
        phaseRange: this.cloneSerializable(workout.phaseRange || null),
        echoRange: this.cloneSerializable(workout.echoRange || null),
      };
    } catch (error) {
      console.warn('Failed to serialize cached workout', error);
      return null;
    }
  }

  deserializeCachedWorkout(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
    if (timestamp && Number.isNaN(timestamp.getTime())) {
      return null;
    }
    const movementData = this.deserializeMovementTelemetry(entry.movementData);
    return {
      timestamp,
      weightKg: Number(entry.weightKg) || 0,
      totalLoadKg: Number(entry.totalLoadKg) || 0,
      cablePeakKg: Number(entry.cablePeakKg) || 0,
      totalLoadPeakKg:
        Number(entry.totalLoadPeakKg) || Number(entry.cablePeakKg) || 0,
      reps: Number(entry.reps) || 0,
      cableCount: Number(entry.cableCount) || Number(entry.cables) || null,
      setName: entry.setName || null,
      mode: entry.mode || null,
      planName: entry.planName || null,
      exerciseId: entry.exerciseId || null,
      exerciseIdNew: entry.exerciseIdNew ?? null,
      itemType: entry.itemType || null,
      movementData,
      phaseAnalysis: entry.phaseAnalysis && typeof entry.phaseAnalysis === 'object'
        ? entry.phaseAnalysis
        : null,
      echoAnalysis: entry.echoAnalysis && typeof entry.echoAnalysis === 'object'
        ? entry.echoAnalysis
        : null,
      phaseRange: entry.phaseRange && typeof entry.phaseRange === 'object'
        ? entry.phaseRange
        : null,
      echoRange: entry.echoRange && typeof entry.echoRange === 'object'
        ? entry.echoRange
        : null,
    };
  }

  recomputeExercisePeaks() {
    const map = new Map();
    if (Array.isArray(this.workouts)) {
      this.workouts.forEach((workout) => {
        if (!workout) return;
        const identity = this.getWorkoutIdentityInfo(workout);
        if (!identity?.key) return;
        const peakKg = this.calculateTotalLoadPeakKg(workout);
        if (!Number.isFinite(peakKg) || peakKg <= 0) {
          return;
        }
        const existing = map.get(identity.key);
        if (!Number.isFinite(existing) || peakKg > existing) {
          map.set(identity.key, peakKg);
        }
      });
    }
    this.exercisePeakMap = map;
  }

  getFallbackLabelForKey(key) {
    if (!key) {
      return 'Exercise';
    }
    if (key.startsWith('exercise:')) {
      return `Exercise ${key.split(':')[1]}`;
    }
    if (key.startsWith('set:')) {
      return key.split(':')[1];
    }
    if (key.startsWith('mode:')) {
      return key.split(':')[1];
    }
    return 'Exercise';
  }

  getExerciseColor(key, index = 0) {
    if (this.colorMap.has(key)) {
      return this.colorMap.get(key);
    }
    const hash = Array.from(String(key || ''))
      .reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 5381);
    const hashedIndex = hash % ANALYTICS_COLORS.length;
    const color = ANALYTICS_COLORS[hashedIndex];
    this.colorMap.set(key, color);
    return color;
  }

  getWorkoutVolumeKg(workout) {
    if (!workout || typeof workout !== 'object') {
      return 0;
    }
    const analysis = this.ensurePhaseAnalysis(workout);
    if (analysis?.hasReps && Number.isFinite(analysis.totalConcentricKg) && analysis.totalConcentricKg > 0) {
      return analysis.totalConcentricKg;
    }
    const reps = Number(workout.reps);
    if (!Number.isFinite(reps) || reps <= 0) {
      return 0;
    }
    const totalLoadKg = this.getWorkoutTotalLoadKg(workout);
    if (!Number.isFinite(totalLoadKg) || totalLoadKg <= 0) {
      return 0;
    }
    return totalLoadKg * reps;
  }

  getWorkoutTotalLoadKg(workout) {
    if (!workout || typeof workout !== 'object') {
      return 0;
    }
    const analysis = this.ensurePhaseAnalysis(workout);
    if (analysis?.hasReps && Number.isFinite(analysis.totalConcentricKg) && analysis.totalConcentricKg > 0) {
      workout.totalLoadKg = analysis.totalConcentricKg;
      return analysis.totalConcentricKg;
    }
    const stored = Number(workout.totalLoadKg);
    if (Number.isFinite(stored) && stored > 0) {
      return stored;
    }
    const perCable = Number(workout.weightKg);
    if (!Number.isFinite(perCable) || perCable <= 0) {
      return 0;
    }
    const cables = this.getCableCountFromWorkout(workout);
    if (!Number.isFinite(cables) || cables <= 0) {
      return 0;
    }
    return perCable * cables;
  }

  getCableCountFromWorkout(workout) {
    if (!workout || typeof workout !== 'object') {
      return 2;
    }
    const candidates = [
      workout.cableCount,
      workout.cables,
      workout.builderMeta?.cables,
      workout.planCables,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        return Math.min(2, Math.max(1, value));
      }
    }
    return 2;
  }

  formatWeight(kg) {
    const unit = this.getUnitLabel();
    const value = this.convertKgToDisplay(kg, unit);
    const decimals = this.getDisplayDecimals();
    return `${value.toFixed(decimals)} ${unit}`;
  }

  formatMonthlyWeight(kg) {
    const unit = this.getUnitLabel();
    const display = this.convertKgToDisplay(kg, unit);
    if (!Number.isFinite(display)) {
      return `0 ${unit}`;
    }
    const rounded = Math.round(display);
    return `${rounded} ${unit}`;
  }

  convertKgToDisplay(kg, unit = this.getUnitLabel()) {
    if (kg === null || kg === undefined || Number.isNaN(kg)) {
      return NaN;
    }
    const normalized = unit === 'lb' ? 'lb' : 'kg';
    return normalized === 'lb' ? kg * LB_PER_KG : kg;
  }

  formatAxisValue(kg) {
    const unit = this.getUnitLabel();
    const display = this.convertKgToDisplay(kg, unit);
    if (!Number.isFinite(display)) {
      return `0 ${unit}`;
    }
    return `${this.formatCompactValue(display)} ${unit}`;
  }

  formatCompactValue(value) {
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (value >= 1000) {
      const compact = value / 1000;
      const decimals = compact >= 10 ? 0 : 1;
      return `${compact.toFixed(decimals)}k`;
    }
    const decimals = value >= 100 ? 0 : this.getDisplayDecimals();
    return value.toFixed(decimals);
  }

  getUnitLabel() {
    return this.getWeightUnit() === 'LBS' ? 'lb' : 'kg';
  }

  getDisplayDecimals() {
    return this.getUnitLabel() === 'lb' ? 1 : 1;
  }

  getRangeDays() {
    const meta = this.rangeMeta[this.currentRange];
    if (!meta) {
      return 30;
    }
    return Number(this.currentRange);
  }

  formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '';
    }
    try {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      return date.toISOString().split('T')[0];
    }
  }

  getFilterState() {
    const selection = this.getSelectedExercise();
    return {
      exerciseKey: selection?.key || null,
      exerciseLabel: selection?.label || null,
      numericId: selection?.numericId ?? null,
      rangeDays: this.getRangeDays(),
      rangeLabel: this.rangeMeta[this.currentRange]?.label || null
    };
  }

  notifyFilterChange() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }
    if (typeof window.CustomEvent !== 'function') {
      return;
    }
    const detail = this.getFilterState();
    document.dispatchEvent(new window.CustomEvent(this.filterEventName, { detail }));
  }

  getWeightUnit() {
    const unit = typeof this._getWeightUnit === 'function' ? this._getWeightUnit() : 'KG';
    return unit === 'LBS' ? 'LBS' : 'KG';
  }

  buildAxisDayLabels(splits = []) {
    let previousDayKey = null;
    let lastYear = null;
    return splits.map((value) => {
      if (!Number.isFinite(value)) {
        return '';
      }
      const date = new Date(value * 1000);
      if (Number.isNaN(date.getTime())) {
        return '';
      }
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (key === previousDayKey) {
        return '';
      }
      previousDayKey = key;
      const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (lastYear === null || date.getFullYear() !== lastYear) {
        lastYear = date.getFullYear();
        return `${label} '${String(date.getFullYear()).slice(-2)}`;
      }
      return label;
    });
  }

  normalizeLegacyExerciseId(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return null;
  }

  toNumericExerciseId(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const integer = Math.trunc(numeric);
    if (integer !== numeric) {
      return null;
    }
    if (integer < 0 || integer > 0xffff) {
      return null;
    }
    return integer;
  }

  getWorkoutIdentityInfo(workout) {
    if (!workout) return null;

    const numericId = this.toNumericExerciseId(
      workout?.exerciseIdNew ??
      workout?.planExerciseIdNew ??
      workout?.builderMeta?.exerciseIdNew ??
      workout?.builderMeta?.exerciseNumericId ??
      workout?.builderMeta?.exercise?.id_new,
    );
    const setName =
      typeof workout.setName === 'string' && workout.setName.trim().length > 0
        ? workout.setName.trim()
        : null;
    const addEchoSuffix = (label) => {
      if (!this.isEchoWorkout(workout)) {
        return label;
      }
      const workoutId = this.getWorkoutDisplayId(workout);
      return `${label} (Echo Mode · ${workoutId})`;
    };

    if (numericId !== null) {
      return {
        key: `exercise:${numericId}`,
        label: addEchoSuffix(setName || `Exercise ${numericId}`),
      };
    }
    if (setName) {
      return { key: `set:${setName.toLowerCase()}`, label: addEchoSuffix(setName) };
    }

    const mode =
      typeof workout.mode === 'string' && workout.mode.trim().length > 0
        ? workout.mode.trim()
        : null;
    if (mode) {
      return { key: `mode:${mode.toLowerCase()}`, label: addEchoSuffix(mode) };
    }

    return null;
  }

  getWorkoutTimestamp(workout) {
    if (!workout || typeof workout !== 'object') {
      return null;
    }

    const candidates = [workout.endTime, workout.timestamp, workout.startTime];
    for (const candidate of candidates) {
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate;
      }
      if (typeof candidate === 'string' && candidate.length > 0) {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }

    return null;
  }

  getWorkoutDisplayId(workout) {
    if (!workout || typeof workout !== 'object') {
      return 'unknown';
    }
    const candidates = [
      workout.workoutId,
      workout.id,
      workout.builderMeta?.workoutId,
      workout.builderMeta?.workout_id,
      workout.dropboxId
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    const timestamp = this.getWorkoutTimestamp(workout);
    return timestamp ? timestamp.toISOString() : 'unknown';
  }

  isEchoWorkout(workout) {
    return sharedIsEchoWorkout ? sharedIsEchoWorkout(workout) : false;
  }

  ensurePhaseAnalysis(workout) {
    if (!workout) {
      return null;
    }
    if (workout.phaseAnalysis && Array.isArray(workout.phaseAnalysis.reps)) {
      return workout.phaseAnalysis;
    }
    const analysis = analyzeMovementPhases ? analyzeMovementPhases(workout) : null;
    if (analysis) {
      workout.phaseAnalysis = analysis;
      if (analysis.range) {
        workout.phaseRange = analysis.range;
        if (analysis.isEcho) {
          workout.echoRange = analysis.range;
        }
      }
      if (analysis.isEcho) {
        workout.echoAnalysis = analysis;
      }
    }
    return workout.phaseAnalysis || workout.echoAnalysis || null;
  }

  hasPhaseReps(analysis) {
    return Array.isArray(analysis?.reps) && analysis.reps.length > 0;
  }

  getWorkoutPhasePeaks(workout) {
    if (!workout || typeof workout !== 'object') {
      return { concentricKg: 0, eccentricKg: 0 };
    }
    const analysis = this.ensurePhaseAnalysis(workout);
    if (this.hasPhaseReps(analysis)) {
      return {
        concentricKg: Number(analysis.maxConcentricKg) || 0,
        eccentricKg: Number(analysis.maxEccentricKg) || 0
      };
    }
    const peak = this.calculateTotalLoadPeakKg(workout);
    return { concentricKg: peak, eccentricKg: peak };
  }

  calculateTotalLoadPeakKg(workout) {
    if (!workout || typeof workout !== 'object') {
      return 0;
    }

    let peak = Number(workout.cablePeakKg);
    const analysis = this.ensurePhaseAnalysis(workout);
    if (this.hasPhaseReps(analysis) && Number.isFinite(analysis?.maxConcentricKg) && analysis.maxConcentricKg > 0) {
      peak = analysis.maxConcentricKg;
    }
    if (!Number.isFinite(peak) || peak <= 0) {
      peak = 0;

      if (Array.isArray(workout.movementData) && workout.movementData.length > 0) {
        for (const point of workout.movementData) {
          if (!point) continue;
          const cablePeak = Math.max(
            Number(point.loadA) || 0,
            Number(point.loadB) || 0,
          );
          if (cablePeak > peak) {
            peak = cablePeak;
          }
        }
      }

      if (peak <= 0) {
        const fallbackWeights = [
          Number(workout.weightKg),
          Number(workout.adjustedWeightKg),
          Number(workout.originalWeightKg),
        ];
        for (const value of fallbackWeights) {
          if (Number.isFinite(value) && value > 0) {
            peak = value;
            break;
          }
        }
      }
    }

    workout.cablePeakKg = peak;
    workout.totalLoadPeakKg = peak;
    return peak;
  }

  setDualMetricPlaceholders() {
    const valueEls = [
      this.peakConcentricValueEl,
      this.peakEccentricValueEl,
      this.baselineConcentricValueEl,
      this.baselineEccentricValueEl,
      this.deltaConcentricValueEl,
      this.deltaEccentricValueEl
    ];
    valueEls.forEach((el) => {
      if (el) el.textContent = '—';
    });
    const percentEls = [this.deltaConcentricPctEl, this.deltaEccentricPctEl];
    percentEls.forEach((el) => {
      if (el) el.textContent = '0%';
    });
    const dateEls = [
      this.peakConcentricDateEl,
      this.peakEccentricDateEl,
      this.baselineConcentricDateEl,
      this.baselineEccentricDateEl
    ];
    dateEls.forEach((el) => {
      if (el) el.textContent = '';
    });
  }

  setDualMetricValue(el, kg) {
    if (!el) return;
    if (Number.isFinite(kg) && kg > 0) {
      el.textContent = this.formatWeight(kg);
    } else {
      el.textContent = '—';
    }
  }

  setDualMetricDate(el, entry) {
    if (!el) return;
    if (!entry) {
      el.textContent = '';
      return;
    }
    const dateValue = entry.timestamp || entry.day || null;
    this.setDualMetricDateValue(el, dateValue);
  }

  setDualMetricDateValue(el, dateValue) {
    if (!el) return;
    if (!dateValue) {
      el.textContent = '';
      return;
    }
    el.textContent = this.formatDate(dateValue);
  }

  setStrengthGainMetrics(pctEl, valueEl, peakKg, baselineKg) {
    if (pctEl) {
      const percent = baselineKg > 0 ? ((Math.max(0, peakKg - baselineKg)) / baselineKg) * 100 : 0;
      pctEl.textContent = this.formatGrowthPercent(percent);
    }
    if (valueEl) {
      const deltaKg = Math.max(0, peakKg - baselineKg);
      valueEl.textContent = this.formatDeltaWeight(deltaKg);
    }
  }
}
