import { EQUIPMENT_COLORS, GROUPING_LABELS } from './constants.js';
import { state, groupColorMap } from './context.js';
import { buildEquipmentKey, buildAttributeKey, formatListLabel, niceName, shuffleArray } from './utils.js';

export const getGroupColor = (type, key) => {
  const cacheKey = `${type}:${key}`;
  if (!groupColorMap.has(cacheKey)) {
    const index = groupColorMap.size % EQUIPMENT_COLORS.length;
    groupColorMap.set(cacheKey, EQUIPMENT_COLORS[index]);
  }
  return groupColorMap.get(cacheKey) || '#7aa2f7';
};

export const getGroupingKey = (exercise, type) => {
  if (type === 'equipment') return buildEquipmentKey(exercise);
  if (type === 'muscles') return buildAttributeKey(exercise?.muscles);
  if (type === 'muscleGroups') return buildAttributeKey(exercise?.muscleGroups);
  return '__none__';
};

export const formatGroupingLabel = (exercise, type) => {
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

export const getActiveGrouping = () => {
  if (state.groupByEquipment) return 'equipment';
  if (state.groupByMuscles) return 'muscles';
  if (state.groupByMuscleGroups) return 'muscleGroups';
  return null;
};

export const setActiveGrouping = (type) => {
  state.groupByEquipment = type === 'equipment';
  state.groupByMuscles = type === 'muscles';
  state.groupByMuscleGroups = type === 'muscleGroups';
};

export const getGroupingClusters = (order, items, type) => {
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

export const applyGrouping = (type) => {
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

export const shuffleBuilderOrder = () => {
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
  return true;
};

export { GROUPING_LABELS };
