import * as connectionModule from './connection.js';
import * as programModule from './program.js';
import * as echoModule from './echo.js';
import * as planModule from './plan.js';
import * as liveModule from './live.js';
import * as historyModule from './history.js';
import * as configModule from './config.js';
import * as backupModule from './backup.js';

export function mount(store, actions = {}) {
  connectionModule.mount(store, actions);
  programModule.mount(store, actions);
  echoModule.mount(store, actions);
  planModule.mount(store, actions);
  configModule.mount(store, actions);
  backupModule.mount(store, actions);
  liveModule.mount(store, actions);
  historyModule.mount(store, actions);

  store.subscribe(() => {
    connectionModule.render(store);
    programModule.render(store);
    echoModule.render(store);
    planModule.render(store);
    configModule.render(store);
    backupModule.render(store);
    liveModule.render(store);
    historyModule.render(store);
  });
}

export const live = {
  render: (store, runnerState) => liveModule.renderTick(store, runnerState),
  updateGauge: (store, sample) => liveModule.updateGauge(store, sample),
};

export const plan = {
  progress: (store, runnerState) => planModule.progress(store, runnerState),
};

export const history = {
  append: (store) => historyModule.append(store),
};
