let elements = null;

export function mount(store, actions = {}) {
  const root = document.querySelector("[data-section='config']");
  if (!root) {
    return;
  }
  const unitSelect = root.querySelector("[data-action='change-unit']");
  const stopCheckbox = root.querySelector("[data-action='toggle-stop-top']");

  unitSelect?.addEventListener('change', () => {
    actions.onUnitChange?.(unitSelect.value);
  });

  stopCheckbox?.addEventListener('change', () => {
    actions.onToggleStopAtTop?.(stopCheckbox.checked);
  });

  elements = { root, unitSelect, stopCheckbox };
  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }
  const state = store.get();
  if (elements.unitSelect) {
    elements.unitSelect.value = state.unit || 'kg';
  }
  if (elements.stopCheckbox) {
    elements.stopCheckbox.checked = !!state.config?.stopAtTop;
  }
}
