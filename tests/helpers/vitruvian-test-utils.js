export function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    },
  };
}

export function createStubElement() {
  const element = {
    style: {},
    classList: createClassList(),
    dataset: {},
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) {
      this.children.push(child);
      this.scrollHeight = this.children.length;
      if (child && typeof child === "object") {
        child.parentNode = this;
      }
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index !== -1) {
        this.children.splice(index, 1);
        this.scrollHeight = this.children.length;
      }
      if (child && typeof child === "object") {
        child.parentNode = null;
      }
      return child;
    },
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

  Object.defineProperty(element, "firstChild", {
    get() {
      return this.children.length > 0 ? this.children[0] : null;
    },
  });

  Object.defineProperty(element, "childNodes", {
    get() {
      return this.children;
    },
  });

  return element;
}

export function createLocalStorage() {
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

export function createSheetJsStub() {
  const encodeCell = ({ r, c }) => {
    let label = "";
    let current = c + 1;
    while (current > 0) {
      current -= 1;
      label = String.fromCharCode(65 + (current % 26)) + label;
      current = Math.floor(current / 26);
    }
    return `${label}${r + 1}`;
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

export function createWindowStub() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const element = createStubElement();
        element.id = id;
        element.style = {};
        elements.set(id, element);
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
    performance: { now: () => Date.now() },
  };

  window.parent = window;
  document.defaultView = window;

  const xlsxStub = createSheetJsStub();
  window.XLSX = xlsxStub;

  return window;
}

export function createDropboxManagerStub(options = {}) {
  return class DropboxManager {
    constructor() {
      this.isConnected = options.isConnected ?? false;
      this.onLog = null;
      this.onConnectionChange = null;
      this.account = null;
      this.savePersonalRecordsCalls = 0;
      this.deleteWorkoutCalls = [];
      this.deleteWorkoutShouldSucceed =
        options.deleteWorkoutShouldSucceed ?? true;
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

    async deleteWorkout(workout) {
      this.deleteWorkoutCalls.push(workout);
      if (typeof this.onDeleteWorkout === "function") {
        return await this.onDeleteWorkout(workout);
      }
      if (typeof options.deleteWorkoutImplementation === "function") {
        return await options.deleteWorkoutImplementation.call(this, workout);
      }
      return Boolean(this.deleteWorkoutShouldSucceed);
    }
  };
}

export function createChartManagerStub() {
  return class ChartManager {
    constructor() {
      this.loadHistory = [];
      this.clearCalled = 0;
      this.clearEventMarkersCalled = 0;
    }

    init() {
      return true;
    }

    resize() {}

    setLoadUnit() {}

    addData() {}

    setTimeRange() {}

    exportCSV() {}

    viewWorkout() {}

    setEventMarkers() {}

    clearEventMarkers() {
      this.clearEventMarkersCalled += 1;
    }

    clear() {
      this.clearCalled += 1;
    }
  };
}

export function createDeviceStub() {
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

export function createPlanRunnerPrototype() {
  const noop = () => {};
  return {
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
}

export function setupVitruvianTestEnvironment(options = {}) {
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

  const dropboxStubClass =
    options.dropbox?.class ?? createDropboxManagerStub(options.dropbox ?? {});
  const chartStubClass =
    options.chart?.class ?? createChartManagerStub(options.chart ?? {});
  const deviceStubClass =
    options.device?.class ?? createDeviceStub(options.device ?? {});

  globalThis.ChartManager = chartStubClass;
  globalThis.VitruvianDevice = deviceStubClass;
  globalThis.DropboxManager = dropboxStubClass;

  const planRunnerPrototype = createPlanRunnerPrototype();
  window.PlanRunnerPrototype = planRunnerPrototype;
  globalThis.PlanRunnerPrototype = planRunnerPrototype;

  return {
    window,
    restore() {
      if (previous.window === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previous.window;
      }

      if (previous.document === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = previous.document;
      }

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
