// Workout builder feature: manages workout state, builder UI, and related actions.
import {
  MAX_CABLE_WEIGHT,
  MAX_CABLE_WEIGHT_KG,
  MODE_OPTIONS,
  MODE_LABELS,
  ECHO_LEVELS,
  SHARE_ICON_HTML,
  SHARE_SUCCESS_HTML,
  SHARE_ERROR_HTML
} from './constants.js';
import { state, els, setDragDidDrop, getDragDidDrop } from './context.js';
import { niceName, formatWeight, convertWeightValue, createWorkbookXlsx } from './utils.js';
import { MUSCLE_COVERAGE, MUSCLE_ALIAS_LOOKUP, normalizeMuscleName } from './muscles.js';
import {
  getActiveGrouping,
  setActiveGrouping,
  getGroupingClusters,
  getGroupColor,
  applyGrouping,
  shuffleBuilderOrder,
  GROUPING_LABELS
} from './grouping.js';
import {
  createSet,
  getBuilderSnapshot,
  persistState,
  base64UrlEncodeUtf8
} from './storage.js';

let renderCallback = null;

export const registerRenderHandler = (fn) => {
  renderCallback = fn;
};

const triggerRender = () => {
  if (typeof renderCallback === 'function') {
    renderCallback();
  }
};

const convertAllWeights = (newUnit) => {
  const previous = state.weightUnit;
  if (previous === newUnit) return;
  state.builder.items.forEach((entry) => {
    entry.sets.forEach((set) => {
      if (set.weight) {
        set.weight = convertWeightValue(set.weight, previous, newUnit);
      }
    });
  });
};

export const updateUnitToggle = () => {
  if (!els.unitToggle) return;
  const label = state.weightUnit === 'LBS' ? 'Units: lbs' : 'Units: kg';
  els.unitToggle.textContent = label;
  els.unitToggle.title = `Switch to ${state.weightUnit === 'LBS' ? 'kilograms' : 'pounds'}`;
};

export const toggleWeightUnit = () => {
  const newUnit = state.weightUnit === 'LBS' ? 'KG' : 'LBS';
  convertAllWeights(newUnit);
  state.weightUnit = newUnit;
  updateUnitToggle();
  persistState();
  triggerRender();
};

const getWeightLabel = () => (state.weightUnit === 'LBS' ? 'lbs' : 'kg');

const getModeLabel = (set) => {
  if (!set) return '';
  if (set.mode === 'ECHO') {
    const level = ECHO_LEVELS.find((opt) => opt.value === set.echoLevel) || ECHO_LEVELS[0];
    return `${MODE_LABELS.ECHO} - ${level.label}`;
  }
  return MODE_LABELS[set.mode] || MODE_LABELS.OLD_SCHOOL;
};

