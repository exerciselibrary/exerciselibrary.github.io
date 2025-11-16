import test from "node:test";
import assert from "node:assert/strict";
import { setupVitruvianTestEnvironment } from "./helpers/vitruvian-test-utils.js";

const APP_MODULE_URL = new URL("../workout-time/app.js", import.meta.url);

const PROGRAM_MODE = {
  OLD_SCHOOL: 0,
  PUMP: 1,
  TUT: 2,
  TUT_BEAST: 3,
  ECCENTRIC_ONLY: 4,
};

const PROGRAM_MODE_NAMES = {
  [PROGRAM_MODE.OLD_SCHOOL]: "Old School",
  [PROGRAM_MODE.PUMP]: "Pump",
  [PROGRAM_MODE.TUT]: "TUT",
  [PROGRAM_MODE.TUT_BEAST]: "TUT Beast",
  [PROGRAM_MODE.ECCENTRIC_ONLY]: "Eccentric Only",
};

const ECHO_LEVEL = {
  HARD: 0,
  HARDER: 1,
  HARDEST: 2,
  EPIC: 3,
};

const ECHO_LEVEL_NAMES = {
  [ECHO_LEVEL.HARD]: "Hard",
  [ECHO_LEVEL.HARDER]: "Harder",
  [ECHO_LEVEL.HARDEST]: "Hardest",
  [ECHO_LEVEL.EPIC]: "Epic",
};

function installModeGlobals(targetWindow) {
  const previous = {
    ProgramMode: globalThis.ProgramMode,
    ProgramModeNames: globalThis.ProgramModeNames,
    EchoLevel: globalThis.EchoLevel,
    EchoLevelNames: globalThis.EchoLevelNames,
  };

  globalThis.ProgramMode = PROGRAM_MODE;
  globalThis.ProgramModeNames = PROGRAM_MODE_NAMES;
  globalThis.EchoLevel = ECHO_LEVEL;
  globalThis.EchoLevelNames = ECHO_LEVEL_NAMES;

  if (targetWindow) {
    targetWindow.ProgramMode = PROGRAM_MODE;
    targetWindow.ProgramModeNames = PROGRAM_MODE_NAMES;
    targetWindow.EchoLevel = ECHO_LEVEL;
    targetWindow.EchoLevelNames = ECHO_LEVEL_NAMES;
  }

  return previous;
}

function restoreModeGlobals(previous) {
  const assignments = [
    ["ProgramMode", previous.ProgramMode],
    ["ProgramModeNames", previous.ProgramModeNames],
    ["EchoLevel", previous.EchoLevel],
    ["EchoLevelNames", previous.EchoLevelNames],
  ];

  for (const [key, priorValue] of assignments) {
    if (priorValue === undefined) {
      delete globalThis[key];
    } else {
      globalThis[key] = priorValue;
    }
  }
}

async function loadVitruvianApp(env, label) {
  const moduleUrl = new URL(APP_MODULE_URL);
  moduleUrl.searchParams.set("test", `${label}-${Date.now()}`);
  await import(moduleUrl.href);

  const { VitruvianApp } = env.window;
  assert.equal(
    typeof VitruvianApp,
    "function",
    "VitruvianApp should be defined on window",
  );
  return VitruvianApp;
}

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 0));

test("device listeners register once and remain single", async () => {
  const env = setupVitruvianTestEnvironment();
  let previousModeGlobals = null;
  try {
    previousModeGlobals = installModeGlobals(env.window);
    const VitruvianApp = await loadVitruvianApp(env, "device-listeners");
    const app = new VitruvianApp();
    const { document } = env.window;
    await flushTimers();

    assert.equal(
      app.device.monitorListeners.length,
      1,
      "monitor listener should register during construction",
    );
    assert.equal(
      app.device.repListeners.length,
      1,
      "rep listener should register during construction",
    );

    app.registerDeviceListeners();
    assert.equal(
      app.device.monitorListeners.length,
      1,
      "registerDeviceListeners should be idempotent for monitor listener",
    );
    assert.equal(
      app.device.repListeners.length,
      1,
      "registerDeviceListeners should be idempotent for rep listener",
    );

    // Configure program inputs with valid values.
    document.getElementById("mode").value = "0";
    document.getElementById("weight").value = "12";
    document.getElementById("reps").value = "8";
    document.getElementById("justLiftCheckbox").checked = false;
    document.getElementById("progression").value = "0";

    const initialMonitorCount = app.device.monitorListeners.length;
    const initialRepCount = app.device.repListeners.length;

    await app.startProgram();
    await flushTimers();
    assert.equal(
      app.device.monitorListeners.length,
      initialMonitorCount,
      "starting a program should not add a monitor listener",
    );
    assert.equal(
      app.device.repListeners.length,
      initialRepCount,
      "starting a program should not add a rep listener",
    );

    await app.startProgram();
    await flushTimers();
    assert.equal(
      app.device.monitorListeners.length,
      initialMonitorCount,
      "restarting a program should not add monitor listeners",
    );
    assert.equal(
      app.device.repListeners.length,
      initialRepCount,
      "restarting a program should not add rep listeners",
    );

    // Configure echo inputs and verify the same behavior.
    document.getElementById("echoLevel").value = "1";
    document.getElementById("eccentric").value = "100";
    document.getElementById("targetReps").value = "4";
    document.getElementById("echoJustLiftCheckbox").checked = false;

    await app.startEcho();
    await flushTimers();
    assert.equal(
      app.device.monitorListeners.length,
      initialMonitorCount,
      "starting Echo should not add monitor listeners",
    );
    assert.equal(
      app.device.repListeners.length,
      initialRepCount,
      "starting Echo should not add rep listeners",
    );

    await app.startEcho();
    await flushTimers();
    assert.equal(
      app.device.monitorListeners.length,
      initialMonitorCount,
      "restarting Echo should not add monitor listeners",
    );
    assert.equal(
      app.device.repListeners.length,
      initialRepCount,
      "restarting Echo should not add rep listeners",
    );
  } finally {
    await flushTimers();
    if (previousModeGlobals) {
      restoreModeGlobals(previousModeGlobals);
    }
    env.restore();
  }
});
