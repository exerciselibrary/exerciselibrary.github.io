// Exercise Library Explorer with Workout Builder

const MAX_CABLE_WEIGHT = 220;
const MAX_CABLE_WEIGHT_KG = Math.round(MAX_CABLE_WEIGHT * 0.45359237);
const STORAGE_KEY = 'exercise-library-state-v1';

const MODE_OPTIONS = [
  { value: 'OLD_SCHOOL', label: 'Old School' },
  { value: 'TIME_UNDER_TENSION', label: 'Time Under Tension' },
  { value: 'PUMP', label: 'Pump' },
  { value: 'ECCENTRIC', label: 'Eccentric' },
  { value: 'ECHO', label: 'Echo Mode' }
];

const MODE_LABELS = MODE_OPTIONS.reduce((acc, opt) => {
  acc[opt.value] = opt.label;
  return acc;
}, {});

const ECHO_LEVELS = [
  { value: 'HARD', label: 'Hard' },
  { value: 'HARDER', label: 'Harder' },
  { value: 'HARDEST', label: 'Hardest' },
  { value: 'EPIC', label: 'Epic' }
];

const state = {
  data: [],
  muscles: [],
  subMuscles: [],
  equipment: [],
  filters: {
    muscles: new Set(),
    subMuscles: new Set(),
    equipment: new Set(),
    mode: { muscles: 'OR', subMuscles: 'OR', equipment: 'OR' }
  },
  buttons: { muscles: new Map(), subMuscles: new Map(), equipment: new Map() },
  search: '',
  sortMode: 'AZ',
  randomOrderMap: null,
  builder: { order: [], items: new Map() },
  highlightId: null,
  highlightHandled: false,
  activeTab: 'library',
  showWorkoutOnly: false,
  groupByEquipment: false,
  groupByMuscles: false,
  groupByMuscleGroups: false,
  includeCheckboxes: false,
  weightUnit: 'LBS'
};

let dragDidDrop = false;
let searchIndex = null;
const groupColorMap = new Map();
const EQUIPMENT_COLORS = [
  '#7aa2f7',
  '#22d3ee',
  '#34d399',
  '#facc15',
  '#f472b6',
  '#fb923c',
  '#a855f7',
  '#f87171',
  '#38bdf8',
  '#fbbf24'
];
function normalizeMuscleName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const MUSCLE_COVERAGE = [
  { key: 'abductors', label: 'Abductors', aliases: ['abductor', 'abductors', 'hip abductors', 'gluteus medius', 'gluteus minimus'] },
  { key: 'biceps', label: 'Biceps', aliases: ['biceps', 'bicep', 'biceps brachii'] },
  { key: 'calves', label: 'Calves', aliases: ['calf', 'calves', 'gastrocnemius', 'soleus'] },
  { key: 'chest', label: 'Chest', aliases: ['chest', 'pectoralis', 'pectoralis major', 'pecs', 'pectoral'] },
  { key: 'core', label: 'Core', aliases: ['core', 'abs', 'abdominals', 'rectus abdominis', 'transverse abdominis', 'transversus abdominis'] },
  { key: 'forearms', label: 'Forearms', aliases: ['forearm', 'forearms', 'brachioradialis', 'pronator', 'supinator', 'wrist flexors', 'wrist extensors'] },
  { key: 'glutes', label: 'Glutes', aliases: ['glutes', 'glute', 'gluteus', 'gluteus maximus', 'gluteus medius', 'gluteus minimus'] },
  { key: 'hamstrings', label: 'Hamstrings', aliases: ['hamstring', 'hamstrings', 'biceps femoris', 'semimembranosus', 'semitendinosus'] },
  { key: 'lats', label: 'Lats', aliases: ['lats', 'lat', 'latissimus', 'latissimus dorsi'] },
  { key: 'lower_back', label: 'Lower Back', aliases: ['lower back', 'lower_back', 'lumbar', 'erector spinae', 'spinal erectors'] },
  { key: 'obliques', label: 'Obliques', aliases: ['oblique', 'obliques', 'internal oblique', 'external oblique', 'serratus', 'serratus anterior'] },
  { key: 'quads', label: 'Quads', aliases: ['quad', 'quads', 'quadriceps', 'vastus', 'rectus femoris'] },
  { key: 'shoulders', label: 'Shoulders', aliases: ['shoulder', 'shoulders', 'delts', 'deltoids', 'anterior deltoid', 'lateral deltoid', 'posterior deltoid'] },
  { key: 'traps', label: 'Traps', aliases: ['traps', 'trap', 'trapezius', 'upper trapezius'] },
  { key: 'triceps', label: 'Triceps', aliases: ['triceps', 'tricep', 'triceps brachii'] },
  { key: 'upper_back', label: 'Upper Back', aliases: ['upper back', 'upper_back', 'upper-back', 'upperback', 'middle back', 'mid back', 'rhomboids', 'rhomboid', 'teres major', 'teres minor'] }
];
const MUSCLE_ALIAS_LOOKUP = new Map();
MUSCLE_COVERAGE.forEach((group) => {
  group.aliases.forEach((alias) => {
    MUSCLE_ALIAS_LOOKUP.set(normalizeMuscleName(alias), group.key);
  });
});
const SHARE_ICON_HTML = '<span aria-hidden="true">&#128279;</span><span class="sr-only">Share</span>';
const SHARE_SUCCESS_HTML = '<span aria-hidden="true">&#10003;</span><span class="sr-only">Copied</span>';
const SHARE_ERROR_HTML = '<span aria-hidden="true">!</span><span class="sr-only">Copy failed</span>';

