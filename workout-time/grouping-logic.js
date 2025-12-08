// grouping-logic.js - Superset/group execution logic
// Handles round-based execution of grouped exercises with intelligent rest and navigation

const GroupingLogic = {
  /**
   * Extract groups from planItems and organize them with their exercises
   * Returns an array of groups, each containing exercises in order
   */
  analyzeGroups: function (planItems) {
    if (!Array.isArray(planItems)) return { groups: [], ungrouped: [] };

    const groupsMap = new Map(); // groupNumber -> { groupNumber, exercises: [] }
    const ungrouped = [];
    const seenGroupNumbers = new Set();

    for (let i = 0; i < planItems.length; i++) {
      const item = planItems[i];
      if (!item) continue;

      const groupNum = item.groupNumber;

      if (groupNum === null || groupNum === undefined) {
        // Ungrouped exercise
        ungrouped.push({ itemIndex: i, ...item });
      } else {
        // Grouped exercise
        if (!groupsMap.has(groupNum)) {
          groupsMap.set(groupNum, { groupNumber: groupNum, exercises: [] });
          seenGroupNumbers.add(groupNum);
        }
        groupsMap.get(groupNum).exercises.push({ itemIndex: i, ...item });
      }
    }

    // Maintain order of groups as they first appear
    const groups = Array.from(seenGroupNumbers).map((num) => groupsMap.get(num));

    return { groups, ungrouped };
  },

    /**
     * Find which group a plan item index belongs to (or null if ungrouped)
     */
    findGroupForItemIndex: function (planItems, itemIndex) {
      const { groups } = this.analyzeGroups(planItems);
      for (const group of groups) {
        if (group.exercises.some((ex) => ex.itemIndex === itemIndex)) {
          return group;
        }
      }
      return null;
    },

    /**
     * Track state for round-based execution within a group
     * Returns: { currentRound, setsRemaining: { itemIndex: count, ... }, lastExerciseInRound: itemIndex }
     */
    initializeGroupState: function (group) {
      const setsRemaining = {};
      for (const ex of group.exercises) {
        setsRemaining[ex.itemIndex] = Number(ex.sets) || 1;
      }
      return {
        currentRound: 1,
        setsRemaining,
        lastExerciseInRound: null,
      };
    },

    /**
     * Get exercises in a group that still have sets remaining
     */
    getExercisesWithSetsRemaining: function (group, groupState) {
      return group.exercises.filter(
        (ex) => groupState.setsRemaining[ex.itemIndex] > 0
      );
    },

    /**
     * After completing a set, determine if group is done and move to next round if needed
     * Returns { groupComplete: bool, nextExerciseInGroup: itemIndex | null, restSeconds: number | null }
     */
    determineNextInGroup: function (group, groupState, currentItemIndex) {
      if (!groupState) return { groupComplete: true, nextExerciseInGroup: null };

      // Mark this exercise's set as performed
      if (groupState.setsRemaining[currentItemIndex] !== undefined) {
        groupState.setsRemaining[currentItemIndex]--;
        groupState.lastExerciseInRound = currentItemIndex;
      }

      // Check if any exercises still have sets remaining
      const remaining = this.getExercisesWithSetsRemaining(group, groupState);

      if (remaining.length === 0) {
        // All exercises in group are done
        return { groupComplete: true, nextExerciseInGroup: null, restSeconds: null };
      }

      // Get the last exercise that performed a set in this round
      const lastEx = group.exercises.find((ex) => ex.itemIndex === groupState.lastExerciseInRound);
      const restSeconds = lastEx ? Number(lastEx.rest) || 0 : 0;

      // Find the next exercise in group order that has sets remaining
      const nextEx = remaining[0];
      if (nextEx) {
        return {
          groupComplete: false,
          nextExerciseInGroup: nextEx.itemIndex,
          restSeconds,
          advancingInRound: true,
        };
      }

      // This shouldn't happen, but fallback to group complete
      return { groupComplete: true, nextExerciseInGroup: null };
    },

    /**
     * When a round completes (all exercises with sets remaining have performed one set),
     * prepare to start the next round or advance to the next group
     */
    completeRound: function (group, groupState) {
      const remaining = this.getExercisesWithSetsRemaining(group, groupState);
      if (remaining.length === 0) {
        return {
          roundComplete: true,
          groupComplete: true,
          nextExerciseInGroup: null,
        };
      }

      // Start next round
      groupState.currentRound++;
      return {
        roundComplete: true,
        groupComplete: false,
        nextExerciseInGroup: remaining[0].itemIndex,
      };
    },

    /**
     * Build a timeline that respects grouping
     * Used to generate an execution plan at workout start
     */
    buildGroupedTimeline: function (planItems) {
      if (!Array.isArray(planItems)) return [];

      const { groups, ungrouped } = this.analyzeGroups(planItems);
      const timeline = [];

      // Process groups and ungrouped exercises in order
      let nextUngroupedIndex = 0;

      // Reconstruct order by iterating through original planItems and determining if each belongs to a group
      for (let i = 0; i < planItems.length; i++) {
        const item = planItems[i];
        if (!item) continue;

        if (item.groupNumber === null || item.groupNumber === undefined) {
          // Ungrouped exercise
          const sets = Number(item.sets) || 1;
          for (let s = 1; s <= sets; s++) {
            timeline.push({
              itemIndex: i,
              set: s,
              type: item.type,
              isGrouped: false,
            });
          }
        }
        // Grouped exercises are handled by group logic, not here
      }

      // Add groups in order
      for (const group of groups) {
        timeline.push({
          type: "group",
          groupNumber: group.groupNumber,
          exercises: group.exercises.map((ex) => ({
            itemIndex: ex.itemIndex,
            sets: Number(ex.sets) || 1,
          })),
        });
      }

      return timeline;
    },

    /**
     * Navigate within a group: get the next exercise or rest period
     * Direction: 1 for next, -1 for previous
     */
    navigateWithinGroup: function (group, groupState, currentItemIndex, direction = 1) {
      const currentExIndex = group.exercises.findIndex(
        (ex) => ex.itemIndex === currentItemIndex
      );
      if (currentExIndex === -1) return { targetItemIndex: null };

      const remaining = this.getExercisesWithSetsRemaining(group, groupState);
      if (remaining.length === 0) return { targetItemIndex: null };

      if (direction === 1) {
        // Next: find next exercise in group with sets remaining
        const nextEx = group.exercises
          .slice(currentExIndex + 1)
          .find((ex) => remaining.some((r) => r.itemIndex === ex.itemIndex));

        if (nextEx) {
          return { targetItemIndex: nextEx.itemIndex, isRest: false };
        }

        // No more exercises in this round: rest period
        const lastEx = group.exercises.find((ex) => ex.itemIndex === groupState.lastExerciseInRound);
        if (lastEx && lastEx.rest > 0) {
          return { isRest: true, restSeconds: lastEx.rest, after: currentItemIndex };
        }

        // After rest or if no rest: start next round or end group
        if (remaining.length > 0) {
          return { targetItemIndex: remaining[0].itemIndex, isRest: false, startingNewRound: true };
        }
      } else if (direction === -1) {
        // Previous: find previous exercise in group
        const prevEx = group.exercises
          .slice(0, currentExIndex)
          .reverse()
          .find((ex) => remaining.some((r) => r.itemIndex === ex.itemIndex));

        if (prevEx) {
          return { targetItemIndex: prevEx.itemIndex, isRest: false };
        }

        // No previous exercise: go to previous group/exercise in overall sequence
        return { targetItemIndex: null, groupBoundary: "start" };
      }

      return { targetItemIndex: null };
    },
};

// Export to global scope for browser and Node.js
if (typeof window !== "undefined") {
  window.GroupingLogic = GroupingLogic;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = GroupingLogic;
}

// ES module export
export default GroupingLogic;
