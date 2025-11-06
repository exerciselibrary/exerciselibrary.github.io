let elements = null;

export function mount(store, actions = {}) {
  const root = document.querySelector("[data-section='plan']");
  if (!root) {
    return;
  }

  const form = root.querySelector("[data-role='plan-form']");
  const list = root.querySelector("[data-role='plan-list']");
  const status = root.querySelector("[data-role='plan-status']");
  const startBtn = root.querySelector("[data-action='start-plan']");
  const stopBtn = root.querySelector("[data-action='stop-plan']");

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: (formData.get('name') || '').toString().trim() || 'Set',
      durationSec: Number(formData.get('duration') || 0),
      restSec: Number(formData.get('rest') || 0),
    };
    actions.onAddPlanSet?.(payload);
    form.reset();
  });

  list?.addEventListener('click', (event) => {
    const removeButton = event.target.closest('button[data-remove-index]');
    if (!removeButton) {
      return;
    }
    const index = Number(removeButton.dataset.removeIndex);
    actions.onRemovePlanSet?.(index);
  });

  startBtn?.addEventListener('click', () => {
    actions.onStartPlan?.();
  });

  stopBtn?.addEventListener('click', () => {
    actions.onStopPlan?.();
  });

  elements = { root, form, list, status, startBtn, stopBtn };
  render(store);
}

export function render(store) {
  if (!elements) {
    return;
  }
  const state = store.get();
  const plan = state.plan || { sets: [] };
  const { list, startBtn } = elements;

  if (list) {
    list.innerHTML = '';
    plan.sets.forEach((set, index) => {
      const item = document.createElement('li');
      const duration = formatSeconds(set.durationSec || 0);
      const rest = formatSeconds(set.restSec || 0);
      item.innerHTML = `
        <strong>${escapeHtml(set.name || `Set ${index + 1}`)}</strong><br />
        Duration: ${duration} • Rest: ${rest}
        <div style="margin-top:0.35rem;">
          <button type="button" class="secondary" data-remove-index="${index}">Remove</button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  if (startBtn) {
    startBtn.disabled = plan.sets.length === 0 || state.planStatus === 'running';
  }
  if (elements.stopBtn) {
    elements.stopBtn.disabled = state.planStatus !== 'running';
  }
  updateStatus(state.planStatus || 'idle');
}

export function progress(store, runnerState) {
  if (!elements) {
    return;
  }
  const { status } = elements;
  if (!status) {
    return;
  }
  if (!runnerState || runnerState.status === 'idle') {
    status.textContent = 'Idle';
    return;
  }

  const { status: phase, cursor, totalSets, remainingMs } = runnerState;
  const remaining = Math.ceil(remainingMs / 1000);
  status.textContent = `${phase === 'rest' ? 'Rest' : 'Set'} ${cursor + 1} of ${totalSets} • ${remaining}s left`;
}

function updateStatus(text) {
  if (elements?.status) {
    if (text === 'running') {
      elements.status.textContent = 'Running';
    } else if (text === 'idle') {
      elements.status.textContent = 'Idle';
    } else {
      elements.status.textContent = text;
    }
  }
}

function formatSeconds(value) {
  const seconds = Number(value || 0);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  })[char]);
}