const els = {
  muscleFilters: document.getElementById('muscleFilters'),
  subMuscleFilters: document.getElementById('subMuscleFilters'),
  equipmentFilters: document.getElementById('equipmentFilters'),
  clearMuscles: document.getElementById('clearMuscles'),
  clearSubMuscles: document.getElementById('clearSubMuscles'),
  clearEquipment: document.getElementById('clearEquipment'),
  muscleModeBar: document.getElementById('muscleModeBar'),
  muscleModeOR: document.getElementById('muscleModeOR'),
  muscleModeAND: document.getElementById('muscleModeAND'),
  subMuscleModeBar: document.getElementById('subMuscleModeBar'),
  subMuscleModeOR: document.getElementById('subMuscleModeOR'),
  subMuscleModeAND: document.getElementById('subMuscleModeAND'),
  equipmentModeBar: document.getElementById('equipmentModeBar'),
  equipmentModeOR: document.getElementById('equipmentModeOR'),
  equipmentModeAND: document.getElementById('equipmentModeAND'),
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  sortToggle: document.getElementById('sortToggle'),
  randomizeLibrary: document.getElementById('randomizeLibrary'),
  unitToggle: document.getElementById('unitToggle'),
  toggleBuilderFilter: document.getElementById('toggleBuilderFilter'),
  grid: document.getElementById('exerciseGrid'),
  gridTitle: document.getElementById('gridTitle'),
  count: document.getElementById('count'),
  activeFilters: document.getElementById('activeFilters'),
  tabLibrary: document.getElementById('tabLibrary'),
  tabBuilder: document.getElementById('tabBuilder'),
  libraryPanel: document.getElementById('libraryPanel'),
  builderPanel: document.getElementById('builderPanel'),
  builderList: document.getElementById('builderList'),
  builderSummary: document.getElementById('builderSummary'),
  builderCount: document.getElementById('builderCount'),
  builderMuscles: document.getElementById('builderMuscles'),
  exportWorkout: document.getElementById('exportWorkout'),
  printWorkout: document.getElementById('printWorkout'),
  shareWorkout: document.getElementById('shareWorkout'),
  shuffleBuilder: document.getElementById('shuffleBuilder'),
  groupEquipment: document.getElementById('groupEquipment'),
  groupMuscles: document.getElementById('groupMuscles'),
  groupMuscleGroups: document.getElementById('groupMuscleGroups'),
  clearWorkout: document.getElementById('clearWorkout'),
  includeCheckboxes: document.getElementById('includeCheckboxes'),
  modal: document.getElementById('modal'),
  modalVideo: document.getElementById('modalVideo'),
  modalNotice: document.getElementById('modalNotice'),
  modalClose: document.getElementById('modalClose'),
  scrollUp: document.getElementById('scrollUp'),
  scrollDown: document.getElementById('scrollDown')
};

const uniq = (arr) => Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));

const niceName = (str) => String(str)
  .toLowerCase()
  .replace(/_/g, ' ')
  .split(' ')
  .filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');

const intersects = (a, b) => {
  for (const v of a) if (b.has(v)) return true;
  return false;
};

const isSuperset = (set, subset) => {
  for (const v of subset) if (!set.has(v)) return false;
  return true;
};

const tokenizeSearch = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .filter(Boolean);

const collectTokens = (values) => {
  const tokens = [];
  for (const value of values || []) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      tokens.push(...collectTokens(value));
    } else {
      tokens.push(...tokenizeSearch(value));
    }
  }
  return tokens;
};

const levenshteinDistance = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return Math.abs(a.length - b.length);
  const prev = [];
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = prev[j] + 1;
      const insertion = prev[j - 1] + 1;
      const substitution = prevDiag + cost;
      prev[j] = Math.min(deletion, insertion, substitution);
      prevDiag = temp;
    }
  }
  return prev[b.length];
};

const buildSearchEntry = (exercise) => {
  const name = exercise?.name || '';
  const nameLower = name.toLowerCase();
  const nameTokens = tokenizeSearch(name);
  const primarySet = new Set(nameTokens);

  const attributeSources = [
    exercise?.muscleGroups || [],
    exercise?.muscles || [],
    exercise?.equipment || [],
    exercise?.tags || [],
    exercise?.category || '',
    exercise?.mode || ''
  ];
  const secondaryTokens = collectTokens(attributeSources);
  const secondarySet = new Set(secondaryTokens);

  const allTokens = Array.from(new Set([...nameTokens, ...secondaryTokens]));

  const fallbackFields = [
    nameLower,
    (exercise?.muscleGroups || []).join(' ').toLowerCase(),
    (exercise?.muscles || []).join(' ').toLowerCase(),
    (exercise?.equipment || []).join(' ').toLowerCase()
  ];

  return {
    id: exercise?.id,
    nameLower,
    nameTokens,
    primarySet,
    secondarySet,
    allTokens,
    fallbackFields
  };
};

const buildSearchIndex = (collection) => {
  const index = new Map();
  for (const item of collection) {
    if (!item?.id) continue;
    index.set(item.id, buildSearchEntry(item));
  }
  return index;
};

const computeSearchScore = (entry, queryTokens) => {
  if (!entry) return 0;
  let score = 0;
  let matched = 0;

  for (const token of queryTokens) {
    if (!token) continue;
    let tokenScore = 0;

    if (entry.primarySet.has(token)) {
      tokenScore = 14;
    } else {
      if (entry.nameTokens.some((word) => word.startsWith(token))) tokenScore = Math.max(tokenScore, 10);
      if (entry.nameLower.includes(token)) tokenScore = Math.max(tokenScore, 7);
    }

    if (entry.secondarySet.has(token)) {
      tokenScore = Math.max(tokenScore, 8);
    }

    if (!tokenScore && token.length > 2) {
      for (const candidate of entry.allTokens) {
        if (Math.abs(candidate.length - token.length) > 2) continue;
        if (levenshteinDistance(candidate, token) <= 1) {
          tokenScore = 4;
          break;
        }
      }
    }

    if (tokenScore) {
      score += tokenScore;
      matched += 1;
    }
  }

  if (!score) {
    const joined = queryTokens.join(' ');
    if (joined) {
      for (const field of entry.fallbackFields) {
        if (field && field.includes(joined)) {
          score = 6;
          break;
        }
      }
    }
  }

  if (matched > 1 && matched === queryTokens.length) {
    score += 6;
  }

  return score;
};

const searchExercises = (query, candidates) => {
  if (!query.trim()) {
    return candidates.map((exercise) => ({ exercise, score: 0 }));
  }
  const tokens = tokenizeSearch(query);
  if (!tokens.length) {
    return candidates.map((exercise) => ({ exercise, score: 0 }));
  }

  const results = [];
  for (const exercise of candidates) {
    const entry = searchIndex?.get(exercise.id) || buildSearchEntry(exercise);
    const score = computeSearchScore(entry, tokens);
    if (score > 0) {
      results.push({ exercise, score });
    }
  }

  if (!results.length) {
    const fallback = candidates.filter((exercise) => {
      const name = (exercise?.name || '').toLowerCase();
      return tokens.every((token) => name.includes(token));
    });
    return fallback.map((exercise) => ({ exercise, score: 1 }));
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = (a.exercise?.name || '').toLowerCase();
    const bn = (b.exercise?.name || '').toLowerCase();
    return an.localeCompare(bn);
  });

  return results;
};

