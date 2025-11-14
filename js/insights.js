import { state, els } from './context.js';
import { persistState } from './storage.js';
import { convertKgToUnit, formatWeightValue } from '../shared/weight-utils.js';

const ALL_EXERCISES_KEY = '__all__';
const HISTORY_STORAGE_KEYS = [
  'vitruvian.workoutHistory',
  'vitruvian.history.workouts',
  'vitruvian.history'
];

const HISTORY_PERSIST_KEY = HISTORY_STORAGE_KEYS[0];

const formatters = {
  integer: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),
  compact: new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }),
  percent: new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, signDisplay: 'always' }),
  dateShort: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }),
  dateLong: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  monthYear: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
};

const INTERVALS = {
  day: {
    label: 'day',
    bucket(date) {
      const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const end = new Date(start.getTime());
      end.setUTCDate(end.getUTCDate() + 1);
      return {
        key: start.toISOString(),
        label: formatters.dateShort.format(start),
        start,
        end
      };
    }
  },
  week: {
    label: 'week',
    bucket(date) {
      const startOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const day = startOfDay.getUTCDay();
      const mondayOffset = (day + 6) % 7; // convert Sunday -> 6, Monday -> 0
      const start = new Date(startOfDay.getTime());
      start.setUTCDate(start.getUTCDate() - mondayOffset);
      const end = new Date(start.getTime());
      end.setUTCDate(end.getUTCDate() + 7);
      const endLabel = new Date(end.getTime());
      endLabel.setUTCDate(endLabel.getUTCDate() - 1);
      return {
        key: `${start.toISOString()}-week`,
        label: `${formatters.dateShort.format(start)} – ${formatters.dateShort.format(endLabel)}`,
        start,
        end
      };
    }
  },
  month: {
    label: 'month',
    bucket(date) {
      const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
      const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
      return {
        key: `${start.getUTCFullYear()}-${start.getUTCMonth()}-month`,
        label: formatters.monthYear.format(start),
        start,
        end
      };
    }
  }
};

const moduleState = {
  initialized: false,
  history: [],
  exerciseTotals: new Map(),
  volumeChart: null,
  distributionChart: null,
  chartsAvailable: typeof window !== 'undefined' && typeof window.Chart !== 'undefined',
  dropboxConnected: false
};

const chartFallbacks = new Map();

const showChartFallback = (canvas, key, message) => {
  if (!canvas) return;
  const container = canvas.parentElement;
  if (!container) return;
  let fallback = chartFallbacks.get(key);
  if (!fallback) {
    fallback = document.createElement('div');
    fallback.className = 'insights-fallback';
    container.appendChild(fallback);
    chartFallbacks.set(key, fallback);
  }
  fallback.textContent = message;
  fallback.classList.remove('is-hidden');
  canvas.classList.add('is-hidden');
};

const hideChartFallback = (canvas, key) => {
  if (!canvas) return;
  canvas.classList.remove('is-hidden');
  const fallback = chartFallbacks.get(key);
  if (fallback) {
    fallback.classList.add('is-hidden');
  }
};

const getDisplayUnit = () => (state.weightUnit === 'KG' ? 'kg' : 'lb');

const setEmptyStateMessage = (message) => {
  if (!els.insightsEmptyState) return;
  const target =
    typeof els.insightsEmptyState.querySelector === 'function'
      ? els.insightsEmptyState.querySelector('p')
      : null;
  if (target) {
    target.textContent = message;
  } else {
    els.insightsEmptyState.textContent = message;
  }
};

