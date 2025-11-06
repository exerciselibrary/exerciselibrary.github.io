import { createChart } from '../chart.js';

let elements = null;
let chart = null;

export function mount(store) {
  const root = document.querySelector("[data-section='live']");
  if (!root) {
    return;
  }
  elements = {
    root,
    left: root.querySelector("[data-field='live-left']"),
    right: root.querySelector("[data-field='live-right']"),
    total: root.querySelector("[data-field='live-total']"),
  };
  chart = createChart({ canvasId: 'liveChart' });
  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }
  const state = store.get();
  updateGauges(state.live || {}, state.unit || 'kg');
}

export function renderTick(store, runnerState) {
  if (!elements) {
    return;
  }
  if (runnerState?.status === 'complete') {
    chart?.render();
  }
}

export function updateGauge(store, sample) {
  if (!elements) {
    return;
  }
  const unit = store.get().unit || 'kg';
  updateGauges(sample, unit);
  chart?.push({ total: sample.total ?? 0 });
}

function updateGauges(sample = {}, unit) {
  if (elements.left) {
    elements.left.textContent = formatWeight(sample.left ?? 0, unit);
  }
  if (elements.right) {
    elements.right.textContent = formatWeight(sample.right ?? 0, unit);
  }
  if (elements.total) {
    elements.total.textContent = formatWeight(sample.total ?? 0, unit);
  }
}

function formatWeight(value, unit) {
  const kg = Number(value || 0);
  if (unit === 'lb') {
    const pounds = kg * 2.2046226218;
    return `${pounds.toFixed(1)} lb`;
  }
  return `${kg.toFixed(1)} kg`;
}
