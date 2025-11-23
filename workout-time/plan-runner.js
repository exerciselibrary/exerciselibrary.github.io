// plan-runner.js - Plan management mixin for VitruvianApp
// Extracted to keep workout-time/app.js more focused on core UI wiring.
(function (global) {
  const PlanRunnerPrototype = {
    startPlan: function startPlan() {
      if (!this.device || !this.device.isConnected) {
        this.addLogEntry("⚠️ Please connect your Vitruvian device before starting a plan.", "error");
        alert("Please connect your Vitruvian device before starting a plan.");
        return;
      }

      if (this.planActive) {
        this.addLogEntry("Previous workout plan stopped.", "info");
        this._planFinish({ silent: true });
      }

      if (!Array.isArray(this.planItems) || this.planItems.length === 0) {
        this.addLogEntry("No items in plan.", "warning");
        return;
      }

      const timeline = this.buildPlanTimeline(this.planItems);
      if (!timeline.length) {
        this.addLogEntry("Plan contains no sets to run.", "warning");
        return;
      }

      this.initializePlanSummary?.();

      this.planActive = true;
      this.planTimeline = timeline;
      this.planTimelineIndex = 0;
      this._activePlanEntry = null;
      this._planSetInProgress = false;
      this._queuedPlanRun = null;
      this._planNavigationTargetIndex = null;
      this.planPaused = false;
      this.planPauseStartedAt = null;
      this.planPausedDurationMs = 0;
      this.planPauseActivityStart = null;
      this.planPauseLastSample = null;
      this.planStartTime = Date.now();
      this.planCursor = { index: timeline[0].itemIndex, set: timeline[0].set };
      this.planOnWorkoutComplete = (completion = {}) =>
        this._planAdvance(completion);

      this._clearRestState({ signalDone: false });
      this.stopPlanElapsedTicker();
      this.startPlanElapsedTicker();
      this.updatePlanControlsState();

      this.updatePlanSetIndicator?.();
      this.updateCurrentSetLabel?.();

      const firstItem = this.planItems[this.planCursor.index];
      if (firstItem) {
        this._planStopAtTopBase = this.stopAtTop;
        this._applyItemToUI(firstItem);
      }

      this.addLogEntry(
        `Starting plan with ${timeline.length} set${timeline.length === 1 ? "" : "s"}.`,
        "success",
      );

      this._runCurrentPlanBlock();
    },

    _runCurrentPlanBlock: async function _runCurrentPlanBlock() {
      if (!this.planActive) {
        return;
      }

      if (!Array.isArray(this.planTimeline) || this.planTimelineIndex >= this.planTimeline.length) {
        this._planFinish();
        return;
      }

      const entry = this.planTimeline[this.planTimelineIndex];
      const item = entry ? this.planItems[entry.itemIndex] : null;

      // Per-entry overrides (intensity microsets)
      const viewItem = entry && item && entry.overrides ? { ...item, ...entry.overrides } : item;

      if (!entry || !item) {
        this.addLogEntry("Plan item missing — skipping.", "error");
        this.planTimelineIndex += 1;
        this.updatePlanControlsState();
        this._runCurrentPlanBlock();
        return;
      }

      this.planCursor = { index: entry.itemIndex, set: entry.set };
      this._applyItemToUI?.(viewItem);
      this.updatePlanControlsState();

      const totalSets = Math.max(1, Number(item.sets) || 1);
      const label = item.type === "exercise" ? "exercise" : "echo";
      this.addLogEntry(
        `Set ${this.planTimelineIndex + 1}/${this.planTimeline.length}: ${
          item.name || `Untitled ${label}`
        } • set ${entry.set}/${totalSets}`,
        "info",
      );

      this._activePlanEntry = {
        itemIndex: entry.itemIndex,
        set: entry.set,
        totalSets,
        restSec: Math.max(0, Number(entry?.restSecOverride ?? item.restSec) || 0),
        type: item.type || "exercise",
        name: item.name || ""
      };
      this._planSetInProgress = true;

      this.updatePlanSetIndicator?.();
      this.updateCurrentSetLabel?.();
      this.ensureFullscreenPreference?.();

      try {
        const prevStopAtTop = this.stopAtTop;
        this.stopAtTop = !!item.stopAtTop;

        if (item.type === "exercise") {
          await this.startProgram();
        } else {
          await this.startEcho();
        }

        this.stopAtTop = prevStopAtTop;
      } catch (error) {
        this.addLogEntry(`Failed to start plan block: ${error.message}`, "error");
        this._planSetInProgress = false;
        this._activePlanEntry = null;
        this._planFinish();
      }
    },

    _planAdvance: function _planAdvance(completion = {}) {
      if (!this.planActive) {
        return;
      }

      this._planSetInProgress = false;

      const { reason = null, completedEntry = null } = completion || {};

      if (this._planNavigationTargetIndex !== null && this._planNavigationTargetIndex !== undefined) {
        this._applyPlanNavigationTarget();
        return;
      }

      this.planTimelineIndex += 1;

      if (!Array.isArray(this.planTimeline) || this.planTimelineIndex >= this.planTimeline.length) {
        this._planFinish();
        return;
      }

      const upcomingEntry = this.planTimeline[this.planTimelineIndex];
      const upcomingItem = upcomingEntry ? this.planItems[upcomingEntry.itemIndex] : null;
      const viewUpcoming =
        upcomingEntry && upcomingItem && upcomingEntry.overrides
          ? { ...upcomingItem, ...upcomingEntry.overrides }
          : upcomingItem;

      if (upcomingEntry && viewUpcoming) {
        this.planCursor = { index: upcomingEntry.itemIndex, set: upcomingEntry.set };
        this._applyItemToUI?.(viewUpcoming);
      }

      this.updatePlanSetIndicator?.();
      this.updateCurrentSetLabel?.();

      const lastEntry =
        completedEntry && Number.isFinite(completedEntry.restSec)
          ? completedEntry
          : this._activePlanEntry && Number.isFinite(this._activePlanEntry.restSec)
            ? this._activePlanEntry
            : null;

      const restSource =
        lastEntry && Number.isFinite(lastEntry.restSec)
          ? lastEntry
          : upcomingItem && Number.isFinite(upcomingItem.restSec)
            ? { restSec: upcomingItem.restSec, name: upcomingItem.name, type: upcomingItem.type }
            : null;

      const restSec = Math.max(0, Number(restSource?.restSec) || 0);
      const nextLabel =
        viewUpcoming?.name || (viewUpcoming?.type === "exercise" ? "Exercise" : "Echo Mode");
      const nextSummary = viewUpcoming ? this.describePlanItem(viewUpcoming) : "";

      this.ensureFullscreenPreference?.();

      if (reason === "echo-auto-stop" && upcomingItem) {
        const queueMessage =
          restSec > 0
            ? `Echo Just Lift auto-stop complete → resting ${restSec}s before ${nextLabel}`
            : `Echo Just Lift auto-stop complete → starting ${nextLabel}`;
        this.addLogEntry(queueMessage, "info");
      }

      const runNext = () => {
        if (this.planPaused) {
          this._queuedPlanRun = () => this._runCurrentPlanBlock();
        } else {
          this._runCurrentPlanBlock();
        }
      };

      if (restSec > 0 && upcomingItem) {
        this.addLogEntry(`Rest ${restSec}s → next: ${nextLabel}`, "info");
        this._beginRest(restSec, runNext, `Next: ${nextLabel}`, nextSummary, upcomingItem);
      } else {
        runNext();
      }

      this._activePlanEntry = null;
      this.updatePlanControlsState();
    },

    _beginRest: function _beginRest(totalSec, onDone, labelText = "Next set", nextHtml = "", nextItemOrName = null) {
      const circle = document.getElementById("weightAdjusterCircle");
      const progress = document.getElementById("restCountdownProgress");
      const timeText = document.getElementById("restCountdownTime");
      const labelEl = document.getElementById("restCountdownLabel");
      const hintEl = document.getElementById("restCountdownHint");
      const restButton = document.getElementById("restCountdownButton");
      const controlRow = document.getElementById("planControlRow");
      const summaryEl = document.getElementById("restCountdownSummary");
      const inlineHud = document.getElementById("planRestInline");

      const finishLater = () => {
        if (typeof onDone !== "function") {
          return;
        }
        if (this.planPaused) {
          this._queuedPlanRun = onDone;
        } else {
          onDone();
        }
      };

      if (!circle || !progress || !timeText || !restButton) {
        const ms = Math.max(0, (totalSec | 0) * 1000);
        this.addLogEntry(`(No rest countdown available) Rest ${totalSec}s…`, "info");
        window.setTimeout(() => finishLater(), ms);
        return;
      }

      this._clearRestState({ signalDone: false });

      const restTotal = Math.max(0, Number(totalSec) || 0);
      const nextName =
        typeof nextItemOrName === "string"
          ? nextItemOrName
          : nextItemOrName?.name || "";

      const adjustButtons = [
        document.getElementById("weightAdjusterIncrease"),
        document.getElementById("weightAdjusterDecrease"),
      ].filter(Boolean);

      const disabledButtons = adjustButtons.map((btn) => ({
        el: btn,
        disabled: btn.disabled,
        tabIndex: btn.getAttribute("tabindex"),
        ariaHidden: btn.getAttribute("aria-hidden"),
      }));

      disabledButtons.forEach(({ el }) => {
        el.disabled = true;
        el.setAttribute("aria-hidden", "true");
        el.setAttribute("tabindex", "-1");
      });

      const state = {
        totalSec: restTotal,
        remainingSec: restTotal,
        onDone,
        labelText,
        nextHtml: nextHtml || "",
        nextName,
        circle,
        progress,
        timeText,
        labelEl,
        hintEl,
        restButton,
        controlRow,
        summaryEl,
        inlineHud,
        timerId: null,
        targetTimestamp: null,
        lastAnnounce: null,
        addHandler: null,
        circleAddHandler: null,
        previousAriaLabel: restButton.getAttribute("aria-label"),
        disabledButtons,
      };

      this._restState = state;
      this._cancelRest = () => {
        this._clearRestState({ signalDone: false });
      };

      this.onPlanRestStateChange?.();

      circle.classList.add("rest-active");
      circle.classList.remove("rest-paused");
      if (controlRow) {
        controlRow.classList.add("resting");
      }
      restButton.disabled = false;
      restButton.tabIndex = 0;

      const addTime = (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        state.totalSec += 30;
        state.remainingSec += 30;
        if (state.targetTimestamp) {
          state.targetTimestamp += 30_000;
        }
        this.addLogEntry("+30s added to rest", "info");
        this._updateRestUI(state, { force: true });
      };

      restButton.addEventListener("click", addTime);
      state.addHandler = addTime;

      const handleCircleClick = (event) => {
        if (event?.target === restButton) {
          return;
        }
        addTime(event);
      };
      circle.addEventListener("click", handleCircleClick);
      state.circleAddHandler = handleCircleClick;

      this._updateRestUI(state, { force: true });

      if (state.totalSec <= 0) {
        this._clearRestState({ signalDone: true, reason: "immediate" });
        return;
      }

      if (this.planPaused) {
        if (inlineHud) {
          inlineHud.textContent = `Rest paused (${state.remainingSec}s remaining)`;
        }
        circle.classList.add("rest-paused");
      } else {
        this._startRestTimer(state);
      }
    },

    _startRestTimer: function _startRestTimer(state) {
      if (!state) {
        return;
      }
      this._stopRestTimer(state);
      state.targetTimestamp = performance.now() + state.remainingSec * 1000;
      state.timerId = window.setInterval(() => {
        this._tickRest(state);
      }, 100);
      this._tickRest(state, { force: true });
    },

    _stopRestTimer: function _stopRestTimer(state) {
      if (state?.timerId) {
        window.clearInterval(state.timerId);
        state.timerId = null;
      }
    },

    _tickRest: function _tickRest(state, options = {}) {
      if (!state) {
        return;
      }

      if (this.planPaused) {
        this._pauseRestCountdown();
        return;
      }

      const target = state.targetTimestamp || performance.now();
      const now = performance.now();
      const msLeft = Math.max(0, target - now);
      const nextRemaining = Math.max(0, Math.ceil(msLeft / 1000));

      const changed = options.force || nextRemaining !== state.remainingSec;
      state.remainingSec = nextRemaining;

      if (changed) {
        this._updateRestUI(state);

        if (
          state.remainingSec <= 3 &&
          state.remainingSec >= 1 &&
          state.lastAnnounce !== state.remainingSec
        ) {
          this.playCountdownBeep(state.remainingSec);
          state.lastAnnounce = state.remainingSec;
        }
      }

      if (msLeft <= 0) {
        this._clearRestState({ signalDone: true, reason: "complete" });
      }
    },

    _updateRestUI: function _updateRestUI(state, options = {}) {
      if (!state) return;
      const {
        circle,
        progress,
        timeText,
        inlineHud,
        restButton,
        hintEl,
        labelEl,
        summaryEl,
        controlRow,
      } = state;

      if (circle) {
        circle.classList.add("rest-active");
        circle.classList.toggle("rest-paused", this.planPaused);
      }

      if (labelEl) {
        labelEl.textContent = this.planPaused ? "Rest paused" : "Rest";
      }

      if (timeText) {
        timeText.textContent = String(Math.max(0, state.remainingSec));
      }

      if (hintEl) {
        hintEl.textContent = this.planPaused ? "Plan paused" : "Tap anywhere to add +30s";
      }

      if (restButton) {
        restButton.classList.toggle("rest-paused", this.planPaused);
        const remaining = Math.max(0, state.remainingSec);
        const baseLabel = this.planPaused ? "Rest paused" : "Rest";
        const action = this.planPaused
          ? "Resume the plan to continue."
          : "Tap anywhere on the circle to add 30 seconds.";
        restButton.setAttribute(
          "aria-label",
          `${baseLabel}. ${remaining}s remaining. ${action}`,
        );
      }

      if (inlineHud) {
        if (this.planPaused) {
          inlineHud.textContent = `Rest paused (${state.remainingSec}s remaining)`;
        } else if (state.totalSec > 0) {
          inlineHud.textContent = `Rest: ${state.remainingSec}s`;
        } else {
          inlineHud.textContent = "";
        }
      }

      const nextSetBanner = document.getElementById("nextSetBanner");
      if (nextSetBanner) {
        if (state.nextHtml) {
          const heading = state.labelText || "Next set";
          // Example final text:
          // "Next set — Program • 20 kg/cable × 2 • 10 reps"
          nextSetBanner.innerHTML = `<strong>${heading}</strong> ${state.nextHtml}`;
          nextSetBanner.classList.remove("hidden");
        } else if (state.labelText) {
          nextSetBanner.textContent = state.labelText;
          nextSetBanner.classList.remove("hidden");
        } else {
          nextSetBanner.textContent = "";
          nextSetBanner.classList.add("hidden");
        }
      }

      if (controlRow) {
        controlRow.classList.add("resting");
      }

      if (progress) {
        const radius = Number(progress.getAttribute("r") || 54);
        const circumference = 2 * Math.PI * radius;
        const total = Math.max(1, state.totalSec);
        const ratio = Math.min(1, Math.max(0, (total - state.remainingSec) / total));
        const dashOffset = circumference * (1 - ratio);
        const dash = circumference.toFixed(3);
        progress.setAttribute("stroke-dasharray", `${dash} ${dash}`);
        progress.setAttribute("stroke-dashoffset", dashOffset.toFixed(3));
      }
    },

    _pauseRestCountdown: function _pauseRestCountdown() {
      const state = this._restState;
      if (!state) {
        return;
      }
      this._stopRestTimer(state);
      if (state.targetTimestamp) {
        const now = performance.now();
        const msLeft = Math.max(0, state.targetTimestamp - now);
        state.remainingSec = Math.max(0, Math.ceil(msLeft / 1000));
        state.targetTimestamp = null;
      }
      if (state.circle) {
        state.circle.classList.add("rest-paused");
      }
      if (state.restButton) {
        state.restButton.classList.add("rest-paused");
      }
      if (state.hintEl) {
        state.hintEl.textContent = "Plan paused";
      }
      if (state.inlineHud) {
        state.inlineHud.textContent = `Rest paused (${state.remainingSec}s remaining)`;
      }
      if (state.timeText) {
        state.timeText.textContent = String(Math.max(0, state.remainingSec));
      }
      if (state.restButton) {
        state.restButton.setAttribute(
          "aria-label",
          `Rest paused. ${state.remainingSec}s remaining. Resume the plan to continue.`,
        );
      }
    },

    _resumeRestCountdown: function _resumeRestCountdown() {
      const state = this._restState;
      if (!state) {
        return;
      }

      if (state.circle) {
        state.circle.classList.remove("rest-paused");
      }
      if (state.restButton) {
        state.restButton.classList.remove("rest-paused");
      }
      if (state.remainingSec <= 0) {
        this._clearRestState({ signalDone: true });
        return;
      }
      state.targetTimestamp = performance.now() + state.remainingSec * 1000;
      this._startRestTimer(state);
    },

    _clearRestState: function _clearRestState(options = {}) {
      const state = this._restState;
      if (!state) {
        return;
      }
      const { signalDone = false, reason = "complete" } = options;

      this._stopRestTimer(state);

      if (state.circle) {
        if (typeof state.circleAddHandler === "function") {
          state.circle.removeEventListener("click", state.circleAddHandler);
        }
        state.circle.classList.remove("rest-active", "rest-paused");
      }
      if (state.restButton) {
        state.restButton.classList.remove("rest-paused");
        if (typeof state.addHandler === "function") {
          state.restButton.removeEventListener("click", state.addHandler);
        }
        state.restButton.disabled = false;
        state.restButton.tabIndex = -1;
        if (state.previousAriaLabel === null || state.previousAriaLabel === undefined) {
          state.restButton.removeAttribute("aria-label");
        } else {
          state.restButton.setAttribute("aria-label", state.previousAriaLabel);
        }
      }
      if (Array.isArray(state.disabledButtons)) {
        state.disabledButtons.forEach((meta) => {
          const btn = meta?.el;
          if (!btn) return;
          btn.disabled = !!meta.disabled;
          if (meta.ariaHidden == null) {
            btn.removeAttribute("aria-hidden");
          } else {
            btn.setAttribute("aria-hidden", meta.ariaHidden);
          }
          if (meta.tabIndex == null) {
            btn.removeAttribute("tabindex");
          } else {
            btn.setAttribute("tabindex", meta.tabIndex);
          }
        });
      }
      if (state.controlRow) {
        state.controlRow.classList.remove("resting");
      }
      if (state.inlineHud) {
        state.inlineHud.textContent = "";
      }
      if (state.summaryEl) {
        state.summaryEl.classList.remove("is-visible");
        state.summaryEl.innerHTML = "";
      }
	const nextSetBanner = document.getElementById("nextSetBanner");
      if (nextSetBanner) {
        nextSetBanner.textContent = "";
        nextSetBanner.classList.add("hidden");
      }

      if (state.hintEl) {
        state.hintEl.textContent = "Tap anywhere to add +30s";
      }
      if (state.timeText) {
        state.timeText.textContent = "0";
      }
      if (state.labelEl) {
        state.labelEl.textContent = "Rest";
      }
      if (state.progress) {
        const radius = Number(state.progress.getAttribute("r") || 54);
        const circumference = 2 * Math.PI * radius;
        state.progress.setAttribute("stroke-dasharray", circumference.toFixed(3));
        state.progress.setAttribute("stroke-dashoffset", circumference.toFixed(3));
      }

      this._restState = null;
      this._cancelRest = null;

      this.onPlanRestStateChange?.();

      if (signalDone && typeof state.onDone === "function") {
        if (reason === "complete" || reason === "skipped") {
          const baseMessage =
            reason === "skipped"
              ? "Rest skipped → starting next block"
              : "Rest finished → starting next block";
          const message = this.planPaused
            ? `${baseMessage} (waiting for resume).`
            : baseMessage;
          const level = reason === "skipped" ? "info" : "success";
          this.addLogEntry(message, level);
        }

        if (this.planPaused) {
          this._queuedPlanRun = state.onDone;
        } else {
          state.onDone();
        }
      }
    },

    _planFinish: function _planFinish(options = {}) {
      if (!this.planActive) {
        return;
      }

      const { silent = false } = options;

      const summary = this.finalizePlanSummary?.();

      if (typeof this._cancelRest === "function") {
        try {
          this._cancelRest();
        } catch (error) {
          // ignore cleanup errors
        }
      }
      this._clearRestState({ signalDone: false });

      this.planActive = false;
      this.planOnWorkoutComplete = null;
      this.planCursor = { index: 0, set: 1 };
      this.planTimeline = [];
      this.planTimelineIndex = 0;
      this._activePlanEntry = null;
      this._planSetInProgress = false;
      this._queuedPlanRun = null;
      this._planNavigationTargetIndex = null;
      this.planPaused = false;
      this.planPauseStartedAt = null;
      this.planPausedDurationMs = 0;
      this.planPauseActivityStart = null;
      this.planPauseLastSample = null;
      this.planStartTime = null;
      this.planRestTimer = null;

      this.stopPlanElapsedTicker();
      this.updatePlanControlsState();
      this.updatePlanElapsedDisplay();
      this.updatePlanSetIndicator?.();
      this.updateCurrentSetLabel?.();
      this.onPlanRestStateChange?.();

      const inlineHud = document.getElementById("planRestInline");
      if (inlineHud) {
        inlineHud.textContent = "";
      }

      if (this._planStopAtTopBase !== null && this._planStopAtTopBase !== undefined) {
        this.stopAtTop = this._planStopAtTopBase;
        this._planStopAtTopBase = null;
      }

      if (!silent) {
        this.addLogEntry("Workout plan complete. Great work!", "success");
      }

      if (!silent) {
        if (summary && Array.isArray(summary.sets) && summary.sets.length) {
          this.presentPlanSummary?.(summary);
        } else {
          this.hidePlanSummary?.();
        }
      } else {
        this.hidePlanSummary?.();
      }
    },

    buildPlanTimeline: function buildPlanTimeline(items = this.planItems) {
      const timeline = [];
      if (!Array.isArray(items)) {
        return timeline;
      }
      items.forEach((item, itemIndex) => {
        if (!item) return;
        const sets = Math.max(1, Number(item.sets) || 1);
        const restSec = Math.max(0, Number(item.restSec) || 0);
        const perCableKg = Number(item.perCableKg) || 0;
        const intensity = (item.intensity || "none").toLowerCase();
        for (let set = 1; set <= sets; set += 1) {
          const isLastSet = set === sets;
          if (!isLastSet || intensity === "none") {
            timeline.push({ itemIndex, set });
            continue;
          }

          if (intensity === "dropset") {
            // Last set: no rest → micro 1 (JL @ -20%) → no rest → micro 2 (JL @ -10%) → normal rest
            timeline.push({ itemIndex, set, restSecOverride: 0 });
            const w80 = Math.max(0, perCableKg * 0.8);
            timeline.push({
              itemIndex,
              set,
              microIndex: 1,
              restSecOverride: 0,
              overrides: { justLift: true, progressionKg: 0, perCableKg: w80 }
            });
            const w70 = Math.max(0, perCableKg * 0.7);
            timeline.push({
              itemIndex,
              set,
              microIndex: 2,
              restSecOverride: restSec,
              overrides: { justLift: true, progressionKg: 0, perCableKg: w70 }
            });
          } else if (intensity === "restpause") {
            // Last set: 15s rest → micro 1 (JL same load) → 15s rest → micro 2 (JL same load) → normal rest
            timeline.push({ itemIndex, set, restSecOverride: 15 });
            timeline.push({
              itemIndex,
              set,
              microIndex: 1,
              restSecOverride: 15,
              overrides: { justLift: true, progressionKg: 0 }
            });
            timeline.push({
              itemIndex,
              set,
              microIndex: 2,
              restSecOverride: restSec,
              overrides: { justLift: true, progressionKg: 0 }
            });
          } else if (intensity === "slownegatives") {
            // Same as rest-pause, but microsets are eccentric-only
            timeline.push({ itemIndex, set, restSecOverride: 15 });
            timeline.push({
              itemIndex,
              set,
              microIndex: 1,
              restSecOverride: 15,
              overrides: { justLift: true, progressionKg: 0, mode: ProgramMode.ECCENTRIC_ONLY }
            });
            timeline.push({
              itemIndex,
              set,
              microIndex: 2,
              restSecOverride: restSec,
              overrides: { justLift: true, progressionKg: 0, mode: ProgramMode.ECCENTRIC_ONLY }
            });
          } else {
            // Fallback – treat as no intensity
            timeline.push({ itemIndex, set });
          }
        }
      });
      return timeline;
    },

    describePlanItem: function describePlanItem(item) {
      if (!item) {
        return "";
      }
      const unit = this.getUnitLabel();
      if (item.type === "exercise") {
        const perCable = Number.isFinite(item.perCableKg)
          ? this.convertKgToDisplay(item.perCableKg).toFixed(this.getWeightInputDecimals())
          : "-";
        const modeName = ProgramModeNames?.[item.mode] || "Program";
        const cables = Number.isFinite(item.cables) ? item.cables : 2;
        const reps = Number(item.reps);
        const unlimited = Boolean(item.justLift) || !Number.isFinite(reps) || reps <= 0;
        const repsText = unlimited
          ? "Unlimited reps"
          : `${Math.max(0, reps)} reps`;
        return `${modeName} • ${perCable} ${unit}/cable × ${cables} • ${repsText}`;
      }
      const levelName = EchoLevelNames?.[item.level] || "Echo";
      const eccentric = Number.isFinite(item.eccentricPct) ? item.eccentricPct : 100;
      const target = Number(item.targetReps);
      const unlimited = Boolean(item.justLift) || !Number.isFinite(target) || target <= 0;
      const repsText = unlimited ? "Unlimited reps" : `target ${Math.max(0, target)} reps`;
      return `${levelName} • ecc ${eccentric}% • ${repsText}`;
    },

    formatDuration: function formatDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    },

    getPlanElapsedMs: function getPlanElapsedMs() {
      if (!this.planActive || !this.planStartTime) {
        return 0;
      }
      const now = Date.now();
      const pausedComponent =
        this.planPaused && this.planPauseStartedAt !== null
          ? now - this.planPauseStartedAt
          : 0;
      const totalPaused = this.planPausedDurationMs + pausedComponent;
      return Math.max(0, now - this.planStartTime - totalPaused);
    },

    startPlanElapsedTicker: function startPlanElapsedTicker() {
      if (this._planElapsedInterval) {
        return;
      }
      this._planElapsedInterval = window.setInterval(() => {
        this.updatePlanElapsedDisplay();
      }, 1000);
      this.updatePlanElapsedDisplay();
    },

    stopPlanElapsedTicker: function stopPlanElapsedTicker() {
      if (this._planElapsedInterval) {
        window.clearInterval(this._planElapsedInterval);
        this._planElapsedInterval = null;
      }
    },

    updatePlanElapsedDisplay: function updatePlanElapsedDisplay() {
      const el = document.getElementById("planElapsedTimer");
      if (!el) {
        return;
      }
      if (!this.planActive || !this.planStartTime) {
        el.textContent = "";
        el.classList.remove("is-paused");
        return;
      }
      el.textContent = this.formatDuration(this.getPlanElapsedMs());
      el.classList.toggle("is-paused", this.planPaused);
    },

    updatePlanControlsState: function updatePlanControlsState() {
      const pauseBtn = document.getElementById("planPauseBtn");
      const prevButtons = [
        document.getElementById("planPrevBtnMobile"),
        document.getElementById("planPrevBtn")
      ].filter(Boolean);
      const nextButtons = [
        document.getElementById("planNextBtnMobile"),
        document.getElementById("planNextBtn")
      ].filter(Boolean);

      const active = !!this.planActive;
      if (pauseBtn) {
        pauseBtn.disabled = !active;
        const isPaused = this.planPaused;
        const label = isPaused ? "Resume plan" : "Pause plan";
        const iconClass = isPaused ? "bi-play-fill" : "bi-pause-fill";
        pauseBtn.innerHTML = `<i class="bi ${iconClass}" aria-hidden="true"></i><span class="sr-only">${label}</span>`;
        pauseBtn.classList.toggle("is-paused", isPaused);
        pauseBtn.setAttribute("aria-pressed", isPaused ? "true" : "false");
        pauseBtn.setAttribute("aria-label", label);
      }
      const prevDisabled = !active || this.planTimelineIndex <= 0;
      prevButtons.forEach((btn) => {
        btn.disabled = prevDisabled;
        btn.setAttribute("aria-label", "Previous set");
      });
      const nextDisabled =
        !active || this.planTimelineIndex >= Math.max(0, this.planTimeline.length - 1);
      nextButtons.forEach((btn) => {
        btn.disabled = nextDisabled;
        btn.setAttribute("aria-label", "Next set");
      });

      this.updatePlanElapsedDisplay();
    },

    togglePlanPause: function togglePlanPause() {
      if (!this.planActive) {
        return;
      }
      if (this.planPaused) {
        this.resumePlan();
      } else {
        this.pausePlan();
      }
    },

    pausePlan: function pausePlan() {
      if (!this.planActive || this.planPaused) {
        return;
      }
      this.planPaused = true;
      this.planPauseStartedAt = Date.now();
      this.planPauseActivityStart = null;
      this.planPauseLastSample = this.currentSample
        ? {
            posA: Number(this.currentSample.posA) || 0,
            posB: Number(this.currentSample.posB) || 0,
            loadA: Number(this.currentSample.loadA) || 0,
            loadB: Number(this.currentSample.loadB) || 0,
          }
        : null;
      this._pauseRestCountdown();
      this.addLogEntry("Plan paused.", "info");
      this.updatePlanControlsState();
      this.updatePlanElapsedDisplay();
    },

    resumePlan: function resumePlan(options = {}) {
      if (!this.planActive || !this.planPaused) {
        return;
      }
      const now = Date.now();
      if (this.planPauseStartedAt !== null) {
        this.planPausedDurationMs += now - this.planPauseStartedAt;
      }
      this.planPaused = false;
      this.planPauseStartedAt = null;
      this.planPauseActivityStart = null;
      this.planPauseLastSample = null;

      this.updatePlanControlsState();
      this.updatePlanElapsedDisplay();
      this._resumeRestCountdown();

      const queued = this._queuedPlanRun;
      this._queuedPlanRun = null;
      if (queued) {
        queued();
      }

      if (options.auto) {
        this.addLogEntry("Detected movement during pause — auto-resuming plan.", "info");
      } else {
        this.addLogEntry("Plan resumed.", "success");
      }
    },

    skipPlanForward: async function skipPlanForward() {
      if (!this.planActive) {
        return false;
      }

      if (this._restState) {
        this.addLogEntry("Rest skipped → starting next block", "info");
        this._clearRestState({ signalDone: true, reason: "skipped" });
        return true;
      }

      return this.navigatePlan(1);
    },

    rewindPlan: async function rewindPlan() {
      await this.navigatePlan(-1);
    },

    navigatePlan: async function navigatePlan(delta) {
      if (!this.planActive || !Number.isInteger(delta) || delta === 0) {
        return false;
      }
      if (!Array.isArray(this.planTimeline) || !this.planTimeline.length) {
        return false;
      }

      const target = this.planTimelineIndex + delta;
      if (target < 0) {
        this.addLogEntry("Already at the first set.", "warning");
        return false;
      }
      if (target >= this.planTimeline.length) {
        this.addLogEntry("Reached the end of the plan.", "info");
        this._planFinish();
        return true;
      }

      this._planNavigationTargetIndex = target;
      this._clearRestState({ signalDone: false });

      if (this._planSetInProgress) {
        try {
          this.addLogEntry("Skipping current set and moving forward.", "info");
          await this.stopWorkout({ reason: "skipped", skipPlanAdvance: true });
          if (!this._planSetInProgress) {
            this._applyPlanNavigationTarget();
          }
        } catch (error) {
          this.addLogEntry(`Unable to stop current set: ${error.message}`, "error");
        }
        return true;
      }

      this._applyPlanNavigationTarget();
      return true;
    },

    _applyPlanNavigationTarget: function _applyPlanNavigationTarget() {
      if (!this.planActive) {
        this._planNavigationTargetIndex = null;
        return;
      }
      if (!Array.isArray(this.planTimeline) || !this.planTimeline.length) {
        this._planNavigationTargetIndex = null;
        return;
      }

      const target = this._planNavigationTargetIndex;
      this._planNavigationTargetIndex = null;

      if (target === null || target === undefined) {
        return;
      }

      if (target >= this.planTimeline.length) {
        this._planFinish();
        return;
      }

      this.planTimelineIndex = Math.max(0, target);
      const entry = this.planTimeline[this.planTimelineIndex];
      const item = entry ? this.planItems[entry.itemIndex] : null;
      const viewItem = entry && item && entry.overrides ? { ...item, ...entry.overrides } : item;
      if (entry && item) {
        this.planCursor = { index: entry.itemIndex, set: entry.set };
        this._applyItemToUI?.(viewItem);
        this.addLogEntry(
          `Navigated to ${item.name || "plan item"} • set ${entry.set}`,
          "info",
        );
      }

      this._activePlanEntry = null;
      this._planSetInProgress = false;

      this.updatePlanSetIndicator?.();
      this.updateCurrentSetLabel?.();
      this.ensureFullscreenPreference?.();

      const runNext = () => {
        if (this.planPaused) {
          this._queuedPlanRun = () => this._runCurrentPlanBlock();
        } else {
          this._runCurrentPlanBlock();
        }
      };

      runNext();
      this.updatePlanControlsState();
    },

    trackPlanPauseMovement: function trackPlanPauseMovement(sample) {
      if (!this.planPaused) {
        this.planPauseActivityStart = null;
        this.planPauseLastSample = sample
          ? {
              posA: Number(sample.posA) || 0,
              posB: Number(sample.posB) || 0,
              loadA: Number(sample.loadA) || 0,
              loadB: Number(sample.loadB) || 0,
            }
          : null;
        return;
      }

      const now = Date.now();
      const current = {
        posA: Number(sample?.posA) || 0,
        posB: Number(sample?.posB) || 0,
        loadA: Number(sample?.loadA) || 0,
        loadB: Number(sample?.loadB) || 0,
      };

      if (this.planPauseLastSample) {
        const deltaPosA = Math.abs(current.posA - this.planPauseLastSample.posA);
        const deltaPosB = Math.abs(current.posB - this.planPauseLastSample.posB);
        const deltaLoad =
          Math.abs(current.loadA - this.planPauseLastSample.loadA) +
          Math.abs(current.loadB - this.planPauseLastSample.loadB);
        const moving = deltaPosA > 5 || deltaPosB > 5 || deltaLoad > 4;
        if (moving) {
          if (!this.planPauseActivityStart) {
            this.planPauseActivityStart = now;
          } else if (now - this.planPauseActivityStart >= 5000) {
            this.planPauseActivityStart = null;
            this.resumePlan({ auto: true });
            return;
          }
        } else {
          this.planPauseActivityStart = null;
        }
      }

      this.planPauseLastSample = current;
    }
  };

  global.PlanRunnerPrototype = PlanRunnerPrototype;
})(window);
