/**
 * Plan runner: pure timeline + state machine. No DOM. No BLE.
 * Hooks: onTick(state), onSetChange(state), onComplete(state)
 * External signals: notifyActivity() for "Just Lift" idle detection,
 *                   markAtTop() for "stop at top of final rep".
 */

/** @typedef {{ name:string, reps:number, loadKgPerCable:number, mode:string, restSec:number }} PlanSet */
/** @typedef {{ sets: PlanSet[], unit:'kg'|'lb' }} Plan */

export function createPlanRunner({ onTick, onSetChange, onComplete, now = () => performance.now() } = {}) {
  let raf = 0, tPrev = 0;
  let state = {
    status: 'idle',          // 'idle'|'running'|'paused'|'stopped'|'done'
    i: 0,                    // current set index
    elapsedMs: 0,
    restLeftMs: 0,
    plan: /** @type {Plan|null} */(null),
    config: { stopAtTop: true, justLiftIdleMs: 5000 },
    _lastActivityMs: 0,
    _awaitTopToStop: false
  };

  const emitTick = () => onTick && onTick(structuredClone(state));
  const emitSetChange = () => onSetChange && onSetChange(structuredClone(state));
  const emitComplete = () => onComplete && onComplete(structuredClone(state));

  function setConfig(cfg) { state.config = { ...state.config, ...cfg }; }

  function start(plan) {
    cancelAnimationFrame(raf);
    state = { ...state, status: 'running', i: 0, elapsedMs: 0, restLeftMs: 0, plan, _awaitTopToStop: false };
    tPrev = now();
    emitSetChange();
    loop();
  }

  function loop() {
    raf = requestAnimationFrame(() => {
      const t = now(); const dt = t - tPrev; tPrev = t;
      if (state.status !== 'running') return;

      state.elapsedMs += dt;

      // Handle rest countdown
      if (state.restLeftMs > 0) {
        state.restLeftMs = Math.max(0, state.restLeftMs - dt);
        if (state.restLeftMs === 0) advanceSet(); // rest finished => next set
      }

      // Just-Lift idle auto-stop
      if (state.plan && state.plan.sets[state.i]?.mode === 'Just Lift') {
        if (state.elapsedMs - state._lastActivityMs > state.config.justLiftIdleMs) {
          stop('idle-auto-stop');
          emitTick(); return;
        }
      }

      // If we're awaiting top-of-rep to stop at end
      if (state._awaitTopToStop === true) {
        // Wait for markAtTop() to be called externally
      }

      emitTick();
      loop();
    });
  }

  function advanceSet() {
    const nextIdx = state.i + 1;
    if (!state.plan) return;
    if (nextIdx >= state.plan.sets.length) {
      // At end of plan:
      if (state.config.stopAtTop) {
        state._awaitTopToStop = true; // app should call markAtTop() when detected
      } else {
        done();
      }
    } else {
      state.i = nextIdx;
      emitSetChange();
    }
  }

  // External signal from app/protocol on telemetry activity (e.g., load/rep motion).
  function notifyActivity() {
    state._lastActivityMs = state.elapsedMs;
  }

  // External signal from app/protocol: reached "top" (peak) so it is safe to stop.
  function markAtTop() {
    if (state._awaitTopToStop) {
      done();
    }
  }

  function next() { if (!state.plan) return; if (state.i < state.plan.sets.length - 1) { state.i++; emitSetChange(); } else advanceSet(); }
  function prev() { if (!state.plan) return; state.i = Math.max(0, state.i - 1); emitSetChange(); }

  function pause() { if (state.status === 'running') { state.status = 'paused'; cancelAnimationFrame(raf); } }
  function resume() { if (state.status === 'paused') { state.status = 'running'; tPrev = now(); loop(); } }
  function stop(reason='stopped') { cancelAnimationFrame(raf); state.status = reason; }
  function done() { cancelAnimationFrame(raf); state.status = 'done'; emitComplete(); }

  return { start, pause, resume, stop, next, prev, setConfig, notifyActivity, markAtTop, getState: () => structuredClone(state) };
}
