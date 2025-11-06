// Local plan storage utilities shared across the Exercise Library app.
// Encapsulates localStorage access, input normalization, and error handling
// so that the rest of the app can reason about plain JS data structures.

export const PLAN_INDEX_KEY = 'vitruvian.plans.index';
export const PLAN_STORAGE_PREFIX = 'vitruvian.plan.';

const getStorage = (override) => {
  if (override) return override;
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
};

export const normalizePlanName = (name) => (typeof name === 'string' ? name.trim() : '');

const sanitiseIndex = (names) =>
  Array.from(
    new Set(
      (Array.isArray(names) ? names : [])
        .map((entry) => normalizePlanName(entry))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

export const readLocalPlanIndex = (storage = getStorage()) => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PLAN_INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return sanitiseIndex(list);
  } catch (error) {
    console.warn('Failed to read plan index from local storage', error);
    return [];
  }
};

export const writeLocalPlanIndex = (names, storage = getStorage()) => {
  const target = getStorage(storage);
  const unique = sanitiseIndex(names);
  if (!target) return unique;
  try {
    target.setItem(PLAN_INDEX_KEY, JSON.stringify(unique));
  } catch (error) {
    console.warn('Failed to write plan index to local storage', error);
    throw new Error('Unable to update plan index in local storage.');
  }
  return unique;
};

const parsePlanItems = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to parse stored plan payload', error);
    return [];
  }
};

const readPlanPayload = (name, storage = getStorage()) => {
  const target = getStorage(storage);
  if (!target) return [];
  const trimmed = normalizePlanName(name);
  if (!trimmed) return [];
  const raw = target.getItem(`${PLAN_STORAGE_PREFIX}${trimmed}`);
  return parsePlanItems(raw);
};

export const persistPlanLocally = (name, items, storage = getStorage()) => {
  const target = getStorage(storage);
  const trimmed = normalizePlanName(name);
  if (!trimmed) {
    throw new Error('Enter a plan name before saving.');
  }
  if (!target) {
    throw new Error('Local storage is unavailable in this environment.');
  }
  try {
    target.setItem(`${PLAN_STORAGE_PREFIX}${trimmed}`, JSON.stringify(Array.isArray(items) ? items : []));
  } catch (error) {
    console.warn('Failed to store plan locally', error);
    throw new Error('Unable to store plan in local storage.');
  }
  const updated = writeLocalPlanIndex([...readLocalPlanIndex(target), trimmed], target);
  return { name: trimmed, index: updated };
};

export const removePlanLocally = (name, storage = getStorage()) => {
  const target = getStorage(storage);
  const trimmed = normalizePlanName(name);
  if (!trimmed || !target) return;
  try {
    target.removeItem(`${PLAN_STORAGE_PREFIX}${trimmed}`);
  } catch (error) {
    console.warn('Failed to remove local plan', error);
  }
  const filtered = readLocalPlanIndex(target).filter((entry) => entry !== trimmed);
  writeLocalPlanIndex(filtered, target);
};

export const loadLocalPlanEntries = (storage = getStorage()) => {
  const target = getStorage(storage);
  if (!target) return [];
  const entries = [];
  const seen = new Set();

  const addEntry = (name) => {
    const trimmed = normalizePlanName(name);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    const items = readPlanPayload(trimmed, target);
    entries.push({ name: trimmed, items });
  };

  readLocalPlanIndex(target).forEach(addEntry);

  for (let i = 0; i < target.length; i += 1) {
    const key = target.key(i);
    if (!key || !key.startsWith(PLAN_STORAGE_PREFIX)) continue;
    const planName = key.slice(PLAN_STORAGE_PREFIX.length);
    addEntry(planName);
  }

  return entries;
};
