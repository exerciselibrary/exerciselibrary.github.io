import fs from 'fs';
import path from 'path';

const p = path.resolve(process.cwd(), 'plans.json');
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
const planName = 'super test';
const planItems = data.plans[planName];
if (!planItems) {
  console.error('Plan not found:', planName);
  process.exit(1);
}

// Reimplement minimal SupersetExecutorV2 logic
class SupersetExecutorV2 {
  constructor(planItems = []) {
    this.planItems = planItems;
    this.groups = this.buildGroups(planItems);
    this.groupState = new Map(); // groupId -> { setsRemaining: Map }
    this.initializeAllGroupStates();
  }

  buildGroups(planItems) {
    const groupMap = new Map();
    const groups = [];
    planItems.forEach((item, index) => {
      const groupId = item.groupNumber && String(item.groupNumber).trim();
      if (groupId) {
        if (!groupMap.has(groupId)) {
          groupMap.set(groupId, []);
          groups.push({ id: groupId, items: groupMap.get(groupId), isGroup: true });
        }
        groupMap.get(groupId).push({ index, item });
      } else {
        groups.push({ id: `standalone-${index}`, items: [{ index, item }], isGroup: false });
      }
    });
    return groups;
  }

  initializeAllGroupStates() {
    this.groups.forEach((group) => {
      if (group.isGroup) {
        const setsRemaining = new Map();
        group.items.forEach(({ index, item }) => {
          setsRemaining.set(index, Number(item.sets) || 1);
        });
        this.groupState.set(group.id, { setsRemaining });
      }
    });
  }

  findGroupForItem(itemIndex) {
    for (const group of this.groups) {
      if (group.isGroup && group.items.some((entry) => entry.index === itemIndex)) {
        return group;
      }
    }
    return null;
  }

  getNextExercise(completedItemIndex) {
    const currentItem = this.planItems[completedItemIndex];
    if (!currentItem) return { action: 'complete' };
    const group = this.findGroupForItem(completedItemIndex);
    if (!group) return { action: 'complete' };
    const groupState = this.groupState.get(group.id);
    if (!groupState) return { action: 'complete' };

    // Decrement sets remaining for this exercise
    const currentRemaining = groupState.setsRemaining.get(completedItemIndex) || 0;
    if (currentRemaining > 0) {
      groupState.setsRemaining.set(completedItemIndex, currentRemaining - 1);
    }

    const currentPositionInGroup = group.items.findIndex((entry) => entry.index === completedItemIndex);

    // Find next exercise in group that has remaining sets
    let nextExerciseIndex = null;
    for (let i = currentPositionInGroup + 1; i < group.items.length; i++) {
      const itemIndex = group.items[i].index;
      const setsRemaining = groupState.setsRemaining.get(itemIndex) || 0;
      if (setsRemaining > 0) {
        nextExerciseIndex = itemIndex;
        break;
      }
    }

    if (nextExerciseIndex !== null) {
      return { itemIndex: nextExerciseIndex, action: 'next-exercise' };
    }

    const anyRemaining = Array.from(groupState.setsRemaining.values()).some((count) => count > 0);
    if (!anyRemaining) {
      return { action: 'complete' };
    }

    const firstExerciseIndex = group.items[0].index;
    const firstRemaining = groupState.setsRemaining.get(firstExerciseIndex) || 0;
    if (firstRemaining > 0) {
      return { itemIndex: firstExerciseIndex, action: 'rest-then-continue', restAfter: completedItemIndex };
    }

    for (const { index } of group.items) {
      const remaining = groupState.setsRemaining.get(index) || 0;
      if (remaining > 0) {
        return { itemIndex: index, action: 'rest-then-continue', restAfter: completedItemIndex };
      }
    }
    return { action: 'complete' };
  }

  getRemainingSets(itemIndex) {
    for (const groupState of this.groupState.values()) {
      const remaining = groupState.setsRemaining.get(itemIndex);
      if (remaining !== undefined) return remaining;
    }
    return 0;
  }

