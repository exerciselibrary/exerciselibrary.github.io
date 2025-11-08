import test from "node:test";
import assert from "node:assert/strict";
const APP_MODULE_URL = new URL("../workout-time/app.js", import.meta.url);

function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    },
  };
}

function createStubElement() {
  return {
    style: {},
    classList: createClassList(),
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    focus() {},
    blur() {},
    click() {},
    innerHTML: "",
    textContent: "",
    value: "",
  };
}

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
    _store: store,
  };
}

function createWindowStub() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createStubElement());
      }
      return elements.get(id);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return createStubElement();
    },
    body: createStubElement(),
    documentElement: createStubElement(),
    hidden: false,
  };
  document.body.classList = createClassList();
  document.documentElement.classList = createClassList();

  const localStorage = createLocalStorage();

  const window = {
    document,
    localStorage,
    WeightUtils: {
      LB_PER_KG: 2.2046226218488,
      KG_PER_LB: 0.45359237,
      convertKgToUnit(kg, unit = "kg") {
        return unit === "lb" ? kg * 2.2046226218488 : kg;
      },
      convertUnitToKg(value, unit = "kg") {
        return unit === "lb" ? value * 0.45359237 : value;
      },
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      };
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    requestAnimationFrame(cb) {
      return setTimeout(cb, 0);
    },
    cancelAnimationFrame(id) {
      clearTimeout(id);
    },
    alert() {},
    confirm() {
      return true;
    },
    history: {
      replaceState() {},
    },
    location: {
      origin: "http://localhost",
      pathname: "/workout-time/index.html",
      search: "",
    },
    navigator: {
      bluetooth: null,
      wakeLock: null,
    },
    parent: null,
    crypto: {
      getRandomValues(array) {
        if (ArrayBuffer.isView(array)) {
          for (let i = 0; i < array.length; i += 1) {
            array[i] = 0;
          }
        }
        return array;
      },
    },
    __VITRUVIAN_DISABLE_AUTO_INIT: true,
  };

  window.parent = window;
  document.defaultView = window;
  const xlsxStub = createSheetJsStub();
  window.XLSX = xlsxStub;

  return window;
}

function createSheetJsStub() {
  const encodeCell = ({ r, c }) => {
    const columnLabel = (() => {
      let label = "";
      let current = c + 1;
      while (current > 0) {
        current -= 1;
        label = String.fromCharCode(65 + (current % 26)) + label;
        current = Math.floor(current / 26);
      }
      return label;
    })();
    return `${columnLabel}${r + 1}`;
  };

  const utils = {
    aoa_to_sheet(rows) {
      const sheet = {};
      rows.forEach((row, r) => {
        if (!Array.isArray(row)) {
          return;
        }
        row.forEach((value, c) => {
          const ref = encodeCell({ r, c });
          sheet[ref] = { v: value };
        });
      });
      sheet["!ref"] = rows.length > 0 ? "A1" : undefined;
      return sheet;
    },
    book_new() {
      return { SheetNames: [], Sheets: {} };
    },
    book_append_sheet(workbook, worksheet, name) {
      workbook.SheetNames.push(name);
      workbook.Sheets[name] = worksheet;
    },
    encode_cell: encodeCell,
  };

  return {
    utils,
    write() {
      return new ArrayBuffer(0);
    },
  };
}

function createDropboxManagerStub() {
  return class DropboxManager {
    constructor() {
      this.isConnected = false;
      this.onLog = null;
      this.onConnectionChange = null;
      this.savePersonalRecordsCalls = 0;
    }

    init() {
      return Promise.resolve();
    }

    connect() {
      this.isConnected = true;
      this.onConnectionChange?.(true);
      return Promise.resolve();
    }

    disconnect() {
      this.isConnected = false;
      this.onConnectionChange?.(false);
    }

    loadWorkouts() {
      return Promise.resolve([]);
    }

    saveWorkout() {
      return Promise.resolve();
    }

    loadPlansIndex() {
      return Promise.resolve({ plans: {} });
    }

    savePlansIndex() {
      return Promise.resolve();
    }

    deletePlan() {
      return Promise.resolve();
    }

    loadPersonalRecords() {
      return Promise.resolve({ records: [] });
    }

    savePersonalRecords(payload) {
      this.savePersonalRecordsCalls += 1;
      return Promise.resolve(payload);
    }

    exportExcelWorkbook() {
      return Promise.resolve();
    }
  };
}

function createChartManagerStub() {
  return class ChartManager {
    constructor() {
      this.loadHistory = [];
    }

    init() {
      return true;
    }

    setLoadUnit() {}

    addData() {}

    clearEventMarkers() {}

    setTimeRange() {}

    exportCSV() {}

    viewWorkout() {}
  };
}

function createDeviceStub() {
  return class VitruvianDevice {
    constructor() {
      this.isConnected = false;
      this.monitorListeners = [];
      this.repListeners = [];
    }

    stopPropertyPolling() {}

    stopMonitorPolling() {}

    connect() {
      this.isConnected = true;
      return Promise.resolve();
    }

    sendInit() {
      return Promise.resolve();
    }

    disconnect() {
      this.isConnected = false;
      return Promise.resolve();
    }

    sendStopCommand() {
      return Promise.resolve();
    }

    updateProgramTargetReps() {
      return Promise.resolve();
    }

    updateProgramWeights() {
      return Promise.resolve();
    }

    startProgram() {
      return Promise.resolve();
    }

    startEcho() {
      return Promise.resolve();
    }

    addMonitorListener(listener) {
      this.monitorListeners.push(listener);
    }

    addRepListener(listener) {
      this.repListeners.push(listener);
    }
  };
}

