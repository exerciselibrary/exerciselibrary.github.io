let elements = null;

export function mount(store) {
  const root = document.querySelector("[data-section='history']");
  if (!root) {
    return;
  }
  elements = {
    list: root.querySelector("[data-role='history-list']"),
  };
  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }
  const state = store.get();
  paint(state.history || []);
}

export function append(store) {
  render(store);
}

function paint(entries) {
  if (!elements?.list) {
    return;
  }
  elements.list.innerHTML = '';
  entries.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'history-entry';
    const finished = new Date(entry.finishedAt || Date.now());
    item.innerHTML = `
      <strong>${entry.plan?.name || 'Workout Plan'}</strong>
      <span>${finished.toLocaleString()}</span>
      <span>Sets completed: ${entry.completedSets?.length || 0}</span>
      <span>Status: ${entry.reason || 'complete'}</span>
    `;
    elements.list.appendChild(item);
  });
}
