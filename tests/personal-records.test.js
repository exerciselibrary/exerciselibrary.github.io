import test from "node:test";
import assert from "node:assert/strict";
import { setupVitruvianTestEnvironment } from "./helpers/vitruvian-test-utils.js";

const APP_MODULE_URL = new URL("../workout-time/app.js", import.meta.url);

test("personal records persist locally when Dropbox is disconnected", async () => {
  const env = setupVitruvianTestEnvironment();
  try {
    const moduleUrl = new URL(APP_MODULE_URL);
    moduleUrl.searchParams.set("test", `personal-records-${Date.now()}`);
    await import(moduleUrl.href);

    const VitruvianApp = env.window.VitruvianApp;
    assert.ok(
      typeof VitruvianApp === "function",
      "VitruvianApp should be available on window",
    );

    const app = new VitruvianApp();

    const identity = { key: "set:squat", label: "Back Squat" };
    const recordTimestamp = "2024-03-01T10:00:00.000Z";
    app.applyPersonalRecordCandidate(identity, 100, recordTimestamp, {
      reason: "test",
    });

    const storedRaw = env.window.localStorage.getItem(
      "vitruvian.personalRecords",
    );
    assert.ok(
      storedRaw,
      "personal records cache should be written to localStorage",
    );

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
  } finally {
    env.restore();
  }
});

test("personal records ignore idle baseline load until a rep is logged", async () => {
  const env = setupVitruvianTestEnvironment();
  try {
    const moduleUrl = new URL(APP_MODULE_URL);
    moduleUrl.searchParams.set(
      "test",
      `personal-records-idle-load-${Date.now()}`,
    );
    await import(moduleUrl.href);

    const app = new env.window.VitruvianApp();
    const identityKey = "exercise:42";
    app.currentWorkout = {
      identityKey,
      identityLabel: "Test Move",
      priorBestTotalLoadKg: 0,
      currentPersonalBestKg: 0,
      livePeakTotalLoadKg: 0,
      celebratedPersonalBestKg: 0,
      hasNewPersonalBest: false,
    };

    // Baseline machine tension (≈8.8 lb) should not register as a PR before reps start.
    app.updateLiveStats({
      timestamp: new Date(),
      loadA: 4,
      loadB: 0,
      posA: 0,
      posB: 0,
    });

    assert.equal(
      app.currentWorkout.currentPersonalBestKg,
      0,
      "idle load should not update personal best before reps",
    );
    assert.equal(
      app._pendingPersonalRecordCandidate,
      null,
      "no PR candidate should be tracked before reps",
    );

    // Once a rep has begun (startTime set), real peaks can update PR tracking.
    app.currentWorkout.startTime = new Date();
    app.updateLiveStats({
      timestamp: new Date(),
      loadA: 12,
      loadB: 0,
      posA: 40,
      posB: 40,
    });

    assert.equal(
      app.currentWorkout.currentPersonalBestKg,
      12,
      "personal best should update after reps begin",
    );
    assert.equal(
      app._pendingPersonalRecordCandidate?.identityKey,
      identityKey,
      "PR candidate should map to the active exercise once reps begin",
    );
  } finally {
    env.restore();
  }
});

test("personal records rely on stored entries instead of workout history", async () => {
  const env = setupVitruvianTestEnvironment();
  try {
    const moduleUrl = new URL(APP_MODULE_URL);
    moduleUrl.searchParams.set(
      "test",
      `personal-records-source-${Date.now()}`,
    );
    await import(moduleUrl.href);

    const app = new env.window.VitruvianApp();
    const identityKey = "exercise:1";
    const identity = { key: identityKey, label: "Incline Press" };

    // Seed a personal record that should remain the source of truth.
    app.personalRecords = {
      [identityKey]: {
        key: identityKey,
        label: identity.label,
        weightKg: 20,
        timestamp: "2024-01-01T10:00:00.000Z",
      },
    };

    const buildWorkout = (weightKg, timestamp) =>
      app.normalizeWorkout({
        exerciseIdNew: 1,
        setName: identity.label,
        movementData: [
          {
            timestamp: new Date(timestamp),
            loadA: weightKg,
            loadB: weightKg,
            posA: 0,
            posB: 0,
          },
          {
            timestamp: new Date(new Date(timestamp).getTime() + 500),
            loadA: weightKg,
            loadB: weightKg,
            posA: 60,
            posB: 60,
          },
        ],
        endTime: new Date(timestamp),
      });

    const historicalBest = buildWorkout(25, "2024-02-01T12:00:00.000Z");
    app.workoutHistory.unshift(historicalBest);

    const currentWorkout = buildWorkout(19, "2024-03-01T12:00:00.000Z");
    const stored = app.addToWorkoutHistory(currentWorkout);

    const prInfo = app.displayTotalLoadPR(stored);
    assert.equal(prInfo.status, "existing");
    assert.equal(
      prInfo.previousBestKg,
      20,
      "previous best should come from the stored personal record",
    );

    const updated = app.applyPersonalRecordCandidate(
      identity,
      app.calculateTotalLoadPeakKg(currentWorkout),
      "2024-03-01T12:00:01.000Z",
      { reason: "test", excludeWorkout: stored },
    );

    assert.equal(
      updated,
      false,
      "lower-weight entries should not overwrite stored personal records",
    );
    assert.equal(app.getPersonalRecord(identityKey).weightKg, 20);

    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    env.restore();
  }
});