const shuffleArray = (source) => {
  const arr = Array.from(source);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const ensureRandomOrderMap = () => {
  if (state.randomOrderMap instanceof Map && state.randomOrderMap.size === state.data.length) return;
  const ids = state.data.map((ex) => ex.id);
  const shuffled = shuffleArray(ids);
  state.randomOrderMap = new Map(shuffled.map((id, idx) => [id, idx]));
};

const shuffleLibraryExercises = () => {
  if (!state.data.length) return;
  const shuffled = shuffleArray(state.data.map((ex) => ex.id));
  state.randomOrderMap = new Map(shuffled.map((id, idx) => [id, idx]));
  state.sortMode = 'RANDOM';
};

const buildEquipmentKey = (exercise) => {
  const equipment = Array.isArray(exercise?.equipment) ? exercise.equipment : [];
  if (!equipment.length) return '__none__';
  const normalized = equipment
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return normalized.length ? normalized.join('|') : '__none__';
};

const getGroupColor = (type, key) => {
  const cacheKey = `${type}:${key}`;
  if (!groupColorMap.has(cacheKey)) {
    const index = groupColorMap.size % EQUIPMENT_COLORS.length;
    groupColorMap.set(cacheKey, EQUIPMENT_COLORS[index]);
  }
  return groupColorMap.get(cacheKey) || '#7aa2f7';
};

const formatListLabel = (values, fallback) => {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return fallback;
  const names = list.map((item) => niceName(item)).filter(Boolean);
  return names.length ? names.join(', ') : fallback;
};

const buildAttributeKey = (values, normalizer = normalizeMuscleName) => {
  const list = Array.isArray(values) ? values : [];
  const normalized = list
    .map((item) => normalizer(item))
    .filter(Boolean)
    .sort();
  return normalized.length ? normalized.join('|') : '__none__';
};

const getGroupingKey = (exercise, type) => {
  if (type === 'equipment') return buildEquipmentKey(exercise);
  if (type === 'muscles') return buildAttributeKey(exercise?.muscles);
  if (type === 'muscleGroups') return buildAttributeKey(exercise?.muscleGroups);
  return '__none__';
};

const formatGroupingLabel = (exercise, type) => {
  if (type === 'equipment') {
    const equipment = Array.isArray(exercise?.equipment) ? exercise.equipment : [];
    if (!equipment.length) return 'No Equipment';
    const names = equipment.map((item) => niceName(item)).filter(Boolean);
    return names.length ? names.join(' + ') : 'No Equipment';
  }
  if (type === 'muscles') return formatListLabel(exercise?.muscles, 'No Muscles');
  if (type === 'muscleGroups') return formatListLabel(exercise?.muscleGroups, 'No Muscle Groups');
  return 'No Data';
};

const GROUPING_LABELS = {
  equipment: 'equipment group',
  muscles: 'muscle cluster',
  muscleGroups: 'muscle group'
};

const getActiveGrouping = () => {
  if (state.groupByEquipment) return 'equipment';
  if (state.groupByMuscles) return 'muscles';
  if (state.groupByMuscleGroups) return 'muscleGroups';
  return null;
};

const setActiveGrouping = (type) => {
  state.groupByEquipment = type === 'equipment';
  state.groupByMuscles = type === 'muscles';
  state.groupByMuscleGroups = type === 'muscleGroups';
};

const getGroupingClusters = (order, items, type) => {
  const groups = [];
  let current = null;
  order.forEach((id) => {
    const entry = items.get(id);
    if (!entry) return;
    const key = getGroupingKey(entry.exercise, type);
    if (!current || current.key !== key) {
      current = {
        key,
        ids: [],
        label: formatGroupingLabel(entry.exercise, type),
        color: getGroupColor(type, key)
      };
      groups.push(current);
    }
    current.ids.push(id);
  });
  return groups;
};

const applyGrouping = (type) => {
  if (!type || state.builder.order.length < 2) return false;
  const groups = new Map();
  const keyOrder = [];
  for (const id of state.builder.order) {
    const entry = state.builder.items.get(id);
    if (!entry) continue;
    const key = getGroupingKey(entry.exercise, type);
    if (!groups.has(key)) {
      groups.set(key, []);
      keyOrder.push(key);
    }
    groups.get(key).push(id);
  }
  if (!keyOrder.length) return false;
  const grouped = [];
  for (const key of keyOrder) {
    grouped.push(...(groups.get(key) || []));
  }
  const changed = grouped.length === state.builder.order.length && grouped.some((id, idx) => id !== state.builder.order[idx]);
  if (!changed) return false;
  state.builder.order = grouped;
  return true;
};

const shuffleBuilderOrder = () => {
  if (state.builder.order.length < 2) return false;
  const grouping = getActiveGrouping();
  if (grouping) {
    const groups = getGroupingClusters(state.builder.order, state.builder.items, grouping);
    if (!groups.length) return false;
    const shuffledGroups = shuffleArray(groups);
    const newOrder = [];
    shuffledGroups.forEach((group) => {
      const shuffledIds = shuffleArray(group.ids);
      newOrder.push(...shuffledIds);
    });
    state.builder.order = newOrder;
  } else {
    state.builder.order = shuffleArray(state.builder.order);
  }
  persistState();
  return true;
};

const encodeBase64 = (text) => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const decodeBase64 = (text) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
};

const base64UrlEncode = (str) => {
  return encodeBase64(str).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
};

const base64UrlDecode = (str) => {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return decodeBase64(base64);
};

const ZIP_ENCODER = new TextEncoder();
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const stringToUint8 = (input) => {
  if (input instanceof Uint8Array) return input;
  return ZIP_ENCODER.encode(String(input));
};

const concatUint8 = (arrays) => {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((arr) => {
    result.set(arr, offset);
    offset += arr.length;
  });
  return result;
};

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZip = (files) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = ZIP_ENCODER.encode(file.name);
    const content = stringToUint8(file.data);
    const crc = crc32(content);
    const size = content.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, content);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += localHeader.length + size;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = offset;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralOffset, true);
  eocdView.setUint16(20, 0, true);

  return concatUint8([...localParts, ...centralParts, eocd]);
};

const columnName = (index) => {
  let name = '';
  let current = index;
  while (current >= 0) {
    name = String.fromCharCode((current % 26) + 65) + name;
    current = Math.floor(current / 26) - 1;
  }
  return name;
};