function setupTestEnvironment() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    localStorage: globalThis.localStorage,
    alert: globalThis.alert,
    confirm: globalThis.confirm,
    performance: globalThis.performance,
    ChartManager: globalThis.ChartManager,
    VitruvianDevice: globalThis.VitruvianDevice,
    DropboxManager: globalThis.DropboxManager,
    PlanRunnerPrototype: globalThis.PlanRunnerPrototype,
  };

  const window = createWindowStub();
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator,
    configurable: true,
    writable: false,
  });
  globalThis.localStorage = window.localStorage;
  globalThis.alert = window.alert;
  globalThis.confirm = window.confirm;
  globalThis.performance = { now: () => Date.now() };
  globalThis.ChartManager = createChartManagerStub();
  globalThis.VitruvianDevice = createDeviceStub();
  globalThis.DropboxManager = createDropboxManagerStub();
  const noop = () => {};
  const planRunnerPrototype = {
    buildPlanTimeline: noop,
    describePlanItem: noop,
    formatDuration: () => "",
    getPlanElapsedMs: () => 0,
    startPlanElapsedTicker: noop,
    stopPlanElapsedTicker: noop,
    updatePlanElapsedDisplay: noop,
    updatePlanControlsState: noop,
    togglePlanPause: noop,
    pausePlan: noop,
    resumePlan: noop,
    skipPlanForward: noop,
    rewindPlan: noop,
    navigatePlan: noop,
    _applyPlanNavigationTarget: noop,
    trackPlanPauseMovement: noop,
    startPlan: noop,
    _runCurrentPlanBlock: noop,
    _planAdvance: noop,
    _beginRest: noop,
    _startRestTimer: () => ({ cancel: noop }),
    _stopRestTimer: noop,
    _tickRest: noop,
    _updateRestUI: noop,
    _pauseRestCountdown: noop,
    _resumeRestCountdown: noop,
    _clearRestState: noop,
    _planFinish: noop,
  };
  window.PlanRunnerPrototype = planRunnerPrototype;
  globalThis.PlanRunnerPrototype = planRunnerPrototype;

  return {
    window,
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      if (previous.navigator === undefined) {
        delete globalThis.navigator;
      } else {
        Object.defineProperty(globalThis, "navigator", {
          value: previous.navigator,
          configurable: true,
          writable: false,
        });
      }
      globalThis.localStorage = previous.localStorage;
      globalThis.alert = previous.alert;
      globalThis.confirm = previous.confirm;
      globalThis.performance = previous.performance;
      if (previous.ChartManager === undefined) {
        delete globalThis.ChartManager;
      } else {
        globalThis.ChartManager = previous.ChartManager;
      }
      if (previous.VitruvianDevice === undefined) {
        delete globalThis.VitruvianDevice;
      } else {
        globalThis.VitruvianDevice = previous.VitruvianDevice;
      }
      if (previous.DropboxManager === undefined) {
        delete globalThis.DropboxManager;
      } else {
        globalThis.DropboxManager = previous.DropboxManager;
      }
      if (previous.PlanRunnerPrototype === undefined) {
        delete globalThis.PlanRunnerPrototype;
      } else {
        globalThis.PlanRunnerPrototype = previous.PlanRunnerPrototype;
      }
    },
  };
}

test("personal records persist locally when Dropbox is disconnected", async () => {
  const env = setupTestEnvironment();
  try {
    const moduleUrl = new URL(APP_MODULE_URL);
    moduleUrl.searchParams.set("test", Date.now().toString());
    await import(moduleUrl.href);

    const VitruvianApp = env.window.VitruvianApp;
    assert.ok(typeof VitruvianApp === "function", "VitruvianApp should be available on window");

    const app = new VitruvianApp();

    const identity = { key: "set:squat", label: "Back Squat" };
    const recordTimestamp = "2024-03-01T10:00:00.000Z";
    app.applyPersonalRecordCandidate(identity, 100, recordTimestamp, { reason: "test" });

    const storedRaw = env.window.localStorage.getItem("vitruvian.personalRecords");
    assert.ok(storedRaw, "personal records cache should be written to localStorage");

    const stored = JSON.parse(storedRaw);
    assert.ok(stored["set:squat"], "personal record entry should exist");
    assert.equal(stored["set:squat"].weightKg, 100);
    assert.equal(stored["set:squat"].timestamp, recordTimestamp);

    assert.equal(
      app.dropboxManager.savePersonalRecordsCalls,
      0,
      "Dropbox upload should not run when disconnected",
    );
    assert.equal(
      app._pendingPersonalRecordsDropboxSync,
      true,
      "sync flag should stay pending for future connections",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  } catch (error) {
    console.error("personal-records test failure", error);
    throw error;
  } finally {
    env.restore();
  }
});
