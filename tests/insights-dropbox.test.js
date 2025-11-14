import test from 'node:test';
import assert from 'node:assert/strict';
import { setupVitruvianTestEnvironment } from './helpers/vitruvian-test-utils.js';

const INSIGHTS_MODULE_URL = new URL('../js/insights.js', import.meta.url);

const createModuleUrl = (baseUrl) => {
  const url = new URL(baseUrl);
  url.searchParams.set('cacheBust', Date.now().toString());
  return url;
};

test('syncInsightsFromDropbox persists Dropbox workouts in insights view', async () => {
  const env = setupVitruvianTestEnvironment();
  try {
    const moduleUrl = createModuleUrl(INSIGHTS_MODULE_URL);
    const { initializeInsights, syncInsightsFromDropbox, setInsightsDropboxStatus } = await import(
      moduleUrl.href
    );

    const workouts = [
      {
        id: 'wk-1',
        label: 'Back Squat',
        timestamp: '2024-05-01T10:00:00.000Z',
        totalLoadKg: 1000,
        reps: 5,
        weightKg: 140
      },
      {
        id: 'wk-2',
        label: 'Flat Bench Press',
        timestamp: '2024-05-03T11:30:00.000Z',
        totalLoadKg: 720,
        reps: 6,
        weightKg: 95
      }
    ];

    const dropboxManager = {
      isConnected: true,
      async loadWorkouts() {
        return workouts.map((entry) => ({ ...entry }));
      }
    };

    setInsightsDropboxStatus(true);
    initializeInsights();

    await syncInsightsFromDropbox(dropboxManager, { maxEntries: Infinity });

    const storedRaw = env.window.localStorage.getItem('vitruvian.workoutHistory');
    assert.ok(storedRaw, 'Dropbox workouts should persist to localStorage');
    const stored = JSON.parse(storedRaw);
    assert.equal(stored.length, 2, 'local cache should mirror Dropbox workout count');
    assert.equal(stored[0].label, 'Back Squat');
    assert.ok(/T/.test(stored[0].timestamp), 'timestamps should be serialised');

    const sessionsSummary = env.window.document.getElementById('insightsTotalSessions');
    assert.match(
      sessionsSummary.textContent,
      /2 exercises logged/i,
      'insights summary should reflect Dropbox workouts'
    );

    const totalVolume = env.window.document.getElementById('insightsTotalVolume').textContent;
    assert.notEqual(totalVolume.trim(), '—', 'total volume should be populated');
  } finally {
    env.restore();
  }
});