const escapeXml = (value) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r\n|\r|\n/g, '&#10;');
};

const createWorksheetXml = (rows) => {
  const body = rows
    .map((row, rowIdx) => {
      const cells = row
        .map((cell, colIdx) => {
          const value = cell === null || cell === undefined ? '' : String(cell);
          if (!value) return '';
          const ref = `${columnName(colIdx)}${rowIdx + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .filter(Boolean)
        .join('');
      return `<row r="${rowIdx + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
};

const createWorkbookXlsx = (rows) => {
  const normalized = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
  const worksheetXml = createWorksheetXml(normalized);
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const relsRoot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Workout" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  return createZip([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsRoot },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/worksheets/sheet1.xml', data: worksheetXml }
  ]);
};

const KG_PER_LB = 0.45359237;
const LB_PER_KG = 1 / KG_PER_LB;
const formatWeight = (value, unit) => {
  if (value === '' || value === null || value === undefined) return '';
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) return '';
  const precision = unit === 'KG' ? 1 : 0;
  const formatted = num.toFixed(precision);
  return precision === 0 ? formatted : formatted.replace(/\.0$/, '');
};

const convertWeightValue = (value, from, to) => {
  if (!value && value !== 0) return '';
  if (from === to) return value;
  const num = parseFloat(value);
  if (Number.isNaN(num)) return '';
  const converted = from === 'LBS' ? num * KG_PER_LB : num * LB_PER_KG;
  return formatWeight(converted, to);
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

const updateUnitToggle = () => {
  if (!els.unitToggle) return;
  const label = state.weightUnit === 'LBS' ? 'Units: lbs' : 'Units: kg';
  els.unitToggle.textContent = label;
  els.unitToggle.title = `Switch to ${state.weightUnit === 'LBS' ? 'kilograms' : 'pounds'}`;
};

const toggleWeightUnit = () => {
  const newUnit = state.weightUnit === 'LBS' ? 'KG' : 'LBS';
  convertAllWeights(newUnit);
  state.weightUnit = newUnit;
  updateUnitToggle();
  persistState();
  render();
};

const getWeightLabel = () => (state.weightUnit === 'LBS' ? 'lbs' : 'kg');

const createSet = () => ({
  id: Math.random().toString(36).slice(2),
  reps: '',
  weight: '',
  mode: 'OLD_SCHOOL',
  echoLevel: ECHO_LEVELS[0].value
});

const getModeLabel = (set) => {
  if (!set) return '';
  if (set.mode === 'ECHO') {
    const level = ECHO_LEVELS.find((opt) => opt.value === set.echoLevel) || ECHO_LEVELS[0];
    return `${MODE_LABELS.ECHO} - ${level.label}`;
  }
  return MODE_LABELS[set.mode] || MODE_LABELS.OLD_SCHOOL;
};

const getBuilderSnapshot = () => ({
  order: [...state.builder.order],
  items: state.builder.order
    .map((id) => {
      const entry = state.builder.items.get(id);
      if (!entry) return null;
      return {
        i: id,
        n: entry.exercise.name,
        g: entry.exercise.muscleGroups || [],
        m: entry.exercise.muscles || [],
        q: entry.exercise.equipment || [],
        s: entry.sets.map((set) => [
          set.reps ?? '',
          set.weight ?? '',
          set.mode || 'OLD_SCHOOL',
          set.echoLevel || ECHO_LEVELS[0].value
        ])
      };
    })
    .filter(Boolean)
});

const applyBuilderSnapshot = (snapshot) => {
  state.builder.order = [];
  state.builder.items.clear();
  if (!snapshot?.order || !snapshot?.items) return;

  const itemMap = new Map();
  snapshot.items.forEach((item) => {
    if (!item) return;
    if (Array.isArray(item.s)) {
      itemMap.set(item.i || item.id, {
        ...item,
        m: Array.isArray(item.m) ? item.m : []
      });
    } else if (Array.isArray(item.sets)) {
      itemMap.set(item.id, {
        i: item.id,
        n: item.exercise?.name,
        g: item.exercise?.muscleGroups || [],
        m: item.exercise?.muscles || [],
        q: item.exercise?.equipment || [],
        s: item.sets.map((set) => [
          set.reps ?? '',
          set.weight ?? '',
          set.mode || 'OLD_SCHOOL',
          set.echoLevel || ECHO_LEVELS[0].value
        ])
      });
    }
  });

  snapshot.order.forEach((id) => {
    const item = itemMap.get(id);
    if (!item) return;

    const sets = (item.s || []).map((values) => ({
      id: Math.random().toString(36).slice(2),
      reps: values[0] ?? '',
      weight: values[1] ?? '',
      mode: values[2] || 'OLD_SCHOOL',
      echoLevel: values[3] || ECHO_LEVELS[0].value
    }));
    if (!sets.length) sets.push(createSet());

    const catalogue = state.data.find((ex) => ex.id === id);
    const musclesFromItem = Array.isArray(item.m) ? item.m : [];
    const baseExercise = catalogue || {
      id,
      name: item.n || 'Exercise',
      muscleGroups: item.g || [],
      muscles: musclesFromItem,
      equipment: item.q || [],
      videos: item.v || []
    };
    const exercise = {
      ...baseExercise,
      muscleGroups: baseExercise.muscleGroups || [],
      muscles: Array.isArray(baseExercise.muscles) ? baseExercise.muscles : musclesFromItem,
      equipment: baseExercise.equipment || [],
      videos: baseExercise.videos || []
    };

    state.builder.order.push(id);
    state.builder.items.set(id, {
      exercise: {
        id: exercise.id,
        name: exercise.name,
        muscleGroups: exercise.muscleGroups || [],
        muscles: exercise.muscles || musclesFromItem,
        equipment: exercise.equipment || [],
        videos: exercise.videos || []
      },
      sets
    });
  });
};

const persistState = (options = {}) => {
  try {
    const snapshot = {
      builder: getBuilderSnapshot(),
      flags: {
        showWorkoutOnly: state.showWorkoutOnly,
        includeCheckboxes: state.includeCheckboxes,
        activeTab: state.activeTab,
        weightUnit: state.weightUnit,
        sortMode: state.sortMode,
        groupByEquipment: state.groupByEquipment,
        groupByMuscles: state.groupByMuscles,
        groupByMuscleGroups: state.groupByMuscleGroups
      }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    if (!options.skipCleanup) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('workout')) {
        url.searchParams.delete('workout');
        history.replaceState({}, '', url.toString());
      }
    }
  } catch (err) {
    console.warn('Persist failed', err);
  }
};

const loadPersistedState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.flags) {
      state.showWorkoutOnly = Boolean(parsed.flags.showWorkoutOnly);
      state.includeCheckboxes = Boolean(parsed.flags.includeCheckboxes);
      if (parsed.flags.activeTab === 'builder') state.activeTab = 'builder';
      if (parsed.flags.weightUnit === 'KG') state.weightUnit = 'KG';
      else state.weightUnit = 'LBS';
      if (parsed.flags.sortMode === 'ZA' || parsed.flags.sortMode === 'RANDOM' || parsed.flags.sortMode === 'AZ') {
        state.sortMode = parsed.flags.sortMode;
      } else {
        state.sortMode = 'AZ';
      }
      const equipmentActive = Boolean(parsed.flags.groupByEquipment);
      const musclesActive = Boolean(parsed.flags.groupByMuscles);
      const muscleGroupsActive = Boolean(parsed.flags.groupByMuscleGroups);
      if (equipmentActive) setActiveGrouping('equipment');
      else if (musclesActive) setActiveGrouping('muscles');
      else if (muscleGroupsActive) setActiveGrouping('muscleGroups');
      else setActiveGrouping(null);
    }
    if (parsed?.builder) applyBuilderSnapshot(parsed.builder);
  } catch (err) {
    console.warn('Failed to load saved state', err);
  }
};

