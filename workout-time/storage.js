const SETTINGS_KEY = 'workout-time:settings';
const HISTORY_KEY = 'workout-time:history';
const PLANS_KEY = 'workout-time:plans';

export function loadSettings() {
  return readJson(SETTINGS_KEY, { unit: 'kg', stopAtTop: true });
}

export function saveSettings(settings) {
  writeJson(SETTINGS_KEY, settings);
}

export function loadHistory() {
  return readJson(HISTORY_KEY, []);
}

export function appendHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  writeJson(HISTORY_KEY, history);
  return history;
}

export function loadPlans() {
  return readJson(PLANS_KEY, []);
}

export function savePlans(plans) {
  writeJson(PLANS_KEY, plans);
}

export async function exportToDropbox(data) {
  console.info('Dropbox export placeholder', data);
}

export async function importFromDropbox() {
  console.info('Dropbox import placeholder');
  return [];
}

function readJson(key, fallback) {
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to read storage key', key, error);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    const storage = window.localStorage;
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Failed to write storage key', key, error);
  }
}
