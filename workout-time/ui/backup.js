let elements = null;

export function mount(store, actions = {}) {
  const root = document.querySelector("[data-section='backup']");
  if (!root) {
    return;
  }
  const syncButton = root.querySelector("[data-action='sync-dropbox']");
  const exportButton = root.querySelector("[data-action='export-dropbox']");
  const status = root.querySelector("[data-role='backup-status']");

  syncButton?.addEventListener('click', () => {
    actions.onSyncDropbox?.();
  });

  exportButton?.addEventListener('click', () => {
    actions.onExportDropbox?.();
  });

  elements = { root, syncButton, exportButton, status };
  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }
  const state = store.get();
  if (elements.status) {
    elements.status.textContent = state.backupStatus || 'Not connected';
  }
}
