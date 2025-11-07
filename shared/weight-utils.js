const LB_PER_KG = 2.2046226218488;
const KG_PER_LB = 1 / LB_PER_KG;

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

export { KG_PER_LB, LB_PER_KG };

const sharedApi = {
  KG_PER_LB,
  LB_PER_KG,
  convertKgToUnit,
  convertUnitToKg,
  formatWeightValue,
  normalizeUnit
};

if (typeof globalThis !== 'undefined') {
  globalThis.WeightUtils = {
    ...(globalThis.WeightUtils || {}),
    ...sharedApi
  };
}

export default sharedApi;
