import * as Device from './device.js';
import * as Protocol from './protocol.js';
import { createPlanRunner } from './plan-runner.js';
import { createStore } from './store.js';
import * as Storage from './storage.js';
import * as UI from './ui/index.js';
import { PROGRAM_DEFAULT, ECHO_DEFAULT } from './modes.js';

const settings = Storage.loadSettings();
const savedPlanSets = Storage.loadPlans();
const savedHistory = Storage.loadHistory();

const store = createStore({
  unit: settings.unit || 'kg',
  connected: false,
  deviceName: null,
  planStatus: 'idle',
  plan: { name: 'Untitled Plan', sets: [...savedPlanSets] },
  live: { left: 0, right: 0, total: 0 },
  config: { stopAtTop: settings.stopAtTop ?? true },
  history: [...savedHistory].reverse(),
  program: { mode: PROGRAM_DEFAULT, weight: 10, progressionKg: 0, reps: 10 },
  echo: { level: ECHO_DEFAULT, weight: 10, durationSec: 60 },
  backupStatus: 'Not connected',
});

const runner = createPlanRunner({
  now: () => performance.now(),
  onTick: (state) => UI.live.render(store, state),
  onSetChange: (state) => UI.plan.progress(store, state),
  onComplete: (state) => handlePlanComplete(state),
});

async function start() {
  UI.mount(store, {
    onConnect,
    onDisconnect,
    onStartProgram,
    onStartEcho,
    onStartPlan,
    onStopPlan: onStop,
    onAddPlanSet,
    onRemovePlanSet,
    onUnitChange,
    onToggleStopAtTop,
    onSyncDropbox,
    onExportDropbox,
  });
}

async function onConnect() {
  try {
    const connection = await Device.connect();
    store.patch({
      connected: true,
      deviceName: connection?.name || 'Vitruvian',
    });
    Device.onTelemetry((left, right, total) => {
      const liveSample = { left, right, total };
      store.patch({ live: liveSample });
      UI.live.updateGauge(store, liveSample);
    });
  } catch (error) {
    console.error('Failed to connect', error);
  }
}

function onDisconnect() {
  Device.disconnect();
  store.patch({ connected: false, deviceName: null });
}

async function onStartProgram(options) {
  store.patch({ program: options });
  await Protocol.startProgram(options);
}

async function onStartEcho(options) {
  store.patch({ echo: options });
  await Protocol.startEcho(options);
}

function onStartPlan() {
  const state = store.get();
  if (!state.plan || state.plan.sets.length === 0) {
    return;
  }
  store.patch({ planStatus: 'running' });
  runner.start(state.plan);
}

function onStop() {
  runner.stop('stopped');
  Protocol.stopAll();
  store.patch({ planStatus: 'idle' });
}

function onAddPlanSet(set) {
  const state = store.get();
  const plan = state.plan || { sets: [] };
  const sets = [...(plan.sets || []), set];
  Storage.savePlans(sets);
  store.patch({ plan: { ...plan, sets } });
}

function onRemovePlanSet(index) {
  const state = store.get();
  const plan = state.plan || { sets: [] };
  const sets = plan.sets.filter((_, i) => i !== index);
  Storage.savePlans(sets);
  store.patch({ plan: { ...plan, sets } });
}

function onUnitChange(unit) {
  const nextUnit = unit === 'lb' ? 'lb' : 'kg';
  store.patch({ unit: nextUnit });
  Storage.saveSettings({ unit: nextUnit, stopAtTop: store.get().config.stopAtTop });
  UI.live.render(store);
}

function onToggleStopAtTop(value) {
  const config = { ...store.get().config, stopAtTop: !!value };
  store.patch({ config });
  Storage.saveSettings({ unit: store.get().unit, stopAtTop: config.stopAtTop });
}

async function onSyncDropbox() {
  store.patch({ backupStatus: 'Syncing…' });
  const imported = await Storage.importFromDropbox();
  store.patch({ backupStatus: imported.length ? 'Imported plans' : 'No data imported' });
}

async function onExportDropbox() {
  store.patch({ backupStatus: 'Exporting…' });
  await Storage.exportToDropbox({
    plans: store.get().plan?.sets || [],
    history: store.get().history || [],
  });
  store.patch({ backupStatus: 'Exported to Dropbox' });
}

function handlePlanComplete(completion) {
  store.patch({ planStatus: 'idle' });
  const history = [...Storage.appendHistory(completion)].reverse();
  store.patch({ history });
  UI.history.append(store);
}

start();
