/**
 * Superset/Group Execution Logic
 * Manages round-based execution for grouped exercises
 *
 * Execution Model:
 * - Each group is executed in rounds
 * - In each round, perform one set of each exercise in the group (in order)
 * - Rest logic: only one rest period per round from the last exercise performed
 * - Completion: when all exercises in the group have completed all sets
 */

class SupersetExecutor {
  constructor(planItems = []) {
    this.planItems = planItems;
    this.groups = this.buildGroups(planItems);
    this.currentGroupIndex = 0;
    this.roundState = new Map(); // Maps groupId -> { currentRound, setsRemaining: Map<itemIndex -> count> }
    this.restPeriod = null; // Current rest period info: { itemIndex, duration, startTime, endTime }
  }

  /**
   * Build group structure from plan items
   * Groups exercises by groupNumber, non-grouped items are singleton groups
   */
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

  /**
   * Check if this executor has any groups (vs. all standalone items)
   * Returns true if any items are explicitly grouped
   */
  hasGroups() {
    return this.groups.some((group) => group.isGroup);
  }

  /**
   * Initialize round state for a group
   */
  initializeGroupRounds(groupIndex) {
    const group = this.groups[groupIndex];
    if (!group) return null;

    const setsRemaining = new Map();
    group.items.forEach(({ index, item }) => {
      setsRemaining.set(index, Number(item.sets) || 1);
    });

    const roundState = {
      currentRound: 1,
      setsRemaining,
      exercisesInRound: [], // Will be populated dynamically
      lastExerciseIndex: null,
    };

    this.roundState.set(group.id, roundState);
    return roundState;
  }

  /**
   * Get exercises to perform in current round
   * Returns array of item indices that still have sets remaining
   */
  getExercisesForRound(groupIndex) {
    const group = this.groups[groupIndex];
    if (!group) return [];

    let roundState = this.roundState.get(group.id);
    if (!roundState) {
      roundState = this.initializeGroupRounds(groupIndex);
    }

    const exercises = [];
    group.items.forEach(({ index, item }) => {
      const remaining = roundState.setsRemaining.get(index);
      if (remaining && remaining > 0) {
        exercises.push(index);
      }
    });

    roundState.exercisesInRound = exercises;
    return exercises;
  }

  /**
   * Move to next exercise in current round, or start rest if round complete
   * Returns { type: 'exercise', itemIndex } or { type: 'rest', itemIndex, duration }
   */
  getNextInRound(groupIndex) {
    const group = this.groups[groupIndex];
    if (!group) return null;

    const roundState = this.roundState.get(group.id);
    if (!roundState) return null;

    const exercisesInRound = this.getExercisesForRound(groupIndex);

    if (exercisesInRound.length === 0) {
      // Group complete
      return { type: 'group-complete', groupIndex };
    }

    // Find if we're currently in rest or an exercise
    if (this.restPeriod) {
      // Rest is active, next should be first exercise of next round
      this.restPeriod = null;
      roundState.currentRound += 1;
      return this.getNextInRound(groupIndex); // Recurse to get first exercise of next round
    }

    // Return first exercise in round
    if (exercisesInRound.length > 0) {
      return { type: 'exercise', itemIndex: exercisesInRound[0] };
    }

    return null;
  }

  /**
   * Complete one set for an exercise and determine what's next
   * Returns: { type: 'exercise', itemIndex } | { type: 'rest', duration } | { type: 'group-complete' } | { type: 'next-group' }
   */
  completeSet(groupIndex, itemIndex) {
    const group = this.groups[groupIndex];
    if (!group) return { type: 'error', message: 'Invalid group' };

    const roundState = this.roundState.get(group.id);
    if (!roundState) return { type: 'error', message: 'Round state not initialized' };

    // Decrement remaining sets for this exercise
    const remaining = roundState.setsRemaining.get(itemIndex) || 0;
    roundState.setsRemaining.set(itemIndex, Math.max(0, remaining - 1));

    // Find which exercise this is in the group
    let exercisePosition = -1;
    group.items.forEach(({ index }, position) => {
      if (index === itemIndex) exercisePosition = position;
    });

    roundState.lastExerciseIndex = itemIndex;

    // Get remaining exercises in this round
    const exercisesRemaining = this.getExercisesForRound(groupIndex);

    // Check if this was the last exercise in the round
    const isLastInRound = exercisePosition === group.items.length - 1 ||
                          (exercisePosition < group.items.length - 1 &&
                           !exercisesRemaining.includes(group.items[exercisePosition + 1].index));

    if (!isLastInRound && exercisesRemaining.length > 0) {
      // More exercises in this round, go to next one
      const nextExercise = exercisesRemaining.find((idx) => {
        const pos = group.items.findIndex(({ index }) => index === idx);
        return pos > exercisePosition;
      });

      if (nextExercise !== undefined) {
        return { type: 'exercise', itemIndex: nextExercise };
      }
    }

    // Check if group is complete
    if (exercisesRemaining.length === 0) {
      // All exercises finished all sets
      return { type: 'group-complete', groupIndex };
    }

    // Apply rest from the last exercise in this round
    const lastItem = this.planItems[itemIndex];
    const restDuration = this.parseRestSeconds(lastItem.restSec);

    this.restPeriod = {
      itemIndex,
      duration: restDuration,
      startTime: null,
      endTime: null,
    };

    return { type: 'rest', itemIndex, duration: restDuration };
  }