export const renderSetRow = (exerciseId, set, index) => {
  const entry = state.builder.items.get(exerciseId);
  const tr = document.createElement('tr');

  const setCell = document.createElement('td');
  setCell.textContent = index + 1;

  if (!set.mode) set.mode = 'OLD_SCHOOL';
  if (!set.echoLevel) set.echoLevel = ECHO_LEVELS[0].value;

  const modeCell = document.createElement('td');
  modeCell.className = 'mode-cell';
  const modeSelect = document.createElement('select');
  MODE_OPTIONS.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = set.mode === opt.value;
    modeSelect.appendChild(option);
  });
  modeCell.appendChild(modeSelect);

  const echoSelect = document.createElement('select');
  echoSelect.className = 'mode-echo-select';
  ECHO_LEVELS.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = set.echoLevel === opt.value;
    echoSelect.appendChild(option);
  });
  echoSelect.addEventListener('change', () => {
    set.echoLevel = echoSelect.value;
    persistState();
  });
  const echoWrapper = document.createElement('div');
  echoWrapper.className = 'mode-echo';
  echoWrapper.appendChild(echoSelect);

  const repsCell = document.createElement('td');
  const repsInput = document.createElement('input');
  repsInput.type = 'number';
  repsInput.min = '0';
  repsInput.placeholder = 'e.g. 12';
  repsInput.value = set.reps;
  repsInput.addEventListener('input', () => {
    set.reps = repsInput.value;
    persistState();
  });
  repsCell.appendChild(repsInput);

  const weightCell = document.createElement('td');
  const weightInput = document.createElement('input');
  weightInput.type = 'number';
  weightInput.min = '0';
  weightInput.max = String(state.weightUnit === 'LBS' ? MAX_CABLE_WEIGHT : MAX_CABLE_WEIGHT_KG);
  weightInput.step = state.weightUnit === 'KG' ? '0.1' : '0.5';
  weightInput.placeholder = getWeightLabel();
  weightInput.value = set.weight;
  weightInput.addEventListener('input', () => {
    const max = state.weightUnit === 'LBS' ? MAX_CABLE_WEIGHT : MAX_CABLE_WEIGHT_KG;
    const value = Number(weightInput.value || 0);
    if (value > max) {
      weightInput.value = String(max);
      set.weight = String(max);
    } else {
      set.weight = weightInput.value;
    }
    persistState();
  });
  const weightWrapper = document.createElement('div');
  weightWrapper.appendChild(weightInput);
  weightCell.appendChild(weightWrapper);
  const echoNote = document.createElement('span');
  echoNote.className = 'muted';
  echoNote.textContent = 'Not used for Echo Mode';

  const updateWeightVisibility = () => {
    const isEcho = set.mode === 'ECHO';
    if (isEcho) {
      weightWrapper.style.display = 'none';
      if (!modeCell.contains(echoWrapper)) modeCell.appendChild(echoWrapper);
      if (!echoNote.parentElement) weightCell.appendChild(echoNote);
    } else {
      weightWrapper.style.display = '';
      if (echoWrapper.parentElement === modeCell) echoWrapper.remove();
      if (echoNote.parentElement === weightCell) echoNote.remove();
      weightInput.value = set.weight || '';
    }
  };

  modeSelect.addEventListener('change', () => {
    set.mode = modeSelect.value;
    persistState();
    triggerRender();
  });

  updateWeightVisibility();

  const actionsCell = document.createElement('td');
  actionsCell.className = 'set-actions';
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn danger small';
  removeBtn.textContent = 'Delete';
  removeBtn.addEventListener('click', () => {
    entry.sets = entry.sets.filter((s) => s.id !== set.id);
    if (entry.sets.length === 0) entry.sets.push(createSet());
    triggerRender();
    persistState();
  });
  actionsCell.appendChild(removeBtn);

  tr.append(setCell, modeCell, repsCell, weightCell, actionsCell);
  return tr;
};

export const addExerciseToBuilder = (exercise) => {
  if (state.builder.items.has(exercise.id)) return;
  const entry = {
    exercise: {
      id: exercise.id,
      name: exercise.name,
      muscleGroups: exercise.muscleGroups || [],
      muscles: exercise.muscles || [],
      equipment: exercise.equipment || [],
      videos: exercise.videos || []
    },
    sets: [createSet()]
  };
  state.builder.items.set(exercise.id, entry);

  const grouping = getActiveGrouping();
  if (grouping) {
    const key = getGroupingKey(entry.exercise, grouping);
    let inserted = false;
    for (let i = 0; i < state.builder.order.length; i += 1) {
      const currentId = state.builder.order[i];
      const currentEntry = state.builder.items.get(currentId);
      if (!currentEntry) continue;
      const currentKey = getGroupingKey(currentEntry.exercise, grouping);
      if (currentKey === key) {
        let insertPos = i;
        while (insertPos < state.builder.order.length) {
          const nextEntry = state.builder.items.get(state.builder.order[insertPos]);
          if (!nextEntry || getGroupingKey(nextEntry.exercise, grouping) !== key) break;
          insertPos += 1;
        }
        state.builder.order.splice(insertPos, 0, exercise.id);
        inserted = true;
        break;
      }
    }
    if (!inserted) state.builder.order.push(exercise.id);
    applyGrouping(grouping);
  } else {
    state.builder.order.push(exercise.id);
  }
  persistState();
};

const getGroupingKey = (exercise, type) => {
  if (type === 'equipment') return Array.isArray(exercise?.equipment) ? exercise.equipment.sort().join('|') : '__none__';
  if (type === 'muscles') return Array.isArray(exercise?.muscles) ? exercise.muscles.sort().join('|') : '__none__';
  if (type === 'muscleGroups') return Array.isArray(exercise?.muscleGroups) ? exercise.muscleGroups.sort().join('|') : '__none__';
  return '__none__';
};

