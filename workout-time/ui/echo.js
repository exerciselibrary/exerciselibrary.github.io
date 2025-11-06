import { ECHO_LEVELS, WEIGHT_LIMITS } from '../modes.js';

let elements = null;

export function mount(store, actions = {}) {
  const root = document.querySelector("[data-section='echo']");
  if (!root) {
    return;
  }

  const form = root.querySelector("[data-role='echo-form']");
  const levelSelect = form?.querySelector("[data-field='level']");
  const weightInput = form?.querySelector("[data-field='weight']");
  const durationInput = form?.querySelector("[data-field='duration']");
  const weightHint = form?.querySelector("[data-role='echo-weight-hint']");

  if (levelSelect && levelSelect.options.length === 0) {
    ECHO_LEVELS.forEach((level) => {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = level.label;
      levelSelect.appendChild(option);
    });
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = {
      level: levelSelect?.value || ECHO_LEVELS[0]?.id,
      weight: weightInput?.value || 0,
      durationSec: durationInput?.value || 0,
      unit: store.get().unit,
    };
    actions.onStartEcho?.(data);
  });

  elements = { root, form, levelSelect, weightInput, durationInput, weightHint };
  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }

  const state = store.get();
  const unit = state.unit || 'kg';
  const formState = state.echo || {};

  if (elements.levelSelect && formState.level) {
    elements.levelSelect.value = formState.level;
  }
  if (elements.weightInput) {
    elements.weightInput.value = formState.weight ?? '';
    elements.weightInput.min = WEIGHT_LIMITS.minKg;
    elements.weightInput.max = WEIGHT_LIMITS.maxKg;
    elements.weightInput.step = WEIGHT_LIMITS.incrementKg;
  }
  if (elements.durationInput) {
    elements.durationInput.value = formState.durationSec ?? '';
  }
  if (elements.weightHint) {
    const numericWeight = Number(elements.weightInput?.value || 0);
    const kg = unit === 'lb' ? numericWeight / 2.2046226218 : numericWeight;
    const lb = kg * 2.2046226218;
    elements.weightHint.textContent = `${kg.toFixed(1)} kg • ${lb.toFixed(1)} lb`;
  }
}
