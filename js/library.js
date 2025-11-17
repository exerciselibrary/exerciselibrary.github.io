// Library view helpers: filters, search, and exercise card rendering.
import { SHARE_ICON_HTML } from './constants.js';
import { state, els, getSearchIndex } from './context.js';
export { state } from './context.js';
import { niceName, intersects, isSuperset, shuffleArray } from './utils.js';
import { searchExercises } from './search.js';
import {
  addExerciseToBuilder,
  removeExerciseFromBuilder,
  pickPreviewVideo,
  openExerciseModal,
  updateUrlExercise,
  shareExercise
} from './builder.js';
import { persistState } from './storage.js';

let renderCallback = null;

export const registerRenderHandler = (fn) => {
  renderCallback = fn;
};

const triggerRender = () => {
  if (typeof renderCallback === 'function') {
    renderCallback();
  }
};

const toggleSelection = (set, value, button) => {
  if (set.has(value)) set.delete(value); else set.add(value);
  button?.classList.toggle('active', set.has(value));
};

const syncButtonStates = () => {
  for (const [value, btn] of state.buttons.muscles) btn.classList.toggle('active', state.filters.muscles.has(value));
  for (const [value, btn] of state.buttons.subMuscles) btn.classList.toggle('active', state.filters.subMuscles.has(value));
  for (const [value, btn] of state.buttons.equipment) btn.classList.toggle('active', state.filters.equipment.has(value));
};

const setMode = (group, mode) => {
  state.filters.mode[group] = mode;
  if (group === 'muscles') {
    els.muscleModeOR.classList.toggle('active', mode === 'OR');
    els.muscleModeAND.classList.toggle('active', mode === 'AND');
    els.muscleModeOR.setAttribute('aria-selected', mode === 'OR');
    els.muscleModeAND.setAttribute('aria-selected', mode === 'AND');
  } else if (group === 'subMuscles') {
    els.subMuscleModeOR.classList.toggle('active', mode === 'OR');
    els.subMuscleModeAND.classList.toggle('active', mode === 'AND');
    els.subMuscleModeOR.setAttribute('aria-selected', mode === 'OR');
    els.subMuscleModeAND.setAttribute('aria-selected', mode === 'AND');
  } else if (group === 'equipment') {
    els.equipmentModeOR.classList.toggle('active', mode === 'OR');
    els.equipmentModeAND.classList.toggle('active', mode === 'AND');
    els.equipmentModeOR.setAttribute('aria-selected', mode === 'OR');
    els.equipmentModeAND.setAttribute('aria-selected', mode === 'AND');
  }
  triggerRender();
  persistState();
};

const buildButtonGroup = (values, registry, container, onClick, useNiceName = false) => {
  container.innerHTML = '';
  registry.clear();
  for (const value of values) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = useNiceName ? niceName(value) : value;
    btn.title = 'Click to toggle. Hover to set AND/OR.';
    btn.addEventListener('click', () => onClick(value));
    registry.set(value, btn);
    container.appendChild(btn);
  }
};

const wireModeBar = (area, bar) => {
  const show = () => bar.classList.add('show');
  const hide = () => bar.classList.remove('show');
  area.addEventListener('mouseenter', show);
  area.addEventListener('mouseleave', hide);
  bar.addEventListener('mouseenter', show);
  bar.addEventListener('mouseleave', hide);
};

export const buildFilters = () => {
  buildButtonGroup(state.muscles, state.buttons.muscles, els.muscleFilters, (value) => {
    toggleSelection(state.filters.muscles, value, state.buttons.muscles.get(value));
    triggerRender();
    persistState();
  });

  buildButtonGroup(state.subMuscles, state.buttons.subMuscles, els.subMuscleFilters, (value) => {
    toggleSelection(state.filters.subMuscles, value, state.buttons.subMuscles.get(value));
    triggerRender();
    persistState();
  }, true);

  buildButtonGroup(state.equipment, state.buttons.equipment, els.equipmentFilters, (value) => {
    toggleSelection(state.filters.equipment, value, state.buttons.equipment.get(value));
    triggerRender();
    persistState();
  });

  els.clearMuscles.addEventListener('click', () => {
    state.filters.muscles.clear();
    syncButtonStates();
    triggerRender();
    persistState();
  });
  els.clearSubMuscles.addEventListener('click', () => {
    state.filters.subMuscles.clear();
    syncButtonStates();
    triggerRender();
    persistState();
  });
  els.clearEquipment.addEventListener('click', () => {
    state.filters.equipment.clear();
    syncButtonStates();
    triggerRender();
    persistState();
  });

  wireModeBar(els.muscleFilters, els.muscleModeBar);
  wireModeBar(els.subMuscleFilters, els.subMuscleModeBar);
  wireModeBar(els.equipmentFilters, els.equipmentModeBar);

  els.muscleModeOR.addEventListener('click', () => setMode('muscles', 'OR'));
  els.muscleModeAND.addEventListener('click', () => setMode('muscles', 'AND'));
  els.subMuscleModeOR.addEventListener('click', () => setMode('subMuscles', 'OR'));
  els.subMuscleModeAND.addEventListener('click', () => setMode('subMuscles', 'AND'));
  els.equipmentModeOR.addEventListener('click', () => setMode('equipment', 'OR'));
  els.equipmentModeAND.addEventListener('click', () => setMode('equipment', 'AND'));
};

