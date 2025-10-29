// Simple Exercise Library Explorer

const state = {
  data: [],
  filters: {
    muscles: new Set(),
    equipment: new Set(),
    mode: { muscles: 'OR', equipment: 'OR' } // OR = any match, AND = must include all selected
  },
  search: '',
  sort: 'AZ',
  muscles: [],
  equipment: [],
  buttons: { muscles: new Map(), equipment: new Map() }
};

const els = {
  muscleFilters: document.getElementById('muscleFilters'),
  equipmentFilters: document.getElementById('equipmentFilters'),
  clearMuscles: document.getElementById('clearMuscles'),
  clearEquipment: document.getElementById('clearEquipment'),
  grid: document.getElementById('exerciseGrid'),
  count: document.getElementById('count'),
  gridTitle: document.getElementById('gridTitle'),
  activeFilters: document.getElementById('activeFilters'),
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  sortToggle: document.getElementById('sortToggle'),
  modal: document.getElementById('modal'),
  modalVideo: document.getElementById('modalVideo'),
  modalNotice: document.getElementById('modalNotice'),
  modalClose: document.getElementById('modalClose'),
  backToTop: document.getElementById('backToTop'),
  muscleModeBar: document.getElementById('muscleModeBar'),
  equipmentModeBar: document.getElementById('equipmentModeBar'),
  muscleModeOR: document.getElementById('muscleModeOR'),
  muscleModeAND: document.getElementById('muscleModeAND'),
  equipmentModeOR: document.getElementById('equipmentModeOR'),
  equipmentModeAND: document.getElementById('equipmentModeAND')
};

// Utility: dedupe and sort
const uniq = arr => Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));

// Attempt to pick an MP4 video URL for preview (skip .m3u8 unless hls.js present)
function pickPreviewVideo(videos) {
  if (!Array.isArray(videos) || videos.length === 0) return null;
  // Prefer mp4
  const mp4 = videos.find(v => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  if (mp4) return mp4.video;
  // If Hls.js is available and mime is HLS, you could enable this path later
  return null;
}

function buildFilters() {
  // Buttons for muscles
  els.muscleFilters.innerHTML = '';
  state.buttons.muscles.clear();
  for (const m of state.muscles) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = m;
    btn.title = 'Click to toggle. Hover to set AND/OR.';
    btn.addEventListener('click', () => {
      toggleSelection(state.filters.muscles, m, btn);
      render();
    });
    state.buttons.muscles.set(m, btn);
    els.muscleFilters.appendChild(btn);
  }
  // Buttons for equipment
  els.equipmentFilters.innerHTML = '';
  state.buttons.equipment.clear();
  for (const e of state.equipment) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = e;
    btn.title = 'Click to toggle. Hover to set AND/OR.';
    btn.addEventListener('click', () => {
      toggleSelection(state.filters.equipment, e, btn);
      render();
    });
    state.buttons.equipment.set(e, btn);
    els.equipmentFilters.appendChild(btn);
  }
  // Clear buttons
  els.clearMuscles.addEventListener('click', () => {
    state.filters.muscles.clear();
    syncButtonStates();
    render();
  });
  els.clearEquipment.addEventListener('click', () => {
    state.filters.equipment.clear();
    syncButtonStates();
    render();
  });

  // Show/Hide mode bars on hover of each block
  const showMuscleMode = () => els.muscleModeBar.classList.add('show');
  const hideMuscleMode = () => els.muscleModeBar.classList.remove('show');
  const showEquipMode = () => els.equipmentModeBar.classList.add('show');
  const hideEquipMode = () => els.equipmentModeBar.classList.remove('show');
  els.muscleFilters.addEventListener('mouseenter', showMuscleMode);
  els.muscleFilters.addEventListener('mouseleave', hideMuscleMode);
  els.muscleModeBar.addEventListener('mouseenter', showMuscleMode);
  els.muscleModeBar.addEventListener('mouseleave', hideMuscleMode);
  els.equipmentFilters.addEventListener('mouseenter', showEquipMode);
  els.equipmentFilters.addEventListener('mouseleave', hideEquipMode);
  els.equipmentModeBar.addEventListener('mouseenter', showEquipMode);
  els.equipmentModeBar.addEventListener('mouseleave', hideEquipMode);

  // Mode toggles
  els.muscleModeOR.addEventListener('click', () => setMode('muscles', 'OR'));
  els.muscleModeAND.addEventListener('click', () => setMode('muscles', 'AND'));
  els.equipmentModeOR.addEventListener('click', () => setMode('equipment', 'OR'));
  els.equipmentModeAND.addEventListener('click', () => setMode('equipment', 'AND'));

  // Search + Sort
  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value || '';
    render();
  });
  els.searchClear.addEventListener('click', () => {
    state.search = '';
    els.searchInput.value = '';
    render();
  });
  els.sortToggle.addEventListener('click', () => {
    state.sort = state.sort === 'AZ' ? 'ZA' : 'AZ';
    syncSortToggle();
    render();
  });
}

