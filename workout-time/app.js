// Workout Time app orchestrator placeholder.
// Actual implementation arrives in milestone 2.

import * as Protocol from './protocol.js';
import * as Device from './device.js';
import * as Chart from './chart.js';
import * as Storage from './storage.js';
import * as PlanRunner from './plan-runner.js';
import * as UI from './ui/index.js';

/**
 * Provide a global `app` object so inline handlers in index.html remain functional
 * while the real implementation is under construction. Each method currently logs
 * a stub warning so future work can progressively replace them without breaking
 * the UI in the meantime.
 */
const createStub = (name) => (...args) => {
  console.warn(`app.${name}() is not implemented yet.`, { args });
};

const stubbedMethods = [
  'toggleSidebar',
  'closeSidebar',
  'connect',
  'disconnect',
  'toggleJustLiftMode',
  'startProgram',
  'toggleEchoJustLiftMode',
  'startEcho',
  'startPlan',
  'saveCurrentPlan',
  'loadSelectedPlan',
  'deleteSelectedPlan',
  'addPlanExercise',
  'addPlanEcho',
  'resetPlanToDefaults',
  'toggleStopAtTop',
  'connectDropbox',
  'syncFromDropbox',
  'requestExportAllToDropboxCSV',
  'disconnectDropbox',
  'rewindPlan',
  'togglePlanPause',
  'stopWorkout',
  'skipPlanForward',
  'setTimeRange',
  'exportData',
];

export const app = Object.freeze({
  ...stubbedMethods.reduce((acc, method) => {
    acc[method] = createStub(method);
    return acc;
  }, {}),
  /**
   * Expose internal module scaffolding to aid manual testing while the
   * orchestrator is still a stub. This mirrors the eventual architecture
   * without committing to behaviour yet.
   */
  _modules: Object.freeze({ Protocol, Device, Chart, Storage, PlanRunner, UI }),
});

// Expose to window for inline event handlers.
window.app = app;

console.info('Workout Time scaffold loaded (stub mode).', app);