const applyWorkoutFromParam = (encoded) => {
  try {
    let decoded;
    try {
      decoded = base64UrlDecode(encoded);
    } catch (err) {
      decoded = decodeBase64(encoded);
    }
    const payload = JSON.parse(decoded);

    if (payload?.b) {
      state.weightUnit = payload.u ? 'KG' : 'LBS';
      state.showWorkoutOnly = Boolean(payload.f);
      state.includeCheckboxes = Boolean(payload.c);
      state.activeTab = 'builder';
      const snapshot = {
        order: payload.b.o || payload.b.order || [],
        items: payload.b.i || payload.b.items || []
      };
      applyBuilderSnapshot(snapshot);
    } else if (payload?.builder) {
      applyBuilderSnapshot(payload.builder);
      if (payload.flags) {
        state.showWorkoutOnly = Boolean(payload.flags.showWorkoutOnly);
        state.includeCheckboxes = Boolean(payload.flags.includeCheckboxes);
        if (payload.flags.activeTab === 'builder') state.activeTab = 'builder';
        if (payload.flags.weightUnit === 'KG') state.weightUnit = 'KG';
        if (Object.prototype.hasOwnProperty.call(payload.flags, 'groupByEquipment')
          || Object.prototype.hasOwnProperty.call(payload.flags, 'groupByMuscles')
          || Object.prototype.hasOwnProperty.call(payload.flags, 'groupByMuscleGroups')) {
          if (payload.flags.groupByEquipment) setActiveGrouping('equipment');
          else if (payload.flags.groupByMuscles) setActiveGrouping('muscles');
          else if (payload.flags.groupByMuscleGroups) setActiveGrouping('muscleGroups');
          else setActiveGrouping(null);
        }
      }
    }
    persistState({ skipCleanup: true });
  } catch (err) {
    console.warn('Failed to apply workout from link', err);
  }
};

function init() {
  const params = new URLSearchParams(window.location.search);
  const deepLink = params.get('exercise');
  const workoutParam = params.get('workout');
  if (deepLink) state.highlightId = deepLink;

  fetch('exercise_dump.json')
    .then((res) => res.json())
    .then((json) => {
      state.data = Array.isArray(json) ? json : [];
      state.muscles = uniq(state.data.flatMap((ex) => ex.muscleGroups || []));
      state.subMuscles = uniq(state.data.flatMap((ex) => ex.muscles || []));
      state.equipment = uniq(state.data.flatMap((ex) => ex.equipment || []));
      searchIndex = buildSearchIndex(state.data);

      if (workoutParam) applyWorkoutFromParam(workoutParam);
      else loadPersistedState();

      const initialGrouping = getActiveGrouping();
      if (initialGrouping) applyGrouping(initialGrouping);
      if (state.sortMode === 'RANDOM') ensureRandomOrderMap();

      buildFilters();
      syncButtonStates();
      bindGlobalEvents();
      syncSortControls();
      updateUnitToggle();
      updateBuilderFilterControl();
      if (els.includeCheckboxes) els.includeCheckboxes.checked = state.includeCheckboxes;
      if (els.searchInput && state.search) {
        els.searchInput.value = state.search;
      }
      render();
      applyDeepLink();
    })
    .catch((err) => {
      console.error('Failed to load exercise_dump.json', err);
      document.body.insertAdjacentHTML('afterbegin', '<div class="container">Failed to load exercise_dump.json. Please serve files via a local web server.</div>');
    });
}

