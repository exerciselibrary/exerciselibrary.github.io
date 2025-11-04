// app.js - Main application logic and UI management

const LB_PER_KG = 2.2046226218488;
const KG_PER_LB = 1 / LB_PER_KG;

class VitruvianApp {
  constructor() {
    this.device = new VitruvianDevice();
    this.chartManager = new ChartManager("loadGraph");
    this.dropboxManager = new DropboxManager(); // Dropbox cloud storage
    this.maxPos = 1000; // Shared max for both cables (keeps bars comparable)
    this.weightUnit = "kg"; // Display unit for weights (default)
    this._unitToggleButton = null; // Reference to unit toggle button
    this._weightAdjustTimer = null; // Interval handle for weight hold
    this._weightAdjustDirection = 0; // Current hold direction
    this._repAudioContext = null; // Web Audio context for rep cues
    this._lastRepTopBeep = 0; // Timestamp of last rep top cue
    this.stopAtTop = false; // Stop at top of final rep instead of bottom
    this.warmupReps = 0;
    this.workingReps = 0;
    this.warmupTarget = 3; // Default warmup target
    this.targetReps = 0; // Target working reps
    this.workoutHistory = []; // Track completed workouts
    this.currentWorkout = null; // Current workout info
    this.topPositionsA = []; // Rolling window of top positions for cable A
    this.bottomPositionsA = []; // Rolling window of bottom positions for cable A
    this.topPositionsB = []; // Rolling window of top positions for cable B
    this.bottomPositionsB = []; // Rolling window of bottom positions for cable B
    this.minRepPosA = null; // Discovered minimum position for cable A (rolling avg)
    this.maxRepPosA = null; // Discovered maximum position for cable A (rolling avg)
    this.minRepPosB = null; // Discovered minimum position for cable B (rolling avg)
    this.maxRepPosB = null; // Discovered maximum position for cable B (rolling avg)
    this.minRepPosARange = null; // Min/max uncertainty for cable A bottom
    this.maxRepPosARange = null; // Min/max uncertainty for cable A top
    this.minRepPosBRange = null; // Min/max uncertainty for cable B bottom
    this.maxRepPosBRange = null; // Min/max uncertainty for cable B top
    this.currentSample = null; // Latest monitor sample
    this.autoStopStartTime = null; // When we entered the auto-stop danger zone
    this.isJustLiftMode = false; // Flag for Just Lift mode with auto-stop
    this.lastTopCounter = undefined; // Track u16[1] for top detection
    this.setupLogging();
    this.setupChart();
    this.setupUnitControls();
    this.setupLiveWeightAdjuster();
    this.setupDropbox();
    this.setupMessageBridge();
    this.resetRepCountersToEmpty();
    this.updateStopButtonState();

    this.planItems = [];        // array of {type: 'exercise'|'echo', fields...}
    this.planActive = false;    // true when plan runner is active
    this.planCursor = { index: 0, set: 1 }; // current item & set counter
    this.planRestTimer = null;  // rest countdown handle
    this.planOnWorkoutComplete = null; // hook assigned while plan is running

    this._hasPerformedInitialSync = false; // track if we've auto-synced once per session
    this._autoSyncInFlight = false;

    this._personalBestHighlight = false; // track highlight state
    this._confettiActive = false; // prevent overlapping confetti bursts
    this._confettiCleanupTimer = null;

    this.sidebarCollapsed = false;
    this.loadSidebarPreference();

    this.selectedHistoryKey = null; // currently selected history entry key
    this.selectedHistoryIndex = null; // cache index for quick lookup

    // initialize plan UI dropdown from storage
    setTimeout(() => {
      this.refreshPlanSelectNames();
      this.renderPlanUI();
      this.applySidebarCollapsedState();
    }, 0);

    window.addEventListener("resize", () => {
      this.applySidebarCollapsedState();
    });


  }

  setupLogging() {
    // Connect device logging to UI
    this.device.onLog = (message, type) => {
      this.addLogEntry(message, type);
    };
  }

  setupChart() {
    // Initialize chart and connect logging
    this.chartManager.init();
    this.chartManager.onLog = (message, type) => {
      this.addLogEntry(message, type);
    };
    this.applyUnitToChart();
  }

