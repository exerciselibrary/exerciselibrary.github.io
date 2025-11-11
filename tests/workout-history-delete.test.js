import test from "node:test";
import assert from "node:assert/strict";
import { setupVitruvianTestEnvironment } from "./helpers/vitruvian-test-utils.js";

const APP_MODULE_URL = new URL("../workout-time/app.js", import.meta.url);

function createSampleWorkout(app) {
  const startTime = new Date("2024-02-01T10:00:00.000Z");
  const endTime = new Date("2024-02-01T10:05:00.000Z");
  return app.normalizeWorkout({
    setName: "Back Squat",
    mode: "Just Lift",
    reps: 5,
    weightKg: 120,
    timestamp: endTime,
    startTime,
    endTime,
    movementData: [
      {
        timestamp: startTime,
        loadA: 50,
        loadB: 55,
        posA: 120,
        posB: 118,
      },
    ],
  });
}

test("deleteWorkoutHistoryEntry removes the local entry and Dropbox backup", async () => {
  const env = setupVitruvianTestEnvironment({ dropbox: { isConnected: true } });
  try {
    const moduleUrl = new URL(APP_MODULE_URL);
    moduleUrl.searchParams.set("test", `history-delete-${Date.now()}`);
    await import(moduleUrl.href);

    const VitruvianApp = env.window.VitruvianApp;
    assert.ok(typeof VitruvianApp === "function");

    const app = new VitruvianApp();
    app.dropboxManager.isConnected = true;

    const workout = createSampleWorkout(app);
    app.workoutHistory = [workout];
    app.selectedHistoryIndex = 0;
    app.selectedHistoryKey = app.getWorkoutHistoryKey(workout);
    app.updateHistoryDisplay();

    const result = await app.deleteWorkoutHistoryEntry(0, { skipConfirm: true });
    assert.equal(result, true);
    assert.equal(app.workoutHistory.length, 0);
    assert.equal(app.selectedHistoryIndex, null);
    assert.equal(app.selectedHistoryKey, null);
    assert.equal(app.dropboxManager.deleteWorkoutCalls.length, 1);
    assert.strictEqual(app.dropboxManager.deleteWorkoutCalls[0], workout);
    assert.equal(app.chartManager.clearCalled, 1);
    assert.equal(app.chartManager.clearEventMarkersCalled, 1);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.restore();
  }
});

test("deleteWorkoutHistoryEntry continues when Dropbox deletion fails", async () => {
  const env = setupVitruvianTestEnvironment({ dropbox: { isConnected: true } });
  try {
    const moduleUrl = new URL(APP_MODULE_URL);
    moduleUrl.searchParams.set("test", `history-delete-fail-${Date.now()}`);
    await import(moduleUrl.href);

    const VitruvianApp = env.window.VitruvianApp;
    const app = new VitruvianApp();
    app.dropboxManager.isConnected = true;
    app.dropboxManager.onDeleteWorkout = () => {
      throw new Error("network error");
    };

    const workout = createSampleWorkout(app);
    app.workoutHistory = [workout];
    app.updateHistoryDisplay();

    const result = await app.deleteWorkoutHistoryEntry(0, { skipConfirm: true });
    assert.equal(result, true);
    assert.equal(app.workoutHistory.length, 0);
    assert.equal(app.dropboxManager.deleteWorkoutCalls.length, 1);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.restore();
  }
});

test("requestDeleteWorkout honours the confirmation prompt", async () => {
  const env = setupVitruvianTestEnvironment();
  try {
    env.window.confirm = () => false;

    const moduleUrl = new URL(APP_MODULE_URL);
    moduleUrl.searchParams.set("test", `history-delete-cancel-${Date.now()}`);
    await import(moduleUrl.href);

    const VitruvianApp = env.window.VitruvianApp;
    const app = new VitruvianApp();

    const workout = createSampleWorkout(app);
    app.workoutHistory = [workout];
    app.updateHistoryDisplay();

    const result = await app.requestDeleteWorkout(0);
    assert.equal(result, false);
    assert.equal(app.workoutHistory.length, 1);
    assert.equal(app.dropboxManager.deleteWorkoutCalls.length, 0);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.restore();
  }
});
