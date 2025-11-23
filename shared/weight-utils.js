const LB_PER_KG = 2.2046226218488;
const KG_PER_LB = 1 / LB_PER_KG;

const UNIT_STORAGE_KEY = 'vitruvian.weightUnit';

const normalizeUnit = (unit) => {
  const normalized = String(unit || 'kg').trim().toLowerCase();
  return normalized === 'lb' || normalized === 'lbs' ? 'lb' : 'kg';
};

const isNumeric = (value) => {
  if (value === null || value === undefined) return false;
  const num = Number(value);
  return Number.isFinite(num);
};

export const convertKgToUnit = (kg, unit = 'kg') => {
  if (!isNumeric(kg)) return NaN;
  const normalized = normalizeUnit(unit);
  const numeric = Number(kg);
  return normalized === 'lb' ? numeric * LB_PER_KG : numeric;
};

export const convertUnitToKg = (value, unit = 'kg') => {
  if (!isNumeric(value)) return NaN;
  const normalized = normalizeUnit(unit);
  const numeric = Number(value);
  return normalized === 'lb' ? numeric * KG_PER_LB : numeric;
};

export const formatWeightValue = (kg, unit = 'kg', decimals = 1) => {
  if (!isNumeric(kg)) return '';
  const converted = convertKgToUnit(kg, unit);
  if (!isNumeric(converted)) return '';
  return Number(converted).toFixed(Math.max(0, decimals));
};

export const getStoredUnitPreference = () => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(UNIT_STORAGE_KEY);
    if (!raw) return null;
    return normalizeUnit(raw);
  } catch (error) {
    return null;
  }
};

export const setStoredUnitPreference = (unit) => {
  const normalized = normalizeUnit(unit);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(UNIT_STORAGE_KEY, normalized);
    }
  } catch (error) {
    // Ignore storage errors (e.g., Safari private mode).
  }
  return normalized;
};

export { KG_PER_LB, LB_PER_KG, normalizeUnit };

const sharedApi = {
  KG_PER_LB,
  LB_PER_KG,
  convertKgToUnit,
  convertUnitToKg,
  formatWeightValue,
  normalizeUnit,
  getStoredUnitPreference,
  setStoredUnitPreference
};

if (typeof globalThis !== 'undefined') {
  globalThis.WeightUtils = {
    ...(globalThis.WeightUtils || {}),
    ...sharedApi
  };
}

export default sharedApi;
