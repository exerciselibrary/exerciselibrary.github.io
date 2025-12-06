// app.js - Main application logic and UI management

const sharedWeights = window.WeightUtils || {};
let sharedEchoTelemetry = typeof window !== "undefined" ? window.EchoTelemetry || null : null;
const resolveSharedEchoTelemetry = () => {
  if (typeof window === "undefined") {
    sharedEchoTelemetry = null;
    return sharedEchoTelemetry;
  }
  if (window.EchoTelemetry && window.EchoTelemetry !== sharedEchoTelemetry) {
    sharedEchoTelemetry = window.EchoTelemetry;
  }
  return sharedEchoTelemetry;
};
const LB_PER_KG = sharedWeights.LB_PER_KG || 2.2046226218488;
const KG_PER_LB = sharedWeights.KG_PER_LB || 1 / LB_PER_KG;
const fallbackConvertKgToUnit = (kg, unit = "kg") => {
  if (kg === null || kg === undefined || isNaN(kg)) {
    return NaN;
  }
  return unit === "lb" ? kg * LB_PER_KG : kg;
};
const fallbackConvertUnitToKg = (value, unit = "kg") => {
  if (value === null || value === undefined || isNaN(value)) {
    return NaN;
  }
  return unit === "lb" ? value * KG_PER_LB : value;
};
const sharedConvertKgToUnit =
  typeof sharedWeights.convertKgToUnit === "function"
    ? sharedWeights.convertKgToUnit
    : fallbackConvertKgToUnit;
const sharedConvertUnitToKg =
  typeof sharedWeights.convertUnitToKg === "function"
    ? sharedWeights.convertUnitToKg
    : fallbackConvertUnitToKg;
const sharedGetUnitPreference =
  typeof sharedWeights.getStoredUnitPreference === "function"
    ? sharedWeights.getStoredUnitPreference
    : null;
const sharedSetUnitPreference =
  typeof sharedWeights.setStoredUnitPreference === "function"
    ? sharedWeights.setStoredUnitPreference
    : null;
let sharedAnalyzePhases = null;
let sharedIsEchoWorkout = null;
const refreshSharedEchoTelemetryHelpers = () => {
  const telemetry = resolveSharedEchoTelemetry();
  sharedAnalyzePhases =
    typeof telemetry?.analyzeMovementPhases === "function"
      ? telemetry.analyzeMovementPhases
      : typeof telemetry?.analyzeEchoWorkout === "function"
        ? telemetry.analyzeEchoWorkout
        : null;
  sharedIsEchoWorkout =
    typeof telemetry?.isEchoWorkout === "function"
      ? telemetry.isEchoWorkout
      : null;
};
refreshSharedEchoTelemetryHelpers();
const DEFAULT_PER_CABLE_KG = 4; // ≈8.8 lb baseline when nothing is loaded
const MIN_ACTIVE_CABLE_RANGE = 35; // minimum delta between red/green markers to treat a cable as engaged for load tracking
const AUTO_STOP_RANGE_THRESHOLD = 50; // slightly higher buffer for safety before auto-stop logic activates
const EXCEL_MAX_ROWS = 1048576;
const PR_HIGHLIGHT_STYLE = {
  fill: {
    patternType: "solid",
    fgColor: { rgb: "FFC6EFCE" }, // Excel "Good" style
    bgColor: { rgb: "FFC6EFCE" },
  },
};
const HEADER_STYLE = {
  fill: {
    patternType: "solid",
    fgColor: { rgb: "FF1F4E78" },
    bgColor: { rgb: "FF1F4E78" },
  },
  font: {
    color: { rgb: "FFFFFFFF" },
    bold: true,
  },
};
const WORKOUT_TAB_COLOR = { rgb: "FF2E75B6" };
const PR_TAB_COLOR = { rgb: "FFF1C232" };
const PLAN_SUMMARY_FLAT_AMOUNTS = [0.5, 1, 1.5, 2, 2.5, 5];
const PLAN_SUMMARY_PERCENT_AMOUNTS = [0.5, 1, 1.5, 2, 2.5, 5];
const FILTERED_HISTORY_PAGE_SIZE = 20;

const escapeHtml = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

class VitruvianApp {
  constructor() {
    this.device = new VitruvianDevice();
    this.chartManager = new ChartManager("loadGraph");
    this._boundMonitorListener = null;
    this._boundRepListener = null;
    this._monitorListenerRegistered = false;
    this._repListenerRegistered = false;
    this._pendingChartResizeFrame = null;
    this._delayedChartResizeTimeout = null;
    this.dropboxManager = new DropboxManager(); // Dropbox cloud storage
    this.maxPos = 1000; // Shared max for both cables (keeps bars comparable)
    this.weightUnit = "kg"; // Display unit for weights (default)
    this._unitToggleButton = null; // Reference to unit toggle button
    this._weightAdjustTimer = null; // Interval handle for weight hold
    this._weightAdjustDirection = 0; // Current hold direction
    this._weightHoldStartTime = null;
    this._weightHoldRepeats = 0;
    this._workingTargetHoldTimer = null; // Interval handle for working reps hold
    this._audioContext = null; // Shared Web Audio context for UI cues
    this._audioUnlockEvents = ["pointerdown", "touchstart", "keydown", "mousedown"];
    this._boundAudioUnlock = null;
    this._boundAudioVisibilityChange = null;
    this._boundAudioStateChange = null;
    this._audioUnlockListenersAttached = false;
    this._lastRepTopBeep = 0; // Timestamp of last rep top cue
    this._weightAdjustSoundThrottle = 0;
    this._countdownBeepThrottle = 0;
    this._lastRestChime = 0;
    this.stopAtTop = false; // Stop at top of final rep instead of bottom
    this.warmupReps = 0;
    this.workingReps = 0;
    this.warmupTarget = 3; // Default warmup target
    this.targetReps = 0; // Target working reps
    this.workoutHistory = []; // Track completed workouts
    this.personalRecords = this.loadPersonalRecordsCache();
    const personalRecordsSyncState = this.loadPersonalRecordsSyncState();
    this._pendingPersonalRecordCandidate = null;
    this._personalRecordsDirty = personalRecordsSyncState.dirty;
    this._personalRecordsSyncInFlight = false;
    this._pendingPersonalRecordsDropboxSync =
      personalRecordsSyncState.pendingDropboxSync;
    this._personalRecordsForceSync = false;
    this.currentWorkout = null; // Current workout info
    this.currentProgramParams = null; // Last program parameters sent to the device
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
    this.defaultPerCableKg = DEFAULT_PER_CABLE_KG;
    this._weightInputKg = DEFAULT_PER_CABLE_KG;
    this._cancelRest = null;
    this.theme = this.loadStoredTheme();
    this.applyAppVersion();
    this.registerAppVersionListener();
    this.setupLogging();
    this.registerDeviceListeners();
    this.setupChart();
    this.setupUnitControls();
    this.initializeAudioToggle();
    this.planItems = [];        // array of {type: 'exercise'|'echo', fields...}
    this.planActive = false;    // true when plan runner is active
    this.planCursor = { index: 0, set: 1 }; // current item & set counter
    this.planRestTimer = null;  // rest countdown handle
    this.planOnWorkoutComplete = null; // hook assigned while plan is running
    this.planTimeline = [];
    this.planTimelineIndex = 0;
    this._activePlanEntry = null;
    this._planSetInProgress = false;
    this._queuedPlanRun = null;
    this._planNavigationTargetIndex = null;
    this.planStartTime = null;
    this.planPaused = false;
    this.planPauseStartedAt = null;
    this.planPausedDurationMs = 0;
    this._planElapsedInterval = null;
    this.planPauseActivityStart = null;
    this.planPauseLastSample = null;
    this._restState = null;
    this._lastTargetSyncError = null;
    this._lastWeightSyncError = null;

    this._hasPerformedInitialSync = false; // track if we've auto-synced once per session
    this._autoSyncInFlight = false;
    this._dropboxConnectInFlight = false;
    this._dropboxSyncHoldTimer = null;
    this._dropboxSyncHoldTriggered = false;
    this._dropboxSyncBusyCount = 0;
    this._deviceConnectInFlight = false;
    this._deviceHoldTimer = null;
    this._deviceHoldTriggered = false;

    this._personalBestHighlight = false; // track highlight state
    this._confettiActive = false; // prevent overlapping confetti bursts
    this._confettiCleanupTimer = null;

    this.sidebarCollapsed = false;
    this.loadSidebarPreference();

    this._scrollButtonsUpdate = null;

    this.selectedHistoryKey = null; // currently selected history entry key
    this.selectedHistoryIndex = null; // cache index for quick lookup

    this.historyPage = 1;
    this.historyPageSize = 5;
    this.historyFilterKey = "all";
    this._loadedPlanName = null;
    this._preferredPlanSelection = null;
    this._planNameCollator = null;

    this._warmupCounterEl = null;
    this._workingCounterEl = null;
    this._workingCounterDecreaseBtn = null;
    this._workingCounterIncreaseBtn = null;
    this._workingCounterControlsBound = false;
    this._planIndicatorEls = null;
    this._planSummaryData = null;
    this._lastPlanSummary = null;
    this._planSummaryOverlay = null;
    this._planSummaryListEl = null;
    this._planSummaryTotalEl = null;
    this._planSummaryPlanNameEl = null;
    this._planSummaryAdjustmentsEl = null;
    this._planSummaryAdjustmentsHintEl = null;
    this._planSummaryModeToggle = null;
    this._planSummaryModeToggleLabelEl = null;
    this._planSummaryActiveAdjustmentMode = "flat";
    this._planSummaryFlatGroup = null;
    this._planSummaryPercentGroup = null;
    this._planSummaryFlatSelect = null;
    this._planSummaryFlatOptions = [];
    this._planSummaryFlatUnitEl = null;
    this._planSummaryFlatLabelEl = null;
    this._planSummaryPercentSelect = null;
    this._planSummaryPercentOptions = [];
    this._planSummaryPercentLabelEl = null;
    this._planSummaryPercentUnitEl = null;
    this._planSummaryAdjustmentFeedbackEl = null;
    this._planSummaryDisplayUnit = null;
    this._planSummarySource = null;
    this._planSummaryReopenBtn = null;

    this._wakeLockSentinel = null;
    this._boundWakeLockVisibilityChange = null;
    this._boundWakeLockRelease = null;

    this._stopAtTopPending = false;
    this._planStopAtTopBase = null;

    // initialize plan UI dropdown from storage and render once UI is ready
    setTimeout(() => {
      this.refreshPlanSelectNames();
      this.setupPlanSelectAutoLoad();
      this.renderPlanUI();
      this.applySidebarCollapsedState();
      this.updatePlanControlsState();
      this.updatePlanElapsedDisplay();
      this._warmupCounterEl = document.getElementById("warmupCounter");
      this._workingCounterEl = document.getElementById("workingCounter");
      this._workingCounterDecreaseBtn = document.getElementById("workingCounterDecrease");
      this._workingCounterIncreaseBtn = document.getElementById("workingCounterIncrease");
      this.setupWorkingCounterControls();
      this._planIndicatorEls = {
        container: document.getElementById("planSetIndicator"),
        name: document.getElementById("planSetIndicatorName"),
        set: document.getElementById("planSetIndicatorSet"),
        reps: document.getElementById("planSetIndicatorReps"),
      };
      this.updatePlanSetIndicator();
      this.updateCurrentSetLabel();
    }, 0);

    this.setupThemeToggle();
    this.setupLiveWeightAdjuster();
    this.setupDropbox();
    this.setupDeviceButton();
    this.setupMessageBridge();
    this.setupScrollButtons();
    this.setupPlanSummaryOverlay();
    this.setupAudioUnlockSupport();
    this.setupWakeLock();
    this.resetRepCountersToEmpty();
    this.updateStopButtonState();
    this.updatePlanControlsState?.();
    this.updatePlanElapsedDisplay?.();

    const handleViewportChange = () => {
      this.applySidebarCollapsedState();
    };

    window.addEventListener("resize", handleViewportChange);

    const orientationQuery = window.matchMedia("(orientation: portrait)");
    if (typeof orientationQuery.addEventListener === "function") {
      orientationQuery.addEventListener("change", handleViewportChange);
    } else if (typeof orientationQuery.addListener === "function") {
      orientationQuery.addListener(handleViewportChange);
    }

    handleViewportChange();

  }
  setupLogging() {
    // Connect device logging to UI
    this.device.onLog = (message, type) => {
      this.addLogEntry(message, type);
    };
  }

  registerDeviceListeners() {
    if (!this.device) {
      return;
    }

    if (!this._boundMonitorListener) {
      this._boundMonitorListener = (sample) => {
        this.updateLiveStats(sample);
      };
    }

    if (
      !this._monitorListenerRegistered &&
      typeof this.device.addMonitorListener === "function"
    ) {
      this.device.addMonitorListener(this._boundMonitorListener);
      this._monitorListenerRegistered = true;
    }

    if (!this._boundRepListener) {
      this._boundRepListener = (data) => {
        this.handleRepNotification(data);
      };
    }

    if (
      !this._repListenerRegistered &&
      typeof this.device.addRepListener === "function"
    ) {
      this.device.addRepListener(this._boundRepListener);
      this._repListenerRegistered = true;
    }
  }

  setupChart() {
    // Initialize chart and connect logging
    this.chartManager.init();
    this.chartManager.onLog = (message, type) => {
      this.addLogEntry(message, type);
    };
    this.applyUnitToChart();
  }

