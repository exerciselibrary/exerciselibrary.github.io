import { toCsv } from './utils.js';

const KEY_PLAN = 'workoutTime:plan';
const KEY_HISTORY = 'workoutTime:history';

export const storage = {
  savePlan(plan) { localStorage.setItem(KEY_PLAN, JSON.stringify(plan)); },
  loadPlan() { try { return JSON.parse(localStorage.getItem(KEY_PLAN) || 'null'); } catch { return null; } },
  saveHistory(rows) { localStorage.setItem(KEY_HISTORY, JSON.stringify(rows)); },
  loadHistory() { try { return JSON.parse(localStorage.getItem(KEY_HISTORY) || '[]'); } catch { return []; } },
  exportCsv(rows) {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `workout-history-${new Date().toISOString().slice(0,10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
};

// Dropbox stubs (fill with Dropbox SDK if page already loads it)
export const dropbox = {
  isConnected: () => false,
  async connect() { alert('Dropbox: not connected (stub).'); },
  async exportAll(rows) { alert('Dropbox export stub.'); }
};
