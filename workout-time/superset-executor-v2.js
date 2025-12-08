/**
 * Superset/Group Execution Logic - Version 2
 *
 * Execution Model:
 * 1. When completing a set in a grouped exercise:
 *    - Check if there are more exercises in the group with remaining sets
 *    - If YES: Move to next grouped exercise (NO rest yet)
 *    - If NO: Rest, then return to first grouped exercise in group
 * 2. Skip exercises that have 0 remaining sets
 * 3. When all exercises exhausted, move to next item outside the group
 */

class SupersetExecutorV2 {
  constructor(planItems = []) {
    this.planItems = planItems;
    this.groups = this.buildGroups(planItems);
    this.groupState = new Map(); // Maps groupId -> { setsRemaining: Map<itemIndex -> count> }
    this.initializeAllGroupStates();
  }

  /**
   * Build group structure from plan items
   * Groups exercises by groupNumber, non-grouped items are singleton groups
   */
  buildGroups(planItems) {
    const groupMap = new Map();
    const groups = [];
    const itemsInOrder = [];

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

  /**
   * Check if executor has any groups
   */
  hasGroups() {
    return this.groups.some((group) => group.isGroup);
  }

  /**
   * Initialize state for all groups
   */
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

  /**
   * Find which group an item belongs to (if any)
   */
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

  /**
   * Get the next exercise to execute after completing a set
   *
   * Returns: {
   *   itemIndex: number | null,
   *   action: 'next-exercise' | 'rest' | 'complete',
   *   restAfter: number | null (which exercise to rest after)
   * }
   */
  getNextExercise(completedItemIndex) {
    const currentItem = this.planItems[completedItemIndex];
    if (!currentItem) return { action: "complete" };

    // Not in a group - this shouldn't happen through this method
    const group = this.findGroupForItem(completedItemIndex);
    if (!group) {
      return { action: "complete" };
    }

    const groupState = this.groupState.get(group.id);
    if (!groupState) {
      return { action: "complete" };
    }

    // Decrement sets remaining for this exercise
    const currentRemaining = groupState.setsRemaining.get(completedItemIndex) || 0;
    if (currentRemaining > 0) {
      groupState.setsRemaining.set(completedItemIndex, currentRemaining - 1);
    }

    // Find current position in group
    const currentPositionInGroup = group.items.findIndex(
      (entry) => entry.index === completedItemIndex,
    );

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
      // Found next exercise in group - execute without rest
      return {
        itemIndex: nextExerciseIndex,
        action: "next-exercise",
      };
    }

    // No more exercises in group - need to check if group is complete or needs rest
    const anyRemaining = Array.from(groupState.setsRemaining.values()).some(
      (count) => count > 0,
    );

    if (!anyRemaining) {
      // All exercises exhausted - group complete
      return { action: "complete" };
    }

    // Some exercises still have sets - rest then return to first exercise
    const firstExerciseIndex = group.items[0].index;
    const firstRemaining = groupState.setsRemaining.get(firstExerciseIndex) || 0;

    if (firstRemaining > 0) {
      return {
        itemIndex: firstExerciseIndex,
        action: "rest-then-continue",
        restAfter: completedItemIndex,
      };
    }

    // First exercise exhausted but others remain - skip and find next valid
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

    // Shouldn't reach here
    return { action: "complete" };
  }

  /**
   * Determine if an item is grouped
   */
  isGrouped(itemIndex) {
    return this.findGroupForItem(itemIndex) !== null;
  }

  /**
   * Get all grouped item indices for the given group
   */
  getGroupedItems(groupId) {
    const group = this.groups.find((g) => g.id === groupId);
    return group ? group.items.map((entry) => entry.index) : [];
  }

  /**
   * Get remaining sets for an item
   */
  getRemainingSets(itemIndex) {
    for (const groupState of this.groupState.values()) {
      const remaining = groupState.setsRemaining.get(itemIndex);
      if (remaining !== undefined) {
        return remaining;
      }
    }
    return 0;
  }

  /**
   * Get state info for display
   */
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

// Export for use in app.js
if (typeof window !== "undefined") {
  window.SupersetExecutorV2 = SupersetExecutorV2;
}