  requestChartResize(options = {}) {
    if (
      !this.chartManager ||
      typeof this.chartManager.resize !== "function"
    ) {
      return;
    }

    const delay =
      typeof options.delay === "number" && options.delay >= 0
        ? options.delay
        : 350;

    if (typeof window === "undefined") {
      this.chartManager.resize();
      return;
    }

    if (this._pendingChartResizeFrame) {
      window.cancelAnimationFrame(this._pendingChartResizeFrame);
      this._pendingChartResizeFrame = null;
    }

    this._pendingChartResizeFrame = window.requestAnimationFrame(() => {
      this._pendingChartResizeFrame = null;
      this.chartManager.resize();
    });

    if (this._delayedChartResizeTimeout) {
      window.clearTimeout(this._delayedChartResizeTimeout);
      this._delayedChartResizeTimeout = null;
    }

    this._delayedChartResizeTimeout = window.setTimeout(() => {
      this._delayedChartResizeTimeout = null;
      this.chartManager.resize();
    }, delay);
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
      this.saveWeightUnitPreference();
    }
  }

  setupThemeToggle() {
    const toggleButton = document.getElementById("themeToggle");

    if (toggleButton) {
      toggleButton.addEventListener("click", () => {
        const next = this.theme === "dark" ? "light" : "dark";
        this.setTheme(next);
      });
    }

    this.setTheme(this.theme, { skipSave: true });
  }

  loadStoredTheme() {
    if (typeof window === "undefined" || !window.localStorage) {
      return "light";
    }
    try {
      const stored = window.localStorage.getItem("vitruvian.theme");
      return stored === "dark" ? "dark" : "light";
    } catch (error) {
      return "light";
    }
  }

  registerAppVersionListener() {
    if (
      typeof document === "undefined" ||
      typeof document.addEventListener !== "function"
    ) {
      return;
    }

    const updateVersionBadge = () => {
      this.applyAppVersion();
    };

    document.addEventListener(
      "workouttime:version-ready",
      updateVersionBadge,
      { once: true }
    );
  }

  applyAppVersion() {
    const root =
      typeof globalThis !== "undefined"
        ? globalThis
        : typeof window !== "undefined"
        ? window
        : null;

    const badge =
      typeof document !== "undefined"
        ? document.getElementById("appVersionBadge")
        : null;

    if (!badge) {
      return;
    }

    const versionInfo = (root && root.WorkoutTimeAppInfo) || {};
    const appVersion =
      typeof versionInfo.version === "string" && versionInfo.version.trim().length > 0
        ? versionInfo.version.trim()
        : null;

    if (!appVersion) {
      badge.hidden = true;
      badge.removeAttribute("title");
      delete badge.dataset.version;
      return;
    }

    const label =
      typeof versionInfo.getVersionLabel === "function"
        ? versionInfo.getVersionLabel({ prefix: "v" })
        : `v${appVersion}`;

    badge.textContent = label;
    badge.hidden = false;
    badge.setAttribute("title", `App version ${appVersion}`);
    badge.setAttribute("aria-label", `Application version ${label}`);
    badge.dataset.version = appVersion;
  }

  setTheme(theme, options = {}) {
    const normalized = theme === "dark" ? "dark" : "light";
    this.theme = normalized;

    if (typeof document !== "undefined" && document.body) {
      document.body.classList.toggle("dark-theme", normalized === "dark");
    }

    if (!options.skipSave && typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem("vitruvian.theme", normalized);
      } catch (error) {
        /* ignore storage errors */
      }
    }

    this.updateThemeToggleUI();
    this.renderPlanUI();
    this.updatePersonalBestDisplay();
    this.updateLiveWeightDisplay();
  }

  updateThemeToggleUI() {
    const toggleButton = document.getElementById("themeToggle");
    if (!toggleButton) {
      return;
    }
    const isDark = this.theme === "dark";
    toggleButton.setAttribute("aria-pressed", isDark ? "true" : "false");
    toggleButton.classList.toggle("is-dark", isDark);

    const label = toggleButton.querySelector(".theme-toggle__label");
    const icon = toggleButton.querySelector(".theme-toggle__icon");
    if (label) {
      label.textContent = isDark ? "Dark Mode" : "Light Mode";
    }
    if (icon) {
      icon.textContent = isDark ? "🌙" : "🌞";
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

  getWeightHoldDynamics(elapsedMs = 0) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      return { interval: 220, stepMultiplier: 1 };
    }

    if (elapsedMs >= 4000) {
      return { interval: 70, stepMultiplier: 5 };
    }
    if (elapsedMs >= 2500) {
      return { interval: 90, stepMultiplier: 4 };
    }
    if (elapsedMs >= 1500) {
      return { interval: 120, stepMultiplier: 3 };
    }
    if (elapsedMs >= 800) {
      return { interval: 160, stepMultiplier: 2 };
    }
    return { interval: 220, stepMultiplier: 1 };
  }

  setupLiveWeightAdjuster() {
    const increase = document.getElementById("weightAdjusterIncrease");
    const decrease = document.getElementById("weightAdjusterDecrease");
    const weightInput = document.getElementById("weight");

    if (weightInput) {
      const existingDisplay = parseFloat(weightInput.value);
      const existingKg = this.convertDisplayToKg(existingDisplay);
      if (!Number.isFinite(existingDisplay) || !Number.isFinite(existingKg)) {
        weightInput.value = this.formatWeightValue(
          this.defaultPerCableKg,
          this.getWeightInputDecimals(),
        );
        this._weightInputKg = this.defaultPerCableKg;
      } else {
        this._weightInputKg = existingKg;
      }

      weightInput.addEventListener("input", () => {
        this.updateLiveWeightDisplay();
      });
      weightInput.addEventListener("change", () => {
        const displayValue = parseFloat(weightInput.value);
        const kgValue = this.convertDisplayToKg(displayValue);
        if (Number.isFinite(kgValue)) {
          this._weightInputKg = kgValue;
        }
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

  setupWorkingCounterControls() {
    if (this._workingCounterControlsBound) {
      this.updateWorkingCounterControlsState();
      return;
    }

    const decreaseBtn =
      this._workingCounterDecreaseBtn ||
      document.getElementById("workingCounterDecrease");
    const increaseBtn =
      this._workingCounterIncreaseBtn ||
      document.getElementById("workingCounterIncrease");

    this._workingCounterDecreaseBtn = decreaseBtn || null;
    this._workingCounterIncreaseBtn = increaseBtn || null;

    const bindHold = (button, direction) => {
      if (!button) {
        return;
      }

      const start = (event) => {
        if (event && event.button !== undefined && event.button !== 0) {
          return;
        }
        if (event) {
          event.preventDefault();
          if (
            typeof event.pointerId === "number" &&
            typeof button.setPointerCapture === "function"
          ) {
            try {
              button.setPointerCapture(event.pointerId);
            } catch (error) {
              /* no-op */
            }
          }
        }
        this.startWorkingTargetHold(direction);
      };

      const stop = (event) => {
        if (
          event &&
          typeof event.pointerId === "number" &&
          typeof button.releasePointerCapture === "function"
        ) {
          try {
            button.releasePointerCapture(event.pointerId);
          } catch (error) {
            /* no-op */
          }
        }
        this.stopWorkingTargetHold();
      };

      button.addEventListener("pointerdown", start);
      button.addEventListener("pointerup", stop);
      button.addEventListener("pointerleave", stop);
      button.addEventListener("pointercancel", stop);
      button.addEventListener("lostpointercapture", stop);
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.adjustWorkingTarget(direction, { repeat: false });
        }
      });
    };

    bindHold(decreaseBtn, -1);
    bindHold(increaseBtn, 1);

    window.addEventListener("pointerup", () => {
      this.stopWorkingTargetHold();
    });

    this._workingCounterControlsBound = true;
    this.updateWorkingCounterControlsState();
  }

  startWorkingTargetHold(direction) {
    if (!this.currentWorkout) {
      return;
    }

    this.stopWorkingTargetHold();

    this.adjustWorkingTarget(direction, { repeat: false });

    const run = () => {
      this._workingTargetHoldTimer = window.setTimeout(() => {
        this.adjustWorkingTarget(direction, { repeat: true });
        run();
      }, 200);
    };

    this._workingTargetHoldTimer = window.setTimeout(run, 400);
  }

  stopWorkingTargetHold() {
    if (this._workingTargetHoldTimer !== null) {
      window.clearTimeout(this._workingTargetHoldTimer);
      this._workingTargetHoldTimer = null;
    }
  }

  adjustWorkingTarget(direction, options = {}) {
    if (!this.currentWorkout) {
      return null;
    }

    const step = Number(direction) > 0 ? 1 : -1;
    if (step === 0) {
      return null;
    }

    let nextTarget = Number.isFinite(this.targetReps) ? this.targetReps + step : step;
    const maxTarget = 100;
    const minimumTarget = this.isJustLiftMode ? 0 : 1;
    const lowerBound = Math.max(minimumTarget, this.workingReps);

    if (nextTarget > maxTarget) {
      nextTarget = maxTarget;
    }
    if (nextTarget < lowerBound) {
      nextTarget = lowerBound;
    }

    if (nextTarget === this.targetReps) {
      return null;
    }

    this.targetReps = nextTarget;
    if (this.currentWorkout && typeof this.currentWorkout === "object") {
      this.currentWorkout.targetReps = nextTarget;
    }

    this.updateRepCounters();

    this.syncProgramTargetReps(nextTarget, options);

    if (!options.repeat) {
      this.addLogEntry(
        `Adjusted target working reps to ${this.targetReps}`,
        "info",
      );
    }

    return this.targetReps;
  }

  async syncProgramTargetReps(nextTarget, options = {}) {
    const silent = !!options.repeat;

    if (
      !this.device ||
      !this.device.isConnected ||
      !this.currentWorkout ||
      !this.currentProgramParams ||
      this.isJustLiftMode
    ) {
      return;
    }

    if (!Number.isFinite(nextTarget) || nextTarget <= 0) {
      return;
    }

    try {
      const updatedParams = { ...this.currentProgramParams, reps: nextTarget };
      await this.device.updateProgramTargetReps(updatedParams, { silent });
      this.currentProgramParams = updatedParams;
      this._lastTargetSyncError = null;
    } catch (error) {
      const message = `Failed to sync target reps to device: ${error.message}`;
      if (!silent || this._lastTargetSyncError !== message) {
        this.addLogEntry(message, "error");
        this._lastTargetSyncError = message;
      }
    }
  }

  async syncProgramWeight(nextPerCableKg, options = {}) {
    const silent = !!options.repeat;

    if (
      !this.device ||
      !this.device.isConnected ||
      !this.currentWorkout ||
      !this.currentProgramParams
    ) {
      return;
    }

    if (!Number.isFinite(nextPerCableKg)) {
      return;
    }

    const clamped = Math.min(100, Math.max(0, nextPerCableKg));
    const effectiveKg = clamped + 10;
    const displayUnit = this.currentProgramParams.displayUnit || this.getUnitLabel();
    const perCableDisplay = this.convertKgToDisplay(clamped, displayUnit);
    const effectiveDisplay = this.convertKgToDisplay(effectiveKg, displayUnit);
    const updatedParams = {
      ...this.currentProgramParams,
      perCableKg: clamped,
      perCableDisplay,
      effectiveKg,
      effectiveDisplay,
    };

    try {
      await this.device.updateProgramWeights(updatedParams, { silent });
      this.currentProgramParams = updatedParams;
      this._lastWeightSyncError = null;
    } catch (error) {
      const message = `Failed to sync target weight to device: ${error.message}`;
      if (!silent || this._lastWeightSyncError !== message) {
        this.addLogEntry(message, "error");
        this._lastWeightSyncError = message;
      }
    }
  }

  updateWorkingCounterControlsState() {
    const disabled = !this.currentWorkout;
    if (this._workingCounterDecreaseBtn) {
      this._workingCounterDecreaseBtn.disabled = disabled;
    }
    if (this._workingCounterIncreaseBtn) {
      this._workingCounterIncreaseBtn.disabled = disabled;
    }
  }

  ensureWorkoutStartTime() {
    if (
      this.currentWorkout &&
      !this.currentWorkout.startTime
    ) {
      this.currentWorkout.startTime = new Date();
      this.addLogEntry("Workout timer started at first warmup rep", "info");
      try {
        if (this.isAudioTriggersEnabled()) {
          this.playAudio("calibrateLift").catch(() => {});
        }
      } catch (e) {}
    }
  }

  startLiveWeightHold(direction) {
    this.stopLiveWeightHold();
    this._weightAdjustDirection = direction;
    this._weightHoldStartTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    this._weightHoldRepeats = 0;

    const initial = this.getWeightHoldDynamics(0);
    this.adjustLiveWeight(direction, {
      repeat: false,
      holdElapsedMs: 0,
      holdStepMultiplier: initial.stepMultiplier,
    });
    this._weightHoldRepeats = 1;

    const run = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = this._weightHoldStartTime ? now - this._weightHoldStartTime : 0;
      const dynamics = this.getWeightHoldDynamics(elapsed);
      this._weightAdjustTimer = window.setTimeout(() => {
        this.adjustLiveWeight(direction, {
          repeat: true,
          holdElapsedMs: elapsed,
          holdStepMultiplier: dynamics.stepMultiplier,
        });
        this._weightHoldRepeats += 1;
        run();
      }, dynamics.interval);
    };

    this._weightAdjustTimer = window.setTimeout(run, initial.interval);
  }

  stopLiveWeightHold() {
    if (this._weightAdjustTimer !== null) {
      window.clearTimeout(this._weightAdjustTimer);
      this._weightAdjustTimer = null;
    }
    this._weightAdjustDirection = 0;
    this._weightHoldStartTime = null;
    this._weightHoldRepeats = 0;
  }

  adjustLiveWeight(direction, options = {}) {
    const stepMultiplier = Number.isFinite(options.holdStepMultiplier) && options.holdStepMultiplier > 0
      ? options.holdStepMultiplier
      : 1;
    const stepDisplay = 0.1 * stepMultiplier;
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

    this._weightInputKg = nextKg;

    const weightInput = document.getElementById("weight");
    if (weightInput) {
      weightInput.value = this.formatWeightValue(
        nextKg,
        this.getWeightInputDecimals(),
      );
    }

    this.updateLiveWeightDisplay();
    this.playWeightAdjustChirp(direction, options);
    this.syncProgramWeight(nextKg, options);

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
        this._weightInputKg = kg;
        return kg;
      }
    }

    if (Number.isFinite(this._weightInputKg)) {
      return this._weightInputKg;
    }

    return this.defaultPerCableKg;
  }

  updateLiveWeightDisplay(sample = this.currentSample) {
    const valueEl = document.getElementById("liveWeightValue");
    const unitEl = document.getElementById("liveWeightUnit");
    const weightInput = document.getElementById("weight");
    if (!valueEl || !unitEl) {
      return;
    }

    const normalizedSample = this.normalizeSampleForDisplay(sample);

    const isEchoWorkout =
      this.currentWorkout &&
      (this.currentWorkout.itemType === "echo" ||
        (typeof this.currentWorkout.mode === "string" &&
          this.currentWorkout.mode.toLowerCase().includes("echo")));

    if (isEchoWorkout) {
      const loadA = Number(normalizedSample?.loadA);
      const loadB = Number(normalizedSample?.loadB);
      const hasLoadSample = Number.isFinite(loadA) || Number.isFinite(loadB);
      const totalKg =
        (Number.isFinite(loadA) ? loadA : 0) +
        (Number.isFinite(loadB) ? loadB : 0);

      if (hasLoadSample) {
        valueEl.textContent = this.convertKgToDisplay(totalKg).toFixed(
          this.getLoadDisplayDecimals(),
        );
      } else {
        valueEl.textContent = "-";
      }

      unitEl.textContent = this.getUnitLabel();
      return;
    }

    const currentKg = this.getCurrentPerCableWeightKg();
    if (Number.isFinite(currentKg)) {
      valueEl.textContent = this.convertKgToDisplay(currentKg).toFixed(
        this.getWeightInputDecimals(),
      );
      if (weightInput && weightInput !== document.activeElement) {
        weightInput.value = this.formatWeightValue(currentKg, this.getWeightInputDecimals());
      }
    } else {
      const fallbackKg = this.defaultPerCableKg;
      const fallbackDisplay = this.convertKgToDisplay(fallbackKg).toFixed(
        this.getWeightInputDecimals(),
      );
      valueEl.textContent = fallbackDisplay;
      if (
        weightInput &&
        weightInput !== document.activeElement &&
        (!weightInput.value || Number.isNaN(parseFloat(weightInput.value)))
      ) {
        weightInput.value = fallbackDisplay;
      }
      this._weightInputKg = fallbackKg;
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
      if (isConnected && (this._personalRecordsDirty || this._pendingPersonalRecordsDropboxSync)) {
        this.syncPersonalRecordsToDropbox({ reason: "connection-change", silent: true }).catch(() => {
          /* already logged inside syncPersonalRecordsToDropbox */
        });
      }
    };

    const dropboxButton = document.getElementById("dropboxStatusButton");
    if (dropboxButton) {
      dropboxButton.addEventListener("click", (event) => {
        const syncTarget = event.target.closest(".dbx-sync");
        if (syncTarget) {
          event.preventDefault();
          event.stopPropagation();
          if (this._dropboxSyncHoldTriggered) {
            this._dropboxSyncHoldTriggered = false;
            return;
          }
          this.handleDropboxQuickSync();
          return;
        }

        this.handleDropboxConnectButton();
      });

      const syncSegment = dropboxButton.querySelector(".dbx-sync");
      if (syncSegment) {
        syncSegment.addEventListener("pointerdown", (event) => {
          if (typeof event.button === "number" && event.button !== 0) {
            return;
          }
          this.startDropboxSyncHold();
        });
        ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
          syncSegment.addEventListener(eventName, () => this.cancelDropboxSyncHold());
        });
      }
    }

    this.setDropboxButtonState(this.dropboxManager.isConnected ? "connected" : "disconnected");
    this.updateDropboxUI(this.dropboxManager.isConnected);

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

  setupDeviceButton() {
    const button = document.getElementById("deviceStatusButton");
    if (!button) {
      return;
    }

    button.addEventListener("click", () => {
      if (this._deviceHoldTriggered) {
        this._deviceHoldTriggered = false;
        return;
      }

      if (this.device?.isConnected || this._deviceConnectInFlight) {
        return;
      }

      this.connect();
    });

    button.addEventListener("pointerdown", (event) => {
      if (typeof event.button === "number" && event.button !== 0) {
        return;
      }
      if (!this.device?.isConnected) {
        return;
      }
      this.startDeviceHold();
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
      button.addEventListener(eventName, () => this.cancelDeviceHold());
    });

    this.setDeviceButtonState(this.device?.isConnected ? "connected" : "disconnected");
    this.setDeviceButtonSubtext(
      this.device?.isConnected
        ? "Hold to disconnect."
        : "Tap to connect your Vitruvian.",
    );
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

  setupScrollButtons() {
    const up = document.getElementById("appScrollUp");
    const down = document.getElementById("appScrollDown");

    if (!up || !down) {
      return;
    }

    const updateVisibility = () => {
      const docEl = document.documentElement;
      const bodyScroll = document.body ? document.body.scrollHeight : 0;
      const maxScrollHeight = Math.max(docEl.scrollHeight, bodyScroll);
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const maxY = Math.max(maxScrollHeight - window.innerHeight, 0);

      if (scrollY > 400) {
        up.classList.add("show");
      } else {
        up.classList.remove("show");
      }

      if (scrollY < maxY - 400) {
        down.classList.add("show");
      } else {
        down.classList.remove("show");
      }
    };

    up.addEventListener("click", (event) => {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    down.addEventListener("click", (event) => {
      event.preventDefault();
      const docEl = document.documentElement;
      const bodyScroll = document.body ? document.body.scrollHeight : 0;
      const maxScrollHeight = Math.max(docEl.scrollHeight, bodyScroll);
      window.scrollTo({ top: maxScrollHeight, behavior: "smooth" });
    });

    this._scrollButtonsUpdate = updateVisibility;
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    updateVisibility();
  }

  setupPlanSummaryOverlay() {
    if (typeof document === "undefined") {
      return;
    }

    this._planSummaryOverlay = document.getElementById("planSummaryOverlay");
    this._planSummaryListEl = document.getElementById("planSummaryList");
    this._planSummaryTotalEl = document.getElementById("planSummaryTotal");
    this._planSummaryPlanNameEl = document.getElementById("planSummaryPlanName");
    this._planSummaryAdjustmentsEl = document.getElementById("planSummaryAdjustments");
    this._planSummaryAdjustmentsHintEl = document.getElementById("planSummaryAdjustmentsHint");
    this._planSummaryModeToggle = document.getElementById("planSummaryAdjustmentToggle");
    this._planSummaryModeToggleLabelEl = document.getElementById("planSummaryToggleLabel");
    this._planSummaryFlatUnitEl = document.getElementById("planSummaryFlatUnit");
    this._planSummaryFlatLabelEl = document.getElementById("planSummaryFlatLabel");
    this._planSummaryPercentLabelEl = document.getElementById("planSummaryPercentLabel");
    this._planSummaryPercentUnitEl = document.getElementById("planSummaryPercentUnit");
    this._planSummaryAdjustmentFeedbackEl = document.getElementById(
      "planSummaryAdjustmentFeedback",
    );
    this._planSummaryReopenBtn = document.getElementById("planSummaryReopen");

    this._planSummaryFlatSelect = document.getElementById(
      "planSummaryFlatSelect",
    );
    this._planSummaryPercentSelect = document.getElementById(
      "planSummaryPercentSelect",
    );
    this._planSummaryFlatOptions = this.populatePlanSummaryOptions(
      this._planSummaryFlatSelect,
      PLAN_SUMMARY_FLAT_AMOUNTS,
      "flat",
    );
    this._planSummaryPercentOptions = this.populatePlanSummaryOptions(
      this._planSummaryPercentSelect,
      PLAN_SUMMARY_PERCENT_AMOUNTS,
      "percent",
    );

    if (this._planSummaryAdjustmentsEl) {
      this._planSummaryFlatGroup = this._planSummaryAdjustmentsEl.querySelector(
        '[data-plan-summary-mode="flat"]',
      );
      this._planSummaryPercentGroup = this._planSummaryAdjustmentsEl.querySelector(
        '[data-plan-summary-mode="percent"]',
      );
    }

    const closeBtn = document.getElementById("planSummaryCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        this.hidePlanSummary();
      });
    }

    if (this._planSummaryFlatSelect) {
      this._planSummaryFlatSelect.addEventListener("change", () => {
        const selected = this._planSummaryFlatSelect?.selectedOptions?.[0];
        if (!selected) {
          return;
        }

        const rawValue = Number.parseFloat(
          selected.dataset.planSummaryFlat ?? selected.value,
        );

        if (!Number.isFinite(rawValue) || rawValue <= 0) {
          return;
        }

        this.applyPlanSummaryAdjustment({ mode: "flat", amount: rawValue });
        this._planSummaryFlatSelect.value = "";
      });
    }

    if (this._planSummaryPercentSelect) {
      this._planSummaryPercentSelect.addEventListener("change", () => {
        const selected = this._planSummaryPercentSelect?.selectedOptions?.[0];
        if (!selected) {
          return;
        }

        const rawValue = Number.parseFloat(
          selected.dataset.planSummaryPercent ?? selected.value,
        );

        if (!Number.isFinite(rawValue) || rawValue <= 0) {
          return;
        }

        this.applyPlanSummaryAdjustment({ mode: "percent", amount: rawValue });
        this._planSummaryPercentSelect.value = "";
      });
    }

    const handleModeToggle = (event) => {
      if (event) {
        event.preventDefault();
      }
      const nextMode =
        this._planSummaryActiveAdjustmentMode === "percent"
          ? "flat"
          : "percent";
      this.setPlanSummaryAdjustmentMode(nextMode, { focus: true });
    };

    if (this._planSummaryModeToggle) {
      this._planSummaryModeToggle.addEventListener("click", handleModeToggle);
      this._planSummaryModeToggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleModeToggle(event);
        }
      });
    }

    this.setPlanSummaryAdjustmentMode("flat");

    if (this._planSummaryReopenBtn) {
      this._planSummaryReopenBtn.addEventListener("click", () => {
        this.presentPlanSummary();
      });
    }

    if (this._planSummaryOverlay) {
      this._planSummaryOverlay.addEventListener("click", (event) => {
        if (event.target === this._planSummaryOverlay) {
          this.hidePlanSummary();
        }
      });

      this._planSummaryOverlay.addEventListener("pointerdown", (event) => {
        if (event.target === this._planSummaryOverlay) {
          this.hidePlanSummary();
        }
      });
    }

    if (typeof document !== "undefined") {
      document.addEventListener("keydown", (event) => {
        if (
          event.key === "Escape" &&
          this._planSummaryOverlay?.classList.contains("is-visible")
        ) {
          this.hidePlanSummary();
        }
      });
    }

    this.updatePlanSummaryReopenVisibility();
  }

  hidePlanSummary() {
    if (!this._planSummaryOverlay) {
      return;
    }

    this._planSummaryOverlay.classList.remove("is-visible");
    this._planSummaryOverlay.setAttribute("aria-hidden", "true");
    this.updatePlanSummaryReopenVisibility();
  }

  updatePlanSummaryReopenVisibility() {
    const button = this._planSummaryReopenBtn;
    if (!button) {
      return;
    }

    const hasSummary =
      !!this._lastPlanSummary &&
      Array.isArray(this._lastPlanSummary.sets) &&
      this._lastPlanSummary.sets.length > 0;
    const overlayVisible = this._planSummaryOverlay?.classList.contains("is-visible");

    if (hasSummary && !overlayVisible) {
      button.classList.add("is-visible");
      button.setAttribute("aria-hidden", "false");
    } else {
      button.classList.remove("is-visible");
      button.setAttribute("aria-hidden", "true");
    }
  }

  resetPlanSummaryAdjustments() {
    this.showPlanSummaryAdjustmentFeedback("");
    if (this._planSummaryFlatSelect) {
      this._planSummaryFlatSelect.value = "";
    }
    if (this._planSummaryPercentSelect) {
      this._planSummaryPercentSelect.value = "";
    }
  }

  showPlanSummaryAdjustmentFeedback(message, variant = null) {
    const feedbackEl = this._planSummaryAdjustmentFeedbackEl;
    if (!feedbackEl) {
      return;
    }

    feedbackEl.textContent = message || "";
    feedbackEl.classList.remove(
      "plan-summary-adjustment__feedback--success",
      "plan-summary-adjustment__feedback--error",
    );

    if (variant === "success") {
      feedbackEl.classList.add("plan-summary-adjustment__feedback--success");
    } else if (variant === "error") {
      feedbackEl.classList.add("plan-summary-adjustment__feedback--error");
    }
  }

  preparePlanSummaryAdjustments(unit = this.weightUnit) {
    const normalizedUnit = unit === "lb" ? "lb" : "kg";
    this._planSummaryDisplayUnit = normalizedUnit;

    if (this._planSummaryFlatSelect) {
      this._planSummaryFlatSelect.value = "";
    }

    if (this._planSummaryPercentSelect) {
      this._planSummaryPercentSelect.value = "";
    }

    if (this._planSummaryFlatUnitEl) {
      this._planSummaryFlatUnitEl.textContent = normalizedUnit;
    }

    if (this._planSummaryAdjustmentsHintEl) {
      const friendly = this.getFriendlyUnitLabel(normalizedUnit);
      this._planSummaryAdjustmentsHintEl.textContent = `Increase every weighted set for this plan by a flat amount in ${friendly} or by a percentage.`;
    }

    const decimals = this.getLoadDisplayDecimalsForUnit(normalizedUnit);

    this._planSummaryFlatOptions.forEach((option) => {
      if (!option) {
        return;
      }
      const baseValue = Number.parseFloat(option.dataset.planSummaryFlat);
      if (!Number.isFinite(baseValue) || baseValue <= 0) {
        return;
      }
      const formatted = Number.parseFloat(baseValue.toFixed(decimals)).toString();
      option.textContent = formatted;
      option.value = formatted;
    });

    this._planSummaryPercentOptions.forEach((option) => {
      if (!option) {
        return;
      }
      const baseValue = Number.parseFloat(option.dataset.planSummaryPercent);
      if (!Number.isFinite(baseValue) || baseValue <= 0) {
        return;
      }
      const formatted = Number.parseFloat(baseValue.toFixed(1)).toString();
      option.textContent = formatted;
      option.value = formatted;
    });

    const hasWeightedExercises = Array.isArray(this.planItems)
      ? this.planItems.some((item) => item && item.type === "exercise")
      : false;

    const disableAdjustments = !hasWeightedExercises;

    if (this._planSummaryAdjustmentsEl) {
      this._planSummaryAdjustmentsEl.toggleAttribute("data-disabled", disableAdjustments);
    }

    if (this._planSummaryFlatSelect) {
      this._planSummaryFlatSelect.disabled = disableAdjustments;
      this._planSummaryFlatSelect.setAttribute(
        "aria-disabled",
        disableAdjustments ? "true" : "false",
      );
    }

    this._planSummaryFlatOptions.forEach((option) => {
      if (!option) {
        return;
      }
      option.disabled = disableAdjustments;
    });

    if (this._planSummaryPercentSelect) {
      this._planSummaryPercentSelect.disabled = disableAdjustments;
      this._planSummaryPercentSelect.setAttribute(
        "aria-disabled",
        disableAdjustments ? "true" : "false",
      );
    }

    this._planSummaryPercentOptions.forEach((option) => {
      if (!option) {
        return;
      }
      option.disabled = disableAdjustments;
    });

    if (this._planSummaryModeToggle) {
      this._planSummaryModeToggle.disabled = disableAdjustments;
      this._planSummaryModeToggle.setAttribute(
        "aria-disabled",
        disableAdjustments ? "true" : "false",
      );
    }

    if (this._planSummaryAdjustmentsEl && !disableAdjustments) {
      const mode =
        this._planSummaryActiveAdjustmentMode === "percent"
          ? "percent"
          : "flat";
      this._planSummaryAdjustmentsEl.dataset.activeMode = mode;
    }

    if (disableAdjustments && this._planSummaryAdjustmentsHintEl) {
      this._planSummaryAdjustmentsHintEl.textContent =
        "Add at least one weighted exercise to adjust your next plan.";
    }
  }

  populatePlanSummaryOptions(selectElement, values, mode = "flat") {
    if (!selectElement || !Array.isArray(values) || values.length === 0) {
      return [];
    }

    const normalizedMode = mode === "percent" ? "percent" : "flat";
    const dataAttribute = `data-plan-summary-${normalizedMode}`;
    selectElement
      .querySelectorAll(`option[${dataAttribute}]`)
      .forEach((option) => option.remove());

    const doc = selectElement.ownerDocument || document;
    const createdOptions = [];

    values.forEach((value) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return;
      }

      const textValue = numericValue.toString();
      const option = doc.createElement("option");
      option.value = textValue;
      option.textContent = textValue;
      option.setAttribute(dataAttribute, textValue);
      selectElement.appendChild(option);
      createdOptions.push(option);
    });

    return createdOptions;
  }

  setPlanSummaryAdjustmentMode(mode = "flat", options = {}) {
    const normalized = mode === "percent" ? "percent" : "flat";
    this._planSummaryActiveAdjustmentMode = normalized;

    if (this._planSummaryAdjustmentsEl) {
      this._planSummaryAdjustmentsEl.dataset.activeMode = normalized;
    }

    if (this._planSummaryModeToggle) {
      this._planSummaryModeToggle.dataset.activeMode = normalized;
      const nextMode = normalized === "flat" ? "percent" : "flat";
      const label =
        normalized === "flat"
          ? "Weight adjustments selected. Switch to percent adjustments."
          : "Percent adjustments selected. Switch to weight adjustments.";
      this._planSummaryModeToggle.setAttribute("aria-label", label);
      this._planSummaryModeToggle.setAttribute("title", label);
      this._planSummaryModeToggle.setAttribute(
        "aria-pressed",
        normalized === "percent" ? "true" : "false",
      );
    }

    if (this._planSummaryModeToggleLabelEl) {
      this._planSummaryModeToggleLabelEl.textContent =
        normalized === "flat"
          ? "Weight adjustments"
          : "Percent adjustments";
    }

    if (this._planSummaryFlatGroup) {
      this._planSummaryFlatGroup.hidden = normalized !== "flat";
    }

    if (this._planSummaryPercentGroup) {
      this._planSummaryPercentGroup.hidden = normalized !== "percent";
    }

    if (options.focus) {
      if (normalized === "flat" && this._planSummaryFlatSelect) {
        this._planSummaryFlatSelect.focus();
      } else if (normalized === "percent" && this._planSummaryPercentSelect) {
        this._planSummaryPercentSelect.focus();
      }
    }
  }

  capturePlanSourceInfo() {
    const items = Array.isArray(this.planItems) ? this.planItems : [];
    const itemCount = items.reduce((total, item) => {
      const setsValue = Number(item?.sets);
      return total + (Number.isFinite(setsValue) && setsValue > 0 ? setsValue : 1);
    }, 0);
    return {
      loadedName: this._loadedPlanName || null,
      itemCount,
      signature: this.computePlanItemsSignature(items),
    };
  }

  computePlanItemsSignature(items) {
    if (!Array.isArray(items)) {
      return null;
    }
    if (items.length === 0) {
      return "empty";
    }
    try {
      const canonical = this.canonicalizePlanValue(items);
      const json = JSON.stringify(canonical);
      let hash = 0;
      for (let i = 0; i < json.length; i += 1) {
        hash = (hash * 31 + json.charCodeAt(i)) >>> 0;
      }
      return hash.toString(16);
    } catch (error) {
      console.warn("Failed to compute plan signature", error);
      return null;
    }
  }

  canonicalizePlanValue(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.canonicalizePlanValue(entry));
    }
    if (typeof value === "object") {
      const result = {};
      Object.keys(value)
        .sort()
        .forEach((key) => {
          const current = value[key];
          if (typeof current === "function") {
            return;
          }
          result[key] = this.canonicalizePlanValue(current);
        });
      return result;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      return null;
    }
    return value;
  }

  isPlanSourceMatching(a, b) {
    if (!a || !b) {
      return false;
    }
    if (a.signature && b.signature) {
      return a.signature === b.signature;
    }
    if (!a.signature && !b.signature) {
      return a.itemCount === b.itemCount && a.loadedName === b.loadedName;
    }
    return false;
  }

  applyPlanSummaryAdjustment(options = {}) {
    const mode = options.mode === "percent" ? "percent" : "flat";

    const summary = this._lastPlanSummary;
    if (!summary || !Array.isArray(summary.sets) || summary.sets.length === 0) {
      this.showPlanSummaryAdjustmentFeedback(
        "Run a workout plan to adjust the next session.",
        "error",
      );
      return;
    }

    if (!Array.isArray(this.planItems) || this.planItems.length === 0) {
      this.showPlanSummaryAdjustmentFeedback(
        "No saved plan is loaded to adjust.",
        "error",
      );
      return;
    }

    const sourceInfo = this._planSummarySource;
    const currentSource = this.capturePlanSourceInfo();
    if (!this.isPlanSourceMatching(sourceInfo, currentSource)) {
      const label =
        summary.planName ||
        sourceInfo?.loadedName ||
        "this plan";
      this.showPlanSummaryAdjustmentFeedback(
        `Load "${label}" so it matches the completed workout before applying adjustments.`,
        "error",
      );
      return;
    }

    const unit = this._planSummaryDisplayUnit || summary.unit || this.weightUnit;
    const normalizedUnit = unit === "lb" ? "lb" : "kg";

    if (mode === "flat") {
      const rawValue = Number.parseFloat(options.amount);
      if (!Number.isFinite(rawValue) || rawValue <= 0) {
        this.showPlanSummaryAdjustmentFeedback(
          `Select an amount of ${this.getFriendlyUnitLabel(normalizedUnit)} to add.`,
          "error",
        );
        return;
      }

      const deltaKg = this.convertDisplayToKg(rawValue, normalizedUnit);
      if (!Number.isFinite(deltaKg) || deltaKg <= 0) {
        this.showPlanSummaryAdjustmentFeedback(
          "That amount could not be converted to a weight.",
          "error",
        );
        return;
      }

      const adjustedCount = this.adjustPlanWeightsByDelta(deltaKg);
      if (adjustedCount > 0) {
        const decimals = this.getLoadDisplayDecimalsForUnit(normalizedUnit);
        const amountText = parseFloat(rawValue.toFixed(decimals)).toString();
        const formattedDelta = `${amountText} ${this.getUnitLabel(normalizedUnit)}`;
        this.showPlanSummaryAdjustmentFeedback(
          `Added ${formattedDelta} per cable to ${adjustedCount} set${
            adjustedCount === 1 ? "" : "s"
          }.`,
          "success",
        );
        this._planSummarySource = this.capturePlanSourceInfo();
      } else {
        this.showPlanSummaryAdjustmentFeedback(
          "No weighted sets were available to adjust.",
          "error",
        );
      }
      return;
    }

    const rawPercent = Number.parseFloat(options.amount);
    if (!Number.isFinite(rawPercent) || rawPercent <= 0) {
      this.showPlanSummaryAdjustmentFeedback(
        "Select a percentage to increase your loads.",
        "error",
      );
      return;
    }

    const adjustedCount = this.adjustPlanWeightsByPercent(rawPercent);
    if (adjustedCount > 0) {
      const percentText = parseFloat(rawPercent.toFixed(1)).toString();
      this.showPlanSummaryAdjustmentFeedback(
        `Increased ${adjustedCount} set${
          adjustedCount === 1 ? "" : "s"
        } by ${percentText} percent per cable.`,
        "success",
      );
      this._planSummarySource = this.capturePlanSourceInfo();
    } else {
      this.showPlanSummaryAdjustmentFeedback(
        "No weighted sets were available to adjust.",
        "error",
      );
    }
  }

  adjustPlanWeightsByDelta(deltaKg) {
    if (!Number.isFinite(deltaKg) || deltaKg <= 0) {
      return 0;
    }

    let updated = 0;

    for (const item of this.planItems || []) {
      if (!item || item.type !== "exercise") {
        continue;
      }

      const current = Number(item.perCableKg);
      if (!Number.isFinite(current)) {
        continue;
      }

      const next = Math.max(0, current + deltaKg);
      if (Math.abs(next - current) < 1e-6) {
        continue;
      }

      item.perCableKg = next;
      updated += 1;
    }

    if (updated > 0) {
      this.afterPlanWeightsAdjusted();
      const displayUnit = this._planSummaryDisplayUnit || this.weightUnit;
      const deltaDisplay = this.convertKgToDisplay(deltaKg, displayUnit);
      const unitLabel = this.getUnitLabel(displayUnit);
      const decimals = this.getLoadDisplayDecimalsForUnit(displayUnit);
      const amountText = Number.isFinite(deltaDisplay)
        ? parseFloat(deltaDisplay.toFixed(decimals)).toString()
        : "";
      this.addLogEntry(
        `Plan weights increased by ${amountText} ${unitLabel} per cable for ${updated} set${
          updated === 1 ? "" : "s"
        }.`,
        "success",
      );
      try {
        if (this.isAudioTriggersEnabled()) {
          this.playAudio("strengthUnlocked").catch(() => {});
        }
      } catch (e) {}
    }

    return updated;
  }

  adjustPlanWeightsByPercent(percent) {
    if (!Number.isFinite(percent) || percent <= 0) {
      return 0;
    }

    let updated = 0;
    const multiplier = 1 + percent / 100;

    for (const item of this.planItems || []) {
      if (!item || item.type !== "exercise") {
        continue;
      }

      const current = Number(item.perCableKg);
      if (!Number.isFinite(current)) {
        continue;
      }

      const next = Math.max(0, current * multiplier);
      if (Math.abs(next - current) < 1e-6) {
        continue;
      }

      item.perCableKg = next;
      updated += 1;
    }

    if (updated > 0) {
      this.afterPlanWeightsAdjusted();
      const percentText = parseFloat(percent.toFixed(1)).toString();
      this.addLogEntry(
        `Plan weights increased by ${percentText}% per cable for ${updated} set${
          updated === 1 ? "" : "s"
        }.`,
        "success",
      );
      try {
        if (this.isAudioTriggersEnabled()) {
          this.playAudio("strengthUnlocked").catch(() => {});
        }
      } catch (e) {}
    }

    return updated;
  }

  afterPlanWeightsAdjusted() {
    this.ensurePlanItemsRepresentUnit(this.planItems, this.weightUnit);
    this.renderPlanUI();

    const planName = this._loadedPlanName;
    if (planName) {
      const saved = this.savePlanLocally(planName, this.planItems);
      if (saved && this.dropboxManager?.isConnected) {
        this.syncPlanToDropbox(planName, this.planItems, {
          silent: true,
          suppressError: true,
        });
      }
    }
  }

  presentPlanSummary(summary) {
    if (!this._planSummaryOverlay) {
      return;
    }

    const data = summary || this._lastPlanSummary;
    if (!data || !Array.isArray(data.sets) || data.sets.length === 0) {
      this.hidePlanSummary();
      return;
    }

    const displayUnit = data.unit || this.weightUnit;
    this._planSummaryDisplayUnit = displayUnit === "lb" ? "lb" : "kg";

    if (this._planSummaryPlanNameEl) {
      this._planSummaryPlanNameEl.textContent = data.planName || "";
    }

    if (this._planSummaryListEl) {
      this._planSummaryListEl.innerHTML = "";

      let overallKg = 0;

      data.sets.forEach((entry, index) => {
        if (!entry) return;

        const itemEl = document.createElement("div");
        itemEl.className = "plan-summary-item";

        const entryType = entry.itemType || "exercise";
        const entryName = entry.name || (entryType === "echo" ? "Echo Mode" : `Set ${index + 1}`);

        const header = document.createElement("div");
        header.className = "plan-summary-item__header";

        const nameEl = document.createElement("div");
        nameEl.className = "plan-summary-item__name";
        nameEl.textContent = entryName;
        header.appendChild(nameEl);

        if (entry.pr) {
          const prEl = document.createElement("div");
          prEl.className = "plan-summary-item__pr";
          prEl.innerHTML = `<i class="bi bi-star-fill" aria-hidden="true"></i><span>PR</span>`;
          if (entry.prDetails?.label) {
            prEl.title = entry.prDetails.label;
          }
          header.appendChild(prEl);
        }

        itemEl.appendChild(header);

        const metaParts = [];
        const setNumber = Number(entry.setNumber);
        const totalSets = Number(entry.totalSets);
        const hasSetNumber = Number.isFinite(setNumber) && setNumber > 0;
        const hasTotalSets = Number.isFinite(totalSets) && totalSets > 0;

        if (hasSetNumber && hasTotalSets) {
          metaParts.push(`Set ${setNumber}/${totalSets}`);
        } else if (hasSetNumber) {
          metaParts.push(`Set ${setNumber}`);
        }

        if (entry.isUnlimited) {
          metaParts.push("Reps: Unlimited");
        } else if (Number.isFinite(Number(entry.reps))) {
          const repsValue = Math.max(0, Number(entry.reps));
          metaParts.push(`Reps: ${repsValue}`);
        }

        if (metaParts.length) {
          const meta = document.createElement("div");
          meta.className = "plan-summary-item__meta";
          metaParts.forEach((part) => {
            const span = document.createElement("span");
            span.textContent = part;
            meta.appendChild(span);
          });
          itemEl.appendChild(meta);
        }

        const detailsParts = [];
        const weightKg = Number(entry.weightKg);
        const hasWeight = Number.isFinite(weightKg) && weightKg > 0;
        if (hasWeight) {
          detailsParts.push(
            `Weight: ${this.formatWeightWithUnit(weightKg, undefined, this._planSummaryDisplayUnit)} per cable`,
          );
        } else if (Number.isFinite(weightKg) && weightKg === 0) {
          detailsParts.push("Weight: Adaptive");
        }

        const cables = Number(entry.cables);
        if (Number.isFinite(cables) && cables > 0) {
          detailsParts.push(`Cables: ${cables}`);
        }

        const totalLoadKg =
          hasWeight && Number.isFinite(cables) && cables > 0 ? weightKg * cables : null;
        if (totalLoadKg !== null) {
          detailsParts.push(
            `Total load: ${this.formatWeightWithUnit(totalLoadKg, undefined, this._planSummaryDisplayUnit)}`,
          );
        }

        if (detailsParts.length) {
          const details = document.createElement("div");
          details.className = "plan-summary-item__details";
          detailsParts.forEach((part) => {
            const span = document.createElement("span");
            span.textContent = part;
            details.appendChild(span);
          });
          itemEl.appendChild(details);
        }

        if (entry.pr && entry.prDetails) {
          const prDetailsEl = document.createElement("div");
          prDetailsEl.className = "plan-summary-item__pr-details";

          const previousBestKg = Number.isFinite(entry.prDetails.previousBestKg)
            ? entry.prDetails.previousBestKg
            : null;
          const currentBestKg = Number.isFinite(entry.prDetails.currentKg)
            ? entry.prDetails.currentKg
            : null;
          const deltaKg = Number.isFinite(entry.prDetails.deltaKg)
            ? entry.prDetails.deltaKg
            : null;
          const deltaPct = Number.isFinite(entry.prDetails.deltaPct)
            ? entry.prDetails.deltaPct
            : null;

          const previousDisplay =
            previousBestKg && previousBestKg > 0
              ? this.formatWeightWithUnit(previousBestKg, undefined, this._planSummaryDisplayUnit)
              : "—";
          const currentDisplay = currentBestKg !== null
            ? this.formatWeightWithUnit(currentBestKg, undefined, this._planSummaryDisplayUnit)
            : "—";

          const deltaParts = [];
          if (deltaKg !== null) {
            const diffValue = this.formatWeightWithUnit(
              Math.abs(deltaKg),
              undefined,
              this._planSummaryDisplayUnit,
            );
            if (diffValue) {
              const diffSign = deltaKg >= 0 ? "+" : "−";
              deltaParts.push(`${diffSign}${diffValue}`);
            }
          }
          if (deltaPct !== null) {
            const pctSign = deltaPct >= 0 ? "+" : "−";
            deltaParts.push(`${pctSign}${Math.abs(deltaPct).toFixed(1)}%`);
          }

          let detailText = `Previous best: ${previousDisplay} → ${currentDisplay}`;
          if (deltaParts.length) {
            detailText += ` (${deltaParts.join(", ")})`;
          }

          prDetailsEl.textContent = detailText;
          itemEl.appendChild(prDetailsEl);
        }

        const loadEl = document.createElement("div");
        loadEl.className = "plan-summary-item__load";
        const volumeKg = Number(entry.volumeKg);
        if (!entry.isUnlimited && Number.isFinite(volumeKg) && volumeKg > 0) {
          loadEl.textContent = `Total volume lifted: ${this.formatWeightWithUnit(
            volumeKg,
            undefined,
            this._planSummaryDisplayUnit,
          )}`;
          overallKg += volumeKg;
        } else {
          loadEl.textContent = "Total volume lifted: —";
        }
        itemEl.appendChild(loadEl);

        this._planSummaryListEl.appendChild(itemEl);
      });

      if (this._planSummaryTotalEl) {
        if (overallKg > 0) {
          this._planSummaryTotalEl.textContent = `Total volume across sets: ${this.formatWeightWithUnit(
            overallKg,
            undefined,
            this._planSummaryDisplayUnit,
          )}`;
        } else {
          this._planSummaryTotalEl.textContent = "Total volume across sets: —";
        }
      }
    }

    this._planSummaryOverlay.classList.add("is-visible");
    this._planSummaryOverlay.setAttribute("aria-hidden", "false");

    try {
      if (this.isAudioTriggersEnabled()) {
        this.playAudio("crowdCheer").catch(() => {});
      }
    } catch (e) {}

    const closeBtn = document.getElementById("planSummaryCloseBtn");
    closeBtn?.focus({ preventScroll: true });
    this.preparePlanSummaryAdjustments(this._planSummaryDisplayUnit);
    this.resetPlanSummaryAdjustments();
    this.setPlanSummaryAdjustmentMode("flat");
    this.updatePlanSummaryReopenVisibility();
  }

  initializePlanSummary() {
    this._planSummaryData = {
      startedAt: Date.now(),
      planName: this.getActivePlanDisplayName(),
      sets: [],
      unit: this.weightUnit,
    };
    this._lastPlanSummary = null;
    this._planSummaryDisplayUnit = null;
    this._planSummarySource = this.capturePlanSourceInfo();
    this.hidePlanSummary();
    this.resetPlanSummaryAdjustments();
    this.updatePlanSummaryReopenVisibility();
  }

  recordPlanSetResult(workout, meta = {}) {
    if (!this._planSummaryData || !workout) {
      return;
    }

    this._planSummaryData.unit = this.weightUnit;

    const entryMeta = meta.completedEntry || null;
    const planItem = entryMeta ? this.planItems?.[entryMeta.itemIndex] : null;

    const name =
      entryMeta?.name ||
      planItem?.name ||
      workout.setName ||
      (workout.itemType === "echo" ? "Echo Mode" : "Exercise");

    const itemType = entryMeta?.type || planItem?.type || workout.itemType || "exercise";
    const isEcho = itemType === "echo";
    const totalSets = Number(entryMeta?.totalSets || planItem?.sets) || null;
    const setNumber = entryMeta?.set ?? workout.setNumber ?? null;
    const cablesValue = Number(entryMeta?.cables || planItem?.cables);
    const cables = Number.isFinite(cablesValue) && cablesValue > 0 ? cablesValue : 2;

    const weightPerCableKg = Number.isFinite(workout.weightKg) && workout.weightKg > 0
      ? workout.weightKg
      : Number(entryMeta?.perCableKg || planItem?.perCableKg) || 0;

    const plannedReps = Number(planItem?.reps);
    const completedReps = Number.isFinite(workout.reps) ? workout.reps : plannedReps;
    const unlimited =
      isEcho ||
      Boolean(planItem?.justLift) ||
      (!Number.isFinite(completedReps) && (!Number.isFinite(plannedReps) || plannedReps <= 0)) ||
      (Number.isFinite(plannedReps) && plannedReps <= 0);

    const repsValue = unlimited ? 0 : Math.max(0, completedReps || 0);
    const volumeKg = unlimited ? 0 : weightPerCableKg * cables * repsValue;

    const prInfo = meta.prInfo || null;
    const prDetails =
      prInfo?.status === "new"
        ? {
            label: prInfo.label || name,
            previousBestKg: Number.isFinite(prInfo.previousBestKg)
              ? prInfo.previousBestKg
              : prInfo.previousBestKg || 0,
            currentKg: Number.isFinite(prInfo.currentKg) ? prInfo.currentKg : 0,
            deltaKg: Number.isFinite(prInfo.deltaKg) ? prInfo.deltaKg : null,
            deltaPct: Number.isFinite(prInfo.deltaPct) ? prInfo.deltaPct : null,
          }
        : null;

    this._planSummaryData.sets.push({
      name,
      itemType,
      setNumber,
      totalSets,
      reps: repsValue,
      isUnlimited: unlimited,
      weightKg: weightPerCableKg,
      cables,
      volumeKg,
      pr: prInfo?.status === "new",
      prDetails,
    });
  }

  finalizePlanSummary() {
    if (!this._planSummaryData) {
      return this._lastPlanSummary;
    }

    const snapshot = {
      ...this._planSummaryData,
      sets: [...this._planSummaryData.sets],
      finishedAt: Date.now(),
    };

    snapshot.unit = snapshot.unit || this.weightUnit;

    this._planSummaryData = null;
    this._lastPlanSummary = snapshot;
    return snapshot;
  }

  onPlanRestStateChange() {
    this.updatePlanSetIndicator();
  }

  updatePlanSetIndicator() {
    const els = this._planIndicatorEls;
    if (!els || !els.container || !els.name || !els.set || !els.reps) {
      return;
    }

    if (!this.planActive || !Array.isArray(this.planTimeline) || !this.planTimeline.length) {
      els.container.classList.add("is-hidden");
      els.name.textContent = "";
      els.set.textContent = "";
      els.reps.textContent = "";
      return;
    }

    let entry = this._activePlanEntry || null;
    if (!entry && this.planTimelineIndex < this.planTimeline.length) {
      entry = this.planTimeline[this.planTimelineIndex];
    }

    const item = entry ? this.planItems?.[entry.itemIndex] : null;
    if (!entry || !item) {
      els.container.classList.add("is-hidden");
      els.name.textContent = "";
      els.set.textContent = "";
      els.reps.textContent = "";
      return;
    }

    const name = item.name || (item.type === "echo" ? "Echo Mode" : "Exercise");
    els.name.textContent = name;

    const totalSets = Math.max(1, Number(item.sets) || 1);
    const setText = `Set ${entry.set} of ${totalSets}`;
    els.set.textContent = setText;

    const planReps = Number(item.reps);
    const unlimited =
      item.type === "echo" ||
      Boolean(item.justLift) ||
      (Number.isFinite(planReps) && planReps <= 0) ||
      !Number.isFinite(planReps);
    let repsText = "";
    if (unlimited) {
      repsText = "Unlimited reps";
    } else if (planReps > 0) {
      repsText = `${planReps} reps`;
    }

    els.reps.textContent = repsText ? `• ${repsText}` : "";
    els.container.classList.remove("is-hidden");
  }

  getActivePlanDisplayName() {
    if (typeof document === "undefined") {
      return "Workout Plan";
    }

    const nameInput = document.getElementById("planNameInput");
    const typedName = nameInput?.value?.trim();
    if (typedName) {
      return typedName;
    }

    const select = document.getElementById("planSelect");
    const option = select?.selectedOptions?.[0];
    const selectedName = option?.textContent?.trim();
    if (selectedName) {
      return selectedName;
    }

    return "Workout Plan";
  }

  updateCurrentSetLabel() {
    if (typeof document === "undefined") {
      return;
    }

    const label = document.getElementById("currentSetName");
    if (!label) {
      return;
    }

    if (this.planActive && this.planCursor && this.planItems[this.planCursor.index]) {
      const planItem = this.planItems[this.planCursor.index];
      label.textContent = planItem.name || (planItem.type === "echo" ? "Echo Mode" : "Plan Set");
      return;
    }

    if (this.currentWorkout) {
      if (this.currentWorkout.setName) {
        label.textContent = this.currentWorkout.setName;
      } else {
        label.textContent = "Live Set";
      }
      return;
    }

    label.textContent = "\u00a0";
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

    this.setDropboxButtonState(isConnected ? "connected" : "disconnected");
    if (isConnected) {
      this._dropboxConnectInFlight = false;
    } else {
      this.cancelDropboxSyncHold();
    }

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

      this.setDropboxButtonLastBackupText("Tap to connect Dropbox.");
      this._dropboxSyncBusyCount = 0;
      this.setDropboxSyncBusy(false);
      this._autoSyncInFlight = false;
      this._hasPerformedInitialSync = false;
    }
  }

  setDropboxButtonState(state = "disconnected") {
    const button = document.getElementById("dropboxStatusButton");
    if (!button) return;

    const states = ["dbx-state-disconnected", "dbx-state-connecting", "dbx-state-connected"];
    button.classList.remove(...states);
    const nextClass = `dbx-state-${state}`;
    if (states.includes(nextClass)) {
      button.classList.add(nextClass);
    } else {
      button.classList.add("dbx-state-disconnected");
    }

    const ariaLabelMap = {
      connected: "Dropbox connected. Use sync to pull workouts.",
      connecting: "Connecting to Dropbox",
      disconnected: "Connect to Dropbox",
    };

    button.setAttribute("aria-pressed", state === "connected" ? "true" : "false");
    button.setAttribute("aria-label", ariaLabelMap[state] || "Dropbox status");
    button.dataset.state = state;

    if (state === "connected") {
      button.classList.remove("button-pulse");
    } else if (state === "disconnected") {
      button.classList.add("button-pulse");
    } else {
      button.classList.remove("button-pulse");
    }
  }

  setDropboxButtonLastBackupText(text = "") {
    const subtext = document.getElementById("dropboxButtonLastBackup");
    if (!subtext) return;
    subtext.textContent = text;
  }

  setDropboxSyncBusy(isBusy) {
    const button = document.getElementById("dropboxStatusButton");
    const syncButton = document.getElementById("dropboxPillSync");
    if (!button || !syncButton) {
      return;
    }

    const defaultTitle = "Tap to sync, hold to disconnect";

    if (isBusy) {
      button.classList.add("dbx-sync-busy");
      syncButton.setAttribute("aria-busy", "true");
      syncButton.setAttribute("title", "Syncing from Dropbox…");
    } else {
      button.classList.remove("dbx-sync-busy");
      syncButton.removeAttribute("aria-busy");
      syncButton.setAttribute("title", defaultTitle);
    }
  }

  beginDropboxSyncBusy() {
    this._dropboxSyncBusyCount = (this._dropboxSyncBusyCount || 0) + 1;
    this.setDropboxSyncBusy(true);
  }

  endDropboxSyncBusy() {
    this._dropboxSyncBusyCount = Math.max(
      0,
      (this._dropboxSyncBusyCount || 0) - 1,
    );
    if (this._dropboxSyncBusyCount === 0) {
      this.setDropboxSyncBusy(false);
    }
  }

  setDeviceButtonState(state = "disconnected") {
    const button = document.getElementById("deviceStatusButton");
    if (!button) return;

    const states = [
      "device-state-disconnected",
      "device-state-connecting",
      "device-state-connected",
    ];
    button.classList.remove(...states);
    const nextState = `device-state-${state}`;
    if (states.includes(nextState)) {
      button.classList.add(nextState);
    } else {
      button.classList.add("device-state-disconnected");
    }

    button.setAttribute("data-state", state);
    button.setAttribute("aria-pressed", state === "connected" ? "true" : "false");

    if (state === "connected") {
      button.classList.remove("device-btn--pulse");
      button.setAttribute("aria-label", "Vitruvian connected. Hold to disconnect.");
    } else if (state === "connecting") {
      button.classList.remove("device-btn--pulse");
      button.setAttribute("aria-label", "Connecting to Vitruvian…");
    } else {
      button.classList.add("device-btn--pulse");
      button.setAttribute("aria-label", "Connect to Vitruvian device");
    }
  }

  setDeviceButtonSubtext(text = "") {
    const subtext = document.getElementById("deviceButtonSubtext");
    if (!subtext) return;
    subtext.textContent = text;
  }

  startDeviceHold() {
    if (this._deviceHoldTimer || this._deviceConnectInFlight) {
      return;
    }
    if (!this.device?.isConnected) {
      return;
    }

    const button = document.getElementById("deviceStatusButton");
    if (!button) {
      return;
    }

    button.classList.add("device-btn-hold-arming");
    this._deviceHoldTimer = window.setTimeout(() => {
      this._deviceHoldTimer = null;
      button.classList.remove("device-btn-hold-arming");
      button.classList.add("device-btn-hold-fired");
      this._deviceHoldTriggered = true;
      this.setDeviceButtonSubtext("Disconnecting…");
      this.disconnect();
      setTimeout(() => {
        button.classList.remove("device-btn-hold-fired");
      }, 900);
    }, 1500);
  }

  cancelDeviceHold() {
    const button = document.getElementById("deviceStatusButton");
    const hadHoldTimer = Boolean(this._deviceHoldTimer);
    if (this._deviceHoldTimer) {
      clearTimeout(this._deviceHoldTimer);
      this._deviceHoldTimer = null;
    }
    if (button) {
      button.classList.remove("device-btn-hold-arming", "device-btn-hold-fired");
    }
    if (hadHoldTimer) {
      this._deviceHoldTriggered = false;
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
    if (!this.dropboxManager?.isConnected) {
      return;
    }

    const lastBackup = localStorage.getItem("vitruvian.dropbox.lastBackup");
    if (lastBackup) {
      const date = new Date(lastBackup);
      const timeAgo = this.getTimeAgo(date);
      this.setDropboxButtonLastBackupText(`📁 Last backup: ${timeAgo}.`);
    } else {
      this.setDropboxButtonLastBackupText("📁 No backups yet.");
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

  handleDropboxConnectButton() {
    if (this.dropboxManager?.isConnected) {
      this.addLogEntry("Dropbox is already connected.", "info");
      return;
    }

    if (this._dropboxConnectInFlight) {
      return;
    }

    this._dropboxConnectInFlight = true;
    this.setDropboxButtonState("connecting");

    Promise.resolve(this.connectDropbox())
      .catch(() => {
        // Errors handled in connectDropbox; this ensures state resets
      })
      .finally(() => {
        if (!this.dropboxManager?.isConnected) {
          this.setDropboxButtonState("disconnected");
        }
        this._dropboxConnectInFlight = false;
      });
  }

  handleDropboxQuickSync() {
    this.cancelDropboxSyncHold();
    if (!this.dropboxManager?.isConnected) {
      alert("Connect to Dropbox first to sync workouts.");
      return;
    }

    this.syncFromDropbox();
  }

  startDropboxSyncHold() {
    if (!this.dropboxManager?.isConnected) {
      return;
    }

    const button = document.getElementById("dropboxStatusButton");
    if (!button) {
      return;
    }

    this.cancelDropboxSyncHold();
    button.classList.add("dbx-sync-hold-arming");

    this._dropboxSyncHoldTimer = window.setTimeout(() => {
      this._dropboxSyncHoldTimer = null;
      button.classList.remove("dbx-sync-hold-arming");
      button.classList.add("dbx-sync-hold-fired");
      this._dropboxSyncHoldTriggered = true;
      this.disconnectDropbox({ silent: true });
      setTimeout(() => {
        button.classList.remove("dbx-sync-hold-fired");
      }, 800);
      setTimeout(() => {
        this._dropboxSyncHoldTriggered = false;
      }, 1500);
    }, 1500);
  }

  cancelDropboxSyncHold() {
    const button = document.getElementById("dropboxStatusButton");
    if (!button) {
      return;
    }

    if (this._dropboxSyncHoldTimer) {
      clearTimeout(this._dropboxSyncHoldTimer);
      this._dropboxSyncHoldTimer = null;
    }

    button.classList.remove("dbx-sync-hold-arming");
  }

  async connectDropbox() {
    try {
      await this.dropboxManager.connect();
    } catch (error) {
      this.addLogEntry(`Failed to connect Dropbox: ${error.message}`, "error");
      alert(`Failed to connect to Dropbox: ${error.message}`);
    }
  }

  disconnectDropbox(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      const confirmed = confirm("Are you sure you want to disconnect Dropbox? Your workout history will remain in your Dropbox, but new workouts won't be automatically backed up.");
      if (!confirmed) {
        return false;
      }
    }

    this.dropboxManager.disconnect();
    this._dropboxSyncBusyCount = 0;
    this.setDropboxSyncBusy(false);
    this.addLogEntry("Disconnected from Dropbox", "info");
    return true;
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

    let busyEngaged = false;
    try {
      this.beginDropboxSyncBusy();
      busyEngaged = true;

      this.addLogEntry(
        `${auto ? "Auto-syncing" : "Syncing"} workouts from Dropbox (reason: ${reason})...`,
        "info",
      );
      this.logDropboxConsole(
        "Sync",
        `${auto ? "Auto" : "Manual"} sync started (reason: ${reason})`,
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

      if (newCount > 0) {
        this.setHistoryPage(1);
      }

      this.updateHistoryDisplay();

      const message = newCount > 0
        ? `Synced ${newCount} new workout(s) from Dropbox`
        : "No new workouts found in Dropbox";

      await this.syncPlansFromDropbox({ silent: auto });
      await this.syncPersonalRecordsFromDropbox({ silent: auto });

      const backfilled = this.ensurePersonalRecordsFromHistory();
      if (backfilled) {
        this.queuePersonalRecordsDropboxSync("history-backfill");
      }

      // Update last backup display to show sync time
      if (normalizedCloud.length > 0) {
        localStorage.setItem("vitruvian.dropbox.lastBackup", new Date().toISOString());
        this.updateLastBackupDisplay();
      }

      this.addLogEntry(message, "success");
      this.logDropboxConsole("Sync", message);

      this._hasPerformedInitialSync = true;
    } catch (error) {
      this.addLogEntry(`Failed to sync from Dropbox: ${error.message}`, "error");
      this.logDropboxConsole("Sync", `Failed: ${error.message}`, {
        level: "error",
      });
    } finally {
      if (busyEngaged) {
        this.endDropboxSyncBusy();
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
      const previousRemoteNames = new Set(this.getDropboxPlanNames());
      const remoteNames = Object.keys(plans);
      const remoteSet = new Set(remoteNames);

      const localOnlyNames = [...existingNames].filter(
        (name) => !previousRemoteNames.has(name),
      );
      const finalNames = this.setAllPlanNames([...localOnlyNames, ...remoteNames]);

      for (const name of remoteNames) {
        try {
          const items = Array.isArray(plans[name]) ? plans[name] : [];
          localStorage.setItem(this.planKey(name), JSON.stringify(items));
        } catch {
          // ignore local persistence errors
        }
      }

      for (const name of previousRemoteNames) {
        if (!remoteSet.has(name)) {
          localStorage.removeItem(this.planKey(name));
        }
      }

      this.setDropboxPlanNames(remoteNames);

      this.refreshPlanSelectNames();

      if (!silent) {
        if (finalNames.length > 0) {
          this.addLogEntry(
            `Loaded ${finalNames.length} plan${finalNames.length === 1 ? "" : "s"} from Dropbox`,
            "success",
          );
        } else {
          this.addLogEntry("No plans found in Dropbox", "info");
        }
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

  async exportAllToDropboxExcel(options = {}) {
    const manual = options?.manual === true;
    if (!manual) {
      this.addLogEntry(
        "Blocked non-manual request to export all workouts as Excel",
        "warning",
      );
      return;
    }

    if (!this.dropboxManager.isConnected) {
      alert("Please connect to Dropbox first");
      return;
    }

    const updateStatus = (message, options = {}) => {
      this.logDropboxConsole("Excel Export", message, options);
      this.setDropboxStatus(`Excel Export: ${message}`.trim(), options);
    };

    try {
      updateStatus("Exporting: grabbing workouts...");

      const cloudWorkouts = await this.dropboxManager.loadWorkouts({
        maxEntries: Infinity,
      });
      const normalized = cloudWorkouts
        .map((workout) => this.normalizeWorkout(workout))
        .filter(Boolean);

      if (normalized.length === 0) {
        alert("No workouts available in Dropbox to export");
        this.setDropboxStatus("");
        return;
      }

      this.annotateWorkoutsForExport(normalized);
      updateStatus("Exporting: preparing workbook...");

      await this.syncPersonalRecordsFromDropbox({ silent: true });
      const personalRecords = this.getPersonalRecordsList();
      const unitLabel = this.getUnitLabel();
      const workoutRows = this.buildWorkoutDataRowsForExcel(
        normalized,
        unitLabel,
      );
      const prRows = this.buildPersonalRecordRowsForExcel(
        personalRecords,
        unitLabel,
      );

      const workoutSheetDefs = this.createWorkoutSheetDefs(workoutRows);
      const prSheet = {
        name: "PRs Current",
        rows: prRows,
        dateColumns: [1],
      };
      const workbookArray = this.buildExcelWorkbookArray({
        sheets: [...workoutSheetDefs, prSheet],
      });

      const workbookData =
        workbookArray instanceof ArrayBuffer
          ? new Uint8Array(workbookArray)
          : workbookArray;
      const filename = `workout_history_${new Date().toISOString().split("T")[0]}.xlsx`;
      updateStatus(`Exporting: uploading ${filename}...`);
      await this.dropboxManager.exportExcelWorkbook(filename, workbookData);

      this.addLogEntry(
        `Exported ${normalized.length} workout${normalized.length === 1 ? "" : "s"} to Dropbox as ${filename}`,
        "success",
      );
      updateStatus(`Export complete! Saved as ${filename} in Dropbox`, {
        color: "#2f9e44",
      });
    } catch (error) {
      this.addLogEntry(`Failed to export Excel: ${error.message}`, "error");
      alert(`Failed to export Excel: ${error.message}`);
      updateStatus(`Error: ${error.message}`);
    }
  }

  requestExportAllToDropboxExcel() {
    return this.exportAllToDropboxExcel({ manual: true });
  }

  requestDeleteWorkout(index) {
    return this.deleteWorkoutHistoryEntry(index, { manual: true });
  }

  requestPersonalRecordsSync() {
    return this.syncPersonalRecordsManual({ manual: true });
  }

  async syncPersonalRecordsManual(options = {}) {
    if (!this.dropboxManager.isConnected) {
      alert("Please connect to Dropbox first");
      return;
    }

    const manual = options?.manual === true;
    if (!manual) {
      this.addLogEntry(
        "Blocked non-manual request to sync personal records",
        "warning",
      );
      return;
    }

    const confirmed = window.confirm(
      "This will rebuild personal-records.json from your full workout history and upload it to Dropbox. This may take a moment. Continue?",
    );
    if (!confirmed) {
      this.addLogEntry("Personal records sync cancelled", "info");
      return;
    }

    const context = "Personal Records Sync";
    const updateStatus = (message, opts = {}) => {
      this.logDropboxConsole(context, message, opts);
      this.setDropboxStatus(`${context}: ${message}`, opts);
    };

    try {
      updateStatus("Downloading latest personal-records.json...");
      await this.syncPersonalRecordsFromDropbox({ silent: true });

      updateStatus("Downloading workouts from Dropbox...");
      const cloudWorkouts = await this.dropboxManager.loadWorkouts({
        maxEntries: Infinity,
      });
      const normalizedCloud = cloudWorkouts
        .map((workout) => this.normalizeWorkout(workout))
        .filter(Boolean);

      updateStatus("Building personal records from full history...");
      if (normalizedCloud.length > 0) {
        this.buildPersonalRecordsFromWorkouts(normalizedCloud);
      } else {
        this.ensurePersonalRecordsFromHistory();
      }

      updateStatus("Uploading to Dropbox...");
      await this.syncPersonalRecordsToDropbox({ force: true, silent: true });

      updateStatus("Completed!", { color: "#2f9e44", preserveColor: true });
      this.addLogEntry("Personal records synced to Dropbox", "success");
    } catch (error) {
      const message = `Failed to sync personal records: ${error.message}`;
      this.addLogEntry(message, "error");
      updateStatus(`Error: ${error.message}`, { color: "#c92a2a" });
    }
  }

  requestUpdateAveragesOldWorkouts() {
    return this.updateAveragesOldWorkouts({ manual: true });
  }

  async updateAveragesOldWorkouts(options = {}) {
    if (!this.dropboxManager.isConnected) {
      alert("Please connect to Dropbox first");
      return;
    }

    const manual = options?.manual === true;
    if (!manual) {
      this.addLogEntry(
        "Blocked non-manual request to update averages",
        "warning",
      );
      return;
    }

    const confirmed = window.confirm(
      "This will scan all your workout files from Dropbox and calculate missing average load fields (averageLoad, averageLoadLeft, averageLoadRight). This may take a moment. Continue?",
    );
    if (!confirmed) {
      this.addLogEntry("Average update cancelled", "info");
      return;
    }

    const context = "Update Averages";
    const updateStatus = (message, opts = {}) => {
      this.logDropboxConsole(context, message, opts);
      this.setDropboxStatus(`${context}: ${message}`, opts);
    };

    try {
      updateStatus("Downloading workouts from Dropbox...");
      const cloudWorkouts = await this.dropboxManager.loadWorkouts({
        maxEntries: Infinity,
      });

      if (!Array.isArray(cloudWorkouts) || cloudWorkouts.length === 0) {
        updateStatus("No workouts found", { color: "#ff922b" });
        this.addLogEntry("No workouts found in Dropbox", "info");
        return;
      }

      let updatedCount = 0;
      const updatedWorkouts = [];

      for (const workout of cloudWorkouts) {
        if (!workout || typeof workout !== "object") {
          continue;
        }

        // Check if averages are missing
        const hasAverageLoad = workout.hasOwnProperty("averageLoad");
        const hasAverageLoadLeft = workout.hasOwnProperty("averageLoadLeft");
        const hasAverageLoadRight = workout.hasOwnProperty("averageLoadRight");

        if (hasAverageLoad && hasAverageLoadLeft && hasAverageLoadRight) {
          // All fields exist, skip
          continue;
        }

        // Calculate averages from movement data
        const averageLoads = this.calculateAverageLoadForWorkout(
          Array.isArray(workout.movementData) ? workout.movementData : [],
          workout.warmupEndTime,
          workout.endTime,
        );

        // Only update if missing at least one field
        if (!hasAverageLoad || !hasAverageLoadLeft || !hasAverageLoadRight) {
          workout.averageLoad = averageLoads ? averageLoads.averageTotal : null;
          workout.averageLoadLeft = averageLoads ? averageLoads.averageLeft : null;
          workout.averageLoadRight = averageLoads ? averageLoads.averageRight : null;
          updatedWorkouts.push(workout);
          updatedCount++;
        }
      }

      if (updatedCount === 0) {
        updateStatus("All workouts already have average fields", {
          color: "#2f9e44",
          preserveColor: true,
        });
        this.addLogEntry("No updates needed", "info");
        return;
      }

      updateStatus(`Uploading ${updatedCount} updated workouts...`);

      // Upload all updated workouts to Dropbox, overwriting the original files
      for (const workout of updatedWorkouts) {
        try {
          await this.dropboxManager.overwriteWorkout(workout);
        } catch (error) {
          this.addLogEntry(
            `Failed to save workout: ${error.message}`,
            "error",
          );
        }
      }

      updateStatus(`Completed! Updated ${updatedCount} workouts.`, {
        color: "#2f9e44",
        preserveColor: true,
      });
      this.addLogEntry(`Updated averages for ${updatedCount} workouts`, "success");
    } catch (error) {
      const message = `Failed to update averages: ${error.message}`;
      this.addLogEntry(message, "error");
      updateStatus(`Error: ${error.message}`, { color: "#c92a2a" });
    }
  }

  setWeightUnit(unit, options = {}) {
    if (unit !== "kg" && unit !== "lb") {
      return;
    }

    const previousUnit = options.previousUnit || this.weightUnit;
    const skipSave = Boolean(options.skipSave);

    if (unit === this.weightUnit && !options.force) {
      return;
    }

    const weightInput = document.getElementById("weight");
    const progressionInput = document.getElementById("progression");

    const currentProgression = progressionInput
      ? parseFloat(progressionInput.value)
      : NaN;

    const weightKg = Number.isFinite(this._weightInputKg) ? this._weightInputKg : null;
    const progressionKg = !isNaN(currentProgression)
      ? this.convertDisplayToKg(currentProgression, previousUnit)
      : null;

    this.weightUnit = unit;

    if (weightInput && weightKg !== null && !Number.isNaN(weightKg)) {
      weightInput.value = this.formatWeightValue(weightKg, this.getWeightInputDecimals());
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
    if (!skipSave) {
      this.saveWeightUnitPreference();
    }
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
    this.handlePlanUnitPreferenceChange();
    this.renderPlanUI();
    this.renderLoadDisplays(this.currentSample);
    this.updateHistoryDisplay();
    this.applyUnitToChart();
    this.updatePersonalBestDisplay();
    this.updatePositionBarColors(this.currentSample);

    this.syncPersonalRecordsToDropbox({ reason: "unit-change", force: true, silent: true }).catch(() => {
      /* errors handled inside syncPersonalRecordsToDropbox */
    });
  }

  getUnitLabel(unit = this.weightUnit) {
    return unit === "lb" ? "lb" : "kg";
  }

  getFriendlyUnitLabel(unit = this.weightUnit) {
    return unit === "lb" ? "pounds" : "kilograms";
  }

  getLoadDisplayDecimals() {
    return this.getLoadDisplayDecimalsForUnit(this.weightUnit);
  }

  getLoadDisplayDecimalsForUnit(unit) {
    return unit === "lb" ? 1 : 1;
  }

  getWeightInputDecimals() {
    return this.getLoadDisplayDecimalsForUnit(this.weightUnit);
  }

  getProgressionInputDecimals() {
    return this.getProgressionDisplayDecimalsForUnit(this.weightUnit);
  }

  getProgressionDisplayDecimalsForUnit(unit) {
    return unit === "lb" ? 1 : 1;
  }

  convertKgToDisplay(kg, unit = this.weightUnit) {
    if (kg === null || kg === undefined || isNaN(kg)) {
      return NaN;
    }
    const normalized = unit === "lb" ? "lb" : "kg";
    const converted = sharedConvertKgToUnit(kg, normalized);
    return Number.isFinite(converted) ? converted : NaN;
  }

  convertDisplayToKg(value, unit = this.weightUnit) {
    if (value === null || value === undefined || isNaN(value)) {
      return NaN;
    }
    const normalized = unit === "lb" ? "lb" : "kg";
    const converted = sharedConvertUnitToKg(value, normalized);
    return Number.isFinite(converted) ? converted : NaN;
  }

  formatWeightValue(kg, decimals = undefined, unit = this.weightUnit) {
    if (kg === null || kg === undefined || isNaN(kg)) {
      return "";
    }

    const resolvedUnit = unit === "lb" ? "lb" : "kg";
    const resolvedDecimals = Number.isFinite(decimals)
      ? decimals
      : this.getLoadDisplayDecimalsForUnit(resolvedUnit);
    const displayValue = this.convertKgToDisplay(kg, resolvedUnit);
    return Number.isFinite(displayValue) ? displayValue.toFixed(resolvedDecimals) : "";
  }

  formatWeightWithUnit(kg, decimals = undefined, unit = this.weightUnit) {
    const resolvedUnit = unit === "lb" ? "lb" : "kg";
    const value = this.formatWeightValue(kg, decimals, resolvedUnit);
    if (!value) {
      return value;
    }
    return `${value} ${this.getUnitLabel(resolvedUnit)}`;
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
    const sharedUnit =
      typeof sharedGetUnitPreference === "function"
        ? sharedGetUnitPreference()
        : null;
    if (sharedUnit === "lb" || sharedUnit === "kg") {
      return sharedUnit;
    }
    if (typeof window === "undefined" || !window.localStorage) {
      return "kg";
    }
    try {
      const stored = localStorage.getItem("vitruvian.weightUnit");
      if (stored === "lb" || stored === "kg") {
        return stored;
      }
    } catch (error) {
      // Ignore storage errors and fall back to default.
    }
    return "kg";
  }

  saveWeightUnitPreference() {
    const normalized = this.weightUnit === "lb" ? "lb" : "kg";
    if (typeof sharedSetUnitPreference === "function") {
      sharedSetUnitPreference(normalized);
    }
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      localStorage.setItem("vitruvian.weightUnit", normalized);
    } catch (error) {
      // Ignore storage errors (e.g., private browsing).
    }
  }

  renderLoadDisplays(sample) {
    const decimals = this.getLoadDisplayDecimals();
    const unitLabel = this.getUnitLabel();

    const safeSample = this.normalizeSampleForDisplay(sample);

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
      const suffix = hasLabel
        ? ` (${current.identityLabel})`
        : " (Per Cable)";
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

    this.trackPersonalRecordCandidate(bestKg);

    this.setPersonalBestHighlight(true);
    this.updatePersonalBestDisplay();

    const priorBest = Number(this.currentWorkout?.priorBestTotalLoadKg) || 0;
    const formatted = this.formatWeightWithUnit(bestKg);
    const message = identityLabel
      ? `New personal best for ${identityLabel}: ${formatted} per cable`
      : `New per-cable personal best: ${formatted}`;
    this.addLogEntry(`🎉 ${message}`, "success");

    if (priorBest > 0) {
      this.triggerConfetti();
    }
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
    const programSection = document.getElementById("programSection");
    const echoSection = document.getElementById("echoSection");

    if (connected) {
      this.setDeviceButtonState("connected");
      this.setDeviceButtonSubtext("Hold to disconnect.");
      this.cancelDeviceHold();
  //KEEP PROGRAM HIDDEN    programSection.classList.remove("hidden");
  //KEEP ECHO HIDDEN    echoSection.classList.remove("hidden");
    } else {
      this.setDeviceButtonState("disconnected");
      this.setDeviceButtonSubtext("Tap to connect your Vitruvian.");
      this.cancelDeviceHold();
      if (programSection) {
        programSection.classList.add("hidden");
      }
      if (echoSection) {
        echoSection.classList.add("hidden");
      }
    }

    this.updateStopButtonState();
  }

  updateLiveStats(sample) {
    // Store current sample for auto-stop checking
    this.currentSample = sample;

    const displaySample = this.normalizeSampleForDisplay(sample);
    const loadA = Number(displaySample.loadA) || 0;
    const loadB = Number(displaySample.loadB) || 0;
    const peakLoadKg = Math.max(loadA, loadB);

    if (
      this.currentWorkout &&
      typeof this.currentWorkout === "object"
    ) {
      const priorBest =
        Number(this.currentWorkout.priorBestTotalLoadKg) || 0;
      const previousPeak =
        Number(this.currentWorkout.livePeakTotalLoadKg) || 0;
      const livePeak = peakLoadKg > previousPeak ? peakLoadKg : previousPeak;
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
    this.renderLoadDisplays(displaySample);
    this.updateLiveWeightDisplay(displaySample);

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
    this.chartManager.addData(displaySample);

    this.trackPlanPauseMovement(displaySample);
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

    const isDesktop = this.isDesktopLayout();

    if (isDesktop) {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      this.applySidebarCollapsedState();
      this.saveSidebarPreference(this.sidebarCollapsed);
    } else {
      sidebar.classList.toggle("open");
      if (overlay) {
        overlay.classList.toggle("show");
      }
      const isOpen = sidebar.classList.contains("open");
      if (document.body) {
        document.body.classList.toggle("sidebar-open", isOpen);
      }
      this.updateSidebarToggleVisual();
    }

    this.requestChartResize();
  }

  closeSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("overlay");
    if (!sidebar) {
      return;
    }

    const isDesktop = this.isDesktopLayout();
    if (isDesktop) {
      return;
    }

    sidebar.classList.remove("open");
    if (overlay) {
      overlay.classList.remove("show");
    }
    if (document.body) {
      document.body.classList.remove("sidebar-open");
    }
    this.updateSidebarToggleVisual();

    this.requestChartResize();
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
    const warmupEl = this._warmupCounterEl || document.getElementById("warmupCounter");
    if (warmupEl) {
      this._warmupCounterEl = warmupEl;
      if (this.currentWorkout) {
        warmupEl.textContent = `${this.warmupReps}/${this.warmupTarget}`;
      } else {
        warmupEl.textContent = `-/3`;
      }
    }

    // Update working reps counter
    const workingEl = this._workingCounterEl || document.getElementById("workingCounter");
    if (workingEl) {
      this._workingCounterEl = workingEl;
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

  getCableRange(cable) {
    const min =
      cable === "A" ? this.minRepPosA : this.minRepPosB;
    const max =
      cable === "A" ? this.maxRepPosA : this.maxRepPosB;

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return null;
    }

    return Math.abs(max - min);
  }

  isCableActiveForLoad(cable) {
    const range = this.getCableRange(cable);
    if (range === null) {
      return null;
    }
    return range >= MIN_ACTIVE_CABLE_RANGE;
  }

  getCableLoadForSample(sample, cable) {
    if (!sample) {
      return 0;
    }
    const key = cable === "A" ? "loadA" : "loadB";
    const raw = Number(sample?.[key]);
    if (!Number.isFinite(raw)) {
      return 0;
    }

    const active = this.isCableActiveForLoad(cable);
    if (active === false) {
      return 0;
    }

    return raw;
  }

  normalizeSampleForDisplay(sample = this.currentSample) {
    if (!sample) {
      return {
        timestamp: new Date(),
        loadA: 0,
        loadB: 0,
        posA: 0,
        posB: 0,
      };
    }

    return {
      ...sample,
      loadA: this.getCableLoadForSample(sample, "A"),
      loadB: this.getCableLoadForSample(sample, "B"),
    };
  }

  resetRepCountersToEmpty() {
    this.warmupReps = 0;
    this.workingReps = 0;
    this.currentWorkout = null;
    this.clearPersonalRecordCandidate();
    this.stopWorkingTargetHold();
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
    this.updateCurrentSetLabel();
    this.updatePlanSetIndicator();
    this.updateWorkingCounterControlsState();

    // Reset auto-stop indicator
    const weightCircle = document.getElementById("weightAdjusterCircle");
    const autoStopIndicator = document.getElementById("autoStopIndicator");
    if (weightCircle) {
      weightCircle.classList.remove("auto-stop-active", "auto-stop-available");
    }
    if (autoStopIndicator) {
      autoStopIndicator.setAttribute("aria-hidden", "true");
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

    if (Object.prototype.hasOwnProperty.call(workout, "exerciseIdNew")) {
      const numeric = this.toNumericExerciseId(workout.exerciseIdNew);
      workout.exerciseIdNew = numeric;
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

    this.applyCableActivationToMovementData(workout.movementData);

    this.calculateTotalLoadPeakKg(workout);
    this.ensurePhaseAnalysis(workout);
    return workout;
  }

  applyCableActivationToMovementData(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return points || [];
    }

    const computeRange = (key) => {
      let min = Infinity;
      let max = -Infinity;

      for (const point of points) {
        if (!point) {
          continue;
        }
        const value = Number(point[key]);
        if (!Number.isFinite(value)) {
          continue;
        }
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }

      if (min === Infinity || max === -Infinity) {
        return null;
      }
      return max - min;
    };

    const rangeA = computeRange("posA");
    const rangeB = computeRange("posB");

    if (rangeA !== null && rangeA < MIN_ACTIVE_CABLE_RANGE) {
      points.forEach((point) => {
        if (point) {
          point.loadA = 0;
        }
      });
    }

    if (rangeB !== null && rangeB < MIN_ACTIVE_CABLE_RANGE) {
      points.forEach((point) => {
        if (point) {
          point.loadB = 0;
        }
      });
    }

    return points;
  }

  calculateTotalLoadPeakKg(workout) {
    if (!workout || typeof workout !== "object") {
      return 0;
    }

    // Personal records track the heaviest load on any single cable during a set.
    let peak = Number(workout.cablePeakKg);
    const analysis = this.ensurePhaseAnalysis(workout);
    if (analysis?.hasReps && Number.isFinite(analysis.maxConcentricKg) && analysis.maxConcentricKg > 0) {
      peak = analysis.maxConcentricKg;
    }
    if (!Number.isFinite(peak) || peak <= 0) {
      peak = 0;

      if (Array.isArray(workout.movementData) && workout.movementData.length > 0) {
        for (const point of workout.movementData) {
          const cablePeak = Math.max(
            Number(point.loadA) || 0,
            Number(point.loadB) || 0,
          );
          if (cablePeak > peak) {
            peak = cablePeak;
          }
        }
      }

      if (peak <= 0) {
        const fallbackWeights = [
          Number(workout.weightKg),
          Number(workout.adjustedWeightKg),
          Number(workout.originalWeightKg),
        ];
        for (const value of fallbackWeights) {
          if (Number.isFinite(value) && value > 0) {
            peak = value;
            break;
          }
        }
      }
    }

    workout.cablePeakKg = peak;
    workout.totalLoadPeakKg = peak;
    return peak;
  }

  getPriorBestTotalLoadKg(identity, options = {}) {
    if (!identity || typeof identity.key !== "string") {
      return 0;
    }

    const record = this.getPersonalRecord(identity.key);
    const excludeWorkout = options.excludeWorkout || null;

    if (excludeWorkout) {
      if (record && Number.isFinite(record.weightKg)) {
        const recordTimestamp = record.timestamp
          ? new Date(record.timestamp).getTime()
          : null;
        const workoutTimestamp = this.getWorkoutTimestamp(excludeWorkout);
        const workoutTime = workoutTimestamp ? workoutTimestamp.getTime() : null;
        const epsilon = 0.0001;
        const workoutPeak = this.calculateTotalLoadPeakKg(excludeWorkout);

        const isSameWorkout =
          recordTimestamp !== null &&
          workoutTime !== null &&
          Math.abs(recordTimestamp - workoutTime) < 2000 &&
          Math.abs(workoutPeak - record.weightKg) <= epsilon;

        if (!isSameWorkout) {
          return record.weightKg;
        }
      }

      return this.getHistoricalBestLoadKg(identity, options);
    }

    if (record && Number.isFinite(record.weightKg)) {
      return record.weightKg;
    }

    return this.getHistoricalBestLoadKg(identity, options);
  }

  getHistoricalBestLoadKg(identity, options = {}) {
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

    const baseIdentity = this.getWorkoutIdentityInfo(this.currentWorkout);
    const identity = this.isEchoWorkout(this.currentWorkout)
      ? this.getEchoPhaseIdentity(baseIdentity, "concentric", this.currentWorkout) || baseIdentity
      : baseIdentity;
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
    if (this.isEchoWorkout(this.currentWorkout)) {
      this.currentWorkout.echoEccentricIdentity =
        this.getEchoPhaseIdentity(baseIdentity, "eccentric", this.currentWorkout) || null;
    } else {
      this.currentWorkout.echoEccentricIdentity = null;
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

    const numericId = this.toNumericExerciseId(
      workout?.exerciseIdNew ??
        workout?.planExerciseIdNew ??
        workout?.builderMeta?.exerciseIdNew ??
        workout?.builderMeta?.exerciseNumericId,
    );
    const setName =
      typeof workout.setName === "string" && workout.setName.trim().length > 0
        ? workout.setName.trim()
        : null;
    const addEchoSuffix = (label) => {
      if (!this.isEchoWorkout(workout)) {
        return label;
      }
      const workoutId = this.getWorkoutDisplayId(workout);
      return `${label} (Echo Mode · ${workoutId})`;
    };

    if (numericId !== null) {
      return {
        key: `exercise:${numericId}`,
        label: addEchoSuffix(setName || `Exercise ${numericId}`),
      };
    }
    if (setName) {
      return { key: `set:${setName.toLowerCase()}`, label: addEchoSuffix(setName) };
    }

    const mode =
      typeof workout.mode === "string" && workout.mode.trim().length > 0
        ? workout.mode.trim()
        : null;
    if (mode) {
      return { key: `mode:${mode.toLowerCase()}`, label: addEchoSuffix(mode) };
    }

    return null;
  }

  getWorkoutDisplayId(workout) {
    if (!workout || typeof workout !== "object") {
      return "unknown";
    }
    const candidates = [
      workout.workoutId,
      workout.id,
      workout.builderMeta?.workoutId,
      workout.builderMeta?.workout_id,
      workout.dropboxId,
    ];
    for (const value of candidates) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    const timestamp = this.getWorkoutTimestamp(workout);
    return timestamp ? timestamp.toISOString() : "unknown";
  }

  isEchoWorkout(workout) {
    if (!workout) return false;
    if (typeof sharedIsEchoWorkout !== "function") {
      refreshSharedEchoTelemetryHelpers();
    }
    if (typeof sharedIsEchoWorkout === "function") {
      return sharedIsEchoWorkout(workout);
    }
    const type = String(workout.itemType || "").toLowerCase();
    if (type.includes("echo")) return true;
    const mode = String(workout.mode || "").toLowerCase();
    return mode.includes("echo");
  }

  ensurePhaseAnalysis(workout) {
    if (!workout) {
      return null;
    }
    if (typeof sharedAnalyzePhases !== "function") {
      refreshSharedEchoTelemetryHelpers();
    }
    if (typeof sharedAnalyzePhases !== "function") {
      return null;
    }
    if (workout.phaseAnalysis && Array.isArray(workout.phaseAnalysis.reps)) {
      return workout.phaseAnalysis;
    }
    const analysis = sharedAnalyzePhases(workout) || null;
    if (analysis) {
      workout.phaseAnalysis = analysis;
      if (analysis.range) {
        workout.phaseRange = analysis.range;
      }
      if (analysis.isEcho) {
        workout.echoAnalysis = analysis;
        if (analysis.range) {
          workout.echoRange = analysis.range;
        }
      }
    }
    return workout.phaseAnalysis || workout.echoAnalysis || null;
  }

  getEchoPhaseIdentity(identity, phase, workout) {
    if (!identity) return null;
    const suffix = phase === "eccentric" ? "Eccentric" : "Concentric";
    return {
      key: `${identity.key}|echo-${phase}`,
      label: `${identity.label} · ${suffix}`,
      workoutId: this.getWorkoutDisplayId(workout),
    };
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

  getWorkoutTimestamp(workout) {
    if (!workout || typeof workout !== "object") {
      return null;
    }

    const candidates = [workout.endTime, workout.timestamp, workout.startTime];
    for (const candidate of candidates) {
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate;
      }
      if (typeof candidate === "string" && candidate.length > 0) {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }

    return null;
  }

  loadPersonalRecordsCache() {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }

    try {
      const raw = window.localStorage.getItem("vitruvian.personalRecords");
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed)
        ? parsed
        : Object.keys(parsed || {}).map((key) => ({ key, ...(parsed[key] || {}) }));

      const records = {};
      for (const entry of entries) {
        const normalized = this.normalizePersonalRecord(entry);
        if (normalized) {
          records[normalized.key] = normalized;
        }
      }
      return records;
    } catch {
      return {};
    }
  }

  loadPersonalRecordsSyncState() {
    if (typeof window === "undefined" || !window.localStorage) {
      return { dirty: false, pendingDropboxSync: false };
    }

    try {
      const raw = window.localStorage.getItem(
        "vitruvian.personalRecords.syncState",
      );
      if (!raw) {
        return { dirty: false, pendingDropboxSync: false };
      }

      const parsed = JSON.parse(raw);
      return {
        dirty: Boolean(parsed?.dirty),
        pendingDropboxSync: Boolean(parsed?.pendingDropboxSync),
      };
    } catch {
      return { dirty: false, pendingDropboxSync: false };
    }
  }

  persistPersonalRecordsSyncState() {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(
        "vitruvian.personalRecords.syncState",
        JSON.stringify({
          dirty: !!this._personalRecordsDirty,
          pendingDropboxSync: !!this._pendingPersonalRecordsDropboxSync,
        }),
      );
    } catch {
      // Ignore persistence errors (e.g., private browsing)
    }
  }

  setPersonalRecordsDirty(isDirty) {
    this._personalRecordsDirty = isDirty === true;
    this.persistPersonalRecordsSyncState();
  }

  setPendingPersonalRecordsDropboxSync(isPending) {
    this._pendingPersonalRecordsDropboxSync = isPending === true;
    this.persistPersonalRecordsSyncState();
  }

  savePersonalRecordsCache() {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(
        "vitruvian.personalRecords",
        JSON.stringify(this.personalRecords || {}),
      );
    } catch {
      // Ignore persistence errors (e.g., private browsing)
    }
  }

  normalizePersonalRecord(record) {
    if (!record || typeof record !== "object") {
      return null;
    }

    const key =
      typeof record.key === "string" && record.key.trim().length > 0
        ? record.key.trim()
        : null;
    if (!key) {
      return null;
    }

    const weightKg = Number(record.weightKg);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      return null;
    }

    const label =
      typeof record.label === "string" && record.label.trim().length > 0
        ? record.label.trim()
        : key;

    const timestampValue = record.timestamp || record.updatedAt || null;
    let timestamp = null;
    if (timestampValue) {
      const date =
        timestampValue instanceof Date
          ? timestampValue
          : new Date(timestampValue);
      if (!Number.isNaN(date.getTime())) {
        timestamp = date.toISOString();
      }
    }

    return { key, label, weightKg, timestamp };
  }

  getPersonalRecordsList() {
    const source = this.personalRecords || {};
    return Object.values(source)
      .map((record) => ({ ...record }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
  }

  annotateWorkoutsForExport(workouts) {
    if (!Array.isArray(workouts) || workouts.length === 0) {
      return;
    }

    const sorted = [...workouts].sort((a, b) => {
      const timeA = this.getWorkoutTimestamp(a)?.getTime() || 0;
      const timeB = this.getWorkoutTimestamp(b)?.getTime() || 0;
      return timeA - timeB;
    });

    const bestByIdentity = new Map();
    const epsilon = 0.0001;

    for (const workout of sorted) {
      const identity = this.getWorkoutIdentityInfo(workout);
      if (!identity) {
        workout._exportIsPR = false;
        workout._exportIdentityLabel = null;
        continue;
      }

      const peak = this.calculateTotalLoadPeakKg(workout);
      const priorBest = bestByIdentity.get(identity.key) || 0;
      const isPR = peak > priorBest + epsilon;
      const nextBest = Math.max(priorBest, peak);
      bestByIdentity.set(identity.key, nextBest);
      workout._exportIsPR = isPR;
      workout._exportIdentityLabel = identity.label;
    }
  }

  buildWorkoutDataRowsForExcel(workouts, unitLabel) {
    const header = [
      "Workout Date",
      "Plan Name",
      "Exercise Name",
      "Exercise ID",
      "Mode",
      "Set Name",
      "Set Number",
      "Set Total",
      "Reps",
      `Weight (${unitLabel})`,
      `Planned Weight (${unitLabel})`,
      `Total Load (${unitLabel})`,
      `Peak Load (${unitLabel})`,
      "Duration (seconds)",
      "Movement Data Points",
      `Average Load (${unitLabel})`,
      `Average Load Left (${unitLabel})`,
      `Average Load Right (${unitLabel})`,
      "Is PR",
    ];

    const rows = [header];
    const sorted = [...workouts].sort((a, b) => {
      const timeA = this.getWorkoutTimestamp(a)?.getTime() || 0;
      const timeB = this.getWorkoutTimestamp(b)?.getTime() || 0;
      return timeA - timeB;
    });

    for (const workout of sorted) {
      const timestamp = this.getWorkoutTimestamp(workout);
      const exerciseName =
        workout._exportIdentityLabel ||
        workout.setName ||
        workout.mode ||
        "";
      const weight = Number.isFinite(workout.weightKg)
        ? this.formatWeightValue(workout.weightKg)
        : "";
      const plannedWeight = Number.isFinite(workout.plannedWeightKg)
        ? this.formatWeightValue(workout.plannedWeightKg)
        : "";
      const peak = this.calculateTotalLoadPeakKg(workout);
      const peakDisplay = Number.isFinite(peak)
        ? this.formatWeightValue(peak)
        : "";
      let durationSeconds = "";
      if (workout.startTime instanceof Date && workout.endTime instanceof Date) {
        durationSeconds = Math.round(
          (workout.endTime.getTime() - workout.startTime.getTime()) / 1000,
        ).toString();
      }
      const movementPoints = Array.isArray(workout.movementData)
        ? workout.movementData.length
        : 0;
      const isPR =
        workout._exportIdentityLabel && workout._exportIsPR ? "Yes" : "No";
      const planName = typeof workout.planName === "string" ? workout.planName : "";
      const exerciseId = this.getWorkoutExerciseId(workout) || "";
      const totalLoadKg = this.deriveTotalLoadKg(workout);
      const totalLoadDisplay = Number.isFinite(totalLoadKg)
        ? this.formatWeightValue(totalLoadKg)
        : "";

      // Get average loads from workout object (converted to display unit if needed)
      const averageLoadKg = workout.averageLoad;
      const averageLoadLeftKg = workout.averageLoadLeft;
      const averageLoadRightKg = workout.averageLoadRight;

      const averageLoadDisplay = Number.isFinite(averageLoadKg)
        ? this.formatWeightValue(averageLoadKg)
        : "";
      const averageLoadLeftDisplay = Number.isFinite(averageLoadLeftKg)
        ? this.formatWeightValue(averageLoadLeftKg)
        : "";
      const averageLoadRightDisplay = Number.isFinite(averageLoadRightKg)
        ? this.formatWeightValue(averageLoadRightKg)
        : "";

      rows.push([
        timestamp instanceof Date ? new Date(timestamp) : "",
        planName,
        exerciseName,
        exerciseId,
        workout.mode || "",
        workout.setName || "",
        workout.setNumber !== undefined && workout.setNumber !== null
          ? String(workout.setNumber)
          : "",
        workout.setTotal !== undefined && workout.setTotal !== null
          ? String(workout.setTotal)
          : "",
        Number.isFinite(workout.reps) ? String(workout.reps) : "",
        weight,
        plannedWeight,
        totalLoadDisplay,
        peakDisplay,
        durationSeconds,
        String(movementPoints),
        averageLoadDisplay,
        averageLoadLeftDisplay,
        averageLoadRightDisplay,
        workout._exportIdentityLabel ? isPR : "",
      ]);
    }

    return rows;
  }

  buildPersonalRecordRowsForExcel(records, unitLabel) {
    const header = ["Exercise", "Timestamp", `Weight (${unitLabel})`];
    const rows = [header];
    if (!Array.isArray(records) || records.length === 0) {
      return rows;
    }
    for (const record of records) {
      const weightDisplay = Number.isFinite(record.weightKg)
        ? this.formatWeightValue(record.weightKg)
        : "";
      const timestampValue =
        record.timestamp && !Number.isNaN(new Date(record.timestamp).getTime())
          ? new Date(record.timestamp)
          : "";
      rows.push([
        record.label || record.key || "",
        timestampValue,
        weightDisplay,
      ]);
    }
    return rows;
  }

  createWorkoutSheetDefs(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const header = safeRows[0] || [];
    const totalRows = safeRows.length;
    const dateColumns = [0];
    const prColumnIndex =
      header.findIndex((value) => value === "Is PR");
    const highlightColumns =
      prColumnIndex >= 0
        ? [
            {
              index: prColumnIndex,
              match: (value) => value === "Yes",
              style: PR_HIGHLIGHT_STYLE,
            },
          ]
        : [];

    if (totalRows === 0) {
      return [
        {
          name: "Workout Data",
          rows: [],
          dateColumns,
          highlightColumns,
        },
      ];
    }

    if (totalRows <= EXCEL_MAX_ROWS) {
      return [
        {
          name: "Workout Data",
          rows: safeRows,
          dateColumns,
          highlightColumns,
        },
      ];
    }

    const dataPerSheet = EXCEL_MAX_ROWS - 1;
    const sheets = [];
    let offset = 1;
    while (offset < totalRows) {
      const chunk = safeRows.slice(offset, offset + dataPerSheet);
      sheets.push({
        name: "",
        rows: [header, ...chunk],
        dateColumns,
        highlightColumns,
      });
      offset += dataPerSheet;
    }

    sheets.forEach((sheet, index) => {
      sheet.name = `Workout Data ${index + 1}`;
    });
    return sheets;
  }

  buildExcelWorkbookArray({ sheets }) {
    const xlsx = typeof window !== "undefined" ? window.XLSX : null;
    if (!xlsx || typeof xlsx.utils !== "object") {
      throw new Error("SheetJS XLSX library is not available");
    }

    const workbook = xlsx.utils.book_new();
    const sheetDefs = Array.isArray(sheets) ? sheets : [];

    sheetDefs.forEach((sheet) => {
      const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
      const dateColumns = Array.isArray(sheet.dateColumns)
        ? sheet.dateColumns
        : [];
      const highlightColumns = Array.isArray(sheet.highlightColumns)
        ? sheet.highlightColumns
        : [];
      const sheetName = this.sanitizeWorksheetName(sheet.name || "Sheet");
      const worksheet = this.buildSheetJsWorksheet(
        rows,
        dateColumns,
        highlightColumns,
      );
      xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
      if (sheetName.toLowerCase().startsWith("workout data")) {
        worksheet["!tabColor"] = WORKOUT_TAB_COLOR;
      } else if (sheetName.toLowerCase().includes("pr")) {
        worksheet["!tabColor"] = PR_TAB_COLOR;
      }
    });

    return xlsx.write(workbook, { bookType: "xlsx", type: "array" });
  }

  buildSheetJsWorksheet(rows, dateColumns = [], highlightColumns = []) {
    const xlsx = typeof window !== "undefined" ? window.XLSX : null;
    if (!xlsx || typeof xlsx.utils !== "object") {
      throw new Error("SheetJS XLSX library is not available");
    }

    const worksheet = xlsx.utils.aoa_to_sheet(rows);
    this.applyDateFormattingToSheet(worksheet, rows, dateColumns);
    this.applyHeaderStylesToSheet(worksheet, rows);
    this.applyHighlightingToSheet(worksheet, rows, highlightColumns);
    this.autosizeWorksheetColumns(worksheet, rows);
    return worksheet;
  }

  applyDateFormattingToSheet(worksheet, rows, dateColumns = []) {
    const xlsx = typeof window !== "undefined" ? window.XLSX : null;
    if (!xlsx || typeof xlsx.utils !== "object") {
      return;
    }
    dateColumns.forEach((columnIndex) => {
      if (!Number.isInteger(columnIndex) || columnIndex < 0) {
        return;
      }
      for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const value = rows[rowIndex]?.[columnIndex];
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
          continue;
        }
        const cellRef = xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const cell = worksheet[cellRef];
        if (!cell) {
          continue;
        }
        cell.t = "d";
        cell.v = value;
        if (cell.w) {
          delete cell.w;
        }
        cell.z = "yyyy-mm-dd hh:mm:ss";
      }
    });
  }

  applyHeaderStylesToSheet(worksheet, rows) {
    const xlsx = typeof window !== "undefined" ? window.XLSX : null;
    if (!xlsx || typeof xlsx.utils !== "object") {
      return;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }
    const header = rows[0];
    if (!Array.isArray(header)) {
      return;
    }
    header.forEach((_, columnIndex) => {
      const cellRef = xlsx.utils.encode_cell({ r: 0, c: columnIndex });
      const cell = worksheet[cellRef];
      if (!cell) {
        return;
      }
      cell.s = { ...(cell.s || {}), ...HEADER_STYLE };
    });
  }

  applyHighlightingToSheet(worksheet, rows, highlightColumns = []) {
    const xlsx = typeof window !== "undefined" ? window.XLSX : null;
    if (!xlsx || typeof xlsx.utils !== "object") {
      return;
    }
    const highlightDefs = Array.isArray(highlightColumns)
      ? highlightColumns
      : [];
    highlightDefs.forEach((def) => {
      const columnIndex = Number(def?.index);
      if (!Number.isInteger(columnIndex) || columnIndex < 0) {
        return;
      }
      const match =
        typeof def.match === "function" ? def.match : (value) => Boolean(value);
      const style = def.style || PR_HIGHLIGHT_STYLE;
      for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const value = rows[rowIndex]?.[columnIndex];
        if (!match(value)) {
          continue;
        }
        const cellRef = xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const cell = worksheet[cellRef];
        if (!cell) {
          continue;
        }
        cell.s = { ...(cell.s || {}), ...style };
      }
    });
  }

  autosizeWorksheetColumns(worksheet, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }
    const columnCount = rows.reduce(
      (max, row) =>
        Array.isArray(row) ? Math.max(max, row.length) : max,
      0,
    );
    if (columnCount === 0) {
      return;
    }
    const colWidths = new Array(columnCount).fill(10);
    rows.forEach((row) => {
      if (!Array.isArray(row)) {
        return;
      }
      row.forEach((value, columnIndex) => {
        const length = this.getCellDisplayLength(value);
        colWidths[columnIndex] = Math.max(colWidths[columnIndex], length + 2);
      });
    });
    worksheet["!cols"] = colWidths.map((wch) => ({
      wch: Math.min(Math.max(wch, 12), 60),
    }));
  }

  getCellDisplayLength(value) {
    if (value instanceof Date) {
      return 19;
    }
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === "number") {
      return value.toString().length;
    }
    return String(value).length;
  }

  sanitizeWorksheetName(name) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return "Sheet";
    }
    const cleaned = name
      .replace(/[\\/*?:\[\]]/g, " ")
      .trim()
      .slice(0, 31);
    return cleaned.length > 0 ? cleaned : "Sheet";
  }

  escapeExcelValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  getPersonalRecord(key) {
    if (!key || !this.personalRecords) {
      return null;
    }
    return this.personalRecords[key] || null;
  }

  clearPersonalRecordCandidate() {
    this._pendingPersonalRecordCandidate = null;
  }

  trackPersonalRecordCandidate(weightKg, timestamp = new Date()) {
    if (
      !this.currentWorkout ||
      !this.currentWorkout.identityKey ||
      !Number.isFinite(weightKg) ||
      weightKg <= 0
    ) {
      return;
    }

    const key = this.currentWorkout.identityKey;
    const label = this.currentWorkout.identityLabel || key;
    const isoTimestamp =
      timestamp instanceof Date
        ? timestamp.toISOString()
        : new Date(timestamp || Date.now()).toISOString();

    const epsilon = 0.0001;
    const existing = this._pendingPersonalRecordCandidate;
    if (existing && existing.identityKey === key) {
      if (weightKg > existing.weightKg + epsilon) {
        existing.weightKg = weightKg;
      }
      existing.timestamp = isoTimestamp;
      return;
    }

    this._pendingPersonalRecordCandidate = {
      identityKey: key,
      identityLabel: label,
      weightKg,
      timestamp: isoTimestamp,
    };
  }

  finalizePersonalRecordForWorkout(workout, options = {}) {
    if (!workout || options.skipped) {
      this.clearPersonalRecordCandidate();
      return false;
    }

    const baseIdentity = this.getWorkoutIdentityInfo(workout);
    const identity = this.isEchoWorkout(workout)
      ? this.getEchoPhaseIdentity(baseIdentity, "concentric", workout) || baseIdentity
      : baseIdentity;
    if (!identity) {
      this.clearPersonalRecordCandidate();
      return false;
    }

    const candidate = this._pendingPersonalRecordCandidate;
    const matchesCandidate =
      candidate && candidate.identityKey === identity.key;
    const workoutPeakKg = this.calculateTotalLoadPeakKg(workout);
    const targetWeightKg = matchesCandidate
      ? Math.max(workoutPeakKg, Number(candidate.weightKg) || 0)
      : workoutPeakKg;
    const timestamp =
      (matchesCandidate && candidate.timestamp) ||
      this.getWorkoutTimestamp(workout) ||
      new Date();

    const updated = this.applyPersonalRecordCandidate(
      identity,
      targetWeightKg,
      timestamp,
      { reason: options.reason || "workout-complete" },
    );

    if (this.isEchoWorkout(workout)) {
      const analysis = this.ensurePhaseAnalysis(workout);
      const eccIdentity = this.getEchoPhaseIdentity(baseIdentity, "eccentric", workout);
      if (
        analysis &&
        eccIdentity &&
        Number.isFinite(analysis.maxEccentricKg) &&
        analysis.maxEccentricKg > 0
      ) {
        this.applyPersonalRecordCandidate(
          eccIdentity,
          analysis.maxEccentricKg,
          timestamp,
          { reason: "echo-workout-complete" },
        );
      }
    }

    this.clearPersonalRecordCandidate();
    return updated;
  }

  applyPersonalRecordCandidate(identity, weightKg, timestamp, options = {}) {
    if (
      !identity ||
      typeof identity.key !== "string" ||
      !Number.isFinite(weightKg) ||
      weightKg <= 0
    ) {
      return false;
    }

    const key = identity.key;
    const label = identity.label || key;
    const isoTimestamp = (() => {
      if (timestamp instanceof Date && !Number.isNaN(timestamp.getTime())) {
        return timestamp.toISOString();
      }
      if (typeof timestamp === "string" && timestamp.length > 0) {
        const parsed = new Date(timestamp);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }
      return new Date().toISOString();
    })();

    const epsilon = 0.0001;
    const existing = this.personalRecords?.[key];
    let shouldUpdate = false;

    if (!existing) {
      shouldUpdate = true;
    } else {
      const weightDelta = weightKg - existing.weightKg;
      if (weightDelta > epsilon) {
        shouldUpdate = true;
      } else if (Math.abs(weightDelta) <= epsilon) {
        const previousTime = existing.timestamp
          ? new Date(existing.timestamp).getTime()
          : 0;
        const candidateTime = isoTimestamp
          ? new Date(isoTimestamp).getTime()
          : Date.now();
        if (candidateTime > previousTime) {
          shouldUpdate = true;
        }
      }
    }

    if (!shouldUpdate) {
      return false;
    }

    if (!this.personalRecords) {
      this.personalRecords = {};
    }

    this.personalRecords[key] = {
      key,
      label,
      weightKg,
      timestamp: isoTimestamp,
    };

    if (!options.skipCacheSave) {
      this.savePersonalRecordsCache();
    }

    if (!options.skipDirtyFlag) {
      this.setPersonalRecordsDirty(true);
    }

    if (!options.skipDropboxSync) {
      this.queuePersonalRecordsDropboxSync(options.reason || "personal-record-update");
    }

    return true;
  }

  ensurePersonalRecordsFromHistory() {
    const workouts = Array.isArray(this.workoutHistory)
      ? this.workoutHistory
      : [];

    const bestByIdentity = new Map();
    const epsilon = 0.0001;

    const registerBest = (identity, weightKg, timestamp) => {
      if (!identity || !Number.isFinite(weightKg) || weightKg <= 0) {
        return;
      }
      const existing = bestByIdentity.get(identity.key);
      if (!existing) {
        bestByIdentity.set(identity.key, { identity, weightKg, timestamp });
        return;
      }
      const delta = weightKg - existing.weightKg;
      const tsMs = timestamp instanceof Date ? timestamp.getTime() : 0;
      const existingMs =
        existing.timestamp instanceof Date ? existing.timestamp.getTime() : 0;

      if (delta > epsilon || (Math.abs(delta) <= epsilon && tsMs > existingMs)) {
        bestByIdentity.set(identity.key, { identity, weightKg, timestamp });
      }
    };

    for (const workout of workouts) {
      const identity = this.getWorkoutIdentityInfo(workout);
      if (!identity) {
        continue;
      }

      const timestamp = this.getWorkoutTimestamp(workout);
      if (this.isEchoWorkout(workout)) {
        const analysis = this.ensurePhaseAnalysis(workout);
        if (analysis) {
          const concIdentity =
            this.getEchoPhaseIdentity(identity, "concentric", workout) || identity;
          if (Number.isFinite(analysis.maxConcentricKg) && analysis.maxConcentricKg > 0) {
            registerBest(concIdentity, analysis.maxConcentricKg, timestamp);
          }
          const eccIdentity = this.getEchoPhaseIdentity(identity, "eccentric", workout);
          if (eccIdentity && Number.isFinite(analysis.maxEccentricKg) && analysis.maxEccentricKg > 0) {
            registerBest(eccIdentity, analysis.maxEccentricKg, timestamp);
          }
        }
        continue;
      }

      const peakKg = this.calculateTotalLoadPeakKg(workout);
      if (!Number.isFinite(peakKg) || peakKg <= 0) {
        continue;
      }

      registerBest(identity, peakKg, timestamp);
    }

    let updated = false;
    for (const entry of bestByIdentity.values()) {
      const applied = this.applyPersonalRecordCandidate(
        entry.identity,
        entry.weightKg,
        entry.timestamp,
        {
          skipDropboxSync: true,
          skipCacheSave: true,
        },
      );
      if (applied) {
        updated = true;
      }
    }

    if (!this.personalRecords) {
      this.personalRecords = {};
    }

    const bestKeys = new Set(bestByIdentity.keys());
    let removed = false;

    for (const key of Object.keys(this.personalRecords)) {
      if (!bestKeys.has(key)) {
        delete this.personalRecords[key];
        removed = true;
      }
    }

    if (removed) {
      this.savePersonalRecordsCache();
      this.setPersonalRecordsDirty(true);
      return true;
    }

    if (updated) {
      this.savePersonalRecordsCache();
    }

    return updated;
  }

  buildPersonalRecordsFromWorkouts(workouts = []) {
    if (!Array.isArray(workouts) || workouts.length === 0) {
      return false;
    }

    const epsilon = 0.0001;
    const nextRecords = {};
    const updateRecord = (identity, weightKg, isoTimestamp) => {
      if (
        !identity ||
        typeof identity.key !== "string" ||
        !Number.isFinite(weightKg) ||
        weightKg <= 0
      ) {
        return;
      }

      const key = identity.key;
      const existing = nextRecords[key];
      if (!existing) {
        nextRecords[key] = {
          key,
          label: identity.label,
          weightKg,
          timestamp: isoTimestamp,
        };
        return;
      }

      const delta = weightKg - existing.weightKg;
      const timestampMs = new Date(isoTimestamp).getTime();
      const existingMs = existing.timestamp
        ? new Date(existing.timestamp).getTime()
        : 0;

      if (
        delta > epsilon ||
        (Math.abs(delta) <= epsilon && timestampMs > existingMs)
      ) {
        nextRecords[key] = {
          key,
          label: identity.label,
          weightKg,
          timestamp: isoTimestamp,
        };
      }
    };

    for (const workout of workouts) {
      const baseIdentity = this.getWorkoutIdentityInfo(workout);
      if (!baseIdentity) {
        continue;
      }

      const timestamp = this.getWorkoutTimestamp(workout);
      const isoTimestamp = timestamp instanceof Date
        ? timestamp.toISOString()
        : new Date(timestamp || Date.now()).toISOString();

      const isEcho = this.isEchoWorkout(workout);
      const concentricIdentity = isEcho
        ? this.getEchoPhaseIdentity(baseIdentity, "concentric", workout) || baseIdentity
        : baseIdentity;

      const peakKg = this.calculateTotalLoadPeakKg(workout);
      updateRecord(concentricIdentity, peakKg, isoTimestamp);

      if (isEcho) {
        const analysis = this.ensurePhaseAnalysis(workout);
        const eccIdentity = this.getEchoPhaseIdentity(baseIdentity, "eccentric", workout);
        const eccPeakKg = analysis ? Number(analysis.maxEccentricKg) : NaN;
        updateRecord(eccIdentity, eccPeakKg, isoTimestamp);
      }
    }

    this.personalRecords = nextRecords;
    this.setPersonalRecordsDirty(true);
    this.savePersonalRecordsCache();
    return true;
  }

  async syncPersonalRecordsFromDropbox(options = {}) {
    if (!this.dropboxManager?.isConnected) {
      return;
    }

    try {
      const payload = await this.dropboxManager.loadPersonalRecords();
      const records = Array.isArray(payload?.records) ? payload.records : [];
      let merged = false;

      for (const entry of records) {
        const normalized = this.normalizePersonalRecord(entry);
        if (!normalized) {
          continue;
        }

        if (!this.personalRecords) {
          this.personalRecords = {};
        }

        const existing = this.personalRecords[normalized.key];
        if (!existing) {
          this.personalRecords[normalized.key] = normalized;
          merged = true;
          continue;
        }

        const epsilon = 0.0001;
        const delta = normalized.weightKg - existing.weightKg;
        const normalizedTime = normalized.timestamp
          ? new Date(normalized.timestamp).getTime()
          : 0;
        const existingTime = existing.timestamp
          ? new Date(existing.timestamp).getTime()
          : 0;

        if (delta > epsilon || (Math.abs(delta) <= epsilon && normalizedTime > existingTime)) {
          this.personalRecords[normalized.key] = normalized;
          merged = true;
        }
      }

      if (merged) {
        this.savePersonalRecordsCache();
      }

      if (!options.silent && records.length > 0) {
        this.addLogEntry(
          `Loaded ${records.length} personal record${records.length === 1 ? "" : "s"} from Dropbox`,
          "success",
        );
      }
    } catch (error) {
      if (!options.silent) {
        this.addLogEntry(
          `Failed to load personal records from Dropbox: ${error.message}`,
          "error",
        );
      }
    }
  }

  async syncPersonalRecordsToDropbox(options = {}) {
    const force = options?.force === true;
    const silent = options?.silent !== false;

    if (force) {
      this._personalRecordsForceSync = true;
    }

    if (!this.dropboxManager?.isConnected) {
      this.setPendingPersonalRecordsDropboxSync(true);
      return;
    }

    const shouldForce = this._personalRecordsForceSync;

    if (!shouldForce && !this._personalRecordsDirty) {
      return;
    }

    if (this._personalRecordsSyncInFlight) {
      this.setPendingPersonalRecordsDropboxSync(true);
      return;
    }

    this._personalRecordsSyncInFlight = true;
    this.setPendingPersonalRecordsDropboxSync(false);

    try {
      await this.dropboxManager.savePersonalRecords({
        records: this.getPersonalRecordsList(),
      });
      this.setPersonalRecordsDirty(false);
      this._personalRecordsForceSync = false;
      this.setPendingPersonalRecordsDropboxSync(false);
      if (!silent) {
        this.addLogEntry("Personal records synced to Dropbox", "success");
      }
    } catch (error) {
      this.setPendingPersonalRecordsDropboxSync(true);
      if (!silent) {
        this.addLogEntry(
          `Failed to sync personal records: ${error.message}`,
          "error",
        );
      }
    } finally {
      this._personalRecordsSyncInFlight = false;
    }
  }

  queuePersonalRecordsDropboxSync(reason) {
    this.setPendingPersonalRecordsDropboxSync(true);

    if (!this.dropboxManager?.isConnected) {
      return;
    }

    this.syncPersonalRecordsToDropbox({ reason, silent: true }).catch(() => {
      // Errors are surfaced via the log inside syncPersonalRecordsToDropbox
    });
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

    const isDesktop = this.isDesktopLayout();
    const isCompact = this.isCompactLayout();

    if (isDesktop && this.sidebarCollapsed) {
      appContainer.classList.add("sidebar-collapsed");
    } else {
      appContainer.classList.remove("sidebar-collapsed");
    }

    if (isCompact) {
      sidebar.classList.remove("open");
      if (document.body) {
        document.body.classList.remove("sidebar-open");
      }
    }

    if (overlay) {
      overlay.classList.remove("show");
    }

    if (document.body) {
      document.body.classList.toggle(
        "sidebar-collapsed",
        isDesktop && this.sidebarCollapsed,
      );
      if (isDesktop || !sidebar.classList.contains("open")) {
        document.body.classList.remove("sidebar-open");
      }
    }

    this.updateSidebarToggleVisual();
    this.requestChartResize();
  }

  updateSidebarToggleVisual() {
    const toggleBtn = document.getElementById("hamburger");
    if (!toggleBtn) {
      return;
    }

    const sidebar = document.getElementById("sidebar");
    const isDesktop = this.isDesktopLayout();

    let label;
    let iconClass;
    if (isDesktop) {
      label = this.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
      iconClass = this.sidebarCollapsed ? "bi bi-chevron-right" : "bi bi-chevron-left";
    } else {
      const isOpen = sidebar?.classList.contains("open");
      label = isOpen ? "Close sidebar" : "Open sidebar";
      iconClass = isOpen ? "bi bi-x-lg" : "bi bi-list";
    }

    const icon = toggleBtn.querySelector("i");
    if (icon && iconClass) {
      icon.className = iconClass;
    }

    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.title = label;
  }

  isPortraitTabletLayout() {
    return window.matchMedia(
      "(orientation: portrait) and (min-width: 769px) and (max-width: 1024px)",
    ).matches;
  }

  isCompactLayout() {
    return (
      window.matchMedia("(max-width: 768px)").matches ||
      this.isPortraitTabletLayout()
    );
  }

  isDesktopLayout() {
    return !this.isCompactLayout();
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
    const deltaKg = priorBestKg > 0 ? currentPeakKg - priorBestKg : currentPeakKg;
    const deltaPct = priorBestKg > 0 && Number.isFinite(priorBestKg)
      ? ((currentPeakKg - priorBestKg) / priorBestKg) * 100
      : null;
    const bestDisplay = this.formatWeightWithUnit(bestKg);
    const currentDisplay = this.formatWeightWithUnit(currentPeakKg);

    banner.classList.remove("hidden", "pr-banner--new", "pr-banner--tie");

    let status = "existing";

    if (isNewPR || priorBestKg <= 0) {
      status = "new";
      banner.classList.add("pr-banner--new");
      banner.textContent = `New total load PR for ${identity.label}: ${bestDisplay}!`;
      this.addLogEntry(
        `New total load PR for ${identity.label}: ${bestDisplay}`,
        "success",
      );
    } else if (matchedPR) {
      status = "matched";
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

    return {
      status,
      bestKg,
      currentKg: currentPeakKg,
      previousBestKg: priorBestKg,
      deltaKg,
      deltaPct,
      label: identity.label,
    };
  }

  addToWorkoutHistory(workout) {
    const normalized = this.normalizeWorkout(workout);
    if (!normalized) {
      return null;
    }
    this.workoutHistory.unshift(normalized); // Add to beginning
    this.setHistoryPage(1);
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

    const pageSize = this.getHistoryPageSize();
    const filteredEntries = this.getFilteredHistoryEntries();
    const filteredIndex = filteredEntries.findIndex((entry) => entry.index === index);
    const targetPage = filteredIndex >= 0
      ? Math.floor(filteredIndex / pageSize) + 1
      : Math.floor(index / pageSize) + 1;
    this.setHistoryPage(targetPage);

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

  async deleteWorkoutHistoryEntry(index, options = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= this.workoutHistory.length) {
      this.addLogEntry("Invalid workout index", "error");
      return false;
    }

    const workout = this.workoutHistory[index];
    if (!workout) {
      this.addLogEntry("Workout not found in history", "error");
      return false;
    }

    const skipConfirm = options?.skipConfirm === true;
    const dropboxConnected = Boolean(this.dropboxManager?.isConnected);

    const descriptorParts = [];
    if (typeof workout.setName === "string" && workout.setName.trim().length > 0) {
      descriptorParts.push(workout.setName.trim());
    } else if (typeof workout.mode === "string" && workout.mode.trim().length > 0) {
      descriptorParts.push(workout.mode.trim());
    }

    const timestamp = this.getWorkoutTimestamp(workout);
    if (timestamp instanceof Date && !Number.isNaN(timestamp.getTime())) {
      try {
        const formatted = timestamp.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        if (formatted) {
          descriptorParts.push(formatted);
        }
      } catch (error) {
        /* ignore formatting errors */
      }
    }

    const descriptor = descriptorParts.length > 0 ? descriptorParts.join(" — ") : "workout";

    let confirmed = skipConfirm;
    if (!skipConfirm) {
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        confirmed = window.confirm(
          `Delete ${descriptor} from your workout history? This will remove the local entry${dropboxConnected ? " and delete the Dropbox backup" : ""}.`,
        );
      } else {
        confirmed = true;
      }
    }

    if (!confirmed) {
      this.addLogEntry("Workout deletion cancelled", "info");
      return false;
    }

    let dropboxAttempted = false;
    let dropboxDeleted = false;

    if (dropboxConnected && typeof this.dropboxManager.deleteWorkout === "function") {
      dropboxAttempted = true;
      try {
        const result = await this.dropboxManager.deleteWorkout(workout);
        dropboxDeleted = result === undefined ? true : Boolean(result);
      } catch (error) {
        dropboxDeleted = false;
        this.addLogEntry(
          `Failed to delete Dropbox backup for ${descriptor}: ${error.message}`,
          "error",
        );
      }
    }

    const removed = this.workoutHistory.splice(index, 1);

    if (this.selectedHistoryIndex !== null) {
      if (this.selectedHistoryIndex === index) {
        this.selectedHistoryIndex = null;
      } else if (this.selectedHistoryIndex > index) {
        this.selectedHistoryIndex -= 1;
      }
    }

    const removedKey = Array.isArray(removed) && removed.length > 0
      ? this.getWorkoutHistoryKey(removed[0])
      : this.getWorkoutHistoryKey(workout);

    if (this.selectedHistoryKey !== null && removedKey !== null && removedKey === this.selectedHistoryKey) {
      this.selectedHistoryKey = null;
    }

    this.setHistoryPage(this.historyPage);
    this.updateHistoryDisplay();
    this.updateExportButtonLabel();

    if (this.chartManager) {
      if (typeof this.chartManager.clearEventMarkers === "function") {
        this.chartManager.clearEventMarkers();
      }
      if (typeof this.chartManager.clear === "function") {
        this.chartManager.clear();
      }
    }

    const personalRecordsUpdated = this.ensurePersonalRecordsFromHistory();
    if (personalRecordsUpdated) {
      this.queuePersonalRecordsDropboxSync("history-delete");
    }

    this.addLogEntry(`Deleted ${descriptor} from workout history`, "info");

    if (dropboxAttempted) {
      if (dropboxDeleted) {
        this.addLogEntry(`Deleted Dropbox backup for ${descriptor}`, "success");
      } else {
        this.addLogEntry(
          `Dropbox backup for ${descriptor} was not found`,
          "warning",
        );
      }
    }

    return true;
  }

  isHistoryFilterActive() {
    return this.getActiveHistoryFilterKey() !== "all";
  }

  getHistoryPageSize() {
    const baseSize = Number(this.historyPageSize) > 0 ? this.historyPageSize : 5;
    return this.isHistoryFilterActive() ? FILTERED_HISTORY_PAGE_SIZE : baseSize;
  }

  getHistoryFilterOptions(history = this.workoutHistory) {
    const list = Array.isArray(history) ? history : [];
    const options = new Map();

    for (const workout of list) {
      const identity = this.getWorkoutIdentityInfo(workout);
      if (!identity || !identity.key) {
        continue;
      }
      const existing = options.get(identity.key);
      if (existing) {
        existing.count += 1;
      } else {
        options.set(identity.key, {
          key: identity.key,
          label: identity.label || "Unnamed Exercise",
          count: 1,
        });
      }
    }

    return Array.from(options.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  getActiveHistoryFilterKey(history = this.workoutHistory) {
    const normalized =
      typeof this.historyFilterKey === "string" && this.historyFilterKey.trim().length > 0
        ? this.historyFilterKey.trim()
        : "all";

    if (normalized === "all") {
      return "all";
    }

    const options = this.getHistoryFilterOptions(history);
    const hasOption = options.some((option) => option.key === normalized);
    if (!hasOption) {
      this.historyFilterKey = "all";
      return "all";
    }

    return normalized;
  }

  getFilteredHistoryEntries(history = this.workoutHistory) {
    const list = Array.isArray(history) ? history : [];
    const activeKey = this.getActiveHistoryFilterKey(list);

    if (activeKey === "all") {
      return list.map((workout, index) => ({ workout, index }));
    }

    return list
      .map((workout, index) => ({ workout, index }))
      .filter(({ workout }) => {
        const identity = this.getWorkoutIdentityInfo(workout);
        return identity && identity.key === activeKey;
      });
  }

  setHistoryFilter(key) {
    const normalized =
      typeof key === "string" && key.trim().length > 0 ? key.trim() : "all";
    const options = this.getHistoryFilterOptions();
    const isValid = options.some((option) => option.key === normalized);
    const targetKey = normalized === "all" || !isValid ? "all" : normalized;

    if (targetKey === this.historyFilterKey) {
      return;
    }

    this.historyFilterKey = targetKey;
    this.historyPage = 1;
    this.selectedHistoryKey = null;
    this.selectedHistoryIndex = null;
    this.updateHistoryDisplay();
  }

  updateHistoryDisplay() {
    const historyList = document.getElementById("historyList");
    if (!historyList) return;

    const history = Array.isArray(this.workoutHistory) ? this.workoutHistory : [];
    const filterOptions = this.getHistoryFilterOptions(history);
    const filteredEntries = this.getFilteredHistoryEntries(history);
    const pageSize = this.getHistoryPageSize();
    const totalItems = filteredEntries.length;
    const totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : 0;

    if (totalItems === 0) {
      this.historyPage = 1;
      historyList.innerHTML = `
        <div style="color: #6c757d; font-size: 0.9em; text-align: center; padding: 20px;">
          No workouts completed yet
        </div>
      `;
      this.selectedHistoryKey = null;
      this.selectedHistoryIndex = null;
      this.updateHistoryPaginationControls({
        totalPages: 0,
        filterOptions,
        totalHistoryCount: history.length,
      });
      this.updateExportButtonLabel();
      return;
    }

    const maxPages = Math.max(1, totalPages);
    if (this.historyPage > maxPages) {
      this.historyPage = maxPages;
    }
    if (this.historyPage < 1) {
      this.historyPage = 1;
    }

    const startIndex = (this.historyPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);
    const pageItems = filteredEntries.slice(startIndex, endIndex);

    let matchedSelection = false;

    historyList.innerHTML = pageItems
      .map(({ workout, index }) => {
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
          ? `<button type="button" class="${buttonClass}" onclick="app.viewWorkoutOnGraph(${index})" title="View this workout on the graph">${buttonLabel}</button>`
          : "";
        const deleteButtonHtml = `<button type="button" class="delete-history-btn" onclick="app.requestDeleteWorkout(${index})" title="Delete this workout from history" aria-label="Delete this workout from history">🗑 Delete</button>`;
        const actionsHtml = [viewButtonHtml, deleteButtonHtml]
          .filter((html) => typeof html === "string" && html.length > 0)
          .join("");
        const actionsBlock = actionsHtml
          ? `<div class="history-item-actions">${actionsHtml}</div>`
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
    ${actionsBlock}
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

    this.updateHistoryPaginationControls({
      totalPages: maxPages,
      filterOptions,
      totalHistoryCount: history.length,
    });
    this.updateExportButtonLabel();
  }

  updateHistoryPaginationControls({ totalPages, filterOptions = [], totalHistoryCount = 0 }) {
    const paginationEl = document.getElementById("historyPagination");
    if (!paginationEl) {
      return;
    }

    const hasHistory = Number.isFinite(totalHistoryCount) && totalHistoryCount > 0;
    if (!hasHistory) {
      paginationEl.style.display = "none";
      paginationEl.innerHTML = "";
      return;
    }

    const safePages = Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1;
    const prevDisabledAttrs = this.historyPage <= 1 ? 'disabled aria-disabled="true"' : "";
    const nextDisabledAttrs = this.historyPage >= safePages ? 'disabled aria-disabled="true"' : "";
    const activeKey = this.getActiveHistoryFilterKey();
    const allLabel = Number.isFinite(totalHistoryCount)
      ? `All exercises (${totalHistoryCount})`
      : "All exercises";

    const filterOptionsHtml = [
      `<option value="all">${escapeHtml(allLabel)}</option>`,
      ...filterOptions.map(
        (option) =>
          `<option value="${escapeHtml(option.key)}">${escapeHtml(`${option.label} (${option.count})`)}</option>`,
      ),
    ].join("");

    paginationEl.style.display = "flex";
    paginationEl.innerHTML = `
      <button type="button" class="history-page-btn secondary" onclick="app.changeHistoryPage(-1)" ${prevDisabledAttrs} aria-label="Previous page">Prev</button>
      <div class="history-pagination__center">
        <label class="history-filter" for="historyExerciseFilter">
          <select id="historyExerciseFilter" class="history-filter__select" aria-label="Filter workout history by exercise">
            ${filterOptionsHtml}
          </select>
        </label>
        <span class="history-pagination__label">Page ${this.historyPage} of ${safePages}</span>
      </div>
      <button type="button" class="history-page-btn secondary" onclick="app.changeHistoryPage(1)" ${nextDisabledAttrs} aria-label="Next page">Next</button>
    `;

    const filterSelect = paginationEl.querySelector("#historyExerciseFilter");
    if (filterSelect) {
      filterSelect.value = activeKey;
      filterSelect.addEventListener("change", (event) => {
        this.setHistoryFilter(event.target.value);
      });
    }
  }

  getHistoryPageCount() {
    const filteredEntries = this.getFilteredHistoryEntries();
    if (filteredEntries.length === 0) {
      return 0;
    }
    const pageSize = this.getHistoryPageSize();
    return Math.ceil(filteredEntries.length / pageSize);
  }

  setHistoryPage(page) {
    const totalPages = this.getHistoryPageCount();
    if (totalPages === 0) {
      const changed = this.historyPage !== 1;
      this.historyPage = 1;
      return changed;
    }
    const clamped = Math.min(Math.max(1, page), totalPages);
    const changed = clamped !== this.historyPage;
    this.historyPage = clamped;
    return changed;
  }

  changeHistoryPage(delta) {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    if (this.setHistoryPage(this.historyPage + delta)) {
      this.updateHistoryDisplay();
    }
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
    const hasHistorySelection = hasSelection && this.selectedHistoryKey !== null;

    exportBtn.textContent = hasSelection ? "Export Workout CSV" : "Export CSV";
    exportBtn.title = hasSelection
      ? "Export detailed movement data for the selected workout to Dropbox."
      : "Export the current load history window as a CSV file.";
    exportBtn.classList.toggle("export-selected", hasHistorySelection);
  }

  completeWorkout(options = {}) {
    const {
      reason = "complete",
      skipPlanAdvance = false,
    } = options;

    const completedPlanEntry =
      this.planActive && this._activePlanEntry
        ? { ...this._activePlanEntry }
        : null;

    this.updateCurrentSetLabel();
    this._planSetInProgress = false;

    if (this.currentWorkout) {
      // stop polling to avoid queue buildup
      this.device.stopPropertyPolling();
      this.device.stopMonitorPolling();

      const endTime = new Date();
      this.currentWorkout.endTime = endTime;

      // Extract movement data for this workout from chart history
      const movementData =
        this.currentWorkout.startTime instanceof Date
          ? this.extractWorkoutMovementData(
              this.currentWorkout.startTime,
              endTime,
            )
          : [];

      // Compute average loads between warmup end and workout end
      const averageLoads = this.calculateAverageLoadForWorkout(
        movementData,
        this.currentWorkout.warmupEndTime,
        endTime,
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
        exerciseId: typeof this.currentWorkout.exerciseId === "string"
          ? this.currentWorkout.exerciseId
          : null,
        exerciseIdNew: this.toNumericExerciseId(this.currentWorkout.exerciseIdNew),
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
        // Average loads between warmup end and workout end
        // averageLoad: total (left+right), averageLoadLeft: left cable, averageLoadRight: right cable
        averageLoad: averageLoads ? averageLoads.averageTotal : null,
        averageLoadLeft: averageLoads ? averageLoads.averageLeft : null,
        averageLoadRight: averageLoads ? averageLoads.averageRight : null,
      };

      const isSkipped = reason === "skipped";
      let storedWorkout = null;
      if (!isSkipped) {
        storedWorkout = this.addToWorkoutHistory(workout);
      }

      const summaryWorkout = storedWorkout || this.normalizeWorkout({ ...workout });

      if (!isSkipped) {
        if (movementData.length > 0) {
          this.addLogEntry(`Captured ${movementData.length} movement data points`, "info");
        } else {
          this.addLogEntry("Warning: No movement data captured for this workout", "warning");
        }
      }

      let prInfo = null;
      if (storedWorkout) {
        prInfo = this.displayTotalLoadPR(storedWorkout);
        try {
          if (this.isAudioTriggersEnabled() && prInfo?.status === "new") {
            this.playAudio("newPersonalRecord").catch(() => {});
          }
        } catch (e) {}
      } else {
        this.hidePRBanner();
      }

      if (!isSkipped) {
        this.finalizePersonalRecordForWorkout(summaryWorkout);
      } else {
        this.clearPersonalRecordCandidate();
      }

      // Auto-save to Dropbox if connected
      if (!isSkipped && this.dropboxManager.isConnected) {
        const workoutToPersist = storedWorkout || summaryWorkout;

        // Ensure average fields are present on the persisted object (after normalization)
        try {
          const avgsPersist = this.calculateAverageLoadForWorkout(
            Array.isArray(workoutToPersist.movementData)
              ? workoutToPersist.movementData
              : [],
            workoutToPersist.warmupEndTime,
            workoutToPersist.endTime,
          );
          workoutToPersist.averageLoad = avgsPersist ? avgsPersist.averageTotal : null;
          workoutToPersist.averageLoadLeft = avgsPersist ? avgsPersist.averageLeft : null;
          workoutToPersist.averageLoadRight = avgsPersist ? avgsPersist.averageRight : null;
        } catch (e) {
          // no-op, fall through with nulls
          workoutToPersist.averageLoad = workoutToPersist.averageLoad ?? null;
          workoutToPersist.averageLoadLeft = workoutToPersist.averageLoadLeft ?? null;
          workoutToPersist.averageLoadRight = workoutToPersist.averageLoadRight ?? null;
        }

        this.dropboxManager
          .saveWorkout(workoutToPersist)
          .then(() => {
            // Store last backup timestamp
            localStorage.setItem("vitruvian.dropbox.lastBackup", new Date().toISOString());
            this.updateLastBackupDisplay();
            this.addLogEntry("Workout backed up to Dropbox", "success");
          })
          .catch((error) => {
            this.addLogEntry(`Failed to auto-save to Dropbox: ${error.message}`, "error");
          });

        // If enabled, play a 'maxed out' audio cue when a single-cable peak is very high
        try {
          if (this.isAudioTriggersEnabled() && storedWorkout) {
            const peakKg = Number(storedWorkout.cablePeakKg || 0) || Number(this.calculateTotalLoadPeakKg(storedWorkout) || 0);
            if (Number.isFinite(peakKg) && peakKg >= 95) {
              this.playAudio("maxedOut").catch(() => {});
            }
          }
        } catch (e) {
          // ignore
        }
      }

      if (!isSkipped && this.planActive && completedPlanEntry) {
        this.recordPlanSetResult(summaryWorkout, {
          completedEntry: completedPlanEntry,
          prInfo,
        });
      }

      this.resetRepCountersToEmpty();
      this.currentProgramParams = null;
      this._lastTargetSyncError = null;
      this._lastWeightSyncError = null;
    }

    const summaryMessages = {
      "auto-stop": "Workout auto-stopped and saved to history",
      "echo-auto-stop": "Echo Just Lift auto-stop saved to history",
      "stop-at-top": "Workout stopped at top and saved to history",
      "target-reps": "Workout completed at target reps and saved to history",
      skipped: "Workout skipped and advanced to the next block",
      user: "Workout completed and saved to history",
      complete: "Workout completed and saved to history",
    };
    const summaryMessage = summaryMessages[reason] || summaryMessages.complete;
    const summaryLevel =
      reason === "auto-stop" ||
      reason === "echo-auto-stop" ||
      reason === "skipped"
        ? "info"
        : "success";
    this.addLogEntry(summaryMessage, summaryLevel);

    // 👉 hand control back to the plan runner so it can show the rest overlay
    try {
      if (
        !skipPlanAdvance &&
        this.planActive &&
        typeof this.planOnWorkoutComplete === "function"
      ) {
        const planMessage =
          reason && reason !== "complete"
            ? `Plan: workout block completed (${reason})`
            : "Plan: workout block completed";
        this.addLogEntry(planMessage, "info");
        this.planOnWorkoutComplete({
          reason,
          completedEntry: completedPlanEntry,
        });
      }
    } catch (e) {
      /* no-op */
    }
  }

  // Extract movement data for a specific time range from chart history
  extractWorkoutMovementData(startTime, endTime) {
    if (
      !this.chartManager ||
      !this.chartManager.loadHistory ||
      !(startTime instanceof Date) ||
      !(endTime instanceof Date)
    ) {
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

  // Calculate average total, left and right loads between warmupEndTime and endTime
  // Returns an object: { averageTotal, averageLeft, averageRight } or null if no points
  calculateAverageLoadForWorkout(movementData = [], warmupEndTime, endTime) {
    if (!Array.isArray(movementData) || movementData.length === 0) {
      return null;
    }

    const windowStartMs =
      warmupEndTime instanceof Date ? warmupEndTime.getTime() : null;
    const windowEndMs = endTime instanceof Date ? endTime.getTime() : null;

    let sumLeft = 0;
    let sumRight = 0;
    let count = 0;

    for (const pt of movementData) {
      const ts = pt && pt.timestamp ? new Date(pt.timestamp).getTime() : NaN;
      if (!isFinite(ts)) continue;

      if (windowEndMs && ts > windowEndMs) continue;
      if (windowStartMs && ts < windowStartMs) continue;

      const left = Number(pt.loadA) || 0;
      const right = Number(pt.loadB) || 0;
      sumLeft += left;
      sumRight += right;
      count += 1;
    }

    if (count === 0) return null;

    const avgLeft = sumLeft / count;
    const avgRight = sumRight / count;
    const avgTotal = avgLeft + avgRight;

    // Return rounded integer values for compatibility with existing files; change to decimals if desired
    return {
      averageTotal: Math.round(avgTotal),
      averageLeft: Math.round(avgLeft),
      averageRight: Math.round(avgRight),
    };
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

    const rangeA =
      Number.isFinite(this.maxRepPosA) && Number.isFinite(this.minRepPosA)
        ? this.maxRepPosA - this.minRepPosA
        : 0;
    const rangeB =
      Number.isFinite(this.maxRepPosB) && Number.isFinite(this.minRepPosB)
        ? this.maxRepPosB - this.minRepPosB
        : 0;

    // Only check cables that have a meaningful range
    const minRangeThreshold = AUTO_STOP_RANGE_THRESHOLD;
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
        const isEchoAutoStop =
          this.isJustLiftMode && this.currentWorkout?.itemType === "echo";
        const autoStopReason = isEchoAutoStop ? "echo-auto-stop" : "auto-stop";

        // Reset timer state before we transition out of the danger zone
        this.autoStopStartTime = null;
        this.updateAutoStopUI(0);

        if (isEchoAutoStop) {
          this.addLogEntry(
            "Echo auto-stop triggered → advancing to the next set",
            "success",
          );
          // Prevent additional auto-stop checks while the stop command is in flight
          this.isJustLiftMode = false;
          this.stopWorkout({ reason: autoStopReason });
        } else {
          this.addLogEntry(
            "Auto-stop triggered! Finishing workout...",
            "success",
          );
          this.stopWorkout({ reason: autoStopReason });
        }
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
    const circle = document.getElementById("weightAdjusterCircle");
    const progressCircle = document.getElementById("autoStopProgress");
    const indicator = document.getElementById("autoStopIndicator");
    const timeLabel = document.getElementById("autoStopTime");

    if (!progressCircle || !circle) return;

    const circumference = 339.292;
    const clampedProgress = Math.max(0, Math.min(progress, 1));
    const offset = circumference - clampedProgress * circumference;

    progressCircle.style.strokeDashoffset = offset;

    const isEnabled = circle.classList.contains("auto-stop-available");

    if (!isEnabled || clampedProgress <= 0) {
      circle.classList.remove("auto-stop-active");
      if (indicator) {
        indicator.setAttribute("aria-hidden", "true");
      }
      if (timeLabel) {
        timeLabel.textContent = "5s";
      }
      return;
    }

    const timeLeft = Math.max(0, Math.ceil((1 - clampedProgress) * 5));
    if (timeLabel) {
      timeLabel.textContent = `${timeLeft}s`;
    }

    circle.classList.add("auto-stop-active");
    if (indicator) {
      indicator.setAttribute("aria-hidden", "false");
    }
  }

  updateAutoStopTimerVisibility(isJustLift) {
    const circle = document.getElementById("weightAdjusterCircle");
    const indicator = document.getElementById("autoStopIndicator");
    const progressCircle = document.getElementById("autoStopProgress");

    if (!circle || !progressCircle) {
      return;
    }

    const shouldShow = !!isJustLift;

    circle.classList.toggle("auto-stop-available", shouldShow);

    if (!shouldShow) {
      circle.classList.remove("auto-stop-active");
      const circumference = 339.292;
      progressCircle.style.strokeDashoffset = circumference;
      if (indicator) {
        indicator.setAttribute("aria-hidden", "true");
      }
      this.updateAutoStopUI(0);
    }
  }

  setupAudioUnlockSupport() {
    if (typeof window === "undefined") {
      return;
    }

    if (!this._boundAudioUnlock) {
      this._boundAudioUnlock = () => this.handleAudioUnlockEvent();
    }

    this.attachAudioUnlockListeners();

    if (typeof document !== "undefined" && !this._boundAudioVisibilityChange) {
      this._boundAudioVisibilityChange = () => {
        if (!document.hidden) {
          this.handleAudioUnlockEvent();
        }
      };
      document.addEventListener(
        "visibilitychange",
        this._boundAudioVisibilityChange,
        false,
      );
    }
  }

  attachAudioUnlockListeners() {
    if (typeof window === "undefined" || this._audioUnlockListenersAttached) {
      return;
    }

    if (!this._boundAudioUnlock) {
      this._boundAudioUnlock = () => this.handleAudioUnlockEvent();
    }
    const handler = this._boundAudioUnlock;

    this._audioUnlockEvents.forEach((eventName) => {
      const options = eventName === "touchstart" ? { passive: true } : undefined;
      window.addEventListener(eventName, handler, options);
    });

    this._audioUnlockListenersAttached = true;
  }

  detachAudioUnlockListeners() {
    if (typeof window === "undefined" || !this._audioUnlockListenersAttached) {
      return;
    }

    const handler = this._boundAudioUnlock || (() => {});

    this._audioUnlockEvents.forEach((eventName) => {
      window.removeEventListener(eventName, handler);
    });

    this._audioUnlockListenersAttached = false;
  }

  handleAudioUnlockEvent() {
    const context = this.getAudioContext();
    if (!context) {
      return;
    }

    if (context.state === "running") {
      this.detachAudioUnlockListeners();
      return;
    }

    try {
      context
        .resume()
        .then(() => {
          if (context.state === "running") {
            this.detachAudioUnlockListeners();
          }
        })
        .catch(() => {});
    } catch {
      // Ignore resume errors triggered outside a user gesture
    }
  }

  setupAudioContextStateHandlers(context) {
    if (!context) {
      return;
    }

    if (!this._boundAudioStateChange) {
      this._boundAudioStateChange = () => this.handleAudioStateChange();
    }

    if (typeof context.addEventListener === "function") {
      context.addEventListener("statechange", this._boundAudioStateChange);
    } else {
      context.onstatechange = this._boundAudioStateChange;
    }

    this.handleAudioStateChange();
  }

  handleAudioStateChange() {
    const context = this._audioContext;
    if (!context) {
      return;
    }

    const state = context.state;
    if (state === "running") {
      this.detachAudioUnlockListeners();
    } else if (state === "suspended" || state === "interrupted") {
      this.attachAudioUnlockListeners();
      this.tryResumeAudioContext();
    }
  }

  tryResumeAudioContext() {
    const context = this._audioContext;
    if (
      context &&
      (context.state === "suspended" || context.state === "interrupted")
    ) {
      try {
        context.resume().catch(() => {});
      } catch {
        // Ignore resume errors triggered outside a user gesture
      }
    }
  }

  /* Audio triggers manager
   * - Toggle persisted in localStorage `vitruvian.audioTriggersEnabled`
  * - `playAudio(key)` attempts to play a mapped file from `AudioCue/`
   * - Falls back to existing oscillator beep behavior when file playback fails.
   */
  isAudioTriggersEnabled() {
    try {
      const raw = localStorage.getItem("vitruvian.audioTriggersEnabled");
      return raw === "true";
    } catch {
      return false;
    }
  }

  setAudioTriggersEnabled(enabled) {
    try {
      localStorage.setItem("vitruvian.audioTriggersEnabled", enabled ? "true" : "false");
    } catch {}
    const btn = document.getElementById("audioTriggersToggle");
    if (btn) {
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      // reflect persistent visual state
      if (enabled) {
        btn.classList.add("is-active");
      } else {
        btn.classList.remove("is-active");
      }
    }
  }

  initializeAudioToggle() {
    const btn = document.getElementById("audioTriggersToggle");
    if (!btn) return;
    const enabled = this.isAudioTriggersEnabled();
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    if (enabled) btn.classList.add("is-active");
    else btn.classList.remove("is-active");
    btn.addEventListener("click", () => {
      const newVal = !this.isAudioTriggersEnabled();
      this.setAudioTriggersEnabled(newVal);
      if (newVal) {
        this.tryResumeAudioContext();
        // Small async preload after a user gesture to warm up assets and reduce latency.
        setTimeout(() => {
          try {
            this.preloadAudioCueAssets();
          } catch (e) {
            // ignore preload failures
          }
        }, 50);
      }
    });
  }

  // Simple audio cache / player for AudioCue assets.
  _audioCache = new Map();

  async playAudio(key, options = {}) {
    try {
      if (!this.isAudioTriggersEnabled()) return false;

      const mapping = {
        newPersonalRecord: "New Personal Record.mp3",
        maxedOut: "Maxed Out.mp3",
        beastMode: "Beast Mode.mp3",
        calibrateLift: "Calibrate your Lift.mp3",
        strengthUnlocked: "Strength Unlocked.mp3",
        startLifting: "Start Lifting.mp3",
        crowdCheer: "crowd cheering.mp3",
        grindContinues: "The Grind Continues.mp3",
        // repcount files: e.g. `1_repcount.mp3`, `01_repcount.mp3`
        repcount: (rep) => `${rep}_repcount.mp3`,
      };

      let filename = null;
      if (Object.prototype.hasOwnProperty.call(mapping, key)) {
        const val = mapping[key];
        filename = typeof val === "function" ? val(options.rep || 0) : val;
      } else {
        // allow caller to pass direct filename
        filename = key;
      }

      if (!filename) return false;

      // For repcount files try zero-padded and non-padded .mp3 variants (e.g. '01_repcount.mp3', '1_repcount.mp3')
      const candidates = [];
      if (key === "repcount") {
        const repNum = Number(options.rep || 0) || 0;
        const pad2 = repNum.toString().padStart(2, "0");
        candidates.push(`${pad2}_repcount.mp3`);
        candidates.push(`${repNum}_repcount.mp3`);
      } else {
        candidates.push(filename);
      }

      // Try candidates sequentially until one plays
      this.tryResumeAudioContext();
      for (const candidate of candidates) {
        const src = `AudioCue/${candidate}`;
        try {
          let audio = this._audioCache.get(src);
          if (!audio) {
            audio = new Audio(src);
            audio.preload = "auto";
            this._audioCache.set(src, audio);
          }
          // Reset currentTime to 0 to allow rapid replays of the same audio element
          audio.currentTime = 0;
          await audio.play();
          return true;
        } catch (err) {
          // Try next candidate
          continue;
        }
      }

      return false;
    } catch (err) {
      // Silent failure: audio not found or blocked. Return false so caller can fallback.
      return false;
    }
  }

  // Preload a list of audio filenames into the audio cache to reduce latency.
  // Accepts filenames relative to the `AudioCue/` folder.
  preloadAudioAssets(filenames = []) {
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return Promise.resolve([]);
    }

    const tasks = [];
    for (const filename of filenames) {
      if (!filename) continue;
      const src = `AudioCue/${filename}`;
      if (this._audioCache.has(src)) {
        continue; // already cached
      }

      try {
        const audio = new Audio(src);
        audio.preload = "auto";
        this._audioCache.set(src, audio);

        const p = new Promise((resolve) => {
          const onReady = () => {
            cleanup();
            resolve({ src, status: "ok" });
          };
          const onError = () => {
            cleanup();
            resolve({ src, status: "error" });
          };
          const cleanup = () => {
            audio.removeEventListener("canplaythrough", onReady);
            audio.removeEventListener("loadedmetadata", onReady);
            audio.removeEventListener("error", onError);
          };

          audio.addEventListener("canplaythrough", onReady, { once: true });
          audio.addEventListener("loadedmetadata", onReady, { once: true });
          audio.addEventListener("error", onError, { once: true });
          // Kick off loading
          try {
            audio.load();
          } catch (e) {
            // ignore
            resolve({ src, status: "error" });
          }
        });

        tasks.push(p);
      } catch (err) {
        // ignore single failures
      }
    }

    return Promise.allSettled(tasks).then((results) => results.map((r) => (r.status === "fulfilled" ? r.value : { status: "error" })));
  }

  // Preload the commonly used cue files and a range of repcount files.
  preloadAudioCueAssets() {
    if (this._preloadInFlight) return this._preloadInFlight;
    const baseFiles = [
      "New Personal Record.mp3",
      "Maxed Out.mp3",
      "Beast Mode.mp3",
      "Calibrate your Lift.mp3",
      "Strength Unlocked.mp3",
      "Start Lifting.mp3",
      "crowd cheering.mp3",
      "The Grind Continues.mp3",
    ];

    // Preload repcount files for 1..25 (mp3, padded and non-padded)
    const repCandidates = new Set();
    for (let i = 1; i <= 25; i++) {
      repCandidates.add(`${i}_repcount.mp3`);
      repCandidates.add(`${i.toString().padStart(2, "0")}_repcount.mp3`);
    }

    const all = baseFiles.concat(Array.from(repCandidates));
    this._preloadInFlight = this.preloadAudioAssets(all).finally(() => {
      this._preloadInFlight = null;
    });
    return this._preloadInFlight;
  }

  getAudioContext() {
    try {
      const AudioContextClass =
        typeof window !== "undefined"
          ? window.AudioContext || window.webkitAudioContext
          : null;
      if (!AudioContextClass) {
        return null;
      }
      if (!this._audioContext) {
        try {
          this._audioContext = new AudioContextClass({ latencyHint: "interactive" });
        } catch {
          this._audioContext = new AudioContextClass();
        }
        this.setupAudioContextStateHandlers(this._audioContext);
      }

      this.tryResumeAudioContext();
      return this._audioContext;
    } catch {
      return null;
    }
  }

  setupWakeLock() {
    if (typeof navigator === "undefined" || !navigator.wakeLock) {
      return;
    }

    if (!this._boundWakeLockVisibilityChange) {
      this._boundWakeLockVisibilityChange = () => {
        if (typeof document === "undefined") {
          return;
        }
        if (document.visibilityState === "visible") {
          this.requestWakeLock({ silent: true });
        } else {
          this.releaseWakeLock({ silent: true });
        }
      };
    }

    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this._boundWakeLockVisibilityChange,
        false,
      );
    }

    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => {
        this.requestWakeLock({ silent: true });
      });
      window.addEventListener("beforeunload", () => {
        this.releaseWakeLock({ silent: true });
      });
      window.addEventListener("pagehide", () => {
        this.releaseWakeLock({ silent: true });
      });
    }

    this.requestWakeLock();
  }

  async requestWakeLock(options = {}) {
    if (
      typeof navigator === "undefined" ||
      !navigator.wakeLock ||
      (typeof document !== "undefined" && document.hidden)
    ) {
      return null;
    }

    if (this._wakeLockSentinel) {
      return this._wakeLockSentinel;
    }

    try {
      const sentinel = await navigator.wakeLock.request("screen");
      this._wakeLockSentinel = sentinel;

      if (!this._boundWakeLockRelease) {
        this._boundWakeLockRelease = () => {
          this._wakeLockSentinel = null;
          if (typeof document !== "undefined" && !document.hidden) {
            this.requestWakeLock({ silent: true }).catch(() => {});
          }
        };
      }

      sentinel.addEventListener("release", this._boundWakeLockRelease);
      if (!options.silent) {
        this.addLogEntry("Screen wake lock active", "info");
      }
      return sentinel;
    } catch (error) {
      if (!options.silent) {
        this.addLogEntry(`Wake Lock request failed: ${error.message}`, "warning");
      }
      return null;
    }
  }

  async releaseWakeLock(options = {}) {
    if (!this._wakeLockSentinel) {
      return;
    }

    try {
      if (this._boundWakeLockRelease) {
        this._wakeLockSentinel.removeEventListener(
          "release",
          this._boundWakeLockRelease,
        );
      }
      await this._wakeLockSentinel.release();
      if (!options.silent) {
        this.addLogEntry("Screen wake lock released", "info");
      }
    } catch (error) {
      if (!options.silent) {
        this.addLogEntry(
          `Failed to release wake lock: ${error.message}`,
          "warning",
        );
      }
    } finally {
      this._wakeLockSentinel = null;
    }
  }

  playWeightAdjustChirp(direction = 0, options = {}) {
    if (!direction) {
      return;
    }

    const context = this.getAudioContext();
    if (!context) {
      return;
    }

    const repeat = !!options.repeat;
    const now = context.currentTime || 0;
    const minInterval = repeat ? 0.12 : 0.18;
    if (now - this._weightAdjustSoundThrottle < minInterval) {
      return;
    }
    this._weightAdjustSoundThrottle = now;

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    const increasing = direction > 0;
    const startFreq = increasing ? 220 : 540;
    const endFreq = increasing ? 680 : 180;

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(startFreq, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      endFreq,
      now + 0.4,
    );

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.5);
  }

  playCountdownBeep(secondsRemaining) {
    if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) {
      return;
    }

    const context = this.getAudioContext();
    if (!context) {
      return;
    }

    const now = context.currentTime || 0;
    if (now - this._countdownBeepThrottle < 0.15) {
      return;
    }
    this._countdownBeepThrottle = now;

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    const baseFrequency =
      secondsRemaining === 1
        ? 880
        : secondsRemaining === 2
          ? 720
          : 560;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(baseFrequency, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }

  playRestStartChime() {
    try {
      const context = this.getAudioContext();
      if (!context) {
        return;
      }

      const now = context.currentTime || 0;
      if (now - this._lastRestChime < 0.4) {
        return;
      }
      this._lastRestChime = now;

      const baseOsc = context.createOscillator();
      const baseGain = context.createGain();
      baseOsc.type = "sine";
      baseOsc.frequency.setValueAtTime(480, now);
      baseOsc.frequency.linearRampToValueAtTime(640, now + 0.18);
      baseGain.gain.setValueAtTime(0.0001, now);
      baseGain.gain.exponentialRampToValueAtTime(0.26, now + 0.02);
      baseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
      baseOsc.connect(baseGain);
      baseGain.connect(context.destination);
      baseOsc.start(now);
      baseOsc.stop(now + 0.38);

      const accentOsc = context.createOscillator();
      const accentGain = context.createGain();
      accentOsc.type = "triangle";
      accentOsc.frequency.setValueAtTime(960, now + 0.22);
      accentOsc.frequency.linearRampToValueAtTime(1160, now + 0.46);
      accentGain.gain.setValueAtTime(0.0001, now);
      accentGain.gain.setValueAtTime(0.0001, now + 0.2);
      accentGain.gain.exponentialRampToValueAtTime(0.22, now + 0.26);
      accentGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
      accentOsc.connect(accentGain);
      accentGain.connect(context.destination);
      accentOsc.start(now + 0.22);
      accentOsc.stop(now + 0.6);
    } catch (error) {
      // Ignore audio failures so rest flow continues without interruption
    }
  }

  playRepTopSound() {
    try {
      const context = this.getAudioContext();
      if (!context) {
        return;
      }

      const now = context.currentTime || 0;
      if (now - this._lastRepTopBeep < 0.08) {
        return;
      }
      this._lastRepTopBeep = now;

      // Determine if we're in warmup or working reps.
      // During warmup reps, always use oscillator beep.
      // During working reps, try repcount audio file first, then fallback to oscillator.
      const currentWarmupReps = Number(this.warmupReps) || 0;
      const currentWorkingReps = Number(this.workingReps) || 0;
      const totalSoFar = currentWarmupReps + currentWorkingReps;
      const nextRepOverall = totalSoFar + 1;
      const isWarmupRep = Number.isFinite(this.warmupTarget) && nextRepOverall <= (Number(this.warmupTarget) || 0);
      const nextRepCount = currentWorkingReps + 1;

      // Helper to play oscillator beep
      const playOscillatorBeep = () => {
        try {
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
        } catch (err) {
          // ignore
        }
      };

      // If warmup, always use beep. If working, try repcount audio first.
      if (isWarmupRep) {
        playOscillatorBeep();
      } else {
        // Working reps: try repcount audio file (1-25), fallback to beep
        if (nextRepCount >= 1 && nextRepCount <= 25 && this.isAudioTriggersEnabled()) {
          this.playAudio("repcount", { rep: nextRepCount })
            .then((played) => {
              if (!played) {
                playOscillatorBeep();
              }
            })
            .catch(() => {
              playOscillatorBeep();
            });
        } else {
          // Audio disabled, out of range, or warmup: use beep
          playOscillatorBeep();
        }
      }
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
        this.ensureWorkoutStartTime();
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
          this.workingReps === this.targetReps - 1 &&
          !this._stopAtTopPending
        ) {
          // We're at targetReps - 1, and just reached top
          // This is the top of the final rep, complete now
          if (this.workingReps < this.targetReps) {
            this.workingReps = Math.min(this.targetReps, this.workingReps + 1);
            this.addLogEntry(
              `Working rep ${this.workingReps}/${this.targetReps} counted at the top`,
              "success",
            );
            this.updateRepCounters();
          }
          this.addLogEntry(
            "Reached top of final rep! Auto-completing workout...",
            "success",
          );
          this._stopAtTopPending = true;
          this.stopWorkout({ reason: "stop-at-top", complete: false })
            .catch((error) => {
              this.addLogEntry(
                `Failed to stop at top automatically: ${error?.message || error}`,
                "error",
              );
            })
            .finally(() => {
              this.completeWorkout({ reason: "stop-at-top" });
              this._stopAtTopPending = false;
            }); // Must be explicitly stopped as the machine thinks the set isn't finished until the bottom of the final rep.
          this.lastRepCounter = completeCounter;
          return;
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
      if (this._stopAtTopPending) {
        this.addLogEntry(
          "Stop-at-top pending; skipping bottom rep increment.",
          "info",
        );
        this.lastRepCounter = completeCounter;
        return;
      }
      this.ensureWorkoutStartTime();
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
          try {
            if (this.isAudioTriggersEnabled()) {
              this.playAudio("startLifting").catch(() => {});
            }
          } catch (e) {}
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
          this.completeWorkout({ reason: "target-reps" });
        }
      }

      this.updateRepCounters();
    }

    this.lastRepCounter = completeCounter;
  }

  async connect() {
    if (!navigator.bluetooth) {
      alert(
        "Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera.",
      );
      return;
    }

    if (this._deviceConnectInFlight || this.device?.isConnected) {
      return;
    }

    this._deviceConnectInFlight = true;
    this.cancelDeviceHold();
    this.setDeviceButtonState("connecting");
    this.setDeviceButtonSubtext("Grant Bluetooth permission to connect.");

    try {
      await this.device.connect();
      this.updateConnectionStatus(true);

      // Send initialization sequence
      await this.device.sendInit();
    } catch (error) {
      console.error("Connection error:", error);
      this.addLogEntry(`Connection failed: ${error.message}`, "error");
      this.updateConnectionStatus(false);
    } finally {
      this._deviceConnectInFlight = false;
    }
  }

  async disconnect() {
    try {
      this.cancelDeviceHold();
      this.setDeviceButtonState("connecting");
      this.setDeviceButtonSubtext("Disconnecting…");
      await this.device.disconnect();
      this.updateConnectionStatus(false);
    } catch (error) {
      console.error("Disconnect error:", error);
      this.addLogEntry(`Disconnect failed: ${error.message}`, "error");
      if (this.device?.isConnected) {
        this.setDeviceButtonState("connected");
        this.setDeviceButtonSubtext("Hold to disconnect.");
      } else {
        this.updateConnectionStatus(false);
      }
    }
  }

  async stopWorkout(options = {}) {
    const { reason = "user", complete = true, skipPlanAdvance = false } = options;

    try {
      if (this.device) {
        this.device.stopPropertyPolling?.();
        this.device.stopMonitorPolling?.();
      }
      await this.device.sendStopCommand();
      this.currentProgramParams = null;
      this._lastTargetSyncError = null;
      this._lastWeightSyncError = null;

      let stopMessage = "Workout stopped by user";
      if (reason === "auto-stop") {
        stopMessage = "Workout auto-stopped (Just Lift safety)";
      } else if (reason === "echo-auto-stop") {
        stopMessage = "Echo Just Lift auto-stop triggered";
      } else if (reason === "stop-at-top") {
        stopMessage = "Workout stopped at top of final rep";
      }
      this.addLogEntry(stopMessage, "info");

      if (complete) {
        this.completeWorkout({ reason, skipPlanAdvance });
      }
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

      const planIndex = Number.isInteger(this.planCursor?.index)
        ? this.planCursor.index
        : null;
      const planItem =
        this.planActive && planIndex !== null
          ? this.planItems?.[planIndex] || null
          : null;
      const activePlanName = this.planActive ? this.getActivePlanDisplayName() : null;
      const planName =
        typeof activePlanName === "string" && activePlanName.trim().length > 0
          ? activePlanName.trim()
          : null;
      const planExerciseId = this.getPlanExerciseId(planItem);
      const planExerciseNumericId = this.getPlanExerciseNumericId(planItem);
      const cableCount = this.getPlanCableCount(planItem);
      const totalLoadKg = Number.isFinite(perCableKg)
        ? perCableKg * cableCount
        : null;

      this.currentWorkout = {
        mode: modeName || "Program",
        weightKg: perCableKg,
        originalWeightKg: perCableKg,
        adjustedWeightKg: perCableKg,
        targetReps: reps,
        startTime: null,
        warmupEndTime: null,
        endTime: null,
        setName: planItem?.name || null,
        setNumber:
          this.planActive && planItem ? this.planCursor?.set ?? null : null,
        setTotal: planItem?.sets ?? null,
        itemType: planItem?.type || "exercise",
        planName,
        exerciseId: planExerciseId,
        exerciseIdNew: planExerciseNumericId,
        cableCount,
        totalLoadKg,
      };
      this.updateWorkingCounterControlsState();
      this.initializeCurrentWorkoutPersonalBest();
      this.updateRepCounters();
      this.updateLiveWeightDisplay();
      this.updateCurrentSetLabel();

      // Enable auto-stop indicator if Just Lift mode (including Echo Just Lift)
      this.updateAutoStopTimerVisibility(isJustLift);

      this.currentProgramParams = { ...params };
      this._lastTargetSyncError = null;
      this._lastWeightSyncError = null;

      await this.device.startProgram(params);

      // If audio triggers enabled, play beast-mode announcement for TUT Beast
      try {
        if (this.isAudioTriggersEnabled() && typeof ProgramMode !== "undefined") {
          if (Number(params.baseMode) === ProgramMode.TUT_BEAST) {
            // best-effort: play beast audio, ignore failures
            this.playAudio("beastMode").catch(() => {});
          }
        }
      } catch (e) {
        // ignore
      }

      // Update stop button state
      this.updateStopButtonState();

      // Close sidebar on mobile after starting
      this.closeSidebar();
    } catch (error) {
      console.error("Start program error:", error);
      this.addLogEntry(`Failed to start program: ${error.message}`, "error");
      alert(`Failed to start program: ${error.message}`);
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
      this._lastTargetSyncError = null;
      this._lastWeightSyncError = null;

      // Reset workout state and set current workout info
      this.warmupReps = 0;
      this.workingReps = 0;
      const modeName = isJustLift
        ? `Just Lift Echo ${EchoLevelNames[level]}`
        : `Echo ${EchoLevelNames[level]}`;

      const planIndex = Number.isInteger(this.planCursor?.index)
        ? this.planCursor.index
        : null;
      const planItem =
        this.planActive && planIndex !== null
          ? this.planItems?.[planIndex] || null
          : null;
      const activePlanName = this.planActive ? this.getActivePlanDisplayName() : null;
      const planName =
        typeof activePlanName === "string" && activePlanName.trim().length > 0
          ? activePlanName.trim()
          : null;
      const planExerciseId = this.getPlanExerciseId(planItem);
      const planExerciseNumericId = this.getPlanExerciseNumericId(planItem);
      const cableCount = this.getPlanCableCount(planItem);
      const plannedPerCableKg = Number(planItem?.perCableKg);
      const totalLoadKg =
        Number.isFinite(plannedPerCableKg) && plannedPerCableKg > 0
          ? plannedPerCableKg * cableCount
          : null;

      this.currentWorkout = {
        mode: modeName,
        weightKg: 0, // Echo mode doesn't have fixed weight
        originalWeightKg: 0,
        adjustedWeightKg: 0,
        targetReps: targetReps,
        startTime: null,
        warmupEndTime: null,
        endTime: null,
        setName: planItem?.name || null,
        setNumber:
          this.planActive && planItem ? this.planCursor?.set ?? null : null,
        setTotal: planItem?.sets ?? null,
        itemType: planItem?.type || "echo",
        planName,
        exerciseId: planExerciseId,
        exerciseIdNew: planExerciseNumericId,
        cableCount,
        totalLoadKg,
      };
      this.updateWorkingCounterControlsState();
      this.initializeCurrentWorkoutPersonalBest();
      this.updateRepCounters();
      this.updateLiveWeightDisplay();
      this.updateCurrentSetLabel();

      // Enable auto-stop indicator if Just Lift mode (including Echo Just Lift)
      this.updateAutoStopTimerVisibility(isJustLift);

      await this.device.startEcho(params);

      // Update stop button state
      this.updateStopButtonState();

      // Close sidebar on mobile after starting
      this.closeSidebar();
    } catch (error) {
      console.error("Start Echo error:", error);
      this.addLogEntry(`Failed to start Echo mode: ${error.message}`, "error");
      alert(`Failed to start Echo mode: ${error.message}`);
    }
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
      intensity: "none",                   // intensity technique (none|dropset|restpause|slownegatives)
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
  _applyItemToUI(item) {
    if (!item) {
      return;
    }

    this.stopAtTop = !!item.stopAtTop;

    const stopAtTopCheckbox = document.getElementById("stopAtTopCheckbox");
    if (stopAtTopCheckbox) {
      stopAtTopCheckbox.checked = this.stopAtTop;
    }

    if (item.type === "exercise") {
      const modeSelect = document.getElementById("mode");
      const weightInput = document.getElementById("weight");
      const repsInput = document.getElementById("reps");
      const progressionInput = document.getElementById("progression");
      const justLiftCheckbox = document.getElementById("justLiftCheckbox");

      const perCableKg = Number.isFinite(item.perCableKg)
        ? item.perCableKg
        : this.defaultPerCableKg;
      item.perCableKg = perCableKg;

      if (modeSelect) {
        modeSelect.value = String(item.mode);
      }
      if (weightInput) {
        weightInput.value = this.formatWeightValue(
          perCableKg,
          this.getWeightInputDecimals(),
        );
        this._weightInputKg = perCableKg;
      }
      if (repsInput) {
        repsInput.value = String(item.reps);
      }
      if (progressionInput) {
        progressionInput.value = this.formatWeightValue(
          item.progressionKg,
          this.getProgressionInputDecimals(),
        );
      }
      if (justLiftCheckbox) {
        justLiftCheckbox.checked = !!item.justLift;
        this.toggleJustLiftMode();
      }
    } else if (item.type === "echo") {
      const levelSelect = document.getElementById("echoLevel");
      const eccentricInput = document.getElementById("eccentric");
      const targetInput = document.getElementById("targetReps");
      const echoJustLiftCheckbox = document.getElementById("echoJustLiftCheckbox");

      if (levelSelect) {
        levelSelect.value = String((item.level ?? 0) + 1);
      }
      if (eccentricInput) {
        eccentricInput.value = String(item.eccentricPct ?? 100);
      }
      if (targetInput) {
        targetInput.value = String(item.targetReps ?? 0);
      }
      if (echoJustLiftCheckbox) {
        echoJustLiftCheckbox.checked = !!item.justLift;
        this.toggleEchoJustLiftMode();
      }
    }

    this.updateLiveWeightDisplay();
    this.updatePlanSetIndicator();
    this.updateCurrentSetLabel();
  }

  setDropboxStatus(message, options = {}) {
    const statusDiv = document.getElementById("dropboxSyncStatus");
    if (!statusDiv) {
      return;
    }
    statusDiv.textContent = message;
    if (options.color) {
      statusDiv.style.color = options.color;
    } else if (!options.preserveColor) {
      statusDiv.style.color = "";
    }
  }

  logDropboxConsole(context, message, options = {}) {
    const prefix = `[WorkoutTime][Dropbox][${context}]`;
    const { level = "info" } = options;
    const output = `${prefix} ${message}`;
    if (level === "error") {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  toNumericExerciseId(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const integer = Math.trunc(numeric);
    if (integer !== numeric) {
      return null;
    }
    if (integer < 0 || integer > 0xffff) {
      return null;
    }
    return integer;
  }

  getPlanExerciseNumericId(planItem) {
    if (!planItem || typeof planItem !== "object") {
      return null;
    }

    const candidates = [
      planItem.exerciseIdNew,
      planItem.id_new,
      planItem.builderMeta?.exerciseIdNew,
      planItem.builderMeta?.exerciseNumericId,
      planItem.builderMeta?.exercise?.id_new,
    ];

    for (const candidate of candidates) {
      const numeric = this.toNumericExerciseId(candidate);
      if (numeric !== null) {
        return numeric;
      }
    }

    return null;
  }

  getPlanExerciseId(planItem) {
    if (!planItem || typeof planItem !== "object") {
      return null;
    }

    const candidate =
      typeof planItem.exerciseId === "string"
        ? planItem.exerciseId
        : typeof planItem.id === "string"
          ? planItem.id
          : planItem.builderMeta?.exerciseId;

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }

    return null;
  }

  getPlanCableCount(planItem) {
    const raw = Number(planItem?.cables);
    if (Number.isFinite(raw) && raw >= 1) {
      return Math.min(2, Math.max(1, raw));
    }
    return 2;
  }

  getWorkoutExerciseId(workout) {
    if (!workout || typeof workout !== "object") {
      return null;
    }
    const candidate =
      workout.exerciseId ||
      workout.planExerciseId ||
      workout.builderMeta?.exerciseId ||
      null;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
    return null;
  }

  extractCableCountFromWorkout(workout) {
    if (!workout || typeof workout !== "object") {
      return null;
    }
    const sources = [
      workout.cableCount,
      workout.cables,
      workout.builderMeta?.cables,
    ];
    for (const source of sources) {
      const value = Number(source);
      if (Number.isFinite(value) && value > 0) {
        return Math.min(2, Math.max(1, value));
      }
    }
    return 2;
  }

  deriveTotalLoadKg(workout) {
    if (!workout || typeof workout !== "object") {
      return null;
    }
    const stored = Number(workout.totalLoadKg);
    if (Number.isFinite(stored) && stored > 0) {
      return stored;
    }
    const perCableKg = Number(workout.weightKg);
    if (!Number.isFinite(perCableKg) || perCableKg <= 0) {
      return null;
    }
    const cables = this.extractCableCountFromWorkout(workout);
    if (!Number.isFinite(cables) || cables <= 0) {
      return null;
    }
    return perCableKg * cables;
  }

  inferPlanWeightUnit(items) {
    if (!Array.isArray(items)) {
      return null;
    }

    for (const item of items) {
      const inferred = this._inferUnitFromPlanItem(item);
      if (inferred) {
        return inferred;
      }
    }

    return null;
  }

  _inferUnitFromPlanItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const progressionUnit = typeof item.progressionUnit === "string"
      ? item.progressionUnit.trim().toUpperCase()
      : null;

    if (progressionUnit === "LBS") {
      return "lb";
    }

    if (progressionUnit === "KG") {
      return "kg";
    }

    const rawWeight = item?.builderMeta?.setData?.weight;
    const parsedWeight =
      typeof rawWeight === "string"
        ? parseFloat(rawWeight)
        : Number(rawWeight);
    const perCableKg = Number(item?.perCableKg);

    if (Number.isFinite(parsedWeight) && Number.isFinite(perCableKg)) {
      const kgDisplay = Number(perCableKg.toFixed(1));
      const lbDisplay = Number((perCableKg * LB_PER_KG).toFixed(1));
      const tolerance = 0.11;
      const kgDelta = Math.abs(parsedWeight - kgDisplay);
      const lbDelta = Math.abs(parsedWeight - lbDisplay);

      if (kgDelta <= tolerance && kgDelta <= lbDelta) {
        return "kg";
      }

      if (lbDelta <= tolerance && lbDelta < kgDelta) {
        return "lb";
      }
    }

    return null;
  }

  /* =========================
     PLAN — UI RENDER
     ========================= */

  renderPlanUI() {
    const container = document.getElementById("planItems");
    if (!container) return;

    const items = Array.isArray(this.planItems) ? this.planItems : [];

    const unit = this.getUnitLabelShort();
    const toAttrValue = (raw) =>
      escapeHtml(raw === null || raw === undefined ? "" : String(raw));
    const toNumberString = (value) => {
      if (value === null || value === undefined) {
        return "";
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? String(numeric) : "";
    };

    const makeRow = (item, i) => {
      const card = document.createElement("div");
      card.className = "plan-card";

      const sectionTitle =
        item.type === "exercise"
          ? `Exercise`
          : `Echo Mode`;

      const title = document.createElement("div");
      title.className = "plan-card__header";
      title.innerHTML = `
        <div class="plan-card__header-title">${escapeHtml(sectionTitle)}</div>
        <div class="plan-card__actions">
          <button class="secondary plan-card__action" onclick="app.movePlanItem(${i}, -1)">Move Up</button>
          <button class="secondary plan-card__action" onclick="app.movePlanItem(${i}, 1)">Move Down</button>
          <button class="danger plan-card__action" onclick="app.removePlanItem(${i})">Delete</button>
        </div>
      `;
      card.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "plan-card__grid";

      // Common: Name, Sets, Rest, JL, StopAtTop
      const nameValue = toAttrValue(item.name || "");
      const setsValue = toAttrValue(toNumberString(item.sets));
      const restValue = toAttrValue(toNumberString(item.restSec));

      const nameField = `
        <div class="form-group">
          <label>Name</label>
          <input type="text" value="${nameValue}" oninput="app.updatePlanField(${i}, 'name', this.value)" />
        </div>
      `;

      const setsField = `
        <div class="form-group">
          <label>Sets</label>
          <input type="number" min="1" max="99" value="${setsValue}" oninput="app.updatePlanField(${i}, 'sets', parseInt(this.value)||1)" />
        </div>
      `;

      const restField = `
        <div class="form-group">
          <label>Rest (sec)</label>
          <input type="number" min="0" max="600" value="${restValue}" oninput="app.updatePlanField(${i}, 'restSec', parseInt(this.value)||0)" />
        </div>
      `;

      const toggleFields = `
        <div class="form-group plan-card__toggles">
          <label class="plan-card__toggle-option">
            <input type="checkbox" ${item.justLift ? "checked" : ""} onchange="app.updatePlanField(${i}, 'justLift', this.checked)" />
            <span>Just lift mode</span>
          </label>
          <label class="plan-card__toggle-option">
            <input type="checkbox" ${item.stopAtTop ? "checked" : ""} onchange="app.updatePlanField(${i}, 'stopAtTop', this.checked)" />
            <span>Stop at Top of final rep</span>
          </label>
        </div>
      `;

      if (item.type === "exercise") {
        const modeOptions = [
          [ProgramMode.OLD_SCHOOL, "Old School"],
          [ProgramMode.PUMP, "Pump"],
          [ProgramMode.TUT, "TUT"],
          [ProgramMode.TUT_BEAST, "TUT Beast"],
          [ProgramMode.ECCENTRIC_ONLY, "Eccentric Only"],
        ]
          .map(
            ([val, label]) =>
              `<option value="${toAttrValue(val)}" ${item.mode === val ? "selected" : ""}>${escapeHtml(label)}</option>`,
          )
          .join("");

        let perCableDisplayRaw = "";
        const numericPerCableKg = Number(item.perCableKg);
        if (Number.isFinite(numericPerCableKg)) {
          const converted = this.convertKgToDisplay(numericPerCableKg);
          perCableDisplayRaw = Number.isFinite(converted)
            ? converted.toFixed(this.getWeightInputDecimals())
            : "";
        }
        const perCableAttr = toAttrValue(perCableDisplayRaw);

        const repsValue = toAttrValue(toNumberString(item.reps));
        const parsedCables = Number(item.cables);
        const normalizedCables = Number.isFinite(parsedCables)
          ? Math.min(2, Math.max(1, parsedCables))
          : "";
        const cablesValue = toAttrValue(
          normalizedCables === "" ? "" : String(normalizedCables),
        );

        let progressionDisplayRaw = "";
        const numericProgressionKg = Number(item.progressionKg);
        if (Number.isFinite(numericProgressionKg)) {
          const convertedProgression = this.convertKgToDisplay(numericProgressionKg);
          progressionDisplayRaw = Number.isFinite(convertedProgression)
            ? convertedProgression.toFixed(this.getProgressionInputDecimals())
            : "";
        }
        const progressionAttr = toAttrValue(progressionDisplayRaw);

        const progressionMin = toAttrValue(this.convertKgToDisplay(-3));
        const progressionMax = toAttrValue(this.convertKgToDisplay(3));
        const perCableStep = unit === "lb" ? "1" : "0.5";
        const progressionStep = unit === "lb" ? "0.2" : "0.1";

        grid.innerHTML = `
          ${nameField}

          <div class="form-group">
            <label>Mode</label>
            <select onchange="app.updatePlanField(${i}, 'mode', parseInt(this.value))">
              ${modeOptions}
            </select>
          </div>

          <div class="form-group">
            <label>Weight per cable (${unit})</label>
            <input type="number" min="0" max="1000" step="${perCableStep}"
                   value="${perCableAttr}"
                   oninput="app.updatePlanPerCableDisplay(${i}, this.value)" />
          </div>

          <div class="form-group">
            <label>Cables</label>
            <input type="number" min="1" max="2" value="${cablesValue}" oninput="app.updatePlanField(${i}, 'cables', Math.min(2, Math.max(1, parseInt(this.value)||1)))" />
          </div>

          <div class="form-group">
            <label>Reps</label>
            <input type="number" min="0" max="100" value="${repsValue}" oninput="app.updatePlanField(${i}, 'reps', parseInt(this.value)||0)" />
          </div>

          ${setsField}

          <div class="form-group">
            <label>Progression (${unit} per rep)</label>
            <input type="number"
                   step="${progressionStep}"
                   min="${progressionMin}"
                   max="${progressionMax}"
                   value="${progressionAttr}"
                   oninput="app.updatePlanProgressionDisplay(${i}, this.value)" />
          </div>

          <div class="form-group">
            <label class="label-with-hint">
              <span>Intensity Technique</span>
              <i
                class="bi bi-info-circle"
                title="Optional finisher applied to the last set: Dropset, Rest-Pause, or Slow negatives."
                aria-label="Intensity technique help"
              ></i>
            </label>
            <select onchange="app.updatePlanField(${i}, 'intensity', this.value)">
              <option value="none" ${item.intensity === "none" ? "selected" : ""}>None (default)</option>
              <option value="dropset" ${item.intensity === "dropset" ? "selected" : ""}>Dropset</option>
              <option value="restpause" ${item.intensity === "restpause" ? "selected" : ""}>Rest-Pause</option>
              <option value="slownegatives" ${item.intensity === "slownegatives" ? "selected" : ""}>Slow negatives</option>
            </select>
          </div>

          ${restField}
          ${toggleFields}
        `;
      } else {
        // echo
        const levelOptions = [
          [EchoLevel.HARD, "Hard"],
          [EchoLevel.HARDER, "Harder"],
          [EchoLevel.HARDEST, "Hardest"],
          [EchoLevel.EPIC, "Epic"],
        ]
          .map(
            ([val, label]) =>
              `<option value="${toAttrValue(val)}" ${item.level === val ? "selected" : ""}>${escapeHtml(label)}</option>`,
          )
          .join("");

        const eccentricValue = toAttrValue(toNumberString(item.eccentricPct));
        const targetRepsValue = toAttrValue(toNumberString(item.targetReps));

        grid.innerHTML = `
          ${nameField}

          <div class="form-group">
            <label>Level</label>
            <select onchange="app.updatePlanField(${i}, 'level', parseInt(this.value))">
              ${levelOptions}
            </select>
          </div>

          <div class="form-group">
            <label>Target Reps</label>
            <input type="number" min="0" max="30" value="${targetRepsValue}" oninput="app.updatePlanField(${i}, 'targetReps', parseInt(this.value)||0)" />
          </div>

          <div class="form-group">
            <label>Eccentric %</label>
            <input type="number" min="0" max="150" step="5" value="${eccentricValue}" oninput="app.updatePlanField(${i}, 'eccentricPct', parseInt(this.value)||0)" />
          </div>

          ${setsField}
          ${restField}
          ${toggleFields}
        `;
      }

      card.appendChild(grid);
      return card;
    };

    container.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.style.color = "#6c757d";
      empty.style.fontSize = "0.9em";
      empty.style.textAlign = "center";
      empty.style.padding = "10px";
      empty.textContent = "No items yet — add an Exercise or Echo Mode.";
      container.appendChild(empty);
    } else {
      items.forEach((it, idx) => container.appendChild(makeRow(it, idx)));
    }
  }

  syncPlanNameInputTo(value) {
    if (typeof document === "undefined") {
      return;
    }
    const input = document.getElementById("planNameInput");
    if (!input) {
      return;
    }
    input.value = value || "";
  }

  /* =========================
     PLAN — UI ACTIONS
     ========================= */

  addPlanExercise() {
    if (!Array.isArray(this.planItems)) {
      this.planItems = [];
    }
    this.planItems.push(this.makeExerciseRow());
    this.renderPlanUI();
  }

  addPlanEcho() {
    if (!Array.isArray(this.planItems)) {
      this.planItems = [];
    }
    this.planItems.push(this.makeEchoRow());
    this.renderPlanUI();
  }

  buildPlanTimeline(items = this.planItems) {
    return window.PlanRunnerPrototype.buildPlanTimeline.call(this, items);
  }

  describePlanItem(item) {
    return window.PlanRunnerPrototype.describePlanItem.call(this, item);
  }

  formatDuration(ms) {
    return window.PlanRunnerPrototype.formatDuration.call(this, ms);
  }

  getPlanElapsedMs() {
    return window.PlanRunnerPrototype.getPlanElapsedMs.call(this);
  }

  startPlanElapsedTicker() {
    return window.PlanRunnerPrototype.startPlanElapsedTicker.call(this);
  }

  stopPlanElapsedTicker() {
    return window.PlanRunnerPrototype.stopPlanElapsedTicker.call(this);
  }

  updatePlanElapsedDisplay() {
    return window.PlanRunnerPrototype.updatePlanElapsedDisplay.call(this);
  }

  updatePlanControlsState() {
    return window.PlanRunnerPrototype.updatePlanControlsState.call(this);
  }

  togglePlanPause() {
    return window.PlanRunnerPrototype.togglePlanPause.call(this);
  }

  pausePlan() {
    return window.PlanRunnerPrototype.pausePlan.call(this);
  }

  resumePlan(options = {}) {
    return window.PlanRunnerPrototype.resumePlan.call(this, options);
  }

  async skipPlanForward() {
    return window.PlanRunnerPrototype.skipPlanForward.call(this);
  }

  async rewindPlan() {
    return window.PlanRunnerPrototype.rewindPlan.call(this);
  }

  async navigatePlan(delta) {
    return window.PlanRunnerPrototype.navigatePlan.call(this, delta);
  }

  _applyPlanNavigationTarget() {
    return window.PlanRunnerPrototype._applyPlanNavigationTarget.call(this);
  }

  trackPlanPauseMovement(sample) {
    return window.PlanRunnerPrototype.trackPlanPauseMovement.call(this, sample);
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

  handlePlanUnitPreferenceChange() {
    if (!Array.isArray(this.planItems) || this.planItems.length === 0) {
      return;
    }

    const planName = this._loadedPlanName;
    const changed = this.ensurePlanItemsRepresentUnit(this.planItems, this.weightUnit);

    if (!changed) {
      return;
    }

    if (planName) {
      this.savePlanLocally(planName, this.planItems);
      if (this.dropboxManager?.isConnected) {
        this.syncPlanToDropbox(planName, this.planItems, {
          silent: true,
          suppressError: true,
        });
      }
      const friendly = this.getFriendlyUnitLabel();
      this.addLogEntry(
        `Plan "${planName}" converted to ${friendly} to match your preference.`,
        "info",
      );
    }
  }

  startPlan() {
    return window.PlanRunnerPrototype.startPlan.call(this);
  }


// Run the currently selected plan block (exercise or echo)
// Uses the visible UI and calls startProgram()/startEcho() just like pressing the buttons.
  async _runCurrentPlanBlock() {
    return window.PlanRunnerPrototype._runCurrentPlanBlock.call(this);
  }

// Decide next step after a block finishes: next set of same item, or next item.
// Schedules rest and then calls _runCurrentPlanBlock() again.
  _planAdvance(completion) {
    return window.PlanRunnerPrototype._planAdvance.call(this, completion);
  }


// Show a ring countdown, update “up next”, wire Skip/+30s, then call onDone()
  _beginRest(totalSec, onDone, labelText = "Next set", nextHtml = "", nextItemOrName = null) {
    if (Number(totalSec) > 0) {
      this.playRestStartChime();
    }

    return window.PlanRunnerPrototype._beginRest.call(
      this,
      totalSec,
      onDone,
      labelText,
      nextHtml,
      nextItemOrName,
    );
  }

  _startRestTimer(state) {
    return window.PlanRunnerPrototype._startRestTimer.call(this, state);
  }

  _stopRestTimer(state) {
    return window.PlanRunnerPrototype._stopRestTimer.call(this, state);
  }

  _tickRest(state, options = {}) {
    return window.PlanRunnerPrototype._tickRest.call(this, state, options);
  }

  _updateRestUI(state, options = {}) {
    return window.PlanRunnerPrototype._updateRestUI.call(this, state, options);
  }

  _pauseRestCountdown() {
    return window.PlanRunnerPrototype._pauseRestCountdown.call(this);
  }

  _resumeRestCountdown() {
    return window.PlanRunnerPrototype._resumeRestCountdown.call(this);
  }

  _clearRestState(options = {}) {
    return window.PlanRunnerPrototype._clearRestState.call(this, options);
  }

  _planFinish(options = {}) {
    return window.PlanRunnerPrototype._planFinish.call(this, options);
  }



  /* =========================
     PLAN — PERSISTENCE
     ========================= */

  getTodayMidnightUtcMs() {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  getPlanNameCollator() {
    if (!this._planNameCollator && typeof Intl !== "undefined" && typeof Intl.Collator === "function") {
      this._planNameCollator = new Intl.Collator(undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }
    return this._planNameCollator;
  }

  comparePlanNames(a, b) {
    const collator = this.getPlanNameCollator();
    if (collator) {
      const result = collator.compare(a || "", b || "");
      if (result !== 0) {
        return result;
      }
    }
    return (a || "").localeCompare(b || "");
  }

  parsePlanDateFromName(name) {
    if (typeof name !== "string") {
      return null;
    }
    const trimmed = name.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    const dateMs = Date.UTC(year, month - 1, day);
    if (!Number.isFinite(dateMs)) {
      return null;
    }
    const remainder = trimmed.slice(match[0].length).trim();
    return { name: trimmed, dateMs, remainder };
  }

  selectPlanNameForToday(names) {
    if (!Array.isArray(names) || names.length === 0) {
      return null;
    }

    const entries = names
      .map((planName) => {
        const parsed = this.parsePlanDateFromName(planName);
        return parsed ? { name: planName, parsed } : null;
      })
      .filter(Boolean);

    if (!entries.length) {
      const sorted = [...names].sort((a, b) => this.comparePlanNames(a, b));
      return sorted[0] || null;
    }

    const todayMs = this.getTodayMidnightUtcMs();
    const pastOrToday = entries.filter((entry) => entry.parsed.dateMs <= todayMs);
    const pool = pastOrToday.length ? pastOrToday : entries;

    pool.sort((a, b) => {
      if (pastOrToday.length) {
        if (a.parsed.dateMs !== b.parsed.dateMs) {
          return b.parsed.dateMs - a.parsed.dateMs;
        }
      } else if (a.parsed.dateMs !== b.parsed.dateMs) {
        return a.parsed.dateMs - b.parsed.dateMs;
      }
      return this.comparePlanNames(a.name, b.name);
    });

    return pool[0]?.name || null;
  }

  ensurePlanItemSetData(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    if (!item.builderMeta || typeof item.builderMeta !== "object") {
      item.builderMeta = {};
    }
    if (!item.builderMeta.setData || typeof item.builderMeta.setData !== "object") {
      item.builderMeta.setData = {};
    }
    return item.builderMeta.setData;
  }

  ensurePlanItemsRepresentUnit(items, unit) {
    if (!Array.isArray(items) || items.length === 0) {
      return false;
    }

    const normalizedUnit = unit === "lb" ? "lb" : "kg";
    const weightDecimals = this.getLoadDisplayDecimalsForUnit(normalizedUnit);
    const progressionDecimals = this.getProgressionDisplayDecimalsForUnit(normalizedUnit);
    const unitLabel = normalizedUnit === "lb" ? "LBS" : "KG";
    let mutated = false;

    for (const item of items) {
      if (!item || typeof item !== "object" || item.type !== "exercise") {
        continue;
      }

      const perCableKg = Number(item.perCableKg);
      if (Number.isFinite(perCableKg)) {
        const displayValue = this.convertKgToDisplay(perCableKg, normalizedUnit);
        if (Number.isFinite(displayValue)) {
          const formatted = displayValue.toFixed(weightDecimals);
          const setData = this.ensurePlanItemSetData(item);

          if (setData.weight !== formatted) {
            setData.weight = formatted;
            mutated = true;
          }
          if (setData.weightUnit !== unitLabel) {
            setData.weightUnit = unitLabel;
            mutated = true;
          }
        }
      }

      const progressionKg = Number(item.progressionKg);
      let formattedProgression = "";
      if (Number.isFinite(progressionKg)) {
        const progressionDisplay = this.convertKgToDisplay(progressionKg, normalizedUnit);
        if (Number.isFinite(progressionDisplay)) {
          formattedProgression = progressionDisplay.toFixed(progressionDecimals);
        }
      }

      if (item.progressionDisplay !== formattedProgression) {
        item.progressionDisplay = formattedProgression;
        mutated = true;
      }
      if (item.progressionUnit !== unitLabel) {
        item.progressionUnit = unitLabel;
        mutated = true;
      }

      const setData = this.ensurePlanItemSetData(item);
      if (setData.progression !== formattedProgression) {
        setData.progression = formattedProgression;
        mutated = true;
      }
      if (setData.progressionUnit !== unitLabel) {
        setData.progressionUnit = unitLabel;
        mutated = true;
      }
    }

    return mutated;
  }

  savePlanLocally(name, items) {
    if (!name) {
      return false;
    }
    try {
      localStorage.setItem(this.planKey(name), JSON.stringify(items ?? []));
      return true;
    } catch (error) {
      this.addLogEntry(`Failed to save plan "${name}" locally: ${error.message}`, "error");
      return false;
    }
  }

  async syncPlanToDropbox(name, items, options = {}) {
    if (!this.dropboxManager?.isConnected || !name) {
      return;
    }

    const payload = JSON.parse(JSON.stringify(items ?? []));

    try {
      await this.dropboxManager.savePlan(name, payload);
      const remoteNames = new Set(this.getDropboxPlanNames());
      remoteNames.add(name);
      this.setDropboxPlanNames([...remoteNames]);
      if (!options.silent) {
        this.addLogEntry(`Plan "${name}" synced to Dropbox`, "success");
      }
    } catch (error) {
      this.addLogEntry(
        `Failed to sync plan "${name}" to Dropbox: ${error.message}`,
        "error",
      );
      if (!options.suppressError) {
        throw error;
      }
    }
  }

  plansKey() { return "vitruvian.plans.index"; }
  planKey(name) { return `vitruvian.plan.${name}`; }
  dropboxPlansKey() { return "vitruvian.plans.dropboxIndex"; }

  getAllPlanNames() {
    try {
      const raw = localStorage.getItem(this.plansKey());
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  getDropboxPlanNames() {
    try {
      const raw = localStorage.getItem(this.dropboxPlansKey());
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

  setDropboxPlanNames(arr) {
    const names = Array.isArray(arr) ? Array.from(new Set(arr)) : [];
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    try {
      localStorage.setItem(this.dropboxPlansKey(), JSON.stringify(names));
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

    this.addLogEntry(`Stored plan "${name}" from Workout Builder`, 'info');
  }

  setupPlanSelectAutoLoad() {
    if (typeof document === "undefined") {
      return;
    }

    const sel = document.getElementById("planSelect");
    if (!sel || sel.dataset.autoloadAttached === "true") {
      return;
    }

    sel.addEventListener("change", () => {
      if (!sel.value) {
        return;
      }
      this.loadSelectedPlan({ silentIfMissing: true });
    });

    sel.dataset.autoloadAttached = "true";
  }

  populatePlanSelect() {
    const sel = document.getElementById("planSelect");
    if (!sel) return;
    const names = this.getAllPlanNames();
    const previous = sel.value;
    sel.innerHTML = names.length
      ? names
          .map((n) => {
            const safe = escapeHtml(n);
            return `<option value="${safe}">${safe}</option>`;
          })
          .join("")
      : `<option value="">(no saved plans)</option>`;

    if (names.length > 0) {
      let nextValue = "";
      if (previous && names.includes(previous)) {
        nextValue = previous;
      } else if (this._preferredPlanSelection && names.includes(this._preferredPlanSelection)) {
        nextValue = this._preferredPlanSelection;
      } else {
        nextValue = this.selectPlanNameForToday(names) || names[0];
      }
      sel.value = nextValue;
    } else {
      sel.value = "";
    }

    this.setupPlanSelectAutoLoad();

    const activeName = sel.value;
    this._preferredPlanSelection = activeName || null;
    if (activeName) {
      if (activeName !== this._loadedPlanName) {
        this.loadSelectedPlan({ silentIfMissing: true, suppressLog: true });
      }
    } else {
      this._loadedPlanName = null;
      this.syncPlanNameInputTo("");
    }
  }

  refreshPlanSelectNames() {
    this.populatePlanSelect();
  }

  async saveCurrentPlan() {
    const nameInput = document.getElementById("planNameInput");
    const name = (nameInput?.value || "").trim();
    if (!name) { alert("Enter a plan name first."); return; }
    const normalized = this.ensurePlanItemsRepresentUnit(this.planItems, this.weightUnit);
    if (normalized) {
      this.addLogEntry(
        `Normalized plan data to ${this.getFriendlyUnitLabel()} before saving.`,
        "info",
      );
    }
    try {
      const saved = this.savePlanLocally(name, this.planItems);
      if (!saved) {
        alert("Could not save plan locally. See logs for details.");
        return;
      }
      const names = new Set(this.getAllPlanNames());
      names.add(name);
      this.setAllPlanNames([...names]);
      this.refreshPlanSelectNames();
      this.addLogEntry(`Saved plan "${name}" (${this.planItems.length} items)`, "success");
      this._loadedPlanName = name;
      this._preferredPlanSelection = name;
      this.syncPlanNameInputTo(name);
    } catch (e) {
      alert(`Could not save plan: ${e.message}`);
      return;
    }

    if (this.dropboxManager?.isConnected) {
      try {
        await this.syncPlanToDropbox(name, this.planItems);
      } catch (error) {
        alert(`Plan saved locally, but Dropbox sync failed: ${error.message}`);
      }
    }
  }

  async loadSelectedPlan(options = {}) {
    const silentIfMissing = options?.silentIfMissing === true;
    const suppressLog = options?.suppressLog === true;
    const sel = document.getElementById("planSelect");
    const planName = sel?.value;
    if (!sel || !planName) {
      if (!silentIfMissing) {
        alert("No saved plan selected.");
      }
      return;
    }
    try {
      let raw = localStorage.getItem(this.planKey(planName));

      if (!raw && this.dropboxManager.isConnected) {
        await this.syncPlansFromDropbox({ silent: true });
        raw = localStorage.getItem(this.planKey(planName));
      }

      if (!raw) {
        if (!silentIfMissing) {
          alert("Saved plan not found.");
        }
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `Saved plan "${planName}" could not be parsed: ${err.message}`,
        );
      }
      this.planItems = Array.isArray(parsed) ? parsed : [];
      this._loadedPlanName = planName;
      this._preferredPlanSelection = planName;
      this.syncPlanNameInputTo(planName);

      const inferredUnit = this.inferPlanWeightUnit(this.planItems);
      const normalizedPlanUnit =
        inferredUnit === "lb" || inferredUnit === "kg" ? inferredUnit : null;

      if (normalizedPlanUnit && normalizedPlanUnit !== this.weightUnit) {
        this.setWeightUnit(normalizedPlanUnit, { force: true });
        if (!suppressLog) {
          const friendly = this.getFriendlyUnitLabel(normalizedPlanUnit);
          this.addLogEntry(
            `Switched to ${friendly} to match plan "${planName}".`,
            "info",
          );
        }
      }

      const normalized = this.ensurePlanItemsRepresentUnit(
        this.planItems,
        this.weightUnit,
      );
      if (normalized) {
        this.savePlanLocally(planName, this.planItems);
        if (this.dropboxManager?.isConnected) {
          this.syncPlanToDropbox(planName, this.planItems, {
            silent: true,
            suppressError: true,
          });
        }
        this.addLogEntry(
          `Normalized plan units to ${this.getFriendlyUnitLabel()}.`,
          "info",
        );
      }
      this.renderPlanUI();
      if (!suppressLog) {
        this.addLogEntry(`Loaded plan "${planName}"`, "success");
      }
    } catch (e) {
      if (!silentIfMissing) {
        alert(`Could not load plan: ${e.message}`);
      }
    }
  }

  async deleteSelectedPlan() {
    const sel = document.getElementById("planSelect");
    if (!sel || !sel.value) { alert("No saved plan selected."); return; }
    const name = sel.value;

    if (typeof window !== "undefined" && !window.confirm(`Delete plan "${name}"? This action cannot be undone.`)) {
      this.addLogEntry(`Plan deletion for "${name}" cancelled by user`, "info");
      return;
    }

    const currentNames = this.getAllPlanNames();
    const remaining = currentNames.filter((n) => n !== name);

    if (this.dropboxManager?.isConnected) {
      try {
        await this.dropboxManager.deletePlan(name);
        const remainingRemote = new Set(this.getDropboxPlanNames());
        remainingRemote.delete(name);
        this.setDropboxPlanNames([...remainingRemote]);
        this.addLogEntry(`Deleted plan "${name}" from Dropbox`, "info");
      } catch (error) {
        this.addLogEntry(
          `Failed to delete plan "${name}" from Dropbox: ${error.message}`,
          "error",
        );
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

}

if (typeof window !== "undefined") {
  window.VitruvianApp = VitruvianApp;
}

const shouldAutoInit =
  typeof window === "undefined" ||
  window.__VITRUVIAN_DISABLE_AUTO_INIT !== true;

let app = null;
if (shouldAutoInit) {
  app = new VitruvianApp();
  if (typeof window !== "undefined") {
    window.app = app;
  }

  app.addLogEntry("Vitruvian Web Control Ready", "success");
  app.addLogEntry('Click "Connect to Device" to begin', "info");
  app.addLogEntry("", "info");
  app.addLogEntry("Requirements:", "info");
  app.addLogEntry("- Chrome, Edge, or Opera browser", "info");
  app.addLogEntry("- HTTPS connection (or localhost)", "info");
  app.addLogEntry("- Bluetooth enabled on your device", "info");
}
