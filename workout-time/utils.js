export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const trySelect = (candidates, root = document) =>
  candidates.map(s => $(s, root)).find(Boolean) || null;

// Units: keep KG internally
export const LB_PER_KG = 2.20462262185;
export const kgToLb = (kg) => kg * LB_PER_KG;
export const lbToKg = (lb) => lb / LB_PER_KG;

// CSV helper
export function toCsv(rows, headers) {
  const h = headers ?? Object.keys(rows[0] ?? {});
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [h.join(','), ...rows.map(r => h.map(k => esc(r[k])).join(','))].join('\n');
}