function toggleSelection(set, value, btn) {
  if (set.has(value)) set.delete(value); else set.add(value);
  if (btn) btn.classList.toggle('active', set.has(value));
}

function syncButtonStates() {
  for (const [m, btn] of state.buttons.muscles) btn.classList.toggle('active', state.filters.muscles.has(m));
  for (const [e, btn] of state.buttons.equipment) btn.classList.toggle('active', state.filters.equipment.has(e));
}

function buildMuscleTiles() {
  const tileCounts = new Map();
  for (const ex of state.data) {
    for (const mg of ex.muscleGroups || []) {
      tileCounts.set(mg, (tileCounts.get(mg) || 0) + 1);
    }
  }
  els.tiles.innerHTML = '';
  for (const mg of state.muscles) {
    const tile = document.createElement('button');
    tile.className = `tile accent accent-${cssSafe(mg)}`;
    tile.title = `Filter by ${mg}`;
    tile.addEventListener('click', () => {
      // Toggle this muscle in the filter without scrolling
      const btn = state.buttons.muscles.get(mg);
      toggleSelection(state.filters.muscles, mg, btn);
      render();
    });

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = mg;
    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = `${tileCounts.get(mg) || 0} exercises`;
    tile.append(name, count);
    els.tiles.appendChild(tile);
  }
}

function cssSafe(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function filterData() {
  const selM = state.filters.muscles;
  const selE = state.filters.equipment;
  const modeM = state.filters.mode.muscles;
  const modeE = state.filters.mode.equipment;
  const q = (state.search || '').trim().toLowerCase();
  const filtered = state.data.filter(ex => {
    const exM = new Set(ex.muscleGroups || []);
    const exE = new Set(ex.equipment || []);
    const mgOk = selM.size === 0 || (modeM === 'OR' ? intersects(exM, selM) : isSuperset(exM, selM));
    const eqOk = selE.size === 0 || (modeE === 'OR' ? intersects(exE, selE) : isSuperset(exE, selE));
    const name = (ex.name || '').toLowerCase();
    const searchOk = q.length === 0 || name.includes(q);
    return mgOk && eqOk && searchOk;
  });
  // Sort by name
  filtered.sort((a, b) => {
    const an = (a.name || '').toLowerCase();
    const bn = (b.name || '').toLowerCase();
    const cmp = an.localeCompare(bn);
    return state.sort === 'ZA' ? -cmp : cmp;
  });
  return filtered;
}

function intersects(a, b) {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

function isSuperset(set, subset) {
  for (const v of subset) if (!set.has(v)) return false;
  return true;
}

function renderGrid(list) {
  els.grid.innerHTML = '';
  for (const ex of list) {
    const card = document.createElement('article');
    card.className = 'card';

    // Media block
    const media = document.createElement('div');
    media.className = 'media';
    const thumbUrl = ex.videos?.[0]?.thumbnail || '';
    const previewUrl = pickPreviewVideo(ex.videos || []);
    const img = document.createElement('img');
    img.alt = `${ex.name} thumbnail`;
    img.loading = 'lazy';
    img.src = thumbUrl;
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
          // Ignore autoplay errors
        }
      });
      media.addEventListener('mouseleave', () => {
        try { video.pause(); } catch {}
        media.classList.remove('playing');
      });
      // In case it ends, reset poster
      video.addEventListener('ended', () => {
        media.classList.remove('playing');
      });
    }

    // Click to open full video modal (best available quality)
    media.addEventListener('click', () => openExerciseModal(ex));

    // Body
    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = ex.name;

    const tags = document.createElement('div');
    tags.className = 'tags';
    for (const mg of ex.muscleGroups || []) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = mg;
      tags.appendChild(t);
    }
    for (const eq of ex.equipment || []) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = eq;
      tags.appendChild(t);
    }

    body.append(title, tags);
    card.append(media, body);
    els.grid.appendChild(card);
  }
}

function render() {
  const list = filterData();
  renderGrid(list);
  const parts = [];
  if (state.filters.muscles.size) parts.push(`${state.filters.mode.muscles === 'AND' ? 'ALL of' : 'ANY of'} ${state.filters.muscles.size} muscle${state.filters.muscles.size>1?'s':''}`);
  if (state.filters.equipment.size) parts.push(`${state.filters.mode.equipment === 'AND' ? 'ALL of' : 'ANY of'} ${state.filters.equipment.size} equipment`);
  els.gridTitle.textContent = parts.length ? `Exercises • ${parts.join(' + ')}` : 'Exercises';
  els.count.textContent = `${list.length} shown of ${state.data.length}`;

  // Show selected filter names in Title Case, underscores to spaces
  const musclesSel = Array.from(state.filters.muscles).map(niceName);
  const equipSel = Array.from(state.filters.equipment).map(niceName);
  const descs = [];
  if (musclesSel.length) descs.push(`Muscles: ${musclesSel.join(', ')}`);
  if (equipSel.length) descs.push(`Equipment: ${equipSel.join(', ')}`);
  els.activeFilters.textContent = descs.join(' • ');
}

