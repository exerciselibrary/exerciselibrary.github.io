/**
 * SupersetExecutorV2 module for tests/imports
 * Exports the SupersetExecutorV2 class as an ES module.
 */

class SupersetExecutorV2 {
  constructor(planItems = []) {
    this.planItems = planItems;
    this.groups = this.buildGroups(planItems);
    this.groupState = new Map();
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
          groups.push({
            id: groupId,
            items: groupMap.get(groupId),
            isGroup: true,
          });
        }
        groupMap.get(groupId).push({ index, item });
      } else {
        groups.push({
          id: `standalone-${index}`,
          items: [{ index, item }],
          isGroup: false,
        });
      }
    });

    return groups;
  }

  hasGroups() {
    return this.groups.some((group) => group.isGroup);
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
      if (
        group.isGroup &&
        group.items.some((entry) => entry.index === itemIndex)
      ) {
        return group;
      }
    }
    return null;
  }

  getNextExercise(completedItemIndex) {
    const currentItem = this.planItems[completedItemIndex];
    if (!currentItem) return { action: "complete" };

    const group = this.findGroupForItem(completedItemIndex);
    if (!group) {
      return { action: "complete" };
    }

    const groupState = this.groupState.get(group.id);
    if (!groupState) {
      return { action: "complete" };
    }

    const currentRemaining = groupState.setsRemaining.get(completedItemIndex) || 0;
    if (currentRemaining > 0) {
      groupState.setsRemaining.set(completedItemIndex, currentRemaining - 1);
    }

    const currentPositionInGroup = group.items.findIndex(
      (entry) => entry.index === completedItemIndex,
    );

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
      return {
        itemIndex: nextExerciseIndex,
        action: "next-exercise",
      };
    }

    const anyRemaining = Array.from(groupState.setsRemaining.values()).some(
      (count) => count > 0,
    );

    if (!anyRemaining) {
      return { action: "complete" };
    }

    const firstExerciseIndex = group.items[0].index;
    const firstRemaining = groupState.setsRemaining.get(firstExerciseIndex) || 0;

    if (firstRemaining > 0) {
      return {
        itemIndex: firstExerciseIndex,
        action: "rest-then-continue",
        restAfter: completedItemIndex,
      };
    }

    for (const { index } of group.items) {
      const remaining = groupState.setsRemaining.get(index) || 0;
      if (remaining > 0) {
        return {
          itemIndex: index,
          action: "rest-then-continue",
          restAfter: completedItemIndex,
        };
      }
    }

    return { action: "complete" };
  }

  isGrouped(itemIndex) {
    return this.findGroupForItem(itemIndex) !== null;
  }

  getGroupedItems(groupId) {
    const group = this.groups.find((g) => g.id === groupId);
    return group ? group.items.map((entry) => entry.index) : [];
  }

  getRemainingSets(itemIndex) {
    for (const groupState of this.groupState.values()) {
      const remaining = groupState.setsRemaining.get(itemIndex);
      if (remaining !== undefined) {
        return remaining;
      }
    }
    return 0;
  }

  getState() {
    const state = {};
    for (const [groupId, groupState] of this.groupState.entries()) {
      state[groupId] = {
        items: Array.from(groupState.setsRemaining.entries()).map(
          ([index, remaining]) => ({
            itemIndex: index,
            remaining,
          }),
        ),
      };
    }
    return state;
  }
}

export { SupersetExecutorV2 };