  setupUnitControls() {
    const toggleButton = document.getElementById("unitToggleButton");
    this._unitToggleButton = toggleButton || null;

    if (toggleButton) {
      const handleToggle = (event) => {
        if (event) {
          event.preventDefault();
        }
        const nextUnit = this.weightUnit === "kg" ? "lb" : "kg";
        this.setWeightUnit(nextUnit, {
          previousUnit: this.weightUnit,
          force: true,
        });
      };

      toggleButton.addEventListener("click", handleToggle);
      toggleButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleToggle(event);
        }
      });
    }

    const storedUnit = this.loadStoredWeightUnit();

    if (storedUnit !== this.weightUnit) {
      this.setWeightUnit(storedUnit, {
        previousUnit: this.weightUnit,
        force: true,
      });
    } else {
      this.onUnitChanged();
    }
  }

  updateUnitToggleUI() {
    if (!this._unitToggleButton) {
      this._unitToggleButton = document.getElementById("unitToggleButton");
    }

    const button = this._unitToggleButton;
    if (!button) {
      return;
    }

    button.dataset.activeUnit = this.weightUnit;
    const friendly =
      this.weightUnit === "kg" ? "kilograms" : "pounds";
    button.setAttribute(
      "aria-label",
      `Toggle between kilograms and pounds (currently ${friendly})`,
    );
    button.setAttribute("aria-pressed", this.weightUnit === "lb" ? "true" : "false");
  }

  setupLiveWeightAdjuster() {
    const increase = document.getElementById("weightAdjusterIncrease");
    const decrease = document.getElementById("weightAdjusterDecrease");
    const weightInput = document.getElementById("weight");

    if (weightInput) {
      weightInput.addEventListener("input", () => {
        this.updateLiveWeightDisplay();
      });
      weightInput.addEventListener("change", () => {
        this.updateLiveWeightDisplay();
      });
    }

    if (!increase || !decrease) {
      this.updateLiveWeightDisplay();
      return;
    }

    const bindHold = (element, direction) => {
      const start = (event) => {
        if (event && event.button !== undefined && event.button !== 0) {
          return;
        }
        if (event) {
          event.preventDefault();
          if (
            typeof event.pointerId === "number" &&
            typeof element.setPointerCapture === "function"
          ) {
            try {
              element.setPointerCapture(event.pointerId);
            } catch (error) {
              // Ignore capture errors (e.g., unsupported browsers)
            }
          }
        }
        this.startLiveWeightHold(direction);
      };

      const stop = (event) => {
        if (
          event &&
          typeof event.pointerId === "number" &&
          typeof element.releasePointerCapture === "function"
        ) {
          try {
            element.releasePointerCapture(event.pointerId);
          } catch (error) {
            // Ignore release errors
          }
        }
        this.stopLiveWeightHold();
      };

      element.addEventListener("pointerdown", start);
      element.addEventListener("pointerup", stop);
      element.addEventListener("pointerleave", stop);
      element.addEventListener("pointercancel", stop);
      element.addEventListener("lostpointercapture", stop);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.adjustLiveWeight(direction, { repeat: false });
        }
      });
    };

    bindHold(increase, 1);
    bindHold(decrease, -1);

    window.addEventListener("pointerup", () => {
      this.stopLiveWeightHold();
    });

    this.updateLiveWeightDisplay();
  }

  startLiveWeightHold(direction) {
    this.stopLiveWeightHold();
    this._weightAdjustDirection = direction;
    this.adjustLiveWeight(direction, { repeat: false });
    this._weightAdjustTimer = window.setInterval(() => {
      this.adjustLiveWeight(direction, { repeat: true });
    }, 220);
  }

  stopLiveWeightHold() {
    if (this._weightAdjustTimer !== null) {
      window.clearInterval(this._weightAdjustTimer);
      this._weightAdjustTimer = null;
    }
    this._weightAdjustDirection = 0;
  }

  adjustLiveWeight(direction, options = {}) {
    const stepDisplay = 0.1;
    const stepKg = this.convertDisplayToKg(stepDisplay);
    
    const maxKg = 100;
    const minKg = 0;

    let baseKg = this.getCurrentPerCableWeightKg();
    if (!Number.isFinite(baseKg)) {
      baseKg = 0;
    }

    let nextKg = baseKg + direction * stepKg;
    if (nextKg > maxKg) nextKg = maxKg;
    if (nextKg < minKg) nextKg = minKg;

    if (Math.abs(nextKg - baseKg) < 1e-6) {
      return null;
    }

    if (this.currentWorkout && typeof this.currentWorkout === "object") {
      if (!Number.isFinite(this.currentWorkout.originalWeightKg)) {
        this.currentWorkout.originalWeightKg = baseKg;
      }
      this.currentWorkout.weightKg = nextKg;
      this.currentWorkout.adjustedWeightKg = nextKg;
    }

    const weightInput = document.getElementById("weight");
    if (weightInput) {
      weightInput.value = this.formatWeightValue(
        nextKg,
        this.getWeightInputDecimals(),
      );
    }

    this.updateLiveWeightDisplay();

    if (!options.repeat) {
      this.addLogEntry(
        `Adjusted live weight to ${this.formatWeightWithUnit(nextKg)}`,
        "info",
      );
    }

    return nextKg;
  }

  getCurrentPerCableWeightKg() {
    if (this.currentWorkout && typeof this.currentWorkout === "object") {
      const value = Number(this.currentWorkout.weightKg);
      if (Number.isFinite(value)) {
        return value;
      }
    }

    const weightInput = document.getElementById("weight");
    if (weightInput) {
      const raw = parseFloat(weightInput.value);
      const kg = this.convertDisplayToKg(raw);
      if (Number.isFinite(kg)) {
        return kg;
      }
    }

    return null;
  }

  updateLiveWeightDisplay() {
    const valueEl = document.getElementById("liveWeightValue");
    const unitEl = document.getElementById("liveWeightUnit");
    if (!valueEl || !unitEl) {
      return;
    }

    const currentKg = this.getCurrentPerCableWeightKg();
    if (Number.isFinite(currentKg)) {
      valueEl.textContent = this.convertKgToDisplay(currentKg).toFixed(
        this.getWeightInputDecimals(),
      );
    } else {
      valueEl.textContent = "-";
    }

    unitEl.textContent = this.getUnitLabel();
  }

  setupDropbox() {
    // Connect Dropbox logging to UI
    this.dropboxManager.onLog = (message, type) => {
      this.addLogEntry(`[Dropbox] ${message}`, type);
    };

    // Handle connection state changes
    this.dropboxManager.onConnectionChange = (isConnected) => {
      this.updateDropboxUI(isConnected);
    };

    // Initialize Dropbox (check for existing token or OAuth callback)
      this.dropboxManager
      .init()
      .then(() => {
        if (this.dropboxManager.isConnected) {
          this.scheduleAutoDropboxSync("init");
        }
      })
      .catch((error) => {
        this.addLogEntry(`Dropbox initialization error: ${error.message}`, "error");
      });
  }

  setupMessageBridge() {
    try {
      window.addEventListener("message", (event) => {
        Promise.resolve(this.handleBuilderMessage(event)).catch((error) => {
          console.error("Builder sync failed", error);
        });
      });

      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "workout-ready" }, window.location.origin);
      }
    } catch (error) {
      // Ignore cross-origin errors or environments without window
    }
  }

  async handleBuilderMessage(event) {
    if (!event || !event.data || typeof event.data !== 'object') {
      return;
    }

    if (event.origin !== window.location.origin) {
      return;
    }

    if (event.data.type !== 'builder-sync-request') {
      return;
    }

    const source = event.source || null;
    const origin = event.origin;
    const requestId = event.data.requestId;
    const respond = (payload) => {
      if (source && typeof source.postMessage === 'function') {
        source.postMessage({
          type: 'builder-sync-response',
          requestId,
          ...payload
        }, origin);
      }
    };

    const plans = Array.isArray(event.data.plans) ? event.data.plans : [];
    if (!plans.length) {
      respond({ status: 'error', message: 'No plans provided.', successes: [], errors: [] });
      return;
    }

    if (!this.dropboxManager || !this.dropboxManager.isConnected) {
      respond({
        status: 'error',
        message: 'Connect Dropbox in Workout Time before syncing.',
        successes: [],
        errors: []
      });
      return;
    }

    const successes = [];
    const errors = [];

    for (const plan of plans) {
      const planName = typeof plan?.name === 'string' ? plan.name.trim() : '';
      const items = Array.isArray(plan?.items) ? plan.items : [];

      if (!planName) {
        errors.push({ name: '(Unnamed plan)', message: 'Missing plan name' });
        continue;
      }

      if (!items.length) {
        errors.push({ name: planName, message: 'Plan has no items' });
        continue;
      }

      try {
        await this.ingestExternalPlan(planName, items);
        successes.push(planName);
      } catch (error) {
        errors.push({ name: planName, message: error?.message || 'Failed to ingest plan' });
      }
    }

    if (successes.length) {
      this.refreshPlanSelectNames();
      this.addLogEntry(`Received ${successes.length} plan${successes.length === 1 ? '' : 's'} from Workout Builder`, 'success');
    }

    errors.forEach((error) => {
      this.addLogEntry(`Failed to ingest plan "${error.name}": ${error.message}`, 'error');
    });

    const status = errors.length ? (successes.length ? 'partial' : 'error') : 'success';

    respond({
      status,
      successes,
      errors,
      plansCount: successes.length
    });
  }

  updateDropboxUI(isConnected) {
    const notConnectedDiv = document.getElementById("dropboxNotConnected");
    const connectedDiv = document.getElementById("dropboxConnected");
    const statusBadge = document.getElementById("dropboxStatusBadge");

    if (isConnected) {
      if (notConnectedDiv) notConnectedDiv.style.display = "none";
      if (connectedDiv) connectedDiv.style.display = "block";

      // Update status badge
      if (statusBadge) {
        statusBadge.textContent = "Connected";
        statusBadge.style.background = "#d3f9d8";
        statusBadge.style.color = "#2b8a3e";
      }

      // Show last backup info if available
      this.updateLastBackupDisplay();

      this.scheduleAutoDropboxSync("connection-change");
      this.syncPlansFromDropbox({ silent: true }).catch(() => {});
    } else {
      if (notConnectedDiv) notConnectedDiv.style.display = "block";
      if (connectedDiv) connectedDiv.style.display = "none";

      // Update status badge
      if (statusBadge) {
        statusBadge.textContent = "Not Connected";
        statusBadge.style.background = "#e0e0e0";
        statusBadge.style.color = "#6c757d";
      }

      this._autoSyncInFlight = false;
      this._hasPerformedInitialSync = false;
    }
  }

  scheduleAutoDropboxSync(reason = "auto") {
    if (!this.dropboxManager.isConnected) {
      return;
    }

    if (this._autoSyncInFlight || this._hasPerformedInitialSync) {
      return;
    }

    this._autoSyncInFlight = true;
    this.syncFromDropbox({ auto: true, reason })
      .catch(() => {
        // Errors already logged inside syncFromDropbox
      })
      .finally(() => {
        this._autoSyncInFlight = false;
      });
  }

  updateLastBackupDisplay() {
    const lastBackupDiv = document.getElementById("dropboxLastBackup");
    if (!lastBackupDiv) return;

    const lastBackup = localStorage.getItem("vitruvian.dropbox.lastBackup");
    if (lastBackup) {
      const date = new Date(lastBackup);
      const timeAgo = this.getTimeAgo(date);
      lastBackupDiv.innerHTML = `📁 Last backup: <strong>${timeAgo}</strong>`;
      lastBackupDiv.style.display = "block";
    } else {
      lastBackupDiv.innerHTML = `📁 No backups yet. Complete a workout to create your first backup.`;
      lastBackupDiv.style.display = "block";
    }
  }

  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

    return date.toLocaleDateString();
  }

  async connectDropbox() {
    try {
      await this.dropboxManager.connect();
    } catch (error) {
      this.addLogEntry(`Failed to connect Dropbox: ${error.message}`, "error");
      alert(`Failed to connect to Dropbox: ${error.message}`);
    }
  }

  disconnectDropbox() {
    if (confirm("Are you sure you want to disconnect Dropbox? Your workout history will remain in your Dropbox, but new workouts won't be automatically backed up.")) {
      this.dropboxManager.disconnect();
      this.addLogEntry("Disconnected from Dropbox", "info");
    }
  }

  async syncFromDropbox(options = {}) {
    const auto = options?.auto === true;
    const reason = options?.reason || (auto ? "auto" : "manual");

    if (!this.dropboxManager.isConnected) {
      if (!auto) {
        alert("Please connect to Dropbox first");
      }
      return;
    }

    try {
      const statusDiv = document.getElementById("dropboxSyncStatus");
      if (statusDiv) {
        statusDiv.textContent = auto
          ? "Auto-syncing from Dropbox..."
          : "Syncing...";
      }

      this.addLogEntry(
        `${auto ? "Auto-syncing" : "Syncing"} workouts from Dropbox (reason: ${reason})...`,
        "info",
      );

      // Ensure existing workouts are normalized before comparisons
      this.workoutHistory = this.workoutHistory
        .map((workout) => this.normalizeWorkout(workout))
        .filter(Boolean);

      // Load workouts from Dropbox
      const cloudWorkouts = await this.dropboxManager.loadWorkouts();
      const normalizedCloud = cloudWorkouts
        .map((workout) => this.normalizeWorkout(workout))
        .filter(Boolean);

      const existingTimestamps = new Set();
      for (const workout of this.workoutHistory) {
        const ts = (workout.timestamp || workout.endTime);
        if (ts instanceof Date) {
          existingTimestamps.add(ts.getTime());
        }
      }

      let newCount = 0;
      for (const workout of normalizedCloud) {
        const ts = workout.timestamp || workout.endTime;
        const timeValue = ts instanceof Date ? ts.getTime() : null;
        if (timeValue && !existingTimestamps.has(timeValue)) {
          this.workoutHistory.unshift(workout);
          existingTimestamps.add(timeValue);
          newCount++;
        }
      }

      // Sort by timestamp, newest first
      this.workoutHistory.sort((a, b) => {
        const timeA = (a.timestamp || a.endTime || new Date(0)).getTime();
        const timeB = (b.timestamp || b.endTime || new Date(0)).getTime();
        return timeB - timeA;
      });

      // Recalculate derived metrics after merge
      this.workoutHistory.forEach((workout) => {
        this.calculateTotalLoadPeakKg(workout);
      });

      this.updateHistoryDisplay();

      const message = newCount > 0
        ? `Synced ${newCount} new workout(s) from Dropbox`
        : "No new workouts found in Dropbox";

      await this.syncPlansFromDropbox({ silent: auto });

      // Update last backup display to show sync time
      if (normalizedCloud.length > 0) {
        localStorage.setItem("vitruvian.dropbox.lastBackup", new Date().toISOString());
        this.updateLastBackupDisplay();
      }

      this.addLogEntry(message, "success");
      if (statusDiv) {
        statusDiv.textContent = message;
        setTimeout(() => {
          if (statusDiv) statusDiv.textContent = "";
        }, auto ? 3000 : 5000);
      }

      this._hasPerformedInitialSync = true;
    } catch (error) {
      this.addLogEntry(`Failed to sync from Dropbox: ${error.message}`, "error");
      const statusDiv = document.getElementById("dropboxSyncStatus");
      if (statusDiv) {
        statusDiv.textContent = `Error: ${error.message}`;
        setTimeout(() => {
          if (statusDiv) statusDiv.textContent = "";
        }, 7000);
      }
    }
  }

  async syncPlansFromDropbox(options = {}) {
    if (!this.dropboxManager.isConnected) {
      return;
    }

    const silent = options?.silent === true;

    try {
      const payload = await this.dropboxManager.loadPlansIndex();
      const plans =
        payload && typeof payload === "object" && payload.plans
          ? { ...payload.plans }
          : {};

      const existingNames = new Set(this.getAllPlanNames());
      const localPlans = new Map();
      for (const name of existingNames) {
        const raw = localStorage.getItem(this.planKey(name));
        if (raw) {
          try {
            localPlans.set(name, JSON.parse(raw));
          } catch {
            // ignore malformed local plan
          }
        }
      }

      const remoteNames = new Set(Object.keys(plans));
      let uploadedCount = 0;
      const failedUploads = new Set();

      for (const [name, planItems] of localPlans.entries()) {
        if (!remoteNames.has(name)) {
          try {
            await this.dropboxManager.savePlan(name, planItems);
            plans[name] = JSON.parse(JSON.stringify(planItems || []));
            remoteNames.add(name);
            uploadedCount += 1;
          } catch (error) {
            failedUploads.add(name);
            if (!silent) {
              this.addLogEntry(
                `Failed to upload local plan "${name}" to Dropbox: ${error.message}`,
                "error",
              );
            }
          }
        }
      }

      const mergedNames = Object.keys(plans);
      for (const name of failedUploads) {
        if (!mergedNames.includes(name)) {
          mergedNames.push(name);
        }
      }

      const finalNames = this.setAllPlanNames(mergedNames);
      const finalSet = new Set(finalNames);

      for (const name of finalNames) {
        if (!plans[name]) {
          continue;
        }
        try {
          const items = Array.isArray(plans[name]) ? plans[name] : [];
          localStorage.setItem(this.planKey(name), JSON.stringify(items));
        } catch {
          // ignore local persistence errors
        }
      }

      for (const name of existingNames) {
        if (!finalSet.has(name) && !failedUploads.has(name)) {
          localStorage.removeItem(this.planKey(name));
        }
      }

      this.refreshPlanSelectNames();

      if (!silent) {
        const summaryMessage = uploadedCount > 0
          ? `Synced ${finalNames.length} plan${finalNames.length === 1 ? "" : "s"} from Dropbox (uploaded ${uploadedCount} local plan${uploadedCount === 1 ? "" : "s"})`
          : `Synced ${finalNames.length} plan${finalNames.length === 1 ? "" : "s"} from Dropbox`;
        this.addLogEntry(summaryMessage, "success");
      }
    } catch (error) {
      if (!silent) {
        this.addLogEntry(
          `Failed to sync plans from Dropbox: ${error.message}`,
          "error",
        );
      }
    }
  }

  async exportAllToDropboxCSV(options = {}) {
    const manual = options?.manual === true;
    if (!manual) {
      this.addLogEntry(
        "Blocked non-manual request to export all workouts as CSV",
        "warning",
      );
      return;
    }

    if (!this.dropboxManager.isConnected) {
      alert("Please connect to Dropbox first");
      return;
    }

    if (this.workoutHistory.length === 0) {
      alert("No workouts to export");
      return;
    }

    try {
      const statusDiv = document.getElementById("dropboxSyncStatus");
      if (statusDiv) statusDiv.textContent = "Exporting to CSV...";

      await this.dropboxManager.exportAllWorkoutsCSV(this.workoutHistory, this.getUnitLabel());

      this.addLogEntry(`Exported ${this.workoutHistory.length} workouts to CSV in Dropbox`, "success");
      if (statusDiv) {
        statusDiv.textContent = "Export complete!";
        setTimeout(() => { if (statusDiv) statusDiv.textContent = ""; }, 5000);
      }
    } catch (error) {
      this.addLogEntry(`Failed to export CSV: ${error.message}`, "error");
      alert(`Failed to export CSV: ${error.message}`);
    }
  }

  requestExportAllToDropboxCSV() {
    return this.exportAllToDropboxCSV({ manual: true });
  }

  setWeightUnit(unit, options = {}) {
    if (unit !== "kg" && unit !== "lb") {
      return;
    }

    const previousUnit = options.previousUnit || this.weightUnit;

    if (unit === this.weightUnit && !options.force) {
      return;
    }

    const weightInput = document.getElementById("weight");
    const progressionInput = document.getElementById("progression");

    const currentWeight = weightInput ? parseFloat(weightInput.value) : NaN;
    const currentProgression = progressionInput
      ? parseFloat(progressionInput.value)
      : NaN;

    const weightKg = !isNaN(currentWeight)
      ? this.convertDisplayToKg(currentWeight, previousUnit)
      : null;
    const progressionKg = !isNaN(currentProgression)
      ? this.convertDisplayToKg(currentProgression, previousUnit)
      : null;

    this.weightUnit = unit;

    if (weightInput && weightKg !== null && !Number.isNaN(weightKg)) {
      weightInput.value = this.formatWeightValue(
        weightKg,
        this.getWeightInputDecimals(),
      );
    }

    if (
      progressionInput &&
      progressionKg !== null &&
      !Number.isNaN(progressionKg)
    ) {
      progressionInput.value = this.formatWeightValue(
        progressionKg,
        this.getProgressionInputDecimals(),
      );
    }

    this.onUnitChanged();
    this.saveWeightUnitPreference();
  }

  onUnitChanged() {
    this.updateUnitToggleUI();
    this.updateLiveWeightDisplay();

    const weightLabel = document.getElementById("weightLabel");
    if (weightLabel) {
      weightLabel.textContent = `Weight per cable (${this.getUnitLabel()}):`;
    }

    const progressionLabel = document.getElementById("progressionLabel");
    if (progressionLabel) {
      progressionLabel.textContent = `Progression/Regression (${this.getUnitLabel()} per rep):`;
    }

    const progressionHint = document.getElementById("progressionHint");
    if (progressionHint) {
      progressionHint.textContent = this.getProgressionRangeText();
    }

    this.updateInputsForUnit();
    this.renderLoadDisplays(this.currentSample);
    this.updateHistoryDisplay();
    this.applyUnitToChart();
    this.updatePersonalBestDisplay();
    this.updatePositionBarColors(this.currentSample);
  }

  getUnitLabel() {
    return this.weightUnit === "lb" ? "lb" : "kg";
  }

  getLoadDisplayDecimals() {
    return this.weightUnit === "lb" ? 1 : 1;
  }

  getWeightInputDecimals() {
    return this.weightUnit === "lb" ? 1 : 1;
  }

  getProgressionInputDecimals() {
    return this.weightUnit === "lb" ? 1 : 1;
  }

  convertKgToDisplay(kg, unit = this.weightUnit) {
    if (kg === null || kg === undefined || isNaN(kg)) {
      return NaN;
    }

    if (unit === "lb") {
      return kg * LB_PER_KG;
    }

    return kg;
  }

  convertDisplayToKg(value, unit = this.weightUnit) {
    if (value === null || value === undefined || isNaN(value)) {
      return NaN;
    }

    if (unit === "lb") {
      return value * KG_PER_LB;
    }

    return value;
  }

  formatWeightValue(kg, decimals = this.getLoadDisplayDecimals()) {
    if (kg === null || kg === undefined || isNaN(kg)) {
      return "";
    }

    const displayValue = this.convertKgToDisplay(kg);
    return displayValue.toFixed(decimals);
  }

  formatWeightWithUnit(kg, decimals = this.getLoadDisplayDecimals()) {
    const value = this.formatWeightValue(kg, decimals);
    if (!value) {
      return value;
    }
    return `${value} ${this.getUnitLabel()}`;
  }

  updateInputsForUnit() {
    const weightInput = document.getElementById("weight");
    if (weightInput) {
      const minDisplay = this.convertKgToDisplay(0);
      const maxDisplay = this.convertKgToDisplay(100);
      weightInput.min = minDisplay.toFixed(this.getWeightInputDecimals());
      weightInput.max = maxDisplay.toFixed(this.getWeightInputDecimals());
      weightInput.step = 0.1;
    }

    const progressionInput = document.getElementById("progression");
    if (progressionInput) {
      const maxDisplay = this.convertKgToDisplay(3);
      progressionInput.min = (-maxDisplay).toFixed(
        this.getProgressionInputDecimals(),
      );
      progressionInput.max = maxDisplay.toFixed(
        this.getProgressionInputDecimals(),
      );
      progressionInput.step = 0.1;
    }
  }

  getWeightRangeText() {
    const min = this.convertKgToDisplay(0);
    const max = this.convertKgToDisplay(100);
    return `${min.toFixed(this.getWeightInputDecimals())}-${max.toFixed(this.getWeightInputDecimals())} ${this.getUnitLabel()}`;
  }

  getProgressionRangeText() {
    const maxDisplay = this.convertKgToDisplay(3);
    const decimals = this.getProgressionInputDecimals();
    const formatted = maxDisplay.toFixed(decimals);
    return `+${formatted} to -${formatted} ${this.getUnitLabel()}`;
  }

  loadStoredWeightUnit() {
    if (typeof window === "undefined" || !window.localStorage) {
      return "kg";
    }
    try {
      const stored = localStorage.getItem("vitruvian.weightUnit");
      if (stored === "lb") {
        return "lb";
      }
    } catch (error) {
      // Ignore storage errors and fall back to default.
    }
    return "kg";
  }

  saveWeightUnitPreference() {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      localStorage.setItem("vitruvian.weightUnit", this.weightUnit);
    } catch (error) {
      // Ignore storage errors (e.g., private browsing).
    }
  }

  renderLoadDisplays(sample) {
    const decimals = this.getLoadDisplayDecimals();
    const unitLabel = this.getUnitLabel();

    const safeSample = sample || {
      loadA: 0,
      loadB: 0,
    };

    const formatLoad = (kg) => {
      if (kg === null || kg === undefined || isNaN(kg)) {
        return `- <span class="stat-unit">${unitLabel}</span>`;
      }
      const value = this.convertKgToDisplay(kg).toFixed(decimals);
      return `${value} <span class="stat-unit">${unitLabel}</span>`;
    };

    const loadAEl = document.getElementById("loadA");
    if (loadAEl) {
      loadAEl.innerHTML = formatLoad(safeSample.loadA);
    }

    const loadBEl = document.getElementById("loadB");
    if (loadBEl) {
      loadBEl.innerHTML = formatLoad(safeSample.loadB);
    }

    const totalEl = document.getElementById("totalLoad");
    if (totalEl) {
      const totalKg = (safeSample.loadA || 0) + (safeSample.loadB || 0);
      totalEl.innerHTML = formatLoad(totalKg);
    }

    this.updatePersonalBestDisplay();
  }

  updatePersonalBestDisplay() {
    const bestEl = document.getElementById("personalBestLoad");
    if (!bestEl) {
      return;
    }

    const unitLabel = this.getUnitLabel();
    const decimals = this.getLoadDisplayDecimals();
    const wrapper = document.getElementById("personalBestWrapper");
    const labelEl = wrapper
      ? wrapper.querySelector(".personal-best-label")
      : null;
    const current = this.currentWorkout;

    const hasIdentity =
      current &&
      typeof current.identityKey === "string" &&
      current.identityKey.length > 0;

    if (labelEl) {
      const hasLabel =
        hasIdentity &&
        typeof current.identityLabel === "string" &&
        current.identityLabel.length > 0;
      const suffix = hasLabel ? ` (${current.identityLabel})` : " (Total)";
      labelEl.textContent = `Personal Best${suffix}`;
    }

    const bestKg = hasIdentity
      ? Number(current.currentPersonalBestKg)
      : NaN;

    if (!hasIdentity || !Number.isFinite(bestKg) || bestKg <= 0) {
      bestEl.innerHTML = `- <span class="stat-unit">${unitLabel}</span>`;
      this.setPersonalBestHighlight(false);
      return;
    }

    const bestDisplay = this.convertKgToDisplay(bestKg).toFixed(decimals);
    bestEl.innerHTML = `${bestDisplay} <span class="stat-unit">${unitLabel}</span>`;
    this.applyPersonalBestHighlight();
  }

  setPersonalBestHighlight(active) {
    this._personalBestHighlight = !!active;
    this.applyPersonalBestHighlight();
  }

  applyPersonalBestHighlight() {
    const bestEl = document.getElementById("personalBestLoad");
    if (!bestEl) {
      return;
    }
    if (this._personalBestHighlight) {
      bestEl.classList.add("highlight");
    } else {
      bestEl.classList.remove("highlight");
    }
  }

  handlePersonalBestAchieved(bestKg) {
    const identityLabel =
      this.currentWorkout && this.currentWorkout.identityLabel
        ? this.currentWorkout.identityLabel
        : null;

    if (this.currentWorkout) {
      this.currentWorkout.hasNewPersonalBest = true;
      const celebrated =
        Number(this.currentWorkout.celebratedPersonalBestKg) || 0;
      if (bestKg > celebrated) {
        this.currentWorkout.celebratedPersonalBestKg = bestKg;
      }
    }

    this.setPersonalBestHighlight(true);
    this.updatePersonalBestDisplay();

    const formatted = this.formatWeightWithUnit(bestKg);
    const message = identityLabel
      ? `New personal best for ${identityLabel}: ${formatted}`
      : `New personal best: ${formatted}`;
    this.addLogEntry(`🎉 ${message}`, "success");

    this.triggerConfetti();
  }

  triggerConfetti() {
    if (this._confettiActive) {
      return;
    }

    this._confettiActive = true;

    const container = document.createElement("div");
    container.className = "confetti-container";
    const root = document.body || document.documentElement;
    if (!root) {
      this._confettiActive = false;
      return;
    }
    root.appendChild(container);

    const colors = ["#51cf66", "#ffd43b", "#74c0fc", "#ff8787", "#845ef7"];
    const pieceCount = 90;

    for (let i = 0; i < pieceCount; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.backgroundColor =
        colors[i % colors.length];
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.setProperty(
        "--confetti-duration",
        `${2.4 + Math.random()}s`,
      );
      piece.style.setProperty(
        "--rotate-start",
        `${Math.floor(Math.random() * 360)}deg`,
      );
      piece.style.setProperty(
        "--rotate-end",
        `${360 + Math.floor(Math.random() * 720)}deg`,
      );
      piece.style.animationDelay = `${Math.random() * 0.6}s`;

      container.appendChild(piece);
    }

    if (this._confettiCleanupTimer) {
      clearTimeout(this._confettiCleanupTimer);
    }

    this._confettiCleanupTimer = setTimeout(() => {
      container.remove();
      this._confettiActive = false;
      this._confettiCleanupTimer = null;
    }, 3500);
  }

  applyUnitToChart() {
    if (!this.chartManager) {
      return;
    }

    const unitLabel = this.getUnitLabel();
    const decimals = this.getLoadDisplayDecimals();

    this.chartManager.setLoadUnit({
      label: unitLabel,
      decimals: decimals,
      toDisplay: (kg) => this.convertKgToDisplay(kg),
    });
  }

  addLogEntry(message, type = "info") {
    const logDiv = document.getElementById("log");
    const entry = document.createElement("div");
    entry.className = `log-line log-${type}`;
    entry.textContent = message;
    logDiv.appendChild(entry);

    // Auto-scroll to bottom
    logDiv.scrollTop = logDiv.scrollHeight;

    // Limit log entries to prevent memory issues
    const maxEntries = 500;
    while (logDiv.children.length > maxEntries) {
      logDiv.removeChild(logDiv.firstChild);
    }
  }

  updateStopButtonState() {
    const stopBtn = document.getElementById("stopBtn");
    if (!stopBtn) return;

    // Check if device is connected and there's an active workout
    const isConnected = this.device && this.device.isConnected;
    const hasActiveWorkout = this.currentWorkout !== null;

    // Grey out if disconnected OR no active workout
    if (!isConnected || !hasActiveWorkout) {
      stopBtn.style.opacity = "0.5";

      // Set tooltip based on the specific issue
      let tooltip = "";
      if (!isConnected && !hasActiveWorkout) {
        tooltip = "Device disconnected and no workout active, but you can still send a stop request if you think this is not right";
      } else if (!isConnected) {
        tooltip = "Device disconnected, but you can still send a stop request if you think this is not right";
      } else {
        tooltip = "No workout active, but you can still send a stop request if you think this is not right";
      }
      stopBtn.title = tooltip;
    } else {
      stopBtn.style.opacity = "1";
      stopBtn.title = "Stop the current workout";
    }
  }

  updateConnectionStatus(connected) {
    const statusDiv = document.getElementById("status");
    const connectBtn = document.getElementById("connectBtn");
    const disconnectBtn = document.getElementById("disconnectBtn");
    const programSection = document.getElementById("programSection");
    const echoSection = document.getElementById("echoSection");
    const colorSection = document.getElementById("colorSection");

    if (connected) {
      statusDiv.textContent = "Connected";
      statusDiv.className = "status connected";
      connectBtn.disabled = true;
      disconnectBtn.disabled = false;
  //KEEP PROGRAM HIDDEN    programSection.classList.remove("hidden");
  //KEEP ECHO HIDDEN    echoSection.classList.remove("hidden");
      colorSection.classList.remove("hidden");
    } else {
      statusDiv.textContent = "Disconnected";
      statusDiv.className = "status disconnected";
      connectBtn.disabled = false;
      disconnectBtn.disabled = true;
      programSection.classList.add("hidden");
      echoSection.classList.add("hidden");
      colorSection.classList.add("hidden");
    }

    this.updateStopButtonState();
  }

  updateLiveStats(sample) {
    // Store current sample for auto-stop checking
    this.currentSample = sample;

    const totalLoadKg =
      (Number(sample?.loadA) || 0) + (Number(sample?.loadB) || 0);

    if (
      this.currentWorkout &&
      typeof this.currentWorkout === "object"
    ) {
      const priorBest =
        Number(this.currentWorkout.priorBestTotalLoadKg) || 0;
      const previousPeak =
        Number(this.currentWorkout.livePeakTotalLoadKg) || 0;
      const livePeak = totalLoadKg > previousPeak ? totalLoadKg : previousPeak;
      const celebrated =
        Number(this.currentWorkout.celebratedPersonalBestKg) || 0;
      const epsilon = 0.0001;

      this.currentWorkout.livePeakTotalLoadKg = livePeak;
      this.currentWorkout.currentPersonalBestKg = Math.max(
        priorBest,
        livePeak,
      );

      if (
        this.currentWorkout.identityKey &&
        livePeak > celebrated + epsilon
      ) {
        this.currentWorkout.hasNewPersonalBest = true;
        this.currentWorkout.celebratedPersonalBestKg = livePeak;
        this.handlePersonalBestAchieved(livePeak);
      }
    }

    // Update numeric displays
    this.renderLoadDisplays(sample);

    // Update position values
    document.getElementById("posAValue").textContent = sample.posA;
    document.getElementById("posBValue").textContent = sample.posB;

    // Auto-adjust max position (shared for both cables to keep bars comparable)
    const currentMax = Math.max(sample.posA, sample.posB);
    if (currentMax > this.maxPos) {
      this.maxPos = currentMax + 100;
    }

    // Update position bars with dynamic scaling
    const heightA = Math.min((sample.posA / this.maxPos) * 100, 100);
    const heightB = Math.min((sample.posB / this.maxPos) * 100, 100);

    document.getElementById("barA").style.height = heightA + "%";
    document.getElementById("barB").style.height = heightB + "%";

    this.updatePositionBarColors(sample);

    // Update range indicators
    this.updateRangeIndicators();

    // Check auto-stop condition for Just Lift mode
    if (this.isJustLiftMode) {
      this.checkAutoStop(sample);
    }

    // Add data to chart
    this.chartManager.addData(sample);
  }

  mixHexColors(colorA, colorB, ratio) {
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const normalize = (hex) => {
      let cleaned = hex.trim().replace("#", "");
      if (cleaned.length === 3) {
        cleaned = cleaned
          .split("")
          .map((ch) => ch + ch)
          .join("");
      }
      if (cleaned.length !== 6) {
        return { r: 0, g: 0, b: 0 };
      }
      const value = parseInt(cleaned, 16);
      return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
      };
    };

    const a = normalize(colorA);
    const b = normalize(colorB);
    const weight = clamp(ratio);
    const inv = 1 - weight;

    const toHex = (value) => {
      const clamped = Math.round(Math.max(0, Math.min(255, value)));
      return clamped.toString(16).padStart(2, "0");
    };

    const r = a.r * inv + b.r * weight;
    const g = a.g * inv + b.g * weight;
    const bChannel = a.b * inv + b.b * weight;

    return `#${toHex(r)}${toHex(g)}${toHex(bChannel)}`;
  }

  applyPositionBarColor(barElement, position, min, max) {
    if (!barElement) {
      return;
    }

    const fallback = "linear-gradient(180deg, #ff6b6b 0%, #228be6 100%)";
    if (
      !Number.isFinite(position) ||
      !Number.isFinite(min) ||
      !Number.isFinite(max)
    ) {
      barElement.style.background = fallback;
      barElement.style.boxShadow = "";
      return;
    }

    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    const span = upper - lower;
    if (!Number.isFinite(span) || span <= 0) {
      barElement.style.background = fallback;
      barElement.style.boxShadow = "";
      return;
    }

    const blue = "#228be6";
    const red = "#ff6b6b";
    const green = "#51cf66";

    let ratio = (position - lower) / span;
    if (!Number.isFinite(ratio)) {
      ratio = 0;
    }
    ratio = Math.max(0, Math.min(1, ratio));

    let topColor = this.mixHexColors(red, blue, 1 - ratio);
    let boxShadow = "0 0 10px rgba(255, 107, 107, 0.35)";

    if (ratio >= 0.97) {
      topColor = green;
      boxShadow = "0 0 16px rgba(81, 207, 102, 0.55)";
    } else if (ratio <= 0.03) {
      topColor = blue;
      boxShadow = "0 0 14px rgba(34, 139, 230, 0.45)";
    }

    const gradient = `linear-gradient(180deg, ${topColor} 0%, ${blue} 100%)`;
    barElement.style.background = gradient;
    barElement.style.boxShadow = boxShadow;
  }

  updatePositionBarColors(sample) {
    const barA = document.getElementById("barA");
    const barB = document.getElementById("barB");

    const posA =
      sample && Number.isFinite(sample.posA) ? Number(sample.posA) : null;
    const posB =
      sample && Number.isFinite(sample.posB) ? Number(sample.posB) : null;

    this.applyPositionBarColor(barA, posA, this.minRepPosA, this.maxRepPosA);
    this.applyPositionBarColor(barB, posB, this.minRepPosB, this.maxRepPosB);
  }

  // Delegate chart methods to ChartManager
  setTimeRange(seconds) {
    const hadSelection =
      this.selectedHistoryKey !== null || this.selectedHistoryIndex !== null;

    if (hadSelection) {
      this.selectedHistoryKey = null;
      this.selectedHistoryIndex = null;
      if (this.chartManager && typeof this.chartManager.clearEventMarkers === "function") {
        this.chartManager.clearEventMarkers();
      }
      this.updateHistoryDisplay();
    }

    this.chartManager.setTimeRange(seconds);
  }





  exportData() {
    const selectedIndex = this.getSelectedHistoryIndex();

    if (selectedIndex >= 0) {
      const workout = this.workoutHistory[selectedIndex];
      if (!workout) {
        this.addLogEntry("Selected workout no longer available for export.", "error");
        this.selectedHistoryKey = null;
        this.selectedHistoryIndex = null;
        this.updateHistoryDisplay();
        return;
      }

      this.exportWorkoutDetailedCSV(selectedIndex, {
        manual: true,
        source: "history-button",
      });
      return;
    }

    this.chartManager.exportCSV();
  }

  // Sidebar toggle supporting desktop collapse and mobile drawer
  toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("overlay");
    if (!sidebar) {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 769px)").matches;

    if (isDesktop) {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      this.applySidebarCollapsedState();
      this.saveSidebarPreference(this.sidebarCollapsed);
    } else {
      sidebar.classList.toggle("open");
      if (overlay) {
        overlay.classList.toggle("show");
      }
      this.updateSidebarToggleVisual();
    }
  }

  closeSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("overlay");
    if (!sidebar) {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 769px)").matches;
    if (isDesktop) {
      return;
    }

    sidebar.classList.remove("open");
    if (overlay) {
      overlay.classList.remove("show");
    }
    this.updateSidebarToggleVisual();
  }

  // Toggle Just Lift mode UI
  toggleJustLiftMode() {
    const justLiftCheckbox = document.getElementById("justLiftCheckbox");
    const repsInput = document.getElementById("reps");
    const modeLabel = document.getElementById("modeLabel");

    if (justLiftCheckbox.checked) {
      // Just Lift mode enabled - disable reps input
      repsInput.disabled = true;
      repsInput.style.opacity = "0.5";
      modeLabel.textContent = "Base Mode (for resistance profile):";
    } else {
      // Regular mode - enable reps input
      repsInput.disabled = false;
      repsInput.style.opacity = "1";
      modeLabel.textContent = "Workout Mode:";
    }
  }

  // Toggle stop at top setting
  toggleStopAtTop() {
    const checkbox = document.getElementById("stopAtTopCheckbox");
    this.stopAtTop = checkbox.checked;
    this.addLogEntry(
      `Stop at top of final rep: ${this.stopAtTop ? "enabled" : "disabled"}`,
      "info",
    );
  }

  // Toggle Just Lift mode UI for Echo mode
  toggleEchoJustLiftMode() {
    const echoJustLiftCheckbox = document.getElementById(
      "echoJustLiftCheckbox",
    );
    const targetRepsInput = document.getElementById("targetReps");

    if (echoJustLiftCheckbox.checked) {
      // Just Lift mode enabled - disable reps input
      targetRepsInput.disabled = true;
      targetRepsInput.style.opacity = "0.5";
    } else {
      // Regular mode - enable reps input
      targetRepsInput.disabled = false;
      targetRepsInput.style.opacity = "1";
    }
  }

  updateRepCounters() {
    // Update warmup counter
    const warmupEl = document.getElementById("warmupCounter");
    if (warmupEl) {
      if (this.currentWorkout) {
        warmupEl.textContent = `${this.warmupReps}/${this.warmupTarget}`;
      } else {
        warmupEl.textContent = `-/3`;
      }
    }

    // Update working reps counter
    const workingEl = document.getElementById("workingCounter");
    if (workingEl) {
      if (this.currentWorkout) {
        if (this.targetReps > 0) {
          workingEl.textContent = `${this.workingReps}/${this.targetReps}`;
        } else {
          workingEl.textContent = `${this.workingReps}`;
        }
      } else {
        workingEl.textContent = `-/-`;
      }
    }
  }

  updateRangeIndicators() {
    // Update range indicators for cable A
    const rangeMinA = document.getElementById("rangeMinA");
    const rangeMaxA = document.getElementById("rangeMaxA");
    const rangeMinB = document.getElementById("rangeMinB");
    const rangeMaxB = document.getElementById("rangeMaxB");
    const rangeBandMinA = document.getElementById("rangeBandMinA");
    const rangeBandMaxA = document.getElementById("rangeBandMaxA");
    const rangeBandMinB = document.getElementById("rangeBandMinB");
    const rangeBandMaxB = document.getElementById("rangeBandMaxB");

    // Cable A
    if (this.minRepPosA !== null && this.maxRepPosA !== null) {
      // Calculate positions as percentage from bottom
      const minPctA = Math.min((this.minRepPosA / this.maxPos) * 100, 100);
      const maxPctA = Math.min((this.maxRepPosA / this.maxPos) * 100, 100);

      rangeMinA.style.bottom = minPctA + "%";
      rangeMaxA.style.bottom = maxPctA + "%";
      rangeMinA.classList.add("visible");
      rangeMaxA.classList.add("visible");

      // Update uncertainty bands
      if (this.minRepPosARange) {
        const minRangeMinPct = Math.min(
          (this.minRepPosARange.min / this.maxPos) * 100,
          100,
        );
        const minRangeMaxPct = Math.min(
          (this.minRepPosARange.max / this.maxPos) * 100,
          100,
        );
        const bandHeight = minRangeMaxPct - minRangeMinPct;

        rangeBandMinA.style.bottom = minRangeMinPct + "%";
        rangeBandMinA.style.height = bandHeight + "%";
        rangeBandMinA.classList.add("visible");
      }

      if (this.maxRepPosARange) {
        const maxRangeMinPct = Math.min(
          (this.maxRepPosARange.min / this.maxPos) * 100,
          100,
        );
        const maxRangeMaxPct = Math.min(
          (this.maxRepPosARange.max / this.maxPos) * 100,
          100,
        );
        const bandHeight = maxRangeMaxPct - maxRangeMinPct;

        rangeBandMaxA.style.bottom = maxRangeMinPct + "%";
        rangeBandMaxA.style.height = bandHeight + "%";
        rangeBandMaxA.classList.add("visible");
      }
    } else {
      rangeMinA.classList.remove("visible");
      rangeMaxA.classList.remove("visible");
      rangeBandMinA.classList.remove("visible");
      rangeBandMaxA.classList.remove("visible");
    }

    // Cable B
    if (this.minRepPosB !== null && this.maxRepPosB !== null) {
      // Calculate positions as percentage from bottom
      const minPctB = Math.min((this.minRepPosB / this.maxPos) * 100, 100);
      const maxPctB = Math.min((this.maxRepPosB / this.maxPos) * 100, 100);

      rangeMinB.style.bottom = minPctB + "%";
      rangeMaxB.style.bottom = maxPctB + "%";
      rangeMinB.classList.add("visible");
      rangeMaxB.classList.add("visible");

      // Update uncertainty bands
      if (this.minRepPosBRange) {
        const minRangeMinPct = Math.min(
          (this.minRepPosBRange.min / this.maxPos) * 100,
          100,
        );
        const minRangeMaxPct = Math.min(
          (this.minRepPosBRange.max / this.maxPos) * 100,
          100,
        );
        const bandHeight = minRangeMaxPct - minRangeMinPct;

        rangeBandMinB.style.bottom = minRangeMinPct + "%";
        rangeBandMinB.style.height = bandHeight + "%";
        rangeBandMinB.classList.add("visible");
      }

      if (this.maxRepPosBRange) {
        const maxRangeMinPct = Math.min(
          (this.maxRepPosBRange.min / this.maxPos) * 100,
          100,
        );
        const maxRangeMaxPct = Math.min(
          (this.maxRepPosBRange.max / this.maxPos) * 100,
          100,
        );
        const bandHeight = maxRangeMaxPct - maxRangeMinPct;

        rangeBandMaxB.style.bottom = maxRangeMinPct + "%";
        rangeBandMaxB.style.height = bandHeight + "%";
        rangeBandMaxB.classList.add("visible");
      }
    } else {
      rangeMinB.classList.remove("visible");
      rangeMaxB.classList.remove("visible");
      rangeBandMinB.classList.remove("visible");
      rangeBandMaxB.classList.remove("visible");
    }
  }

  resetRepCountersToEmpty() {
    this.warmupReps = 0;
    this.workingReps = 0;
    this.currentWorkout = null;
    this.updateLiveWeightDisplay();
    this.updatePersonalBestDisplay();
    this.topPositionsA = [];
    this.bottomPositionsA = [];
    this.topPositionsB = [];
    this.bottomPositionsB = [];
    this.minRepPosA = null;
    this.maxRepPosA = null;
    this.minRepPosB = null;
    this.maxRepPosB = null;
    this.minRepPosARange = null;
    this.maxRepPosARange = null;
    this.minRepPosBRange = null;
    this.maxRepPosBRange = null;
    this.autoStopStartTime = null;
    this.isJustLiftMode = false;
    this.lastTopCounter = undefined;
    this.updateRepCounters();

    // Hide auto-stop timer
    const autoStopTimer = document.getElementById("autoStopTimer");
    if (autoStopTimer) {
      autoStopTimer.style.display = "none";
    }
    this.updateAutoStopUI(0);
    this.updateStopButtonState();
    this.updatePositionBarColors(null);
  }

  normalizeWorkout(workout) {
    if (!workout || typeof workout !== "object") {
      return null;
    }

    const toDate = (value) => {
      if (!value) return null;
      if (value instanceof Date) return value;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const toNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    };

    if (typeof workout.setName === "string") {
      workout.setName = workout.setName.trim();
      if (workout.setName.length === 0) {
        workout.setName = null;
      }
    }

    if (typeof workout.mode === "string") {
      workout.mode = workout.mode.trim();
    }

    workout.timestamp = toDate(workout.timestamp);
    workout.startTime = toDate(workout.startTime);
    workout.warmupEndTime = toDate(workout.warmupEndTime);
    workout.endTime = toDate(workout.endTime);

    if (Object.prototype.hasOwnProperty.call(workout, "weightKg")) {
      workout.weightKg = toNumber(workout.weightKg);
    }

    if (Object.prototype.hasOwnProperty.call(workout, "plannedWeightKg")) {
      workout.plannedWeightKg = toNumber(workout.plannedWeightKg);
    }

    if (!Array.isArray(workout.movementData)) {
      workout.movementData = [];
    }

    workout.movementData = workout.movementData
      .map((point) => {
        if (!point) return null;
        const ts = toDate(point.timestamp);
        if (!ts) return null;
        return {
          timestamp: ts,
          loadA: toNumber(point.loadA),
          loadB: toNumber(point.loadB),
          posA: toNumber(point.posA),
          posB: toNumber(point.posB),
        };
      })
      .filter(Boolean);

    this.calculateTotalLoadPeakKg(workout);
    return workout;
  }

  calculateTotalLoadPeakKg(workout) {
    if (!workout || typeof workout !== "object") {
      return 0;
    }

    const cached = Number(workout.totalLoadPeakKg);
    if (Number.isFinite(cached) && cached > 0) {
      return cached;
    }

    let peak = 0;
    if (Array.isArray(workout.movementData) && workout.movementData.length > 0) {
      for (const point of workout.movementData) {
        const total =
          (Number(point.loadA) || 0) + (Number(point.loadB) || 0);
        if (total > peak) {
          peak = total;
        }
      }
    }

    if (peak <= 0 && Number.isFinite(workout.weightKg)) {
      peak = Math.max(peak, workout.weightKg * 2);
    }

    workout.totalLoadPeakKg = peak;
    return peak;
  }

  getPriorBestTotalLoadKg(identity, options = {}) {
    if (!identity || typeof identity.key !== "string") {
      return 0;
    }

    const excludeWorkout = options.excludeWorkout || null;
    let best = 0;

    for (const item of this.workoutHistory) {
      if (excludeWorkout && item === excludeWorkout) {
        continue;
      }

      const info = this.getWorkoutIdentityInfo(item);
      if (!info || info.key !== identity.key) {
        continue;
      }

      const value = this.calculateTotalLoadPeakKg(item);
      if (value > best) {
        best = value;
      }
    }

    return best;
  }

  initializeCurrentWorkoutPersonalBest() {
    if (!this.currentWorkout) {
      this.updatePersonalBestDisplay();
      return;
    }

    const identity = this.getWorkoutIdentityInfo(this.currentWorkout);
    if (identity) {
      this.currentWorkout.identityKey = identity.key;
      this.currentWorkout.identityLabel = identity.label;
      this.currentWorkout.priorBestTotalLoadKg =
        this.getPriorBestTotalLoadKg(identity);
    } else {
      this.currentWorkout.identityKey = null;
      this.currentWorkout.identityLabel = null;
      this.currentWorkout.priorBestTotalLoadKg = 0;
    }

    this.currentWorkout.livePeakTotalLoadKg = 0;
    this.currentWorkout.currentPersonalBestKg =
      this.currentWorkout.priorBestTotalLoadKg || 0;
    this.currentWorkout.hasNewPersonalBest = false;
    this.currentWorkout.celebratedPersonalBestKg =
      this.currentWorkout.currentPersonalBestKg || 0;

    this.setPersonalBestHighlight(false);

    this.updatePersonalBestDisplay();
  }

  getWorkoutIdentityInfo(workout) {
    if (!workout) return null;

    const setName =
      typeof workout.setName === "string" && workout.setName.trim().length > 0
        ? workout.setName.trim()
        : null;
    if (setName) {
      return { key: `set:${setName.toLowerCase()}`, label: setName };
    }

    const mode =
      typeof workout.mode === "string" && workout.mode.trim().length > 0
        ? workout.mode.trim()
        : null;
    if (mode) {
      return { key: `mode:${mode.toLowerCase()}`, label: mode };
    }

    return null;
  }

  getWorkoutHistoryKey(workout) {
    if (!workout || typeof workout !== "object") {
      return null;
    }

    const timestamp =
      (workout.timestamp instanceof Date && workout.timestamp) ||
      (workout.endTime instanceof Date && workout.endTime) ||
      (workout.startTime instanceof Date && workout.startTime) ||
      null;

    return timestamp ? timestamp.getTime() : null;
  }

  loadSidebarPreference() {
    try {
      const stored = localStorage.getItem("vitruvian.sidebar.collapsed");
      this.sidebarCollapsed = stored === "true";
    } catch {
      this.sidebarCollapsed = false;
    }
  }

  saveSidebarPreference(collapsed) {
    try {
      localStorage.setItem(
        "vitruvian.sidebar.collapsed",
        collapsed ? "true" : "false",
      );
    } catch {
      // Ignore storage errors silently
    }
  }

  applySidebarCollapsedState() {
    const appContainer = document.getElementById("appContainer");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("overlay");

    if (!appContainer || !sidebar) {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 769px)").matches;

    if (isDesktop && this.sidebarCollapsed) {
      appContainer.classList.add("sidebar-collapsed");
    } else {
      appContainer.classList.remove("sidebar-collapsed");
    }

    if (!isDesktop) {
      sidebar.classList.remove("open");
    }

    if (overlay) {
      overlay.classList.remove("show");
    }

    this.updateSidebarToggleVisual();
  }

  updateSidebarToggleVisual() {
    const toggleBtn = document.getElementById("hamburger");
    if (!toggleBtn) {
      return;
    }

    const sidebar = document.getElementById("sidebar");
    const isDesktop = window.matchMedia("(min-width: 769px)").matches;

    let label;
    if (isDesktop) {
      toggleBtn.classList.toggle("is-collapsed", this.sidebarCollapsed);
      label = this.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
    } else {
      const isOpen = sidebar?.classList.contains("open");
      toggleBtn.classList.remove("is-collapsed");
      label = isOpen ? "Close sidebar" : "Open sidebar";
    }

    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.title = label;
  }

  hidePRBanner() {
    const banner = document.getElementById("prBanner");
    if (!banner) return;
    banner.textContent = "";
    banner.classList.add("hidden");
    banner.classList.remove("pr-banner--new", "pr-banner--tie");
  }

  displayTotalLoadPR(workout) {
    const banner = document.getElementById("prBanner");
    if (!banner) return;

    const identity = this.getWorkoutIdentityInfo(workout);
    if (!identity) {
      this.hidePRBanner();
      return;
    }

    const currentPeakKg = this.calculateTotalLoadPeakKg(workout);
    const priorBestKg = this.getPriorBestTotalLoadKg(identity, {
      excludeWorkout: workout,
    });

    const epsilon = 0.0001;
    const isNewPR = currentPeakKg > priorBestKg + epsilon;
    const matchedPR =
      !isNewPR && Math.abs(currentPeakKg - priorBestKg) <= epsilon && priorBestKg > 0;

    const bestKg = Math.max(currentPeakKg, priorBestKg);
    const bestDisplay = this.formatWeightWithUnit(bestKg);
    const currentDisplay = this.formatWeightWithUnit(currentPeakKg);

    banner.classList.remove("hidden", "pr-banner--new", "pr-banner--tie");

    if (isNewPR || priorBestKg <= 0) {
      banner.classList.add("pr-banner--new");
      banner.textContent = `New total load PR for ${identity.label}: ${bestDisplay}!`;
      this.addLogEntry(
        `New total load PR for ${identity.label}: ${bestDisplay}`,
        "success",
      );
    } else if (matchedPR) {
      banner.classList.add("pr-banner--tie");
      banner.textContent = `Matched total load PR for ${identity.label}: ${bestDisplay}`;
      this.addLogEntry(
        `Matched total load PR for ${identity.label}: ${bestDisplay}`,
        "info",
      );
    } else {
      banner.textContent = `Total load PR for ${identity.label}: ${bestDisplay} (current set ${currentDisplay})`;
      this.addLogEntry(
        `Total load PR for ${identity.label} remains ${bestDisplay} (current set ${currentDisplay})`,
        "info",
      );
    }
  }

  addToWorkoutHistory(workout) {
    const normalized = this.normalizeWorkout(workout);
    if (!normalized) {
      return null;
    }
    this.workoutHistory.unshift(normalized); // Add to beginning
    this.updateHistoryDisplay();
    return normalized;
  }

  viewWorkoutOnGraph(index) {
    if (index < 0 || index >= this.workoutHistory.length) {
      this.addLogEntry("Invalid workout index", "error");
      return;
    }

    const workout = this.workoutHistory[index];
    const previousKey = this.selectedHistoryKey;
    const newKey = this.getWorkoutHistoryKey(workout);

    this.selectedHistoryKey = newKey;
    this.selectedHistoryIndex = index;
    this.updateHistoryDisplay();

    this.chartManager.viewWorkout(workout);

    if (newKey !== previousKey) {
      if (Array.isArray(workout.movementData) && workout.movementData.length > 0) {
        this.addLogEntry(
          "Selected workout ready to export via the Load History Export CSV button.",
          "info",
        );
      } else {
        this.addLogEntry(
          "Selected workout has no detailed movement data available for export.",
          "warning",
        );
      }
    }
  }

  exportWorkoutDetailedCSV(index, options = {}) {
    if (options?.manual !== true) {
      this.addLogEntry(
        "Blocked non-manual request to export detailed workout CSV",
        "warning",
      );
      return;
    }

    if (index < 0 || index >= this.workoutHistory.length) {
      this.addLogEntry("Invalid workout index", "error");
      return;
    }

    if (!this.dropboxManager.isConnected) {
      alert("Please connect to Dropbox first to export detailed CSV files");
      return;
    }

    const workout = this.workoutHistory[index];
    if (!workout.movementData || workout.movementData.length === 0) {
      alert("This workout does not have detailed movement data");
      return;
    }

    this.addLogEntry(`Exporting detailed CSV for workout (${workout.movementData.length} data points)...`, "info");

    // Get unit conversion function
    const toDisplayFn = this.weightUnit === "lb"
      ? (kg) => kg * LB_PER_KG
      : (kg) => kg;

    this.dropboxManager.exportWorkoutDetailedCSV(workout, this.getUnitLabel(), toDisplayFn)
      .then(() => {
        this.addLogEntry("Detailed workout CSV exported to Dropbox", "success");
      })
      .catch((error) => {
        this.addLogEntry(`Failed to export CSV: ${error.message}`, "error");
        alert(`Failed to export CSV: ${error.message}`);
      });
  }

  updateHistoryDisplay() {
    const historyList = document.getElementById("historyList");
    if (!historyList) return;

    if (this.workoutHistory.length === 0) {
      historyList.innerHTML = `
        <div style="color: #6c757d; font-size: 0.9em; text-align: center; padding: 20px;">
          No workouts completed yet
        </div>
      `;
      this.selectedHistoryKey = null;
      this.selectedHistoryIndex = null;
      this.updateExportButtonLabel();
      return;
    }

    let matchedSelection = false;

    historyList.innerHTML = this.workoutHistory
      .map((workout, index) => {
        const weightStr =
          workout.weightKg > 0
            ? `${this.formatWeightWithUnit(workout.weightKg)}`
            : "Adaptive";
        const hasTimingData = workout.startTime && workout.endTime;
        const peakKg = this.calculateTotalLoadPeakKg(workout);
        const peakText = peakKg > 0
          ? ` • Peak ${this.formatWeightWithUnit(peakKg)}`
          : "";
        const hasMovementData = workout.movementData && workout.movementData.length > 0;
        const dataPointsText = hasMovementData
          ? ` • ${workout.movementData.length} data points`
          : "";

        const key = this.getWorkoutHistoryKey(workout);
        const isSelected =
          (this.selectedHistoryKey !== null && key === this.selectedHistoryKey) ||
          (this.selectedHistoryKey === null &&
            this.selectedHistoryIndex === index);

        if (isSelected) {
          matchedSelection = true;
          this.selectedHistoryIndex = index;
        }

        const buttonLabel = isSelected ? "📊 Viewing" : "📊 View Graph";
        const buttonClass = isSelected ? "view-graph-btn active" : "view-graph-btn";
        const viewButtonHtml = hasTimingData
          ? `<button class="${buttonClass}" onclick="app.viewWorkoutOnGraph(${index})" title="View this workout on the graph">${buttonLabel}</button>`
          : "";

        return `
  <div class="history-item${isSelected ? " selected" : ""}">
    <div class="history-item-title">
      ${workout.setName ? `${workout.setName}` : "Unnamed Set"}
      ${workout.mode ? ` — ${workout.mode}` : ""}
      ${workout.setNumber && workout.setTotal ? ` (Set ${workout.setNumber}/${workout.setTotal})` : ""}
    </div>
    <div class="history-item-details">
      ${weightStr} • ${workout.reps} reps${peakText}${dataPointsText}
    </div>
    ${viewButtonHtml}
  </div>`;
      })
      .join("");

    if (
      (this.selectedHistoryKey !== null || this.selectedHistoryIndex !== null) &&
      !matchedSelection
    ) {
      this.selectedHistoryKey = null;
      this.selectedHistoryIndex = null;
    }

    this.updateExportButtonLabel();
  }

  getSelectedHistoryIndex() {
    if (this.workoutHistory.length === 0) {
      return -1;
    }

    if (
      this.selectedHistoryIndex !== null &&
      this.selectedHistoryIndex >= 0 &&
      this.selectedHistoryIndex < this.workoutHistory.length
    ) {
      const candidate = this.workoutHistory[this.selectedHistoryIndex];
      const candidateKey = this.getWorkoutHistoryKey(candidate);
      if (
        this.selectedHistoryKey === null ||
        candidateKey === this.selectedHistoryKey
      ) {
        return this.selectedHistoryIndex;
      }
    }

    if (this.selectedHistoryKey === null) {
      return -1;
    }

    return this.workoutHistory.findIndex(
      (workout) => this.getWorkoutHistoryKey(workout) === this.selectedHistoryKey,
    );
  }

  updateExportButtonLabel() {
    const exportBtn = document.getElementById("exportChartButton");
    if (!exportBtn) {
      return;
    }

    const selectedIndex = this.getSelectedHistoryIndex();
    const hasSelection = selectedIndex >= 0;

    exportBtn.textContent = hasSelection ? "Export Workout CSV" : "Export CSV";
    exportBtn.title = hasSelection
      ? "Export detailed movement data for the selected workout to Dropbox."
      : "Export the current load history window as a CSV file.";
    exportBtn.classList.toggle("export-selected", hasSelection);
  }

 completeWorkout() {

const setLabel = document.getElementById("currentSetName");
if (setLabel) setLabel.textContent = "";

  if (this.currentWorkout) {
    // stop polling to avoid queue buildup
    this.device.stopPropertyPolling();
    this.device.stopMonitorPolling();

    const endTime = new Date();
    this.currentWorkout.endTime = endTime;

    // Extract movement data for this workout from chart history
    const movementData = this.extractWorkoutMovementData(
      this.currentWorkout.startTime,
      endTime
    );

    const workout = {
      mode: this.currentWorkout.mode,
      weightKg: this.currentWorkout.weightKg,
      plannedWeightKg: Number.isFinite(
        this.currentWorkout.originalWeightKg,
      )
        ? this.currentWorkout.originalWeightKg
        : this.currentWorkout.weightKg,
      reps: this.workingReps,
      timestamp: endTime,
      startTime: this.currentWorkout.startTime,
      warmupEndTime: this.currentWorkout.warmupEndTime,
      endTime,

      setName: this.currentWorkout.setName || null,
      setNumber: this.currentWorkout.setNumber ?? null,
      setTotal: this.currentWorkout.setTotal ?? null,
      itemType: this.currentWorkout.itemType || null,

      // Include detailed movement data (positions and loads over time)
      movementData: movementData,
    };

    const storedWorkout = this.addToWorkoutHistory(workout);

    // Log movement data capture
    if (movementData.length > 0) {
      this.addLogEntry(`Captured ${movementData.length} movement data points`, "info");
    } else {
      this.addLogEntry("Warning: No movement data captured for this workout", "warning");
    }

    if (storedWorkout) {
      this.displayTotalLoadPR(storedWorkout);
    } else {
      this.hidePRBanner();
    }

    // Auto-save to Dropbox if connected
    if (this.dropboxManager.isConnected) {
      const workoutToPersist = storedWorkout || workout;
      this.dropboxManager.saveWorkout(workoutToPersist)
        .then(() => {
          // Store last backup timestamp
          localStorage.setItem("vitruvian.dropbox.lastBackup", new Date().toISOString());
          this.updateLastBackupDisplay();
          this.addLogEntry("Workout backed up to Dropbox", "success");
        })
        .catch((error) => {
          this.addLogEntry(`Failed to auto-save to Dropbox: ${error.message}`, "error");
        });
    }

    this.resetRepCountersToEmpty();
    this.addLogEntry("Workout completed and saved to history", "success");
  }

  // 👉 hand control back to the plan runner so it can show the rest overlay
  try {
    if (this.planActive && typeof this.planOnWorkoutComplete === "function") {
      this.addLogEntry("Plan: completeWorkout() fired", "info");
      this.planOnWorkoutComplete();
    }
  } catch (e) {
    /* no-op */
  }
}

  // Extract movement data for a specific time range from chart history
  extractWorkoutMovementData(startTime, endTime) {
    if (!this.chartManager || !this.chartManager.loadHistory) {
      return [];
    }

    const startMs = startTime.getTime();
    const endMs = endTime.getTime();

    // Filter loadHistory to only include data points within the workout timeframe
    const workoutData = this.chartManager.loadHistory.filter((point) => {
      const pointMs = point.timestamp.getTime();
      return pointMs >= startMs && pointMs <= endMs;
    });

    // Convert to a simpler format for JSON storage
    return workoutData.map((point) => ({
      timestamp: point.timestamp.toISOString(),
      loadA: point.loadA,
      loadB: point.loadB,
      posA: point.posA,
      posB: point.posB,
    }));
  }


  // Get dynamic window size based on workout phase
  getWindowSize() {
    // During warmup: use last 2 samples
    // During working reps: use last 3 samples
    const totalReps = this.warmupReps + this.workingReps;
    return totalReps < this.warmupTarget ? 2 : 3;
  }

  // Record top position (when u16[0] increments)
  recordTopPosition(posA, posB) {
    // Add to rolling window
    this.topPositionsA.push(posA);
    this.topPositionsB.push(posB);

    // Keep only last N samples based on workout phase
    const windowSize = this.getWindowSize();
    if (this.topPositionsA.length > windowSize) {
      this.topPositionsA.shift();
    }
    if (this.topPositionsB.length > windowSize) {
      this.topPositionsB.shift();
    }

    // Update max positions using rolling average
    this.updateRepRanges();
  }

  // Record bottom position (when u16[2] increments - rep complete)
  recordBottomPosition(posA, posB) {
    // Add to rolling window
    this.bottomPositionsA.push(posA);
    this.bottomPositionsB.push(posB);

    // Keep only last N samples based on workout phase
    const windowSize = this.getWindowSize();
    if (this.bottomPositionsA.length > windowSize) {
      this.bottomPositionsA.shift();
    }
    if (this.bottomPositionsB.length > windowSize) {
      this.bottomPositionsB.shift();
    }

    // Update min positions using rolling average
    this.updateRepRanges();
  }

  // Calculate rolling average for an array
  calculateAverage(arr) {
    if (arr.length === 0) return null;
    const sum = arr.reduce((a, b) => a + b, 0);
    return Math.round(sum / arr.length);
  }

  // Calculate min/max range for uncertainty band
  calculateRange(arr) {
    if (arr.length === 0) return null;
    return {
      min: Math.min(...arr),
      max: Math.max(...arr),
    };
  }

  // Update min/max rep ranges from rolling averages
  updateRepRanges() {
    const oldMinA = this.minRepPosA;
    const oldMaxA = this.maxRepPosA;
    const oldMinB = this.minRepPosB;
    const oldMaxB = this.maxRepPosB;

    // Calculate averages for each position type
    this.maxRepPosA = this.calculateAverage(this.topPositionsA);
    this.minRepPosA = this.calculateAverage(this.bottomPositionsA);
    this.maxRepPosB = this.calculateAverage(this.topPositionsB);
    this.minRepPosB = this.calculateAverage(this.bottomPositionsB);

    // Calculate uncertainty ranges
    this.maxRepPosARange = this.calculateRange(this.topPositionsA);
    this.minRepPosARange = this.calculateRange(this.bottomPositionsA);
    this.maxRepPosBRange = this.calculateRange(this.topPositionsB);
    this.minRepPosBRange = this.calculateRange(this.bottomPositionsB);

    // Log if range changed significantly (> 5 units)
    const rangeChanged =
      (oldMinA !== null && Math.abs(this.minRepPosA - oldMinA) > 5) ||
      (oldMaxA !== null && Math.abs(this.maxRepPosA - oldMaxA) > 5) ||
      (oldMinB !== null && Math.abs(this.minRepPosB - oldMinB) > 5) ||
      (oldMaxB !== null && Math.abs(this.maxRepPosB - oldMaxB) > 5);

    if (rangeChanged || oldMinA === null) {
      const rangeA =
        this.maxRepPosA && this.minRepPosA
          ? this.maxRepPosA - this.minRepPosA
          : 0;
      const rangeB =
        this.maxRepPosB && this.minRepPosB
          ? this.maxRepPosB - this.minRepPosB
          : 0;

      this.addLogEntry(
        `Rep range updated: A[${this.minRepPosA || "?"}-${this.maxRepPosA || "?"}] (${rangeA}), B[${this.minRepPosB || "?"}-${this.maxRepPosB || "?"}] (${rangeB})`,
        "info",
      );
    }

    this.updatePositionBarColors(this.currentSample);
  }

  // Check if we should auto-stop (for Just Lift mode)
  checkAutoStop(sample) {
    // Need at least one cable to have established a range
    if (!this.minRepPosA && !this.minRepPosB) {
      this.updateAutoStopUI(0);
      return;
    }

    const rangeA = this.maxRepPosA - this.minRepPosA;
    const rangeB = this.maxRepPosB - this.minRepPosB;

    // Only check cables that have a meaningful range (> 50 units of movement)
    const minRangeThreshold = 50;
    const checkCableA = rangeA > minRangeThreshold;
    const checkCableB = rangeB > minRangeThreshold;

    // If neither cable has moved significantly, can't auto-stop yet
    if (!checkCableA && !checkCableB) {
      this.updateAutoStopUI(0);
      return;
    }

    let inDangerZone = false;

    // Check cable A if it has meaningful range
    if (checkCableA) {
      const thresholdA = this.minRepPosA + rangeA * 0.05;
      if (sample.posA <= thresholdA) {
        inDangerZone = true;
      }
    }

    // Check cable B if it has meaningful range
    if (checkCableB) {
      const thresholdB = this.minRepPosB + rangeB * 0.05;
      if (sample.posB <= thresholdB) {
        inDangerZone = true;
      }
    }

    if (inDangerZone) {
      if (this.autoStopStartTime === null) {
        // Entered danger zone
        this.autoStopStartTime = Date.now();
        this.addLogEntry(
          "Near bottom of range, starting auto-stop timer (5s)...",
          "info",
        );
      }

      // Calculate elapsed time and update UI
      const elapsed = (Date.now() - this.autoStopStartTime) / 1000;
      const progress = Math.min(elapsed / 5.0, 1.0); // 0 to 1 over 5 seconds
      this.updateAutoStopUI(progress);

      if (elapsed >= 5.0) {
        this.addLogEntry(
          "Auto-stop triggered! Finishing workout...",
          "success",
        );
        this.stopWorkout();
      }
    } else {
      // Reset timer if we left the danger zone
      if (this.autoStopStartTime !== null) {
        this.addLogEntry("Moved out of danger zone, timer reset", "info");
        this.autoStopStartTime = null;
      }
      this.updateAutoStopUI(0);
    }
  }

  // Update the auto-stop timer UI
  updateAutoStopUI(progress) {
    const progressCircle = document.getElementById("autoStopProgress");
    const autoStopText = document.getElementById("autoStopText");

    if (!progressCircle || !autoStopText) return;

    // Circle circumference is ~220 (2 * PI * radius where radius = 35)
    const circumference = 220;
    const offset = circumference - progress * circumference;

    progressCircle.style.strokeDashoffset = offset;

    // Update text based on progress
    if (progress > 0) {
      const timeLeft = Math.ceil((1 - progress) * 5);
      autoStopText.textContent = `${timeLeft}s`;
      autoStopText.style.color = "#dc3545";
      autoStopText.style.fontSize = "1.5em";
    } else {
      autoStopText.textContent = "Auto-Stop";
      autoStopText.style.color = "#6c757d";
      autoStopText.style.fontSize = "0.75em";
    }
  }

  playRepTopSound() {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return;
      }

      if (!this._repAudioContext) {
        this._repAudioContext = new AudioContextClass();
      }

      const context = this._repAudioContext;
      if (context.state === "suspended") {
        context.resume().catch(() => {});
      }

      const now = context.currentTime || 0;
      if (now - this._lastRepTopBeep < 0.08) {
        return;
      }
      this._lastRepTopBeep = now;

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(880, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (error) {
      // Silently ignore audio failures to avoid spamming logs
    }
  }

  handleRepNotification(data) {
    // Parse rep notification
    if (data.length < 6) {
      return; // Not enough data
    }

    // Parse as u16 array
    const numU16 = data.length / 2;
    const u16Values = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    for (let i = 0; i < numU16; i++) {
      u16Values.push(view.getUint16(i * 2, true));
    }

    if (u16Values.length < 3) {
      return; // Need at least u16[0], u16[1], u16[2]
    }

    const topCounter = u16Values[0]; // Reached top of range
    const completeCounter = u16Values[2]; // Rep complete (bottom)

    // Log counters for debugging
    this.addLogEntry(
      `Rep notification: top=${topCounter}, complete=${completeCounter}, pos=[${this.currentSample?.posA || "?"}, ${this.currentSample?.posB || "?"}]`,
      "info",
    );

    // Only process if we have a current sample and active workout
    if (!this.currentSample || !this.currentWorkout) {
      return;
    }

    // Track top of range (u16[1])
    if (this.lastTopCounter === undefined) {
      this.lastTopCounter = topCounter;
    } else {
      // Check if top counter incremented
      let topDelta = 0;
      if (topCounter >= this.lastTopCounter) {
        topDelta = topCounter - this.lastTopCounter;
      } else {
        // Handle wrap-around
        topDelta = 0xffff - this.lastTopCounter + topCounter + 1;
      }

      if (topDelta > 0) {
        // Reached top of range!
        this.addLogEntry(
          `TOP detected! Counter: ${this.lastTopCounter} -> ${topCounter}, pos=[${this.currentSample.posA}, ${this.currentSample.posB}]`,
          "success",
        );
        this.playRepTopSound();
        this.recordTopPosition(
          this.currentSample.posA,
          this.currentSample.posB,
        );
        this.lastTopCounter = topCounter;

        // Check if we should complete at top of final rep
        if (
          this.stopAtTop &&
          !this.isJustLiftMode &&
          this.targetReps > 0 &&
          this.workingReps === this.targetReps - 1
        ) {
          // We're at targetReps - 1, and just reached top
          // This is the top of the final rep, complete now
          this.addLogEntry(
            "Reached top of final rep! Auto-completing workout...",
            "success",
          );
          this.stopWorkout(); // Must be explicitly stopped as the machine thinks the set isn't finished until the bottom of the final rep.
          this.completeWorkout();
        }
      }
    }

    // Track rep complete / bottom of range (u16[2])
    if (this.lastRepCounter === undefined) {
      this.lastRepCounter = completeCounter;
      return;
    }

    // Check if counter incremented
    let delta = 0;
    if (completeCounter >= this.lastRepCounter) {
      delta = completeCounter - this.lastRepCounter;
    } else {
      // Handle wrap-around
      delta = 0xffff - this.lastRepCounter + completeCounter + 1;
    }

    if (delta > 0) {
      // Rep completed! Record bottom position
      this.addLogEntry(
        `BOTTOM detected! Counter: ${this.lastRepCounter} -> ${completeCounter}, pos=[${this.currentSample.posA}, ${this.currentSample.posB}]`,
        "success",
      );
      this.recordBottomPosition(
        this.currentSample.posA,
        this.currentSample.posB,
      );

      const totalReps = this.warmupReps + this.workingReps + 1;

      if (totalReps <= this.warmupTarget) {
        // Still in warmup
        this.warmupReps++;
        this.addLogEntry(
          `Warmup rep ${this.warmupReps}/${this.warmupTarget} complete`,
          "success",
        );

        // Record when warmup ends (last warmup rep complete)
        if (this.warmupReps === this.warmupTarget && this.currentWorkout && !this.currentWorkout.warmupEndTime) {
          this.currentWorkout.warmupEndTime = new Date();
        }
      } else {
        // Working reps
        this.workingReps++;

        if (this.targetReps > 0) {
          this.addLogEntry(
            `Working rep ${this.workingReps}/${this.targetReps} complete`,
            "success",
          );
        } else {
          this.addLogEntry(
            `Working rep ${this.workingReps} complete`,
            "success",
          );
        }

        // Auto-complete workout when target reps are reached (but not for Just Lift)
        // Only applies when stopAtTop is disabled
        if (
          !this.stopAtTop &&
          !this.isJustLiftMode &&
          this.targetReps > 0 &&
          this.workingReps >= this.targetReps
        ) {
          // Complete immediately at bottom (default behavior)
          this.addLogEntry(
            "Target reps reached! Auto-completing workout...",
            "success",
          );
          this.completeWorkout();
        }
      }

      this.updateRepCounters();
    }

    this.lastRepCounter = completeCounter;
  }

  async connect() {
    try {
      // Check if Web Bluetooth is supported
      if (!navigator.bluetooth) {
        alert(
          "Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera.",
        );
        return;
      }

      await this.device.connect();
      this.updateConnectionStatus(true);

      // Send initialization sequence
      await this.device.sendInit();
    } catch (error) {
      console.error("Connection error:", error);
      this.addLogEntry(`Connection failed: ${error.message}`, "error");
      this.updateConnectionStatus(false);
    }
  }

  async disconnect() {
    try {
      await this.device.disconnect();
      this.updateConnectionStatus(false);
    } catch (error) {
      console.error("Disconnect error:", error);
      this.addLogEntry(`Disconnect failed: ${error.message}`, "error");
    }
  }

  async stopWorkout() {
    try {
      await this.device.sendStopCommand();
      this.addLogEntry("Workout stopped by user", "info");

      // Complete the workout and save to history
      this.completeWorkout();
    } catch (error) {
      console.error("Stop workout error:", error);
      this.addLogEntry(`Failed to stop workout: ${error.message}`, "error");
      alert(`Failed to stop workout: ${error.message}`);
    }
  }

  async startProgram() {
    try {
      this.hidePRBanner();

      const modeSelect = document.getElementById("mode");
      const weightInput = document.getElementById("weight");
      const repsInput = document.getElementById("reps");
      const justLiftCheckbox = document.getElementById("justLiftCheckbox");
      const progressionInput = document.getElementById("progression");

      const baseMode = parseInt(modeSelect.value);
      const perCableDisplay = parseFloat(weightInput.value);
      const isJustLift = justLiftCheckbox.checked;
      const reps = isJustLift ? 0 : parseInt(repsInput.value);
      const progressionDisplay = parseFloat(progressionInput.value);

      const perCableKg = this.convertDisplayToKg(perCableDisplay);
      const progressionKg = this.convertDisplayToKg(progressionDisplay);

      // Validate inputs
      if (
        isNaN(perCableDisplay) ||
        isNaN(perCableKg) ||
        perCableKg < 0 ||
        perCableKg > 100
      ) {
        alert(`Please enter a valid weight (${this.getWeightRangeText()})`);
        return;
      }

      if (!isJustLift && (isNaN(reps) || reps < 1 || reps > 100)) {
        alert("Please enter a valid number of reps (1-100)");
        return;
      }

      if (
        isNaN(progressionDisplay) ||
        isNaN(progressionKg) ||
        progressionKg < -3 ||
        progressionKg > 3
      ) {
        alert(
          `Please enter a valid progression (${this.getProgressionRangeText()})`,
        );
        return;
      }

      // Calculate effective weight (per_cable_kg + 10)
      const effectiveKg = perCableKg + 10.0;
      const effectiveDisplay = this.convertKgToDisplay(effectiveKg);

      const params = {
        mode: baseMode, // Not used directly, baseMode is used in protocol
        baseMode: baseMode,
        isJustLift: isJustLift,
        reps: reps,
        perCableKg: perCableKg,
        perCableDisplay: this.convertKgToDisplay(perCableKg),
        effectiveKg: effectiveKg,
        effectiveDisplay: effectiveDisplay,
        progressionKg: progressionKg,
        progressionDisplay: this.convertKgToDisplay(progressionKg),
        displayUnit: this.getUnitLabel(),
        sequenceID: 0x0b,
      };

      // Set rep targets before starting
      this.warmupTarget = 3; // Programs always use 3 warmup reps
      this.targetReps = reps;
      this.isJustLiftMode = isJustLift;
      this.lastRepCounter = undefined;
      this.lastTopCounter = undefined;

      // Reset workout state and set current workout info
      this.warmupReps = 0;
      this.workingReps = 0;
      const modeName = isJustLift
        ? `Just Lift (${ProgramModeNames[baseMode]})`
        : ProgramModeNames[baseMode];



const inPlan = this.planActive && this.planItems[this.planCursor.index];
const planItem = inPlan ? this.planItems[this.planCursor.index] : null;

      this.currentWorkout = {
        mode: modeName || "Program",
        weightKg: perCableKg,
        originalWeightKg: perCableKg,
        adjustedWeightKg: perCableKg,
        targetReps: reps,
        startTime: new Date(),
        warmupEndTime: null,
        endTime: null,

  // ⬇ NEW: plan metadata for history
  setName: planItem?.name || null,
  setNumber: inPlan ? this.planCursor.set : null,
  setTotal: planItem?.sets ?? null,
  itemType: planItem?.type || "exercise",

      };
      this.initializeCurrentWorkoutPersonalBest();
      this.updateRepCounters();
      this.updateLiveWeightDisplay();

      // Show auto-stop timer if Just Lift mode
      const autoStopTimer = document.getElementById("autoStopTimer");
      if (autoStopTimer) {
        autoStopTimer.style.display = isJustLift ? "block" : "none";
      }

      await this.device.startProgram(params);

      // Set up monitor listener
      this.device.addMonitorListener((sample) => {
        this.updateLiveStats(sample);
      });

      // Set up rep listener
      this.device.addRepListener((data) => {
        this.handleRepNotification(data);
      });

      // Update stop button state
      this.updateStopButtonState();

      // Close sidebar on mobile after starting
      this.closeSidebar();
} catch (error) {
      console.error("Start program error:", error);
      this.addLogEntry(`Failed to start program: ${error.message}`, "error");
      alert(`Failed to start program: ${error.message}`);
    }

// === Update current set name under "Live Workout Data" ===
const setLabel = document.getElementById("currentSetName");
if (setLabel) {
  // If a plan is active, show the current plan item's name; otherwise clear
  if (this.planActive && this.planItems[this.planCursor.index]) {
    const planItem = this.planItems[this.planCursor.index];
    setLabel.textContent = planItem.name || "Unnamed Set";
  } else {
    setLabel.textContent = "Live Set";
  }
}

  }

  async startEcho() {
    try {
      this.hidePRBanner();

      const levelSelect = document.getElementById("echoLevel");
      const eccentricInput = document.getElementById("eccentric");
      const targetInput = document.getElementById("targetReps");
      const echoJustLiftCheckbox = document.getElementById(
        "echoJustLiftCheckbox",
      );

      const level = parseInt(levelSelect.value) - 1; // Convert to 0-indexed
      const eccentricPct = parseInt(eccentricInput.value);
      const warmupReps = 3; // Hardcoded warmup reps for Echo mode
      const isJustLift = echoJustLiftCheckbox.checked;
      const targetReps = isJustLift ? 0 : parseInt(targetInput.value);

      // Validate inputs
      if (isNaN(eccentricPct) || eccentricPct < 0 || eccentricPct > 150) {
        alert("Please enter a valid eccentric percentage (0-150)");
        return;
      }

      if (
        !isJustLift &&
        (isNaN(targetReps) || targetReps < 0 || targetReps > 30)
      ) {
        alert("Please enter valid target reps (0-30)");
        return;
      }

      const params = {
        level: level,
        eccentricPct: eccentricPct,
        warmupReps: warmupReps,
        targetReps: targetReps,
        isJustLift: isJustLift,
        sequenceID: 0x01,
      };

      // Set rep targets before starting
      this.warmupTarget = 3; // Always 3 for Echo mode
      this.targetReps = targetReps;
      this.isJustLiftMode = isJustLift;
      this.lastRepCounter = undefined;
      this.lastTopCounter = undefined;

      // Reset workout state and set current workout info
      this.warmupReps = 0;
      this.workingReps = 0;
      const modeName = isJustLift
        ? `Just Lift Echo ${EchoLevelNames[level]}`
        : `Echo ${EchoLevelNames[level]}`;
      
const inPlan = this.planActive && this.planItems[this.planCursor.index];
const planItem = inPlan ? this.planItems[this.planCursor.index] : null;

this.currentWorkout = {
        mode: modeName,
        weightKg: 0, // Echo mode doesn't have fixed weight
        originalWeightKg: 0,
        adjustedWeightKg: 0,
        targetReps: targetReps,
        startTime: new Date(),
        warmupEndTime: null,
        endTime: null,

  setName: planItem?.name || null,
  setNumber: inPlan ? this.planCursor.set : null,
  setTotal: planItem?.sets ?? null,
  itemType: planItem?.type || "echo",

      };
      this.initializeCurrentWorkoutPersonalBest();
      this.updateRepCounters();
      this.updateLiveWeightDisplay();

      // Show auto-stop timer if Just Lift mode
      const autoStopTimer = document.getElementById("autoStopTimer");
      if (autoStopTimer) {
        autoStopTimer.style.display = isJustLift ? "block" : "none";
      }

      await this.device.startEcho(params);

      // Set up monitor listener
      this.device.addMonitorListener((sample) => {
        this.updateLiveStats(sample);
      });

      // Set up rep listener
      this.device.addRepListener((data) => {
        this.handleRepNotification(data);
      });

      // Update stop button state
      this.updateStopButtonState();

      // Close sidebar on mobile after starting
      this.closeSidebar();
    } catch (error) {
      console.error("Start Echo error:", error);
      this.addLogEntry(`Failed to start Echo mode: ${error.message}`, "error");
      alert(`Failed to start Echo mode: ${error.message}`);
    }

// === Update current set name under "Live Workout Data" ===
const setLabel = document.getElementById("currentSetName");
if (setLabel) {
  // If a plan is active, show the current plan item's name; otherwise clear
  if (this.planActive && this.planItems[this.planCursor.index]) {
    const planItem = this.planItems[this.planCursor.index];
    setLabel.textContent = planItem.name || "Unnamed Set";
  } else {
    setLabel.textContent = "Live Set";
  }
}

  }

  loadColorPreset() {
    const presetSelect = document.getElementById("colorPreset");
    const preset = presetSelect.value;

    if (!preset) {
      return; // Custom option selected
    }

    const scheme = PredefinedColorSchemes[preset];
    if (!scheme) {
      return;
    }

    // Update color pickers
    const colorToHex = (color) => {
      return (
        "#" +
        color.r.toString(16).padStart(2, "0") +
        color.g.toString(16).padStart(2, "0") +
        color.b.toString(16).padStart(2, "0")
      );
    };

    document.getElementById("color1").value = colorToHex(scheme.colors[0]);
    document.getElementById("color2").value = colorToHex(scheme.colors[1]);
    document.getElementById("color3").value = colorToHex(scheme.colors[2]);
  }


  /* =========================
     PLAN — DATA HELPERS
     ========================= */

  getUnitLabelShort() { return this.getUnitLabel(); } // alias for UI labels

  // Make an empty Exercise row
  makeExerciseRow() {
    return {
      type: "exercise",
      name: "Untitled Exercise",
      mode: ProgramMode.OLD_SCHOOL,        // numeric mode
      perCableKg: 10,                      // stored as kg
      reps: 10,
      sets: 3,
      restSec: 60,
      cables: 2,
      justLift: false,
      stopAtTop: false,
      progressionKg: 0,                    // reuse progression logic if desired
    };
  }

  // Make an empty Echo row
  makeEchoRow() {
    return {
      type: "echo",
      name: "Echo Block",
      level: EchoLevel.HARD,  // numeric 0..3
      eccentricPct: 100,
      targetReps: 2,
      sets: 3,
      restSec: 60,
      justLift: false,
      stopAtTop: false,
    };
  }


