import { PROGRAM_MODES, WEIGHT_LIMITS } from '../modes.js';

let elements = null;

export function mount(store, actions = {}) {
  const root = document.querySelector("[data-section='program']");
  if (!root) {
    return;
  }

  const form = root.querySelector("[data-role='program-form']");
  const modeSelect = form?.querySelector("[data-field='mode']");
  const weightInput = form?.querySelector("[data-field='weight']");
  const progressionInput = form?.querySelector("[data-field='progression']");
  const repsInput = form?.querySelector("[data-field='reps']");
  const weightHint = form?.querySelector("[data-role='program-weight-hint']");

  if (modeSelect && modeSelect.options.length === 0) {
    PROGRAM_MODES.forEach((mode) => {
      const option = document.createElement('option');
      option.value = mode.id;
      option.textContent = mode.label;
      modeSelect.appendChild(option);
    });
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = {
      mode: modeSelect?.value || PROGRAM_MODES[0]?.id,
      weight: weightInput?.value || 0,
      progressionKg: progressionInput?.value || 0,
      reps: repsInput?.value || 0,
      unit: store.get().unit,
    };
    actions.onStartProgram?.(data);
  });

  elements = { root, form, modeSelect, weightInput, progressionInput, repsInput, weightHint };
  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }

  const state = store.get();
  const unit = state.unit || 'kg';
  const formState = state.program || {};

  if (elements.modeSelect && formState.mode) {
    elements.modeSelect.value = formState.mode;
  }
  if (elements.weightInput) {
    elements.weightInput.value = formState.weight ?? '';
    elements.weightInput.min = WEIGHT_LIMITS.minKg;
    elements.weightInput.max = WEIGHT_LIMITS.maxKg;
    elements.weightInput.step = WEIGHT_LIMITS.incrementKg;
  }
  if (elements.progressionInput) {
    elements.progressionInput.value = formState.progressionKg ?? '';
  }
  if (elements.repsInput) {
    elements.repsInput.value = formState.reps ?? '';
  }
  if (elements.weightHint) {
    const numericWeight = Number(elements.weightInput?.value || 0);
    const kg = unit === 'lb' ? numericWeight / 2.2046226218 : numericWeight;
    const lb = kg * 2.2046226218;
    elements.weightHint.textContent = `${kg.toFixed(1)} kg • ${lb.toFixed(1)} lb`;
  }
}