function buildFilters() {
  buildButtonGroup(state.muscles, state.buttons.muscles, els.muscleFilters, (value) => {
    toggleSelection(state.filters.muscles, value, state.buttons.muscles.get(value));
    render();
    persistState();
  });

  buildButtonGroup(state.subMuscles, state.buttons.subMuscles, els.subMuscleFilters, (value) => {
    toggleSelection(state.filters.subMuscles, value, state.buttons.subMuscles.get(value));
    render();
    persistState();
  }, true);

  buildButtonGroup(state.equipment, state.buttons.equipment, els.equipmentFilters, (value) => {
    toggleSelection(state.filters.equipment, value, state.buttons.equipment.get(value));
    render();
    persistState();
  });

  els.clearMuscles.addEventListener('click', () => {
    state.filters.muscles.clear();
    syncButtonStates();
    render();
    persistState();
  });
  els.clearSubMuscles.addEventListener('click', () => {
    state.filters.subMuscles.clear();
    syncButtonStates();
    render();
    persistState();
  });
  els.clearEquipment.addEventListener('click', () => {
    state.filters.equipment.clear();
    syncButtonStates();
    render();
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
}

function buildButtonGroup(values, registry, container, onClick, useNiceName = false) {
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
}

function wireModeBar(area, bar) {
  const show = () => bar.classList.add('show');
  const hide = () => bar.classList.remove('show');
  area.addEventListener('mouseenter', show);
  area.addEventListener('mouseleave', hide);
  bar.addEventListener('mouseenter', show);
  bar.addEventListener('mouseleave', hide);
}

function bindGlobalEvents() {
  els.searchInput.addEventListener('input', () => {
    const value = els.searchInput.value || '';
    state.search = value;
    if (value.trim() && state.sortMode === 'RANDOM') {
      state.sortMode = 'AZ';
      state.randomOrderMap = null;
      syncSortControls();
    }
    render();
  });
  els.searchClear.addEventListener('click', () => {
    state.search = '';
    els.searchInput.value = '';
    render();
  });
  els.sortToggle.addEventListener('click', () => {
    if (state.sortMode === 'RANDOM') {
      state.sortMode = 'AZ';
    } else {
      state.sortMode = state.sortMode === 'AZ' ? 'ZA' : 'AZ';
    }
    if (state.sortMode !== 'RANDOM') state.randomOrderMap = null;
    syncSortControls();
    render();
    persistState();
  });

  els.randomizeLibrary?.addEventListener('click', () => {
    shuffleLibraryExercises();
    syncSortControls();
    render();
    persistState();
  });

  els.unitToggle?.addEventListener('click', toggleWeightUnit);

  els.toggleBuilderFilter.addEventListener('click', () => {
    state.showWorkoutOnly = !state.showWorkoutOnly;
    updateBuilderFilterControl();
    render();
    persistState();
  });

  els.tabLibrary.addEventListener('click', () => switchTab('library'));
  els.tabBuilder.addEventListener('click', () => switchTab('builder'));

  els.exportWorkout.addEventListener('click', exportWorkout);
  els.printWorkout.addEventListener('click', printWorkout);
  els.shareWorkout.addEventListener('click', shareWorkout);
  els.shuffleBuilder?.addEventListener('click', () => {
    if (shuffleBuilderOrder()) render();
  });
  els.groupEquipment?.addEventListener('click', () => toggleGrouping('equipment'));
  els.groupMuscles?.addEventListener('click', () => toggleGrouping('muscles'));
  els.groupMuscleGroups?.addEventListener('click', () => toggleGrouping('muscleGroups'));
  els.clearWorkout.addEventListener('click', () => {
    state.builder.order = [];
    state.builder.items.clear();
    render();
    persistState();
  });
  els.includeCheckboxes.addEventListener('change', () => {
    state.includeCheckboxes = els.includeCheckboxes.checked;
    persistState();
  });

  if (els.builderList) {
    els.builderList.addEventListener('dragover', handleBuilderDragOver);
    els.builderList.addEventListener('drop', handleBuilderDrop);
    els.builderList.addEventListener('dragover', handleGroupDragOver);
    els.builderList.addEventListener('drop', handleGroupDrop);
  }

  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (evt) => {
    if (evt.target === els.modal) closeModal();
  });

  window.addEventListener('scroll', handleScrollButtons);
  els.scrollUp.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  els.scrollDown.addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));

  window.addEventListener('keydown', (evt) => {
    const activeTag = evt.target?.tagName?.toLowerCase();
    const typing = activeTag === 'input' || activeTag === 'textarea' || evt.isComposing;
    if (evt.key === '/' && !typing) {
      evt.preventDefault();
      els.searchInput.focus();
    } else if (evt.key === 'Escape') {
      if (state.search) {
        state.search = '';
        els.searchInput.value = '';
        render();
      }
    } else if ((evt.key === 's' || evt.key === 'S') && !typing) {
      evt.preventDefault();
      if (state.sortMode === 'RANDOM') {
        state.sortMode = 'AZ';
      } else {
        state.sortMode = state.sortMode === 'AZ' ? 'ZA' : 'AZ';
      }
      if (state.sortMode !== 'RANDOM') state.randomOrderMap = null;
      syncSortControls();
      render();
      persistState();
    } else if ((evt.key === 'b' || evt.key === 'B') && !typing) {
      evt.preventDefault();
      switchTab('builder');
    }
  });
}

function handleScrollButtons() {
  const scrollY = window.scrollY;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollY > 400) {
    els.scrollUp.classList.add('show');
  } else {
    els.scrollUp.classList.remove('show');
  }
  if (scrollY < maxY - 200) {
    els.scrollDown.classList.add('show');
  } else {
    els.scrollDown.classList.remove('show');
  }
}