export const removeExerciseFromBuilder = (id) => {
  state.builder.items.delete(id);
  state.builder.order = state.builder.order.filter((val) => val !== id);
  persistState();
};

export const updateBuilderBadge = () => {
  const count = state.builder.order.length;
  els.builderCount.textContent = count;
  const isBuilder = state.activeTab === 'builder';
  els.tabBuilder.classList.toggle('active', isBuilder);
  els.tabLibrary.classList.toggle('active', !isBuilder);
  els.builderPanel.classList.toggle('active', isBuilder);
  els.libraryPanel.classList.toggle('active', !isBuilder);
  document.body.classList.toggle('builder-active', isBuilder);
};

export const switchTab = (tab) => {
  state.activeTab = tab;
  updateBuilderBadge();
  persistState();
  triggerRender();
};

export const updateBuilderFilterControl = () => {
  if (!els.toggleBuilderFilter) return;
  els.toggleBuilderFilter.textContent = state.showWorkoutOnly ? 'Show Full Library' : 'Show Workout Only';
  els.toggleBuilderFilter.classList.toggle('active', state.showWorkoutOnly);
  els.toggleBuilderFilter.setAttribute('aria-pressed', state.showWorkoutOnly ? 'true' : 'false');
};

export const updateGroupingButtons = () => {
  if (!els.groupEquipment || !els.groupMuscles || !els.groupMuscleGroups) return;
  const active = getActiveGrouping();
  els.groupEquipment.classList.toggle('active', active === 'equipment');
  els.groupMuscles.classList.toggle('active', active === 'muscles');
  els.groupMuscleGroups.classList.toggle('active', active === 'muscleGroups');
};

export const toggleGrouping = (type) => {
  const active = getActiveGrouping();
  if (active === type) {
    setActiveGrouping(null);
  } else {
    setActiveGrouping(type);
    applyGrouping(type);
  }
  updateGroupingButtons();
  persistState();
  triggerRender();
};

const copyToClipboard = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
};

export const shareExercise = async (exercise, button) => {
  if (!exercise) return;
  const url = new URL(window.location.href);
  url.searchParams.set('exercise', exercise.id);
  try {
    await copyToClipboard(url.toString());
    if (button) {
      button.innerHTML = SHARE_SUCCESS_HTML;
      setTimeout(() => {
        button.innerHTML = SHARE_ICON_HTML;
      }, 1500);
    }
  } catch (err) {
    console.warn('Share failed', err);
    if (button) {
      button.innerHTML = SHARE_ERROR_HTML;
      setTimeout(() => {
        button.innerHTML = SHARE_ICON_HTML;
      }, 1500);
    }
  }
  document.querySelectorAll('.card.highlight').forEach((el) => {
    if (el.dataset.exerciseId !== exercise.id) el.classList.remove('highlight');
  });
  const card = button?.closest('.card');
  if (card) card.classList.add('highlight');
};

export const shareWorkout = async () => {
  if (!state.builder.order.length) {
    alert('Add exercises to the workout before sharing.');
    return;
  }

  const snapshot = getBuilderSnapshot();
  const payload = {
    u: state.weightUnit === 'KG' ? 1 : 0,
    f: state.showWorkoutOnly ? 1 : 0,
    c: state.includeCheckboxes ? 1 : 0,
    b: { o: snapshot.order, i: snapshot.items }
  };

  try {
    const json = JSON.stringify(payload);
    const encoded = base64UrlEncodeUtf8(json);
    const url = new URL(window.location.href);
    url.searchParams.set('workout', encoded);
    window.history.replaceState({}, '', url.toString());
    await copyToClipboard(url.toString());
    alert('Workout link copied to clipboard.');
  } catch (err) {
    console.warn('Failed to share workout', err);
    alert('Unable to generate share link.');
  }
};

export const pickPreviewVideo = (videos) => {
  if (!Array.isArray(videos) || videos.length === 0) return null;
  const mp4 = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  return mp4 ? mp4.video : null;
};