// Apply a plan item to the visible sidebar UI (Program or Echo)
// Also sets the global Stop-at-Top checkbox to match the item's setting.
_applyItemToUI(item){
  if (!item) return;

  // Stop at Top (primary/global)
  const sat = document.getElementById("stopAtTopCheckbox");
  if (sat) {
    sat.checked = !!item.stopAtTop;
    this.stopAtTop = !!item.stopAtTop;           // keep runtime flag in sync
  }

  if (item.type === "exercise") {
    // Program Mode fields
    const modeSel   = document.getElementById("mode");
    const weightInp = document.getElementById("weight");
    const repsInp   = document.getElementById("reps");
    const progInp   = document.getElementById("progression");
    const jlChk     = document.getElementById("justLiftCheckbox");

    if (modeSel)   modeSel.value = String(item.mode);
    if (weightInp) weightInp.value = this.formatWeightValue(item.perCableKg, this.getWeightInputDecimals());
    if (repsInp)   repsInp.value = String(item.reps);
    if (progInp)   progInp.value = this.formatWeightValue(item.progressionKg, this.getProgressionInputDecimals());
    if (jlChk)     { jlChk.checked = !!item.justLift; this.toggleJustLiftMode(); }

  } else if (item.type === "echo") {
    // Echo Mode fields
    const levelSel  = document.getElementById("echoLevel");
    const eccInp    = document.getElementById("eccentric");
    const targInp   = document.getElementById("targetReps");
    const jlChkE    = document.getElementById("echoJustLiftCheckbox");

    // UI is 1..4 while internal is 0..3 in many builds—adjust if your UI expects 0..3, drop the +1
    if (levelSel) levelSel.value = String((item.level ?? 0) + 1);
    if (eccInp)   eccInp.value   = String(item.eccentricPct ?? 100);
    if (targInp)  targInp.value  = String(item.targetReps ?? 0);
    if (jlChkE)   { jlChkE.checked = !!item.justLift; this.toggleEchoJustLiftMode(); }
  }

  this.updateLiveWeightDisplay();
}


  /* =========================
     PLAN — UI RENDER
     ========================= */

  renderPlanUI() {
    const container = document.getElementById("planItems");
    if (!container) return;

    const unit = this.getUnitLabelShort();

    const makeRow = (item, i) => {
      const card = document.createElement("div");
      card.style.background = "#f8f9fa";
      card.style.padding = "12px";
      card.style.borderRadius = "8px";
      card.style.borderLeft = "4px solid #667eea";

      const sectionTitle =
        item.type === "exercise"
          ? `Exercise`
          : `Echo Mode`;

      const title = document.createElement("div");
      title.style.display = "flex";
      title.style.justifyContent = "space-between";
      title.style.alignItems = "center";
      title.style.marginBottom = "10px";
      title.innerHTML = `
        <div style="font-weight:700; color:#212529">${sectionTitle}</div>
        <div style="display:flex; gap:8px;">
          <button class="secondary" style="width:auto; padding:6px 10px;" onclick="app.movePlanItem(${i}, -1)">Move Up</button>
          <button class="secondary" style="width:auto; padding:6px 10px;" onclick="app.movePlanItem(${i}, 1)">Move Down</button>
          <button class="secondary" style="width:auto; padding:6px 10px; background:#dc3545" onclick="app.removePlanItem(${i})">Delete</button>
        </div>
      `;
      card.appendChild(title);

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "1fr 1fr";
      grid.style.gap = "10px";

      // Common: Name, Sets, Rest, JL, StopAtTop
      const commonHtml = `
        <div class="form-group">
          <label>Name</label>
          <input type="text" value="${item.name || ""}" oninput="app.updatePlanField(${i}, 'name', this.value)" />
        </div>

        <div class="form-group">
          <label>Sets</label>
          <input type="number" min="1" max="99" value="${item.sets}" oninput="app.updatePlanField(${i}, 'sets', parseInt(this.value)||1)" />
        </div>

        <div class="form-group">
          <label>Rest (sec)</label>
          <input type="number" min="0" max="600" value="${item.restSec}" oninput="app.updatePlanField(${i}, 'restSec', parseInt(this.value)||0)" />
        </div>

        <div class="form-group" style="align-self:center">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" ${item.justLift ? "checked" : ""} onchange="app.updatePlanField(${i}, 'justLift', this.checked)" style="width:auto;" />
            <span>Just lift mode</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:6px;">
            <input type="checkbox" ${item.stopAtTop ? "checked" : ""} onchange="app.updatePlanField(${i}, 'stopAtTop', this.checked)" style="width:auto;" />
            <span>Stop at Top of final rep</span>
          </label>
        </div>
      `;

      if (item.type === "exercise") {
        const displayPerCable = this.formatWeightValue(item.perCableKg);
        const modeOptions = [
          [ProgramMode.OLD_SCHOOL, "Old School"],
          [ProgramMode.PUMP, "Pump"],
          [ProgramMode.TUT, "TUT"],
          [ProgramMode.TUT_BEAST, "TUT Beast"],
          [ProgramMode.ECCENTRIC_ONLY, "Eccentric Only"],
        ].map(([val, label]) => `<option value="${val}" ${item.mode===val?"selected":""}>${label}</option>`).join("");

        grid.innerHTML = `
          <div class="form-group">
            <label>Mode</label>
            <select onchange="app.updatePlanField(${i}, 'mode', parseInt(this.value))">
              ${modeOptions}
            </select>
          </div>

          <div class="form-group">
            <label>Weight per cable (${unit})</label>
            <input type="number" min="0" max="1000" step="${unit==='lb' ? 1 : 0.5}"
                   value="${this.convertKgToDisplay(item.perCableKg).toFixed(this.getWeightInputDecimals())}"
                   oninput="app.updatePlanPerCableDisplay(${i}, this.value)" />
          </div>

          <div class="form-group">
            <label>Reps</label>
            <input type="number" min="0" max="100" value="${item.reps}" oninput="app.updatePlanField(${i}, 'reps', parseInt(this.value)||0)" />
          </div>

          <div class="form-group">
            <label>Cables</label>
            <input type="number" min="1" max="2" value="${item.cables}" oninput="app.updatePlanField(${i}, 'cables', Math.min(2, Math.max(1, parseInt(this.value)||1)))" />
          </div>

          <div class="form-group">
            <label>Progression (${unit} per rep)</label>
            <input type="number"
                   step="${unit==='lb' ? 0.2 : 0.1}"
                   min="${this.convertKgToDisplay(-3)}"
                   max="${this.convertKgToDisplay(3)}"
                   value="${this.convertKgToDisplay(item.progressionKg).toFixed(this.getProgressionInputDecimals())}"
                   oninput="app.updatePlanProgressionDisplay(${i}, this.value)" />
          </div>

          ${commonHtml}
        `;
      } else {
        // echo
        const levelOptions = [
          [EchoLevel.HARD, "Hard"],
          [EchoLevel.HARDER, "Harder"],
          [EchoLevel.HARDEST, "Hardest"],
          [EchoLevel.EPIC, "Epic"],
        ].map(([val, label]) => `<option value="${val}" ${item.level===val?"selected":""}>${label}</option>`).join("");

        grid.innerHTML = `
          <div class="form-group">
            <label>Level</label>
            <select onchange="app.updatePlanField(${i}, 'level', parseInt(this.value))">
              ${levelOptions}
            </select>
          </div>

          <div class="form-group">
            <label>Eccentric %</label>
            <input type="number" min="0" max="150" step="5" value="${item.eccentricPct}" oninput="app.updatePlanField(${i}, 'eccentricPct', parseInt(this.value)||0)" />
          </div>

          <div class="form-group">
            <label>Target Reps</label>
            <input type="number" min="0" max="30" value="${item.targetReps}" oninput="app.updatePlanField(${i}, 'targetReps', parseInt(this.value)||0)" />
          </div>

          ${commonHtml}
        `;
      }

      card.appendChild(grid);
      return card;
    };

    container.innerHTML = "";
    if (this.planItems.length === 0) {
      const empty = document.createElement("div");
      empty.style.color = "#6c757d";
      empty.style.fontSize = "0.9em";
      empty.style.textAlign = "center";
      empty.style.padding = "10px";
      empty.textContent = "No items yet — add an Exercise or Echo Mode.";
      container.appendChild(empty);
    } else {
      this.planItems.forEach((it, idx) => container.appendChild(makeRow(it, idx)));
    }
  }

  /* =========================
     PLAN — UI ACTIONS
     ========================= */

  addPlanExercise() {
    this.planItems.push(this.makeExerciseRow());
    this.renderPlanUI();
  }

  addPlanEcho() {
    this.planItems.push(this.makeEchoRow());
    this.renderPlanUI();
  }

  resetPlanToDefaults() {
    this.planItems = [
      { ...this.makeExerciseRow(), name: "Back Squat", mode: ProgramMode.OLD_SCHOOL, perCableKg: 15, reps: 8, sets: 3, restSec: 90, stopAtTop: true },
      { ...this.makeEchoRow(),    name: "Echo Finishers", level: EchoLevel.HARDER, eccentricPct: 120, targetReps: 2, sets: 2, restSec: 60 },
    ];
    this.renderPlanUI();
  }

  removePlanItem(index) {
    this.planItems.splice(index, 1);
    this.renderPlanUI();
  }

  movePlanItem(index, delta) {
    const j = index + delta;
    if (j < 0 || j >= this.planItems.length) return;
    const [row] = this.planItems.splice(index, 1);
    this.planItems.splice(j, 0, row);
    this.renderPlanUI();
  }

  updatePlanField(index, key, value) {
    const it = this.planItems[index];
    if (!it) return;
    it[key] = value;
    // If user toggled stopAtTop on an item, nothing live to do yet; applied when running that item.
  }

  updatePlanPerCableDisplay(index, displayVal) {
    const kg = this.convertDisplayToKg(parseFloat(displayVal));
    if (isNaN(kg)) return;
    this.planItems[index].perCableKg = Math.max(0, kg);
  }

  updatePlanProgressionDisplay(index, displayVal) {
    const kg = this.convertDisplayToKg(parseFloat(displayVal));
    if (isNaN(kg)) return;
    this.planItems[index].progressionKg = Math.max(-3, Math.min(3, kg));
  }