  /**
   * Get next item after completing rest
   */
  completeRest(groupIndex) {
    const group = this.groups[groupIndex];
    if (!group) return null;

    this.restPeriod = null;

    // Get exercises for next round
    const exercisesForRound = this.getExercisesForRound(groupIndex);

    if (exercisesForRound.length === 0) {
      return { type: 'group-complete', groupIndex };
    }

    // Start next round with first exercise
    return { type: 'exercise', itemIndex: exercisesForRound[0] };
  }

  /**
   * Navigate to next logical item (respects group sequencing)
   */
  navigateNext(currentGroupIndex, currentItemIndex, currentPhase = 'exercise') {
    const group = this.groups[currentGroupIndex];
    if (!group) return null;

    if (currentPhase === 'rest') {
      // Complete the rest and get next
      return this.completeRest(currentGroupIndex);
    }

    // In exercise, get next in round
    const exercisesInRound = this.getExercisesForRound(currentGroupIndex);
    const currentPos = group.items.findIndex(({ index }) => index === currentItemIndex);

    // Find next exercise in round after current position
    for (let i = currentPos + 1; i < group.items.length; i++) {
      const itemIndex = group.items[i].index;
      if (exercisesInRound.includes(itemIndex)) {
        return { type: 'exercise', groupIndex: currentGroupIndex, itemIndex };
      }
    }

    // No more in this round, go to rest
    const lastItem = this.planItems[currentItemIndex];
    const restDuration = this.parseRestSeconds(lastItem.restSec);

    this.restPeriod = {
      itemIndex: currentItemIndex,
      duration: restDuration,
      startTime: null,
      endTime: null,
    };

    return { type: 'rest', groupIndex: currentGroupIndex, itemIndex: currentItemIndex, duration: restDuration };
  }

  /**
   * Navigate to previous logical item (respects group sequencing)
   */
  navigatePrevious(currentGroupIndex, currentItemIndex, currentPhase = 'exercise') {
    const group = this.groups[currentGroupIndex];
    if (!group) return null;

    if (currentPhase === 'rest') {
      // From rest, go back to last exercise
      this.restPeriod = null;
      return { type: 'exercise', groupIndex: currentGroupIndex, itemIndex: this.restPeriod?.itemIndex };
    }

    // In exercise, go to previous exercise in round or to rest if at first
    const exercisesInRound = this.getExercisesForRound(currentGroupIndex);
    const currentPos = group.items.findIndex(({ index }) => index === currentItemIndex);

    // Find previous exercise in round before current position
    for (let i = currentPos - 1; i >= 0; i--) {
      const itemIndex = group.items[i].index;
      if (exercisesInRound.includes(itemIndex)) {
        return { type: 'exercise', groupIndex: currentGroupIndex, itemIndex };
      }
    }

    // At first exercise, check if there's a rest from previous round
    if (this.restPeriod) {
      return { type: 'rest', groupIndex: currentGroupIndex, itemIndex: this.restPeriod.itemIndex, duration: this.restPeriod.duration };
    }

    return null;
  }

  /**
   * Parse rest seconds from item
   */
  parseRestSeconds(restSec) {
    const value = Number(restSec);
    return Number.isFinite(value) ? Math.max(0, value) : 60;
  }

  /**
   * Get group info for display
   */
  getGroupInfo(groupIndex) {
    const group = this.groups[groupIndex];
    if (!group) return null;

    const roundState = this.roundState.get(group.id);

    return {
      groupId: group.id,
      isGroup: group.isGroup,
      exerciseCount: group.items.length,
      currentRound: roundState?.currentRound || 1,
      itemsWithSets: group.items.map(({ index, item }) => ({
        itemIndex: index,
        name: item.name,
        totalSets: Number(item.sets) || 1,
        remaining: roundState?.setsRemaining.get(index) || Number(item.sets) || 1,
      })),
    };
  }

  /**
   * Get current state for navigation
   */
  getState() {
    return {
      totalGroups: this.groups.length,
      currentGroupIndex: this.currentGroupIndex,
      groups: this.groups.map((group, idx) => this.getGroupInfo(idx)),
      restPeriod: this.restPeriod,
    };
  }
}

// Export for use in app.js
if (typeof window !== 'undefined') {
  window.SupersetExecutor = SupersetExecutor;
}
