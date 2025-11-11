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