export const ensureRandomOrderMap = () => {
  if (state.randomOrderMap instanceof Map && state.randomOrderMap.size === state.data.length) return;
  const ids = state.data.map((ex) => ex.id);
  const shuffled = shuffleArray(ids);
  state.randomOrderMap = new Map(shuffled.map((id, idx) => [id, idx]));
};

export const shuffleLibraryExercises = () => {
  if (!state.data.length) return;
  const shuffled = shuffleArray(state.data.map((ex) => ex.id));
  state.randomOrderMap = new Map(shuffled.map((id, idx) => [id, idx]));
  state.shuffleMode = true;
};

export const filterData = () => {
  const { muscles, subMuscles, equipment, mode } = state.filters;
  const query = state.search.trim();

  const baseList = state.data.filter((ex) => {
    const muscleGroups = new Set(ex.muscleGroups || []);
    const muscleList = new Set(ex.muscles || []);
    const equipmentList = new Set(ex.equipment || []);

    const muscleOk = muscles.size === 0 || (mode.muscles === 'OR' ? intersects(muscleGroups, muscles) : isSuperset(muscleGroups, muscles));
    const subMuscleOk = subMuscles.size === 0 || (mode.subMuscles === 'OR' ? intersects(muscleList, subMuscles) : isSuperset(muscleList, subMuscles));
    const equipmentOk = equipment.size === 0 || (mode.equipment === 'OR' ? intersects(equipmentList, equipment) : isSuperset(equipmentList, equipment));

    return muscleOk && subMuscleOk && equipmentOk;
  });

  if (query) {
    const results = searchExercises(query, baseList, getSearchIndex());
    return results.map((entry) => entry.exercise);
  }

  const list = [...baseList];
  if (state.shuffleMode) {
    ensureRandomOrderMap();
    list.sort((a, b) => {
      const idxA = state.randomOrderMap?.get(a.id);
      const idxB = state.randomOrderMap?.get(b.id);
      if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
      if (idxA !== undefined) return -1;
      if (idxB !== undefined) return 1;
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      return an.localeCompare(bn);
    });
  } else {
    list.sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      const cmp = an.localeCompare(bn);
      return state.sortMode === 'ZA' ? -cmp : cmp;
    });
  }

  return list;
};

export const renderGrid = (exercises) => {
  els.grid.innerHTML = '';

  if (!exercises.length) {
    els.grid.innerHTML = '<div class="empty">No exercises found. Adjust filters or search terms.</div>';
    return;
  }

  exercises.forEach((ex) => {
    const inBuilder = state.builder.items.has(ex.id);

    const card = document.createElement('article');
    card.className = 'card';
    card.id = `exercise-${ex.id}`;
    card.dataset.exerciseId = ex.id;
    if (state.highlightId === ex.id) card.classList.add('highlight');

    const media = document.createElement('div');
    media.className = 'media';
    const thumbUrl = ex.videos?.[0]?.thumbnail || '';
    const previewUrl = pickPreviewVideo(ex.videos || []);

    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = `${ex.name} thumbnail`;
    img.loading = 'lazy';
    media.appendChild(img);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'none';
    video.poster = thumbUrl;
    media.appendChild(video);

    if (previewUrl) {
      media.addEventListener('mouseenter', async () => {
        try {
          if (!video.src) video.src = previewUrl;
          media.classList.add('playing');
          await video.play();
        } catch (err) {
          console.debug('Preview play blocked', err);
        }
      });
      media.addEventListener('mouseleave', () => {
        video.pause();
        media.classList.remove('playing');
      });
      video.addEventListener('ended', () => media.classList.remove('playing'));
    }

    media.addEventListener('click', () => {
      state.highlightId = ex.id;
      openExerciseModal(ex);
      updateUrlExercise(ex.id);
    });

    const body = document.createElement('div');
    body.className = 'card-body';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = ex.name;

    const tags = document.createElement('div');
    tags.className = 'tags';
    (ex.muscleGroups || []).forEach((mg) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = niceName(mg);
      tags.appendChild(span);
    });
    (ex.equipment || []).forEach((eq) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = niceName(eq);
      tags.appendChild(span);
    });

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'card-action icon';
    shareBtn.innerHTML = SHARE_ICON_HTML;
    shareBtn.dataset.label = 'Share';
    shareBtn.title = 'Share';
    shareBtn.setAttribute('aria-label', 'Share');
    shareBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      shareExercise(ex, shareBtn);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'card-action';
    if (inBuilder) {
      addBtn.classList.add('danger');
      addBtn.textContent = 'Remove from Workout';
    } else {
      addBtn.classList.add('primary');
      addBtn.textContent = 'Add to Workout';
    }
    addBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (state.builder.items.has(ex.id)) {
        removeExerciseFromBuilder(ex.id);
      } else {
        addExerciseToBuilder(ex);
      }
      triggerRender();
    });

    actions.append(shareBtn, addBtn);

    body.append(title, tags, actions);
    card.append(media, body);
    els.grid.appendChild(card);
  });
};

export const refreshFilterButtons = () => {
  syncButtonStates();
};