const pickBestVideo = (videos) => {
  if (!Array.isArray(videos)) return null;
  const mp4 = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  if (mp4) return { type: 'mp4', url: mp4.video };
  const hls = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.m3u8'));
  if (hls) return { type: 'hls', url: hls.video };
  if (videos.length) return { type: 'unknown', url: videos[0].video || videos[0].url };
  return null;
};

const supportsNativeHls = (videoEl) => {
  if (!videoEl) return false;
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) return true;
  if (videoEl.canPlayType('application/x-mpegurl')) return true;
  return false;
};

export const openExerciseModal = (exercise) => {
  const best = pickBestVideo(exercise.videos || []);
  els.modalVideo.pause();
  els.modalVideo.removeAttribute('src');
  els.modalVideo.load();
  els.modalNotice.textContent = '';

  if (!best) {
    els.modalNotice.textContent = 'No playable video source available for this exercise.';
  } else if (best.type === 'mp4' || (best.type === 'hls' && supportsNativeHls(els.modalVideo))) {
    els.modalVideo.src = best.url;
  } else if (best.type === 'hls') {
    els.modalNotice.innerHTML = `This video is an HLS stream (.m3u8) which may not play in this browser. Try Safari or open directly: <a href="${best.url}" target="_blank" rel="noopener">open stream</a>.`;
  } else {
    els.modalNotice.innerHTML = `Video format not recognised. You can try opening directly: <a href="${best.url}" target="_blank" rel="noopener">open stream</a>.`;
  }

  els.modal.classList.remove('hidden');
  els.modal.setAttribute('aria-hidden', 'false');
  els.modalVideo.play().catch(() => {});
};

export const closeModal = () => {
  els.modalVideo.pause();
  els.modalVideo.removeAttribute('src');
  els.modalVideo.load();
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
  state.highlightId = null;
  state.highlightHandled = false;
  document.querySelectorAll('.card.highlight').forEach((el) => el.classList.remove('highlight'));
  resetExerciseUrl();
};

export const syncSortControls = () => {
  if (!els.sortToggle) return;
  const label = state.sortMode === 'ZA' ? 'Z-A' : 'A-Z';
  els.sortToggle.textContent = label;
  els.sortToggle.classList.remove('asc', 'desc', 'shuffled');
  if (state.sortMode === 'ZA') {
    els.sortToggle.classList.add('desc');
  } else {
    els.sortToggle.classList.add('asc');
  }
  if (state.shuffleMode) {
    els.sortToggle.classList.add('shuffled');
    els.sortToggle.title = `${label} (showing shuffled order until you toggle)`;
  } else {
    els.sortToggle.title = `Currently ${label} (click to toggle)`;
  }
  els.sortToggle.setAttribute('aria-pressed', state.sortMode === 'ZA' ? 'true' : 'false');
};