async function init() {
  try {
    const res = await fetch('exercise_dump.json');
    const json = await res.json();
    state.data = Array.isArray(json) ? json : [];
  } catch (e) {
    console.error('Failed to load exercise_dump.json', e);
    // Show a simple error UI
    document.body.insertAdjacentHTML('afterbegin', '<div class="container">Failed to load exercise_dump.json. Please serve files via a local web server.</div>');
    return;
  }

  // Collect unique muscles and equipment from the dataset
  state.muscles = uniq(state.data.flatMap(ex => ex.muscleGroups || []));
  state.equipment = uniq(state.data.flatMap(ex => ex.equipment || []));

  buildFilters();
  syncButtonStates();

  // Modal events
  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });

  // Back to top
  window.addEventListener('scroll', () => {
    if (window.scrollY > 400) els.backToTop.classList.add('show'); else els.backToTop.classList.remove('show');
  });
  els.backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // Keyboard shortcuts: '/' focus search, 'Esc' clear search, 's' toggle sort
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const isTyping = tag === 'input' || tag === 'textarea' || e.isComposing;
    if (e.key === '/' && !isTyping) {
      e.preventDefault();
      els.searchInput?.focus();
    } else if (e.key === 'Escape') {
      if (state.search) {
        state.search = '';
        if (els.searchInput) els.searchInput.value = '';
        render();
      }
    } else if ((e.key === 's' || e.key === 'S') && !isTyping) {
      e.preventDefault();
      state.sort = state.sort === 'AZ' ? 'ZA' : 'AZ';
      syncSortToggle();
      render();
    }
  });
  render();
}

init();

// Modal helpers
function openExerciseModal(ex) {
  const best = pickBestVideo(ex.videos || []);
  els.modalVideo.pause();
  els.modalVideo.removeAttribute('src');
  els.modalVideo.load();
  els.modalNotice.textContent = '';

  if (!best) {
    els.modalNotice.textContent = 'No playable video source available for this exercise.';
  } else if (best.type === 'mp4') {
    els.modalVideo.src = best.url;
  } else if (best.type === 'hls') {
    if (supportsNativeHls(els.modalVideo)) {
      els.modalVideo.src = best.url;
    } else {
      els.modalNotice.innerHTML = `This video is an HLS stream (.m3u8) which may not play in this browser. Try Safari or open directly: <a href="${best.url}" target="_blank" rel="noopener">open stream</a>.`;
    }
  }

  els.modal.classList.remove('hidden');
  els.modal.setAttribute('aria-hidden', 'false');
  // Auto-play when possible
  els.modalVideo.play().catch(() => {});
}

function closeModal() {
  try { els.modalVideo.pause(); } catch {}
  els.modalVideo.removeAttribute('src');
  els.modalVideo.load();
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
}

function pickBestVideo(videos) {
  if (!Array.isArray(videos)) return null;
  // Prefer explicit mp4 if present
  const mp4 = videos.find(v => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  if (mp4) return { type: 'mp4', url: mp4.video };
  // Otherwise default to first video source (likely HLS)
  const first = videos.find(v => typeof v.video === 'string');
  if (!first) return null;
  const url = first.video;
  if (url.toLowerCase().endsWith('.m3u8')) return { type: 'hls', url };
  return { type: 'unknown', url };
}

function supportsNativeHls(videoEl) {
  if (!videoEl) return false;
  const can = videoEl.canPlayType('application/vnd.apple.mpegurl');
  return can === 'probably' || can === 'maybe';
}

function setMode(group, mode) {
  state.filters.mode[group] = mode;
  // update UI
  if (group === 'muscles') {
    els.muscleModeOR.classList.toggle('active', mode === 'OR');
    els.muscleModeAND.classList.toggle('active', mode === 'AND');
    els.muscleModeOR.setAttribute('aria-selected', String(mode === 'OR'));
    els.muscleModeAND.setAttribute('aria-selected', String(mode === 'AND'));
  } else if (group === 'equipment') {
    els.equipmentModeOR.classList.toggle('active', mode === 'OR');
    els.equipmentModeAND.classList.toggle('active', mode === 'AND');
    els.equipmentModeOR.setAttribute('aria-selected', String(mode === 'OR'));
    els.equipmentModeAND.setAttribute('aria-selected', String(mode === 'AND'));
  }
  render();
}

function syncSortToggle() {
  if (!els.sortToggle) return;
  const asc = state.sort === 'AZ';
  els.sortToggle.textContent = asc ? 'A→Z' : 'Z→A';
  els.sortToggle.classList.toggle('asc', asc);
  els.sortToggle.classList.toggle('desc', !asc);
}

function niceName(s) {
  return String(s)
    .toLowerCase()
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