const refreshEmptyStateCopy = (hasHistory) => {
  if (hasHistory) return;
  const message = moduleState.dropboxConnected
    ? 'No exercises logged yet. Complete a workout and sync from Dropbox to populate insights.'
    : 'Connect Dropbox to sync your Vitruvian workout history and unlock insights.';
  setEmptyStateMessage(message);
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeKey = (label) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

const normalizeWorkout = (workout) => {
  const timestamp = toDate(workout.timestamp || workout.endTime || workout.startTime);
  if (!timestamp) return null;
  const labelRaw = workout.label || workout.setName || workout.exercise || workout.mode || '';
  const label = typeof labelRaw === 'string' ? labelRaw.trim() : '';
  if (!label) return null;
  const totalLoadKg = toNumber(
    workout.totalLoadKg ??
      workout.totalVolumeKg ??
      workout.total_weight_kg ??
      workout.totalLoad ??
      workout.volumeKg ??
      workout.weightKg
  );
  if (!totalLoadKg) return null;
  const exerciseId = workout.exerciseId || workout.planExerciseId;
  const key = exerciseId ? String(exerciseId).trim() : normalizeKey(label);
  const reps = toNumber(workout.reps);
  const weightKg = toNumber(workout.weightKg ?? workout.weight);
  const planName = typeof workout.planName === 'string' ? workout.planName.trim() : '';
  return {
    id: workout.id || `${key}-${timestamp.toISOString()}`,
    key,
    label,
    timestamp,
    totalLoadKg,
    reps,
    weightKg,
    planName
  };
};

const toSerializableEntry = (entry) => {
  const timestamp =
    entry.timestamp instanceof Date
      ? entry.timestamp.toISOString()
      : toDate(entry.timestamp)?.toISOString();
  return {
    id: entry.id,
    key: entry.key,
    label: entry.label,
    timestamp,
    totalLoadKg: entry.totalLoadKg,
    reps: entry.reps ?? null,
    weightKg: entry.weightKg ?? null,
    planName: entry.planName ?? ''
  };
};

const persistHistoryLocally = (history) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    if (!history.length) {
      window.localStorage.removeItem(HISTORY_PERSIST_KEY);
      return;
    }
    const serializable = history
      .map((entry) => toSerializableEntry(entry))
      .filter((entry) => entry.timestamp);
    if (!serializable.length) {
      window.localStorage.removeItem(HISTORY_PERSIST_KEY);
      return;
    }
    window.localStorage.setItem(HISTORY_PERSIST_KEY, JSON.stringify(serializable));
  } catch (error) {
    console.warn('Failed to persist workout history for insights view', error);
  }
};