export const exportWorkout = () => {
  if (!state.builder.order.length) {
    alert('Add exercises to the workout before exporting.');
    return;
  }

  const rows = [
    ['Exercise', 'Set', 'Mode', 'Reps', `Weight (${getWeightLabel()})`, 'Muscle Groups', 'Equipment']
  ];

  state.builder.order.forEach((id) => {
    const entry = state.builder.items.get(id);
    if (!entry) return;
    entry.sets.forEach((set, idx) => {
      const weightValue = set.mode === 'ECHO' ? '' : (set.weight || '');
      rows.push([
        entry.exercise.name,
        (idx + 1).toString(),
        getModeLabel(set),
        set.reps || '',
        weightValue,
        (entry.exercise.muscleGroups || []).map(niceName).join(', '),
        (entry.exercise.equipment || []).map(niceName).join(', ')
      ]);
    });
  });

  const workbook = createWorkbookXlsx(rows);
  const blob = new Blob([workbook], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const now = new Date();
  const pad = (val) => String(val).padStart(2, '0');
  const nameStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStamp = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `workout-${nameStamp}-${timeStamp}.xlsx`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
};

export const printWorkout = () => {
  if (!state.builder.order.length) {
    alert('Add exercises to the workout before printing.');
    return;
  }

  const weightLabel = getWeightLabel();
  const sections = state.builder.order.map((id) => {
    const entry = state.builder.items.get(id);
    if (!entry) return '';
    const checkboxHeader = state.includeCheckboxes ? '<th>Complete</th>' : '';
    const rows = entry.sets
      .map((set, idx) => {
        const checkboxCell = state.includeCheckboxes ? '<td>&#9744;</td>' : '';
        const weightValue = set.mode === 'ECHO' ? '' : (set.weight || '');
        return `<tr><td>${idx + 1}</td><td>${getModeLabel(set)}</td><td>${set.reps || ''}</td><td>${weightValue}</td>${checkboxCell}</tr>`;
      })
      .join('');
    const metaParts = [];
    if (entry.exercise.muscleGroups?.length) {
      metaParts.push(`Muscle Groups: ${entry.exercise.muscleGroups.map(niceName).join(', ')}`);
    }
    if (entry.exercise.equipment?.length) {
      metaParts.push(`Equipment: ${entry.exercise.equipment.map(niceName).join(', ')}`);
    }
    const metaHtml = metaParts.length ? `<p>${metaParts.join(' | ')}</p>` : '';
    return `
      <section>
        <h2>${entry.exercise.name}</h2>
        ${metaHtml}
        <table>
          <thead><tr><th>Set</th><th>Mode</th><th>Reps</th><th>Weight (${weightLabel})</th>${checkboxHeader}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  const printHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Workout</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { margin-bottom: 8px; }
      section { margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
      th { background: #f4f4f4; }
    </style>
  </head><body>
    <h1>Workout Plan</h1>
    <p>Generated ${new Date().toLocaleString()}</p>
    ${sections}
  </body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const printWindow = iframe.contentWindow;
  if (!printWindow) {
    iframe.remove();
    alert('Unable to open print preview.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();

  const cleanup = () => {
    iframe.remove();
    window.focus();
  };

  let fallbackTimer;
  const finalize = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    cleanup();
  };

  fallbackTimer = setTimeout(finalize, 60000);

  printWindow.addEventListener('afterprint', finalize, { once: true });
  printWindow.addEventListener('pagehide', finalize, { once: true });

  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 50);
};

export const computeMuscleSummary = () => {
  const hits = new Set();
  state.builder.order.forEach((id) => {
    const entry = state.builder.items.get(id);
    if (!entry) return;
    let muscles = entry.exercise.muscles;
    if (!Array.isArray(muscles) || muscles.length === 0) {
      const fallback = state.data.find((ex) => ex.id === id);
      muscles = fallback?.muscles || [];
    }
    muscles.forEach((muscle) => {
      const normalized = normalizeMuscleName(muscle);
      if (!normalized) return;
      const key = MUSCLE_ALIAS_LOOKUP.get(normalized);
      if (key) hits.add(key);
    });
  });

  const labels = MUSCLE_COVERAGE
    .filter((group) => hits.has(group.key))
    .map((group) => group.label)
    .sort((a, b) => a.localeCompare(b));

  return {
    hitCount: hits.size,
    total: MUSCLE_COVERAGE.length,
    labels
  };
};

export const renderMuscleSummary = () => {
  if (!els.builderMuscles) return;
  if (!state.builder.order.length) {
    els.builderMuscles.textContent = `Muscles hit: 0/${MUSCLE_COVERAGE.length}.`;
    return;
  }

  const summary = computeMuscleSummary();
  if (!summary.hitCount) {
    els.builderMuscles.textContent = `Muscles hit: 0/${summary.total}.`;
    return;
  }

  const listText = summary.labels.join(', ');
  els.builderMuscles.textContent = `Muscles hit: ${summary.hitCount}/${summary.total} | ${listText}`;
};

export const attachGroupDragEvents = (groupEl, handle, type) => {
  if (!groupEl || !handle) return;
  groupEl.dataset.groupType = type;
  handle.draggable = true;
  handle.addEventListener('dragstart', (evt) => {
    if (getActiveGrouping() !== type) {
      evt.preventDefault();
      return;
    }
    setDragDidDrop(false);
    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', groupEl.dataset.groupKey || '');
    groupEl.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    groupEl.classList.remove('dragging');
    if (!getDragDidDrop()) triggerRender();
    setDragDidDrop(false);
  });
};

export const attachGroupBodyEvents = (body, type, groupKey) => {
  if (!body) return;
  body.dataset.groupType = type;
  body.dataset.groupKey = groupKey;
  body.addEventListener('dragover', handleGroupedCardDragOver);
  body.addEventListener('drop', handleGroupedCardDrop);
};

const getDragAfterElement = (container, y) => {
  const elements = [...container.querySelectorAll('.builder-card:not(.dragging)')];
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  elements.forEach((child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = child;
    }
  });
  return closest;
};

const getGroupAfterElement = (container, y) => {
  const elements = [...container.querySelectorAll('.builder-group:not(.dragging)')];
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  elements.forEach((child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = child;
    }
  });
  return closest;
};

export const handleGroupedCardDragOver = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping) return;
  evt.preventDefault();
  const body = evt.currentTarget;
  if (body.dataset.groupType !== grouping) return;
  const afterElement = getDragAfterElement(body, evt.clientY);
  const dragging = body.querySelector('.builder-card.dragging');
  if (!dragging) return;
  if (!afterElement) {
    body.appendChild(dragging);
  } else if (afterElement !== dragging) {
    body.insertBefore(dragging, afterElement);
  }
};

export const reorderGroupBlock = (type, groupKey, newIds) => {
  if (!type || !groupKey || !Array.isArray(newIds) || !newIds.length) return false;
  const currentOrder = state.builder.order;
  const items = state.builder.items;
  let start = -1;
  let end = -1;
  for (let i = 0; i < currentOrder.length; i += 1) {
    const entry = items.get(currentOrder[i]);
    if (!entry) continue;
    const key = getGroupingKey(entry.exercise, type);
    if (key === groupKey) {
      if (start === -1) start = i;
      end = i;
    } else if (start !== -1) {
      break;
    }
  }
  if (start === -1) return false;
  end += 1;
  const block = currentOrder.slice(start, end);
  if (block.length !== newIds.length) return false;
  const sameMembers = block.every((id) => newIds.includes(id));
  if (!sameMembers) return false;
  const changed = block.some((id, idx) => id !== newIds[idx]);
  if (!changed) return false;
  state.builder.order = [
    ...currentOrder.slice(0, start),
    ...newIds,
    ...currentOrder.slice(end)
  ];
  return true;
};

export const handleGroupedCardDrop = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping) return;
  evt.preventDefault();
  evt.stopPropagation();
  const body = evt.currentTarget;
  if (body.dataset.groupType !== grouping) return;
  const groupKey = body.dataset.groupKey;
  const dragging = body.querySelector('.builder-card.dragging');
  if (dragging) dragging.classList.remove('dragging');
  const newIds = Array.from(body.querySelectorAll('.builder-card'))
    .map((node) => node.dataset.exerciseId)
    .filter(Boolean);
  const changed = reorderGroupBlock(grouping, groupKey, newIds);
  if (changed) persistState();
  triggerRender();
  setDragDidDrop(true);
};

export const handleGroupDragOver = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping || !els.builderList) return;
  evt.preventDefault();
  evt.stopPropagation();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
  const dragging = els.builderList.querySelector('.builder-group.dragging');
  if (!dragging) return;
  if (dragging.dataset.groupType !== grouping) return;
  const afterElement = getGroupAfterElement(els.builderList, evt.clientY);
  if (!afterElement) {
    els.builderList.appendChild(dragging);
  } else if (afterElement !== dragging) {
    els.builderList.insertBefore(dragging, afterElement);
  }
};

export const handleGroupDrop = (evt) => {
  const grouping = getActiveGrouping();
  if (!grouping || !els.builderList) return;
  evt.preventDefault();
  evt.stopPropagation();
  const dragging = els.builderList.querySelector('.builder-group.dragging');
  if (dragging) dragging.classList.remove('dragging');
  const orderKeys = Array.from(els.builderList.querySelectorAll('.builder-group'))
    .filter((node) => node.dataset.groupType === grouping)
    .map((node) => node.dataset.groupKey);
  const clusters = getGroupingClusters(state.builder.order, state.builder.items, grouping);
  const map = new Map(clusters.map((group) => [group.key, group.ids]));
  const newOrder = [];
  const keySet = new Set(orderKeys);
  orderKeys.forEach((key) => {
    if (!key) return;
    const ids = map.get(key);
    if (ids) newOrder.push(...ids);
  });
  map.forEach((ids, key) => {
    if (!keySet.has(key) && ids) newOrder.push(...ids);
  });
  const changed = newOrder.length === state.builder.order.length
    ? newOrder.some((id, idx) => id !== state.builder.order[idx])
    : true;
  if (newOrder.length && changed) {
    state.builder.order = newOrder;
    persistState();
    triggerRender();
  } else {
    triggerRender();
  }
  setDragDidDrop(true);
};

export const handleBuilderDragOver = (evt) => {
  if (!els.builderList || getActiveGrouping()) return;
  evt.preventDefault();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
  const dragging = els.builderList.querySelector('.builder-card.dragging');
  if (!dragging) return;
  const afterElement = getDragAfterElement(els.builderList, evt.clientY);
  if (!afterElement) {
    els.builderList.appendChild(dragging);
  } else if (afterElement !== dragging) {
    els.builderList.insertBefore(dragging, afterElement);
  }
};

export const handleBuilderDrop = (evt) => {
  if (!els.builderList || getActiveGrouping()) return;
  evt.preventDefault();
  const dragging = els.builderList.querySelector('.builder-card.dragging');
  if (dragging) dragging.classList.remove('dragging');
  const order = Array.from(els.builderList.querySelectorAll('.builder-card'))
    .map((node) => node.dataset.exerciseId)
    .filter(Boolean);
  const changed = order.some((id, idx) => id !== state.builder.order[idx]);
  if (changed) {
    state.builder.order = order;
    persistState();
    triggerRender();
  } else {
    triggerRender();
  }
  setDragDidDrop(true);
};

export const renderBuilder = () => {
  const { order, items } = state.builder;
  if (!order.length) {
    els.builderList.classList.remove('grouped');
    els.builderList.innerHTML = '<div class="empty">Add exercises from the library to build a custom workout.</div>';
    els.builderSummary.textContent = 'No exercises selected yet.';
    renderMuscleSummary();
    return;
  }

  let setTotal = 0;
  let summaryExtra = '';
  let displayIndex = 0;
  const grouping = getActiveGrouping();

  if (grouping) {
    const groups = getGroupingClusters(order, items, grouping);
    els.builderList.classList.add('grouped');
    els.builderList.innerHTML = '';

    groups.forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'builder-group';
      groupEl.dataset.groupKey = group.key;
      groupEl.dataset.groupType = grouping;
      groupEl.dataset.count = String(group.ids.length);
      groupEl.style.setProperty('--group-color', group.color);

      const head = document.createElement('div');
      head.className = 'builder-group-head';
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = group.label;
      const handle = document.createElement('div');
      handle.className = 'builder-group-handle';
      handle.textContent = 'Drag Group';
      head.append(label, handle);

      const body = document.createElement('div');
      body.className = 'builder-group-body';
      attachGroupBodyEvents(body, grouping, group.key);

      group.ids.forEach((id) => {
        const entry = items.get(id);
        if (!entry) return;
        displayIndex += 1;
        const { card, setCount } = buildBuilderCard(entry, displayIndex, { groupColor: group.color, groupKey: group.key });
        setTotal += setCount;
        body.appendChild(card);
      });

      groupEl.append(head, body);
      attachGroupDragEvents(groupEl, handle, grouping);
      els.builderList.appendChild(groupEl);
    });

    if (groups.length) {
      const labelBase = GROUPING_LABELS[grouping] || 'group';
      summaryExtra = ` | ${groups.length} ${labelBase}${groups.length === 1 ? '' : 's'}`;
    }
  } else {
    els.builderList.classList.remove('grouped');
    els.builderList.innerHTML = '';
    order.forEach((id, idx) => {
      const entry = items.get(id);
      if (!entry) return;
      const { card, setCount } = buildBuilderCard(entry, idx + 1);
      setTotal += setCount;
      els.builderList.appendChild(card);
    });
  }

  const exerciseWord = order.length === 1 ? 'exercise' : 'exercises';
  const setWord = setTotal === 1 ? 'set' : 'sets';
  els.builderSummary.textContent = `${order.length} ${exerciseWord} | ${setTotal} ${setWord}${summaryExtra}`;

  renderMuscleSummary();
};

const buildBuilderCard = (entry, displayIndex, options = {}) => {
  const { groupColor = null, groupKey = null } = options;
  const id = entry.exercise.id;
  const card = document.createElement('div');
  card.className = 'builder-card';
  if (groupColor) card.style.setProperty('--group-color', groupColor);
  if (groupKey) {
    card.classList.add('grouped');
    card.dataset.groupKey = groupKey;
  }
  card.dataset.exerciseId = id;

  const controls = document.createElement('div');
  controls.className = 'builder-controls';

  const header = document.createElement('div');
  header.className = 'builder-header-main';
  header.tabIndex = 0;

  const title = document.createElement('h3');
  title.textContent = `${displayIndex}. ${entry.exercise.name}`;
  const meta = document.createElement('div');
  meta.className = 'builder-meta';

  const metaFragments = [];
  if (entry.exercise.muscleGroups?.length) {
    const span = document.createElement('span');
    span.innerHTML = `<strong>Groups:</strong> ${entry.exercise.muscleGroups.map(niceName).join(', ')}`;
    metaFragments.push(span);
  }
  if (entry.exercise.muscles?.length) {
    const span = document.createElement('span');
    span.innerHTML = `<strong>Muscles:</strong> ${entry.exercise.muscles.map(niceName).join(', ')}`;
    metaFragments.push(span);
  }
  if (entry.exercise.equipment?.length) {
    const span = document.createElement('span');
    span.innerHTML = `<strong>Equipment:</strong> ${entry.exercise.equipment.map(niceName).join(', ')}`;
    metaFragments.push(span);
  }

  metaFragments.forEach((fragment, index) => {
    meta.appendChild(fragment);
    if (index < metaFragments.length - 1) {
      meta.appendChild(document.createTextNode(' | '));
    }
  });
  header.append(title, meta);

  const thumbUrl = entry.exercise.videos?.[0]?.thumbnail || entry.exercise.thumbnail || '';
  if (thumbUrl) {
    const preview = document.createElement('img');
    preview.className = 'builder-thumb';
    preview.src = thumbUrl;
    preview.alt = '';
    preview.loading = 'lazy';
    header.appendChild(preview);
  }

  const openReference = () => {
    openExerciseModal(entry.exercise);
  };
  header.addEventListener('click', openReference);
  header.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      openReference();
    }
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn danger small';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    removeExerciseFromBuilder(id);
    triggerRender();
  });

  controls.append(header, removeBtn);
  card.appendChild(controls);

  card.draggable = true;
  card.addEventListener('dragstart', (evt) => {
    setDragDidDrop(false);
    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    if (!getDragDidDrop()) triggerRender();
    setDragDidDrop(false);
  });

  const table = document.createElement('table');
  table.className = 'sets-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>Set</th><th>Mode</th><th>Reps</th><th>Weight (${getWeightLabel()})</th><th></th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let setCount = 0;
  entry.sets.forEach((set, index) => {
    setCount += 1;
    tbody.appendChild(renderSetRow(id, set, index));
  });
  table.appendChild(tbody);

  const addSetBtn = document.createElement('button');
  addSetBtn.className = 'btn small add-set';
  addSetBtn.textContent = 'Add Set';
  addSetBtn.addEventListener('click', () => {
    entry.sets.push(createSet());
    triggerRender();
    persistState();
  });

  card.append(table, addSetBtn);

  return { card, setCount };
};

export const handleScrollButtons = () => {
  const scrollY = window.scrollY;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollY > 400) {
    els.scrollUp.classList.add('show');
  } else {
    els.scrollUp.classList.remove('show');
  }
  if (scrollY < maxY - 400) {
    els.scrollDown.classList.add('show');
  } else {
    els.scrollDown.classList.remove('show');
  }
};

export const applyDeepLink = () => {
  if (!state.highlightId || state.highlightHandled) return;
  const target = document.getElementById(`exercise-${state.highlightId}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const exercise = state.data.find((ex) => ex.id === state.highlightId);
    if (exercise) openExerciseModal(exercise);
    state.highlightHandled = true;
  }
};

export function updateUrlExercise(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('exercise', id);
  history.replaceState({}, '', url.toString());
}

export function resetExerciseUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('exercise')) return;
  url.searchParams.delete('exercise');
  history.replaceState({}, '', url.toString());
}

export { shuffleBuilderOrder, getGroupColor };