startPlan(){
 
 // ✅ 1. Check device connection first
  if (!this.device || !this.device.isConnected) {
    // Add message in the console log panel
    this.addLogEntry("⚠️ Please connect your Vitruvian device before starting a plan.", "error");
    // Optional popup for visibility
    alert("Please connect your Vitruvian device before starting a plan.");
    return; // Stop execution
  }

 if (!this.planItems || this.planItems.length === 0){
    this.addLogEntry("No items in plan.", "warning");
    return;
  }

  this.planActive = true;
  this.planCursor = { index: 0, set: 1 };
  this.planOnWorkoutComplete = () => this._planAdvance();
  this.addLogEntry(`Starting plan with ${this.planItems.length} item(s)`, "success");

  // ⬇️ Prefill Program/Echo UI + Stop-at-Top & Just Lift for the first set
  this._applyItemToUI(this.planItems[0]);

  // If you auto-start, keep this; otherwise, remove the next line to let user review first:
  this._runCurrentPlanBlock();
}


// Run the currently selected plan block (exercise or echo)
// Uses the visible UI and calls startProgram()/startEcho() just like pressing the buttons.
async _runCurrentPlanBlock(){
  if (!this.planActive) return;

  const i = this.planCursor.index;
  const item = this.planItems[i];
  if (!item){ this._planFinish?.(); return; }

  // Prefill sidebar so startProgram/startEcho read the right values
  this._applyItemToUI?.(item);

  // Log what's about to run
  const label = item.type === "exercise" ? "exercise" : "echo";
  this.addLogEntry(`Plan item ${i+1}/${this.planItems.length}, set ${this.planCursor.set}/${item.sets}: ${item.name || "Untitled " + (label[0].toUpperCase()+label.slice(1))}`, "info");

  try {
    // Respect per-item Stop-at-Top for this run
    const prevStopAtTop = this.stopAtTop;
    this.stopAtTop = !!item.stopAtTop;

    if (item.type === "exercise") {
      // Starts using values we just injected into Program Mode UI
      this.addLogEntry("Starting exercise — set " + this.planCursor.set + "/" + item.sets, "info");
      await this.startProgram();
    } else {
      // Starts using values we just injected into Echo Mode UI
      this.addLogEntry("Starting echo — set " + this.planCursor.set + "/" + item.sets, "info");
      await this.startEcho();
    }

    // restore global flag after we’ve kicked off the set
    this.stopAtTop = prevStopAtTop;
  } catch (e) {
    this.addLogEntry(`Failed to start plan block: ${e.message}`, "error");
    // fail-safe: try finishing the plan so we don't get stuck
    this._planFinish?.();
  }
}