  getState() {
    const state = {};
    for (const [groupId, groupState] of this.groupState.entries()) {
      state[groupId] = Array.from(groupState.setsRemaining.entries());
    }
    return state;
  }
}

// buildPlanTimeline (same logic used by app)
function buildPlanTimeline(items = []) {
  const timeline = [];
  items.forEach((item, itemIndex) => {
    if (!item) return;
    const sets = Math.max(1, Number(item.sets) || 1);
    const restSec = Math.max(0, Number(item.restSec) || 0);
    const perCableKg = Number(item.perCableKg) || 0;
    const intensity = (item.intensity || 'none').toLowerCase();
    for (let set = 1; set <= sets; set += 1) {
      const isLastSet = set === sets;
      if (!isLastSet || intensity === 'none') {
        timeline.push({ itemIndex, set });
        continue;
      }
      // For simplicity, handle intensity as no micros
      timeline.push({ itemIndex, set });
    }
  });
  return timeline;
}

const timeline = buildPlanTimeline(planItems);
console.log('Timeline length:', timeline.length);
console.log(timeline.map((t, i) => `${i}: item ${t.itemIndex} set ${t.set} (${planItems[t.itemIndex].name})`).join('\n'));

const exec = new SupersetExecutorV2(planItems);
console.log('Initial superset state:', exec.getState());

let timelineIndex = 0;
const events = [];

function findTimelineIndexFor(itemIndex, setNumber) {
  return timeline.findIndex((e) => e.itemIndex === itemIndex && Number(e.set) === Number(setNumber));
}

while (timelineIndex < timeline.length) {
  const entry = timeline[timelineIndex];
  const item = planItems[entry.itemIndex];
  const label = item.name || item.type || String(entry.itemIndex);
  events.push(`RUN timelineIndex=${timelineIndex} -> ${label} set ${entry.set}`);

  // Simulate completing the set for this item
  const completedItemIndex = entry.itemIndex;
  const nextStep = exec.getNextExercise(completedItemIndex);
  events.push(`  executor -> ${JSON.stringify(nextStep)} state=${JSON.stringify(exec.getState())}`);

  if (nextStep.action === 'next-exercise') {
    // Jump timelineIndex to the matching item/set
    const remaining = exec.getRemainingSets(nextStep.itemIndex);
    const totalSets = Math.max(1, Number(planItems[nextStep.itemIndex].sets) || 1);
    const setToRun = Math.max(1, totalSets - remaining + 1);
    const ti = findTimelineIndexFor(nextStep.itemIndex, setToRun);
    if (ti !== -1) {
      timelineIndex = ti;
      events.push(`  jump to timelineIndex=${timelineIndex} (${planItems[nextStep.itemIndex].name} set ${setToRun})`);
      continue;
    } else {
      // no matching, advance
      timelineIndex += 1;
      continue;
    }
  }

  if (nextStep.action === 'rest-then-continue') {
    // simulate rest, then jump to first appropriate
    const remaining = exec.getRemainingSets(nextStep.itemIndex);
    const totalSets = Math.max(1, Number(planItems[nextStep.itemIndex].sets) || 1);
    const setToRun = Math.max(1, totalSets - remaining + 1);
    const ti = findTimelineIndexFor(nextStep.itemIndex, setToRun);
    if (ti !== -1) {
      events.push(`  rest then jump to timelineIndex=${ti} (${planItems[nextStep.itemIndex].name} set ${setToRun})`);
      timelineIndex = ti;
      continue;
    } else {
      timelineIndex += 1;
      continue;
    }
  }

  if (nextStep.action === 'complete') {
    // group complete, fall back to normal timeline advance
    timelineIndex += 1;
    continue;
  }

  // default advance
  timelineIndex += 1;
}

console.log('\nSimulation events:\n' + events.join('\n'));
