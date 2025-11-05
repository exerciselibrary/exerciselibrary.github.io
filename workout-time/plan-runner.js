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
      this.planOnWorkoutComplete = () => this._planAdvance();

      this._clearRestState({ signalDone: false });
      this.stopPlanElapsedTicker();
      this.startPlanElapsedTicker();
      this.updatePlanControlsState();

      const firstItem = this.planItems[this.planCursor.index];
      if (firstItem) {
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

      if (!entry || !item) {
        this.addLogEntry("Plan item missing — skipping.", "error");
        this.planTimelineIndex += 1;
        this.updatePlanControlsState();
        this._runCurrentPlanBlock();
        return;
      }

      this.planCursor = { index: entry.itemIndex, set: entry.set };
      this._applyItemToUI?.(item);
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
        restSec: Math.max(0, Number(item.restSec) || 0),
        type: item.type || "exercise",
        name: item.name || ""
      };
      this._planSetInProgress = true;

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

    _planAdvance: function _planAdvance() {
      if (!this.planActive) {
        return;
      }

      this._planSetInProgress = false;

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

      if (upcomingEntry && upcomingItem) {
        this.planCursor = { index: upcomingEntry.itemIndex, set: upcomingEntry.set };
        this._applyItemToUI?.(upcomingItem);
      }

      const restSource =
        this._activePlanEntry && Number.isFinite(this._activePlanEntry.restSec)
          ? this._activePlanEntry
          : upcomingItem && Number.isFinite(upcomingItem.restSec)
            ? { restSec: upcomingItem.restSec, name: upcomingItem.name, type: upcomingItem.type }
            : null;

      const restSec = Math.max(0, Number(restSource?.restSec) || 0);
      const nextLabel =
        upcomingItem?.name || (upcomingItem?.type === "exercise" ? "Exercise" : "Echo Mode");
      const nextSummary = upcomingItem ? this.describePlanItem(upcomingItem) : "";

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
      const overlay = document.getElementById("restOverlay");
      const progress = document.getElementById("restProgress");
      const timeText = document.getElementById("restTimeText");
      const nextDiv = document.getElementById("restNext");
      const addBtn = document.getElementById("restAddBtn");
      const skipBtn = document.getElementById("restSkipBtn");
      const inlineHud = document.getElementById("planRestInline");
      const setNameEl = document.getElementById("restSetName");
      const labelEl = document.getElementById("restLabel");

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

      if (!overlay || !progress || !timeText) {
        const ms = Math.max(0, (totalSec | 0) * 1000);
        this.addLogEntry(`(No overlay found) Rest ${totalSec}s…`, "info");
        window.setTimeout(() => finishLater(), ms);
        return;
      }

      this._clearRestState({ signalDone: false });

      const restTotal = Math.max(0, Number(totalSec) || 0);
      const nextName =
        typeof nextItemOrName === "string"
          ? nextItemOrName
          : nextItemOrName?.name || "";

      const state = {
        totalSec: restTotal,
        remainingSec: restTotal,
        onDone,
        labelText,
        nextHtml: nextHtml || "",
        nextName,
        overlay,
        progress,
        timeText,
        nextDiv,
        addBtn,
        skipBtn,
        inlineHud,
        setNameEl,
        labelEl,
        timerId: null,
        targetTimestamp: null,
        lastAnnounce: null,
      };

      this._restState = state;
      this._cancelRest = () => {
        this._clearRestState({ signalDone: false });
      };

      if (addBtn) {
        addBtn.onclick = () => {
          state.totalSec += 30;
          state.remainingSec += 30;
          if (state.targetTimestamp) {
            state.targetTimestamp += 30_000;
          }
          this.addLogEntry("+30s added to rest", "info");
          this._updateRestUI(state, { force: true });
        };
      }

      if (skipBtn) {
        skipBtn.onclick = () => {
          this.addLogEntry("Rest skipped", "info");
          this._clearRestState({ signalDone: true, reason: "skip" });
        };
      }

      this._updateRestUI(state, { force: true });

      if (state.totalSec <= 0) {
        this._clearRestState({ signalDone: true, reason: "immediate" });
        return;
      }

      if (this.planPaused) {
        if (inlineHud) {
          inlineHud.textContent = `Rest paused (${state.remainingSec}s remaining)`;
        }
        overlay.classList.add("paused");
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
      const { overlay, progress, timeText, nextDiv, inlineHud, setNameEl, labelEl } = state;
      if (overlay) {
        overlay.classList.remove("hidden");
        overlay.classList.toggle("paused", this.planPaused);
      }
      if (labelEl) {
        const base = state.labelText || "Next set";
        labelEl.textContent = this.planPaused ? `${base} (Paused)` : base;
      }
      if (setNameEl) {
        setNameEl.textContent = state.nextName || "";
      }
      if (nextDiv) {
        nextDiv.innerHTML = state.nextHtml || "";
      }
      if (timeText) {
        timeText.textContent = String(Math.max(0, state.remainingSec));
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
      if (progress) {
        const circumference = 2 * Math.PI * 45;
        const total = Math.max(1, state.totalSec);
        const ratio = Math.min(
          1,
          Math.max(0, (total - state.remainingSec) / total),
        );
        const dash = ratio * circumference;
        progress.setAttribute("stroke-dasharray", circumference.toFixed(3));
        progress.setAttribute(
          "stroke-dashoffset",
          String((circumference - dash).toFixed(3)),
        );
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
      if (state.overlay) {
        state.overlay.classList.add("paused");
      }
      if (state.inlineHud) {
        state.inlineHud.textContent = `Rest paused (${state.remainingSec}s remaining)`;
      }
      if (state.timeText) {
        state.timeText.textContent = String(Math.max(0, state.remainingSec));
      }
    },

    _resumeRestCountdown: function _resumeRestCountdown() {
      const state = this._restState;
      if (!state) {
        return;
      }

      if (state.overlay) {
        state.overlay.classList.remove("paused");
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

      if (state.overlay) {
        state.overlay.classList.add("hidden");
        state.overlay.classList.remove("paused");
      }
      if (state.inlineHud) {
        state.inlineHud.textContent = "";
      }
      if (state.setNameEl) {
        state.setNameEl.textContent = "";
      }
      if (state.nextDiv) {
        state.nextDiv.innerHTML = "";
      }
      if (state.labelEl) {
        state.labelEl.textContent = state.labelText || "Next set";
      }
      if (state.addBtn) {
        state.addBtn.onclick = null;
      }
      if (state.skipBtn) {
        state.skipBtn.onclick = null;
      }

      this._restState = null;
      this._cancelRest = null;

      if (signalDone && typeof state.onDone === "function") {
        if (reason === "complete") {
          const message = this.planPaused
            ? "Rest finished — waiting for resume to continue plan."
            : "Rest finished → starting next block";
          this.addLogEntry(message, this.planPaused ? "info" : "success");
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

      const inlineHud = document.getElementById("planRestInline");
      if (inlineHud) {
        inlineHud.textContent = "";
      }

      if (!silent) {
        this.addLogEntry("Workout plan complete. Great work!", "success");
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
        for (let set = 1; set <= sets; set += 1) {
          timeline.push({ itemIndex, set });
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
        const reps = Number.isFinite(item.reps) ? item.reps : 0;
        return `${modeName} • ${perCable} ${unit}/cable × ${cables} • ${reps} reps`;
      }
      const levelName = EchoLevelNames?.[item.level] || "Echo";
      const eccentric = Number.isFinite(item.eccentricPct) ? item.eccentricPct : 100;
      const target = Number.isFinite(item.targetReps) ? item.targetReps : 0;
      return `${levelName} • ecc ${eccentric}% • target ${target} reps`;
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
      const prevBtn = document.getElementById("planPrevBtn");
      const nextBtn = document.getElementById("planNextBtn");

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
      if (prevBtn) {
        prevBtn.disabled = !active || this.planTimelineIndex <= 0;
        prevBtn.setAttribute("aria-label", "Previous set");
      }
      if (nextBtn) {
        nextBtn.disabled =
          !active || this.planTimelineIndex >= Math.max(0, this.planTimeline.length - 1);
        nextBtn.setAttribute("aria-label", "Next set");
      }

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
      await this.navigatePlan(1);
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
          await this.stopWorkout();
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
      if (entry && item) {
        this.planCursor = { index: entry.itemIndex, set: entry.set };
        this._applyItemToUI?.(item);
        this.addLogEntry(
          `Navigated to ${item.name || "plan item"} • set ${entry.set}`,
          "info",
        );
      }

      this._activePlanEntry = null;
      this._planSetInProgress = false;

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
