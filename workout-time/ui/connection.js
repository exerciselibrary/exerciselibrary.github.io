let elements = null;

export function mount(store, actions = {}) {
  const root = document.querySelector("[data-section='connection']");
  if (!root) {
    return;
  }

  elements = {
    root,
    status: root.querySelector("[data-role='connection-status']"),
    connect: root.querySelector("[data-action='connect']"),
    disconnect: root.querySelector("[data-action='disconnect']"),
  };

  elements.connect?.addEventListener('click', () => {
    actions.onConnect?.();
  });

  elements.disconnect?.addEventListener('click', () => {
    actions.onDisconnect?.();
  });

  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }
  const state = store.get();
  const connected = !!state.connected;
  const deviceName = state.deviceName ? ` • ${state.deviceName}` : '';
  elements.status.textContent = connected ? `Connected${deviceName}` : 'Disconnected';
  elements.root.dataset.status = connected ? 'connected' : 'disconnected';
  if (elements.connect) {
    elements.connect.disabled = connected;
  }
  if (elements.disconnect) {
    elements.disconnect.disabled = !connected;
  }
}