const getDragAfterElement = (container, y) => {
  const elements = [...container.querySelectorAll('.builder-card:not(.dragging)')];
  return elements.reduce((closest, child) => {
    const rect = child.getBoundingClientRect();
    const offset = y - rect.top - rect.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
};

const getGroupAfterElement = (container, y) => {
  const elements = [...container.querySelectorAll('.builder-group:not(.dragging)')];
  return elements.reduce((closest, child) => {
    const rect = child.getBoundingClientRect();
    const offset = y - rect.top - rect.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
};

function attachGroupBodyEvents(body, type, groupKey) {
  if (!body) return;
  body.dataset.groupKey = groupKey;
  body.dataset.groupType = type;
  body.addEventListener('dragover', handleGroupedCardDragOver);
  body.addEventListener('drop', handleGroupedCardDrop);
}

function handleGroupedCardDragOver(evt) {
  const grouping = getActiveGrouping();
  if (!grouping) return;
  evt.preventDefault();
  evt.stopPropagation();
  const body = evt.currentTarget;
  if (body.dataset.groupType !== grouping) return;
  const dragging = body.querySelector('.builder-card.dragging');
  if (!dragging) return;
  const afterElement = getDragAfterElement(body, evt.clientY);
  if (!afterElement) {
    body.appendChild(dragging);
  } else if (afterElement !== dragging) {
    body.insertBefore(dragging, afterElement);
  }
}

function handleGroupedCardDrop(evt) {
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
  render();
  dragDidDrop = true;
}

function reorderGroupBlock(type, groupKey, newIds) {
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
}

function handleGroupDragOver(evt) {
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
}

function handleGroupDrop(evt) {
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
    render();
  } else {
    render();
  }
  dragDidDrop = true;
}

function handleBuilderDragOver(evt) {
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
}

function handleBuilderDrop(evt) {
  if (!els.builderList || getActiveGrouping()) return;
  evt.preventDefault();
  const dragging = els.builderList.querySelector('.builder-card.dragging');
  if (dragging) dragging.classList.remove('dragging');
  const order = Array.from(els.builderList.querySelectorAll('.builder-card')).map((node) => node.dataset.exerciseId).filter(Boolean);
  const changed = order.some((id, idx) => id !== state.builder.order[idx]);
  if (changed) {
    state.builder.order = order;
    persistState();
    render();
  } else {
    render();
  }
  dragDidDrop = true;
}

function toggleSelection(set, value, button) {
  if (set.has(value)) set.delete(value); else set.add(value);
  button?.classList.toggle('active', set.has(value));
}

function syncButtonStates() {
  for (const [value, btn] of state.buttons.muscles) btn.classList.toggle('active', state.filters.muscles.has(value));
  for (const [value, btn] of state.buttons.subMuscles) btn.classList.toggle('active', state.filters.subMuscles.has(value));
  for (const [value, btn] of state.buttons.equipment) btn.classList.toggle('active', state.filters.equipment.has(value));
}

function setMode(group, mode) {
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
  render();
}

function filterData() {
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
    const results = searchExercises(query, baseList);
    return results.map((entry) => entry.exercise);
  }

  const list = [...baseList];
  if (state.sortMode === 'RANDOM') {
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
}

function render() {
  const filtered = filterData();
  const displayList = state.showWorkoutOnly ? filtered.filter((ex) => state.builder.items.has(ex.id)) : filtered;

  renderGrid(displayList);
  renderBuilder();
  updateUnitToggle();

  const summaryParts = [];
  const muscleCount = state.filters.muscles.size;
  const subMuscleCount = state.filters.subMuscles.size;
  const equipmentCount = state.filters.equipment.size;
  if (muscleCount) summaryParts.push(`${state.filters.mode.muscles === 'AND' ? 'ALL of' : 'ANY of'} ${muscleCount} muscle${muscleCount > 1 ? 's' : ''}`);
  if (subMuscleCount) summaryParts.push(`${state.filters.mode.subMuscles === 'AND' ? 'ALL of' : 'ANY of'} ${subMuscleCount} target muscle${subMuscleCount > 1 ? 's' : ''}`);
  if (equipmentCount) summaryParts.push(`${state.filters.mode.equipment === 'AND' ? 'ALL of' : 'ANY of'} ${equipmentCount} equipment`);
  els.gridTitle.textContent = summaryParts.length ? `Exercises | ${summaryParts.join(' + ')}` : 'Exercises';

  const countText = state.showWorkoutOnly
    ? `${displayList.length} (workout only) shown of ${state.data.length}`
    : `${displayList.length} shown of ${state.data.length}`;
  els.count.textContent = countText;

  const desc = [];
  if (muscleCount) desc.push(`Muscle Groups: ${Array.from(state.filters.muscles).map(niceName).join(', ')}`);
  if (subMuscleCount) desc.push(`Muscles: ${Array.from(state.filters.subMuscles).map(niceName).join(', ')}`);
  if (equipmentCount) desc.push(`Equipment: ${Array.from(state.filters.equipment).map(niceName).join(', ')}`);
  els.activeFilters.textContent = desc.join(' | ');

  updateBuilderBadge();
  updateBuilderFilterControl();
  updateGroupingButtons();
  if (els.includeCheckboxes) els.includeCheckboxes.checked = state.includeCheckboxes;
  handleScrollButtons();
}

function renderGrid(exercises) {
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
      render();
    });

    actions.append(shareBtn, addBtn);

    body.append(title, tags, actions);
    card.append(media, body);
    els.grid.appendChild(card);
  });
}

function renderBuilder() {
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
}

function buildBuilderCard(entry, displayIndex, options = {}) {
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
    render();
  });

  controls.append(header, removeBtn);
  card.appendChild(controls);

  card.draggable = true;
  card.addEventListener('dragstart', (evt) => {
    dragDidDrop = false;
    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    if (!dragDidDrop) render();
    dragDidDrop = false;
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
    render();
    persistState();
  });

  card.append(table, addSetBtn);

  return { card, setCount };
}

function attachGroupDragEvents(groupEl, handle, type) {
  if (!groupEl || !handle) return;
  groupEl.dataset.groupType = type;
  handle.draggable = true;
  handle.addEventListener('dragstart', (evt) => {
    if (getActiveGrouping() !== type) {
      evt.preventDefault();
      return;
    }
    dragDidDrop = false;
    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', groupEl.dataset.groupKey || '');
    groupEl.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    groupEl.classList.remove('dragging');
    if (!dragDidDrop) render();
    dragDidDrop = false;
  });
}

function computeMuscleSummary() {
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
}

function renderMuscleSummary() {
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
  els.builderMuscles.textContent = `Muscles hit: ${summary.hitCount}/${summary.total} (${listText})`;
}

function renderSetRow(exerciseId, set, index) {
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
  weightInput.step = state.weightUnit === 'KG' ? '0.5' : '1';
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
    render();
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
    render();
    persistState();
  });
  actionsCell.appendChild(removeBtn);

  tr.append(setCell, modeCell, repsCell, weightCell, actionsCell);
  return tr;
}

function addExerciseToBuilder(exercise) {
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
}

function removeExerciseFromBuilder(id) {
  state.builder.items.delete(id);
  state.builder.order = state.builder.order.filter((val) => val !== id);
  persistState();
}

function updateBuilderBadge() {
  const count = state.builder.order.length;
  els.builderCount.textContent = count;
  const isBuilder = state.activeTab === 'builder';
  els.tabBuilder.classList.toggle('active', isBuilder);
  els.tabLibrary.classList.toggle('active', !isBuilder);
  els.builderPanel.classList.toggle('active', isBuilder);
  els.libraryPanel.classList.toggle('active', !isBuilder);
  document.body.classList.toggle('builder-active', isBuilder);
}

function switchTab(tab) {
  state.activeTab = tab;
  updateBuilderBadge();
  persistState();
}

function updateBuilderFilterControl() {
  const btn = els.toggleBuilderFilter;
  if (!btn) return;
  btn.textContent = state.showWorkoutOnly ? 'Show All Exercises' : 'Show Workout Only';
  btn.classList.toggle('toggle-active', state.showWorkoutOnly);
}