// Decide next step after a block finishes: next set of same item, or next item.
// Schedules rest and then calls _runCurrentPlanBlock() again.
_planAdvance(){
  if (!this.planActive) return;

  const curIndex = this.planCursor.index;
  const item = this.planItems[curIndex];
  if (!item){ this._planFinish?.(); return; }

  // If more sets remain for this item → rest, then same item next set
  if (this.planCursor.set < item.sets) {
    this.planCursor.set += 1;

    // Build "Up next" preview text
    const unit = this.getUnitLabel();
    let nextHtml = "";
    if (item.type === "exercise"){
      const w = this.convertKgToDisplay(item.perCableKg).toFixed(this.getWeightInputDecimals());
      const modeName = ProgramModeNames?.[item.mode] || "Mode";
      nextHtml = `${modeName} • ${w} ${unit}/cable × ${item.cables ?? 2} • ${item.reps} reps`;
    } else {
      const lvl = EchoLevelNames?.[item.level] || "Level";
      nextHtml = `${lvl} • ecc ${item.eccentricPct}% • target ${item.targetReps} reps`;
    }

    // Prefill the UI for the upcoming set so startProgram/startEcho will read correct values
    this._applyItemToUI?.(item);

    // Rest → then run the same item again
    this.addLogEntry(`Rest ${item.restSec}s → then next set/item (_runCurrentPlanBlock)`, "info");
    this._beginRest
      ? this._beginRest(item.restSec, () => this._runCurrentPlanBlock(), `Next set (${this.planCursor.set}/${item.sets})`, nextHtml, item)
      : setTimeout(() => this._runCurrentPlanBlock(), Math.max(0, (item.restSec|0))*1000);
    return;
  }

  // Otherwise advance to next item
  this.planCursor.index += 1;
  this.planCursor.set = 1;

  if (this.planCursor.index >= this.planItems.length){
    // No more items
    this._planFinish?.();
    return;
  }

  const nextItem = this.planItems[this.planCursor.index];

  // Build "Up next" preview text
  const unit = this.getUnitLabel();
  let nextHtml = "";
  if (nextItem.type === "exercise"){
    const w = this.convertKgToDisplay(nextItem.perCableKg).toFixed(this.getWeightInputDecimals());
    const modeName = ProgramModeNames?.[nextItem.mode] || "Mode";
    nextHtml = `${modeName} • ${w} ${unit}/cable × ${nextItem.cables ?? 2} • ${nextItem.reps} reps`;
  } else {
    const lvl = EchoLevelNames?.[nextItem.level] || "Level";
    nextHtml = `${lvl} • ecc ${nextItem.eccentricPct}% • target ${nextItem.targetReps} reps`;
  }

  // Prefill the UI for the next item so startProgram/startEcho will read correct values
  this._applyItemToUI?.(nextItem);

  // Use the *current* item's rest before the next item starts (common convention)
  this.addLogEntry(`Rest ${item.restSec}s → then next set/item (_runCurrentPlanBlock)`, "info");
  this._beginRest
    ? this._beginRest(item.restSec, () => this._runCurrentPlanBlock(), `Next: ${nextItem.name || (nextItem.type === "exercise" ? "Exercise" : "Echo Mode")}`, nextHtml, nextItem)
    : setTimeout(() => this._runCurrentPlanBlock(), Math.max(0, (item.restSec|0))*1000);
}