const normalizeHistoryEntries = (entries) => {
  if (!Array.isArray(entries) || !entries.length) {
    return [];
  }
  const normalized = entries
    .map((entry) => normalizeWorkout(entry))
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
  const deduped = new Map();
  normalized.forEach((entry) => {
    const key = `${entry.key}-${entry.timestamp.toISOString()}-${Math.round(entry.totalLoadKg * 1000)}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  });
  return Array.from(deduped.values());
};

const applyHistory = (entries, options = {}) => {
  const normalized = normalizeHistoryEntries(entries);
  moduleState.history = normalized;
  moduleState.exerciseTotals = summariseByExercise(normalized);
  ensureExerciseSelect();
  if (options.persist === true) {
    persistHistoryLocally(normalized);
  }
  if (moduleState.initialized) {
    renderInsights();
  }
  return normalized;
};

const readLocalHistory = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  const collected = [];
  HISTORY_STORAGE_KEYS.forEach((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        collected.push(...parsed);
      } else if (Array.isArray(parsed?.workouts)) {
        collected.push(...parsed.workouts);
      } else if (Array.isArray(parsed?.items)) {
        collected.push(...parsed.items);
      }
    } catch (error) {
      console.warn('Failed to parse stored workout history for key', key, error);
    }
  });
  return collected;
};

const loadHistory = () => normalizeHistoryEntries(readLocalHistory());

const summariseByExercise = (history) => {
  const totals = new Map();
  history.forEach((entry) => {
    if (!totals.has(entry.key)) {
      totals.set(entry.key, { key: entry.key, label: entry.label, totalKg: 0, sessions: 0 });
    }
    const summary = totals.get(entry.key);
    summary.totalKg += entry.totalLoadKg;
    summary.sessions += 1;
  });
  return totals;
};

const ensureExerciseSelect = () => {
  if (!els.insightsExerciseSelect) return;
  const select = els.insightsExerciseSelect;
  select.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = ALL_EXERCISES_KEY;
  defaultOption.textContent = 'All Exercises';
  select.appendChild(defaultOption);
  const entries = Array.from(moduleState.exerciseTotals.values()).sort((a, b) => {
    if (b.totalKg !== a.totalKg) return b.totalKg - a.totalKg;
    return a.label.localeCompare(b.label);
  });
  entries.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.key;
    option.textContent = entry.label;
    select.appendChild(option);
  });
  const preferred = moduleState.exerciseTotals.has(state.insights.exercise)
    ? state.insights.exercise
    : ALL_EXERCISES_KEY;
  if (preferred !== state.insights.exercise) {
    state.insights.exercise = preferred;
    persistState();
  }
  select.value = preferred;
};

const normalizeInterval = (value) => {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return INTERVALS[key] ? key : 'week';
};

const updateIntervalControls = () => {
  if (!els.insightsIntervalControls) return;
  const interval = normalizeInterval(state.insights.interval);
  els.insightsIntervalControls
    .querySelectorAll('button[data-interval]')
    .forEach((button) => {
      const isActive = button.dataset.interval === interval;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
};

const toggleEmptyState = (isEmpty) => {
  if (els.insightsEmptyState) {
    els.insightsEmptyState.classList.toggle('is-hidden', !isEmpty);
  }
  if (els.insightsBody) {
    els.insightsBody.classList.toggle('is-hidden', isEmpty);
  }
};

const bucketWorkouts = (workouts, intervalKey) => {
  const config = INTERVALS[intervalKey];
  const buckets = new Map();
  workouts.forEach((workout) => {
    const bucket = config.bucket(workout.timestamp);
    const current = buckets.get(bucket.key) || {
      key: bucket.key,
      label: bucket.label,
      start: bucket.start,
      totalKg: 0,
      sessions: 0
    };
    current.totalKg += workout.totalLoadKg;
    current.sessions += 1;
    buckets.set(bucket.key, current);
  });
  const sorted = Array.from(buckets.values()).sort((a, b) => a.start - b.start);
  let cumulative = 0;
  return sorted.map((bucket) => {
    cumulative += bucket.totalKg;
    return { ...bucket, cumulativeKg: cumulative };
  });
};

const formatRangeDescription = (workouts) => {
  if (!workouts.length) return 'No exercises logged yet';
  const first = workouts[0].timestamp;
  const last = workouts[workouts.length - 1].timestamp;
  if (first.toISOString() === last.toISOString()) {
    return `On ${formatters.dateLong.format(last)}`;
  }
  return `${formatters.dateShort.format(first)} – ${formatters.dateShort.format(last)}`;
};

const renderSummary = (history, filtered, series, intervalKey, unit, selectedKey) => {
  const totalKg = series.length ? series[series.length - 1].cumulativeKg : 0;
  const sessionCount = filtered.length;
  const averageKg = sessionCount > 0 ? totalKg / sessionCount : 0;
  if (els.insightsTotalVolume) {
    els.insightsTotalVolume.textContent = totalKg
      ? `${formatWeightValue(totalKg, unit, totalKg >= 1000 ? 0 : 1)} ${unit}`
      : '—';
  }
  if (els.insightsTotalSessions) {
    els.insightsTotalSessions.textContent = sessionCount
      ? `${formatters.integer.format(sessionCount)} exercise${sessionCount === 1 ? '' : 's'} logged`
      : 'No exercises yet';
  }
  if (els.insightsAverageLoad) {
    els.insightsAverageLoad.textContent = averageKg
      ? `${formatWeightValue(averageKg, unit, averageKg >= 500 ? 0 : 1)} ${unit}`
      : '—';
  }
  if (els.insightsAverageDuration) {
    els.insightsAverageDuration.textContent = formatRangeDescription(filtered.length ? filtered : history);
  }
  const lastBucket = series[series.length - 1];
  const previousBucket = series[series.length - 2];
  if (els.insightsChange) {
    if (lastBucket && previousBucket) {
      const delta = lastBucket.totalKg - previousBucket.totalKg;
      if (Math.abs(delta) < 1e-6) {
        els.insightsChange.textContent = 'No change';
      } else {
        const converted = convertKgToUnit(Math.abs(delta), unit);
        const decimals = converted >= 100 ? 0 : 1;
        const amount = formatWeightValue(Math.abs(delta), unit, decimals);
        const sign = delta > 0 ? '+' : '−';
        let percentFragment = '';
        if (previousBucket.totalKg > 0) {
          const percent = (delta / previousBucket.totalKg) * 100;
          percentFragment = ` (${formatters.percent.format(percent)})`;
        }
        els.insightsChange.textContent = `${sign}${amount} ${unit}${percentFragment}`;
      }
    } else if (lastBucket) {
      const converted = convertKgToUnit(lastBucket.totalKg, unit);
      const decimals = converted >= 100 ? 0 : 1;
      els.insightsChange.textContent = `+${formatWeightValue(lastBucket.totalKg, unit, decimals)} ${unit}`;
    } else {
      els.insightsChange.textContent = '—';
    }
  }
  if (els.insightsChangeDetail) {
    const intervalLabel = INTERVALS[intervalKey].label;
    els.insightsChangeDetail.textContent = previousBucket ? `vs prior ${intervalLabel}` : `Waiting for prior ${intervalLabel}`;
  }
  if (els.insightsChartSubtitle) {
    const descriptor = intervalKey === 'day' ? 'Daily' : intervalKey === 'week' ? 'Weekly' : 'Monthly';
    const label =
      selectedKey === ALL_EXERCISES_KEY
        ? 'All exercises'
        : moduleState.exerciseTotals.get(selectedKey)?.label || 'Selected exercise';
    els.insightsChartSubtitle.textContent = `${descriptor} cumulative load • ${label}`;
  }
  if (els.insightsLegendLabel) {
    els.insightsLegendLabel.textContent =
      selectedKey === ALL_EXERCISES_KEY
        ? 'All exercises'
        : moduleState.exerciseTotals.get(selectedKey)?.label || 'Selected exercise';
  }
};

const renderRecentSessions = (workouts, unit) => {
  if (!els.insightsRecentList) return;
  const list = els.insightsRecentList;
  list.innerHTML = '';
  if (!workouts.length) {
    const empty = document.createElement('li');
    empty.className = 'insights-recent__item';
    empty.textContent = 'No exercises match this view yet.';
    list.appendChild(empty);
    return;
  }
  const fragment =
    typeof document !== 'undefined' && typeof document.createDocumentFragment === 'function'
      ? document.createDocumentFragment()
      : null;
  const target = fragment || list;
  workouts
    .slice(-6)
    .reverse()
    .forEach((item) => {
      const li = document.createElement('li');
      li.className = 'insights-recent__item';
      const title = document.createElement('div');
      title.className = 'insights-recent__title';
      const name = document.createElement('span');
      name.textContent = item.label;
      const date = document.createElement('span');
      date.className = 'muted small';
      date.textContent = formatters.dateLong.format(item.timestamp);
      title.appendChild(name);
      title.appendChild(date);
      const meta = document.createElement('div');
      meta.className = 'insights-recent__meta';
      const volume = document.createElement('span');
      const volumeDisplay = formatWeightValue(item.totalLoadKg, unit, item.totalLoadKg >= 1000 ? 0 : 1);
      volume.textContent = `${volumeDisplay} ${unit} total`;
      meta.appendChild(volume);
      if (item.reps) {
        const reps = document.createElement('span');
        reps.textContent = `${item.reps} reps`;
        meta.appendChild(reps);
      }
      if (item.weightKg) {
        const perCable = formatWeightValue(item.weightKg, unit, item.weightKg >= 200 ? 0 : 1);
        const weight = document.createElement('span');
        weight.textContent = `${perCable} ${unit} per cable`;
        meta.appendChild(weight);
      }
      if (item.planName) {
        const plan = document.createElement('span');
        plan.textContent = item.planName;
        meta.appendChild(plan);
      }
      li.appendChild(title);
      li.appendChild(meta);
      if (typeof target.appendChild === 'function') {
        target.appendChild(li);
      }
    });
  if (fragment) {
    list.appendChild(fragment);
  }
};

const renderVolumeChart = (allSeries, selectedSeries, intervalKey, unit, selectedKey) => {
  const canvas = els.insightsVolumeChart;
  if (!canvas) return;
  if (!moduleState.chartsAvailable) {
    showChartFallback(
      canvas,
      'volume',
      'Charts unavailable in this environment. Volume metrics are summarised below.'
    );
    return;
  }
  hideChartFallback(canvas, 'volume');
  const Chart = window.Chart;
  const labels = allSeries.map((point) => point.label);
  const allData = allSeries.map((point) => point.cumulativeKg);
  const selectedLookup = new Map(selectedSeries.map((point) => [point.key, point.cumulativeKg]));
  const selectedData = allSeries.map((point) => selectedLookup.get(point.key) ?? null);
  const datasets = [
    {
      label: 'All exercises',
      data: allData,
      borderColor: '#7aa2f7',
      backgroundColor: 'rgba(122, 162, 247, 0.2)',
      tension: 0.35,
      borderWidth: 3,
      pointRadius: 3,
      pointHoverRadius: 5
    }
  ];
  if (selectedKey !== ALL_EXERCISES_KEY) {
    datasets.push({
      label: 'Selected exercise',
      data: selectedData,
      borderColor: '#f472b6',
      backgroundColor: 'rgba(244, 114, 182, 0.18)',
      tension: 0.35,
      borderWidth: 3,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true
    });
  }
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        ticks: { color: '#9aa5b1' },
        grid: { color: 'rgba(37, 50, 72, 0.35)' }
      },
      y: {
        ticks: {
          color: '#9aa5b1',
          callback: (value) => {
            if (!Number.isFinite(value)) return value;
            const converted = convertKgToUnit(value, unit);
            return `${formatters.compact.format(converted)} ${unit}`;
          }
        },
        grid: { color: 'rgba(37, 50, 72, 0.25)' }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.dataset.label || '';
            const valueKg = context.parsed.y;
            if (!Number.isFinite(valueKg)) return label;
            const converted = convertKgToUnit(valueKg, unit);
            const decimals = converted >= 100 ? 0 : 1;
            return `${label}: ${formatWeightValue(valueKg, unit, decimals)} ${unit}`;
          }
        }
      }
    }
  };
  if (!moduleState.volumeChart) {
    moduleState.volumeChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options
    });
  } else {
    moduleState.volumeChart.data.labels = labels;
    moduleState.volumeChart.data.datasets = datasets;
    moduleState.volumeChart.options = options;
    moduleState.volumeChart.update();
  }
};

const renderDistributionChart = (unit, selectedKey) => {
  const canvas = els.insightsDistributionChart;
  if (!canvas) return;
  if (!moduleState.chartsAvailable) {
    showChartFallback(
      canvas,
      'distribution',
      'Charts unavailable in this environment. Top exercises are summarised below.'
    );
    return;
  }
  const totals = Array.from(moduleState.exerciseTotals.values())
    .sort((a, b) => {
      if (b.totalKg !== a.totalKg) return b.totalKg - a.totalKg;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 5);
  if (!totals.length) {
    showChartFallback(canvas, 'distribution', 'Add workouts to view exercise distribution.');
    if (moduleState.distributionChart) {
      moduleState.distributionChart.destroy();
      moduleState.distributionChart = null;
    }
    return;
  }
  hideChartFallback(canvas, 'distribution');
  const Chart = window.Chart;
  const labels = totals.map((item) => item.label);
  const data = totals.map((item) => item.totalKg);
  const backgroundColor = totals.map((item) =>
    item.key === selectedKey ? 'rgba(244, 114, 182, 0.85)' : 'rgba(122, 162, 247, 0.85)'
  );
  const borderColor = totals.map((item) => (item.key === selectedKey ? '#f472b6' : '#7aa2f7'));
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    scales: {
      x: {
        ticks: {
          color: '#9aa5b1',
          callback: (value) => {
            if (!Number.isFinite(value)) return value;
            const converted = convertKgToUnit(value, unit);
            return `${formatters.compact.format(converted)} ${unit}`;
          }
        },
        grid: { color: 'rgba(37, 50, 72, 0.25)' }
      },
      y: {
        ticks: { color: '#9aa5b1' },
        grid: { display: false }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const valueKg = context.parsed.x;
            const converted = convertKgToUnit(valueKg, unit);
            const decimals = converted >= 100 ? 0 : 1;
            return `${formatWeightValue(valueKg, unit, decimals)} ${unit}`;
          }
        }
      }
    }
  };
  const datasets = [
    {
      label: 'Total load',
      data,
      backgroundColor,
      borderColor,
      borderWidth: 1,
      borderRadius: 12,
      borderSkipped: false
    }
  ];
  if (!moduleState.distributionChart) {
    moduleState.distributionChart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options
    });
  } else {
    moduleState.distributionChart.data.labels = labels;
    moduleState.distributionChart.data.datasets = datasets;
    moduleState.distributionChart.options = options;
    moduleState.distributionChart.update();
  }
};

export const renderInsights = () => {
  if (!moduleState.initialized) return;
  const history = moduleState.history;
  refreshEmptyStateCopy(history.length > 0);
  if (!history.length) {
    toggleEmptyState(true);
    renderRecentSessions([], getDisplayUnit());
    return;
  }
  toggleEmptyState(false);
  const intervalKey = normalizeInterval(state.insights.interval);
  const unit = getDisplayUnit();
  const validExercise = moduleState.exerciseTotals.has(state.insights.exercise)
    ? state.insights.exercise
    : ALL_EXERCISES_KEY;
  if (validExercise !== state.insights.exercise) {
    state.insights.exercise = validExercise;
    persistState();
    if (els.insightsExerciseSelect) {
      els.insightsExerciseSelect.value = validExercise;
    }
  }
  const filtered =
    validExercise === ALL_EXERCISES_KEY ? history : history.filter((entry) => entry.key === validExercise);
  const allSeries = bucketWorkouts(history, intervalKey);
  const selectedSeries = validExercise === ALL_EXERCISES_KEY ? allSeries : bucketWorkouts(filtered, intervalKey);
  renderSummary(history, filtered, selectedSeries, intervalKey, unit, validExercise);
  renderVolumeChart(allSeries, selectedSeries, intervalKey, unit, validExercise);
  renderDistributionChart(unit, validExercise);
  renderRecentSessions(filtered, unit);
};

export const setInsightsDropboxStatus = (isConnected) => {
  moduleState.dropboxConnected = Boolean(isConnected);
  if (moduleState.initialized) {
    refreshEmptyStateCopy(moduleState.history.length > 0);
  }
};

export const syncInsightsFromDropbox = async (dropboxManager, options = {}) => {
  if (!dropboxManager || !dropboxManager.isConnected) {
    return moduleState.history;
  }
  try {
    const workouts = await dropboxManager.loadWorkouts({
      maxEntries: options.maxEntries ?? Infinity
    });
    const combined = Array.isArray(workouts)
      ? [...moduleState.history, ...workouts]
      : moduleState.history;
    return applyHistory(combined, { persist: true });
  } catch (error) {
    console.error('Failed to load Dropbox workouts for insights:', error);
    throw error;
  }
};

export const initializeInsights = () => {
  if (!els.insightsPanel || moduleState.initialized) return;
  applyHistory(loadHistory());
  state.insights.interval = normalizeInterval(state.insights.interval);
  updateIntervalControls();
  if (els.insightsExerciseSelect) {
    els.insightsExerciseSelect.addEventListener('change', (event) => {
      const value = event.target.value || ALL_EXERCISES_KEY;
      if (value === state.insights.exercise) return;
      state.insights.exercise = value;
      persistState();
      renderInsights();
    });
  }
  if (els.insightsIntervalControls) {
    els.insightsIntervalControls.querySelectorAll('button[data-interval]').forEach((button) => {
      button.addEventListener('click', () => {
        const { interval } = button.dataset;
        if (!INTERVALS[interval]) return;
        if (state.insights.interval === interval) return;
        state.insights.interval = interval;
        updateIntervalControls();
        persistState();
        renderInsights();
      });
    });
  }
  moduleState.initialized = true;
  renderInsights();
};

export default {
  initializeInsights,
  renderInsights,
  syncInsightsFromDropbox,
  setInsightsDropboxStatus
};