function updateGroupingButtons() {
  if (els.groupEquipment) {
    const active = state.groupByEquipment;
    els.groupEquipment.textContent = active ? 'Ungroup Equipment' : 'Group Equipment';
    els.groupEquipment.classList.toggle('toggle-active', active);
    els.groupEquipment.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (els.groupMuscles) {
    const active = state.groupByMuscles;
    els.groupMuscles.textContent = active ? 'Ungroup Muscles' : 'Group Muscles';
    els.groupMuscles.classList.toggle('toggle-active', active);
    els.groupMuscles.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (els.groupMuscleGroups) {
    const active = state.groupByMuscleGroups;
    els.groupMuscleGroups.textContent = active ? 'Ungroup Muscle Groups' : 'Group Muscle Groups';
    els.groupMuscleGroups.classList.toggle('toggle-active', active);
    els.groupMuscleGroups.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function toggleGrouping(type) {
  if (!type) return;
  const current = getActiveGrouping();
  if (!state.builder.order.length) {
    if (current === type) setActiveGrouping(null);
    else setActiveGrouping(type);
    updateGroupingButtons();
    render();
    persistState();
    return;
  }
  if (current === type) {
    setActiveGrouping(null);
  } else {
    setActiveGrouping(type);
  }
  const active = getActiveGrouping();
  if (active) applyGrouping(active);
  updateGroupingButtons();
  render();
  persistState();
}

function shareExercise(exercise, button) {
  const url = new URL(window.location.href);
  url.searchParams.set('exercise', exercise.id);
  const shareUrl = url.toString();
  copyToClipboard(shareUrl)
    .then(() => {
      button.innerHTML = SHARE_SUCCESS_HTML;
      button.dataset.label = 'Copied!';
      button.title = 'Copied!';
      button.setAttribute('aria-label', 'Copied!');
      setTimeout(() => {
        button.innerHTML = SHARE_ICON_HTML;
        button.dataset.label = 'Share';
        button.title = 'Share';
        button.setAttribute('aria-label', 'Share');
      }, 1500);
    })
    .catch(() => {
      button.innerHTML = SHARE_ERROR_HTML;
      button.dataset.label = 'Copy failed';
      button.title = 'Copy failed';
      button.setAttribute('aria-label', 'Copy failed');
      setTimeout(() => {
        button.innerHTML = SHARE_ICON_HTML;
        button.dataset.label = 'Share';
        button.title = 'Share';
        button.setAttribute('aria-label', 'Share');
      }, 1500);
    });

  state.highlightId = exercise.id;
  state.highlightHandled = false;
  document.querySelectorAll('.card.highlight').forEach((el) => {
    if (el.dataset.exerciseId !== exercise.id) el.classList.remove('highlight');
  });
  const card = button.closest('.card');
  if (card) card.classList.add('highlight');
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (err) {
      reject(err);
    }
    document.body.removeChild(textarea);
  });
}

// --- helper: URL-safe base64 for UTF-8 strings ---
function base64UrlEncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// If your copyToClipboard already exists and returns a Promise, keep it.
// Otherwise, this robust version will work:
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

async function shareWorkout() {
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
    // 1) Encode JSON safely for URLs
    const json = JSON.stringify(payload);
    const encoded = base64UrlEncodeUtf8(json);

    // 2) Build URL without clobbering existing params/fragments
    const url = new URL(window.location.href);
    url.searchParams.set('workout', encoded);

    // 3) Update address bar
    window.history.replaceState({}, '', url.toString());

    // 4) Copy (must be called from a user gesture on HTTPS or localhost)
    await copyToClipboard(url.toString());
    alert('Workout link copied to clipboard.');
  } catch (err) {
    console.warn('Failed to share workout', err);
    alert('Unable to generate share link.');
  }
}

function pickPreviewVideo(videos) {
  if (!Array.isArray(videos) || videos.length === 0) return null;
  const mp4 = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  return mp4 ? mp4.video : null;
}

function openExerciseModal(exercise) {
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
}

function closeModal() {
  els.modalVideo.pause();
  els.modalVideo.removeAttribute('src');
  els.modalVideo.load();
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
}

function pickBestVideo(videos) {
  if (!Array.isArray(videos)) return null;
  const mp4 = videos.find((v) => typeof v.video === 'string' && v.video.toLowerCase().endsWith('.mp4'));
  if (mp4) return { type: 'mp4', url: mp4.video };
  const first = videos.find((v) => typeof v.video === 'string');
  if (!first) return null;
  const url = first.video;
  if (url.toLowerCase().endsWith('.m3u8')) return { type: 'hls', url };
  return { type: 'unknown', url };
}

function supportsNativeHls(videoEl) {
  const can = videoEl?.canPlayType('application/vnd.apple.mpegurl');
  return can === 'probably' || can === 'maybe';
}

function syncSortControls() {
  if (!els.sortToggle) return;
  const mode = state.sortMode;
  const isAsc = mode === 'AZ';
  const isDesc = mode === 'ZA';
  els.sortToggle.textContent = isDesc ? 'Z-A' : 'A-Z';
  els.sortToggle.classList.toggle('asc', isAsc);
  els.sortToggle.classList.toggle('desc', isDesc);
  if (mode === 'RANDOM') {
    els.sortToggle.classList.remove('asc');
    els.sortToggle.classList.remove('desc');
  }
  if (els.randomizeLibrary) {
    const active = mode === 'RANDOM';
    els.randomizeLibrary.classList.toggle('toggle-active', active);
    els.randomizeLibrary.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function exportWorkout() {
  if (!state.builder.order.length) {
    alert('Add exercises to the workout before exporting.');
    return;
  }

  const weightLabel = getWeightLabel();
  const rows = [];
  const header = ['Exercise', 'Set', 'Mode', 'Reps', `Weight (${weightLabel})`];
  if (state.includeCheckboxes) header.push('Complete');
  rows.push(header);

  state.builder.order.forEach((id) => {
    const entry = state.builder.items.get(id);
    if (!entry) return;
    entry.sets.forEach((set, idx) => {
      const row = [
        entry.exercise.name,
        String(idx + 1),
        getModeLabel(set),
        set.reps || '',
        set.mode === 'ECHO' ? '' : (set.weight || '')
      ];
      if (state.includeCheckboxes) row.push('[ ]');
      rows.push(row);
    });
  });

  const workbook = createWorkbookXlsx(rows);
  const blob = new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `workout-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function printWorkout() {
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
}

function applyDeepLink() {
  if (!state.highlightId || state.highlightHandled) return;
  const target = document.getElementById(`exercise-${state.highlightId}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const exercise = state.data.find((ex) => ex.id === state.highlightId);
    if (exercise) openExerciseModal(exercise);
    state.highlightHandled = true;
  }
}

function updateUrlExercise(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('exercise', id);
  history.replaceState({}, '', url.toString());
}

init();