// Show a ring countdown, update “up next”, wire Skip/+30s, then call onDone()
_beginRest(totalSec, onDone, labelText = "Next set", nextHtml = "", nextItemOrName = null) {
  const overlay   = document.getElementById("restOverlay");
  const progress  = document.getElementById("restProgress");
  const timeText  = document.getElementById("restTimeText");
  const nextDiv   = document.getElementById("restNext");
  const addBtn    = document.getElementById("restAddBtn");
  const skipBtn   = document.getElementById("restSkipBtn");
  const inlineHud = document.getElementById("planRestInline");
  const setNameEl = document.getElementById("restSetName");

  // Fallback: if overlay not present, just delay then continue
  if (!overlay || !progress || !timeText) {
    const ms = Math.max(0, (totalSec|0) * 1000);
    this.addLogEntry(`(No overlay found) Rest ${totalSec}s…`, "info");
    setTimeout(() => onDone && onDone(), ms);
    return;
  }

  // Setup UI
  overlay.classList.remove("hidden");
  if (nextDiv) nextDiv.innerHTML = nextHtml || "";
  if (inlineHud) inlineHud.textContent = `Rest: ${totalSec}s`;

  const nextName = (typeof nextItemOrName === "string")
    ? nextItemOrName
    : (nextItemOrName && nextItemOrName.name) || "";
  if (setNameEl) setNameEl.textContent = nextName;

  const CIRC = 2 * Math.PI * 45; // r=45 in index.html
  progress.setAttribute("stroke-dasharray", CIRC.toFixed(3));

  let remaining = Math.max(0, totalSec|0);
  let paused = false;
  let rafId = null;
  let endT = performance.now() + remaining * 1000;

  const closeOverlay = () => { // ← NEW helper to clear name as well
    overlay.classList.add("hidden");
    if (inlineHud) inlineHud.textContent = "";
    if (setNameEl) setNameEl.textContent = "";
  };

  const tick = (t) => {
    if (paused) { rafId = requestAnimationFrame(tick); return; }
    const leftMs = Math.max(0, endT - t);
    remaining = Math.ceil(leftMs / 1000);

    // ring
    const ratio = Math.min(1, Math.max(0, leftMs / (totalSec * 1000)));
    const dash  = ratio * CIRC;
    progress.setAttribute("stroke-dashoffset", String((CIRC - dash).toFixed(3)));

    // text
    timeText.textContent = String(remaining);
    if (inlineHud) inlineHud.textContent = `Rest: ${remaining}s`;

    if (leftMs <= 0) {
      // done
      cancelAnimationFrame(rafId);
      overlay.classList.add("hidden");
      if (inlineHud) inlineHud.textContent = "";
      this.addLogEntry("Rest finished → starting next block", "success");
      onDone && onDone();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  // Buttons
  const add30 = () => {
    const addMs = 30_000;
    endT += addMs;
    this.addLogEntry("+30s added to rest", "info");
  };
  const skip = () => {
    this.addLogEntry("Rest skipped", "info");
    cancelAnimationFrame(rafId);
    overlay.classList.add("hidden");
    if (inlineHud) inlineHud.textContent = "";
    onDone && onDone();
  };

  addBtn.onclick = add30;
  skipBtn.onclick = skip;

  // start loop
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}



  /* =========================
     PLAN — PERSISTENCE
     ========================= */

  plansKey() { return "vitruvian.plans.index"; }
  planKey(name) { return `vitruvian.plan.${name}`; }

  getAllPlanNames() {
    try {
      const raw = localStorage.getItem(this.plansKey());
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  setAllPlanNames(arr) {
    const names = Array.isArray(arr) ? Array.from(new Set(arr)) : [];
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    try {
      localStorage.setItem(this.plansKey(), JSON.stringify(names));
    } catch {}
    return names;
  }

  async ingestExternalPlan(name, items) {
    if (!name || !Array.isArray(items) || !items.length) {
      throw new Error('Invalid plan payload');
    }

    try {
      localStorage.setItem(this.planKey(name), JSON.stringify(items));
    } catch (error) {
      throw new Error('Unable to store plan locally');
    }

    const names = new Set(this.getAllPlanNames());
    names.add(name);
    this.setAllPlanNames([...names]);
    this.refreshPlanSelectNames();

    if (this.dropboxManager && this.dropboxManager.isConnected) {
      await this.dropboxManager.savePlan(name, items);
      this.addLogEntry(`Saved plan "${name}" to Dropbox from Workout Builder`, 'success');
    } else {
      this.addLogEntry(`Stored plan "${name}" from Workout Builder`, 'info');
    }
  }

  populatePlanSelect() {
    const sel = document.getElementById("planSelect");
    if (!sel) return;
    const names = this.getAllPlanNames();
    const previous = sel.value;
    sel.innerHTML = names.length
      ? names.map((n) => `<option value="${n}">${n}</option>`).join("")
      : `<option value="">(no saved plans)</option>`;

    if (names.length > 0) {
      if (names.includes(previous)) {
        sel.value = previous;
      } else {
        sel.value = names[0];
      }
    }
  }

  refreshPlanSelectNames() {
    const sel = document.getElementById("planSelect");
    if (!sel) return;
    const current = sel.value;
    this.populatePlanSelect();
    if (current && [...sel.options].some((opt) => opt.value === current)) {
      sel.value = current;
    }
  }

  async saveCurrentPlan() {
    const nameInput = document.getElementById("planNameInput");
    const name = (nameInput?.value || "").trim();
    if (!name) { alert("Enter a plan name first."); return; }
    try {
      localStorage.setItem(this.planKey(name), JSON.stringify(this.planItems));
      const names = new Set(this.getAllPlanNames());
      names.add(name);
      this.setAllPlanNames([...names]);
      this.refreshPlanSelectNames();
      this.addLogEntry(`Saved plan "${name}" (${this.planItems.length} items)`, "success");
    } catch (e) {
      alert(`Could not save plan: ${e.message}`);
      return;
    }

    if (this.dropboxManager.isConnected) {
      try {
        await this.dropboxManager.savePlan(name, this.planItems);
        this.addLogEntry(`Uploaded plan "${name}" to Dropbox`, "success");
      } catch (error) {
        this.addLogEntry(
          `Failed to sync plan "${name}" to Dropbox: ${error.message}`,
          "error",
        );
        alert(`Plan saved locally but Dropbox sync failed: ${error.message}`);
      }
    }
  }

  async loadSelectedPlan() {
    const sel = document.getElementById("planSelect");
    if (!sel || !sel.value) { alert("No saved plan selected."); return; }
    try {
      let raw = localStorage.getItem(this.planKey(sel.value));

      if (!raw && this.dropboxManager.isConnected) {
        await this.syncPlansFromDropbox({ silent: true });
        raw = localStorage.getItem(this.planKey(sel.value));
      }

      if (!raw) { alert("Saved plan not found."); return; }
      this.planItems = JSON.parse(raw) || [];
      this.renderPlanUI();
      this.addLogEntry(`Loaded plan "${sel.value}"`, "success");
    } catch (e) {
      alert(`Could not load plan: ${e.message}`);
    }
  }

  async deleteSelectedPlan() {
    const sel = document.getElementById("planSelect");
    if (!sel || !sel.value) { alert("No saved plan selected."); return; }
    const name = sel.value;
    const currentNames = this.getAllPlanNames();
    const remaining = currentNames.filter((n) => n !== name);

    if (this.dropboxManager.isConnected) {
      try {
        await this.dropboxManager.deletePlan(name);
        this.addLogEntry(`Removed plan "${name}" from Dropbox`, "info");
      } catch (error) {
        this.addLogEntry(
          `Failed to delete plan "${name}" from Dropbox: ${error.message}`,
          "error",
        );
        alert(`Could not delete plan from Dropbox: ${error.message}`);
        return;
      }
    }

    try {
      localStorage.removeItem(this.planKey(name));
      this.setAllPlanNames(remaining);
      this.refreshPlanSelectNames();
      this.addLogEntry(`Deleted plan "${name}"`, "info");
    } catch (e) {
      alert(`Could not delete plan: ${e.message}`);
    }
  }





  async setColorScheme() {
    try {
      const color1Input = document.getElementById("color1");
      const color2Input = document.getElementById("color2");
      const color3Input = document.getElementById("color3");

      // Use fixed brightness of 0.4 (adjusting brightness doesn't seem to work)
      const brightness = 0.4;

      // Parse colors from hex inputs
      const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
          ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16),
            }
          : { r: 0, g: 0, b: 0 };
      };

      const colors = [
        hexToRgb(color1Input.value),
        hexToRgb(color2Input.value),
        hexToRgb(color3Input.value),
      ];

      await this.device.setColorScheme(brightness, colors);
    } catch (error) {
      console.error("Set color scheme error:", error);
      this.addLogEntry(`Failed to set color scheme: ${error.message}`, "error");
      alert(`Failed to set color scheme: ${error.message}`);
    }
  }
}

// Create global app instance
const app = new VitruvianApp();

// Log startup message
app.addLogEntry("Vitruvian Web Control Ready", "success");
app.addLogEntry('Click "Connect to Device" to begin', "info");
app.addLogEntry("", "info");
app.addLogEntry("Requirements:", "info");
app.addLogEntry("- Chrome, Edge, or Opera browser", "info");
app.addLogEntry("- HTTPS connection (or localhost)", "info");
app.addLogEntry("- Bluetooth enabled on your device", "info");
