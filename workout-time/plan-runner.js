const DEFAULT_TICK_MS = 100;

export function createPlanRunner({ now, onTick, onSetChange, onComplete } = {}) {
  let state = null;
  let ticker = null;
  let segmentTimer = null;

  function start(plan) {
    if (!plan || !Array.isArray(plan.sets) || plan.sets.length === 0) {
      stop();
      return;
    }

    const timeline = plan.sets.map((set, index) => ({
      index,
      ...normaliseSet(set),
    }));

    state = {
      plan,
      timeline,
      cursor: 0,
      status: 'idle',
      segment: null,
      paused: false,
      pauseStartedAt: null,
      pausedDuration: 0,
      completed: [],
    };

    startTicker();
    runCurrentSegment('set');
  }

  function stop(reason = 'stopped') {
    clearTimer();
    stopTicker();
    if (state) {
      const snapshot = snapshotState({
        status: 'idle',
        reason,
      });
      state = null;
      safeCall(onTick, snapshot);
    }
  }

  function pause() {
    if (!state || state.paused || !state.segment) {
      return;
    }
    state.paused = true;
    state.pauseStartedAt = now();
    clearTimer();
    safeCall(onTick, snapshotState());
  }

  function resume() {
    if (!state || !state.paused || !state.segment) {
      return;
    }
    state.paused = false;
    state.pausedDuration += now() - state.pauseStartedAt;
    state.pauseStartedAt = null;
    scheduleTimer(remainingMs());
    safeCall(onTick, snapshotState());
  }

  function next(reason = 'advance') {
    if (!state) {
      return;
    }
    clearTimer();

    const { timeline, cursor, segment } = state;
    if (segment) {
      state.completed.push({
        type: segment.type,
        index: cursor,
        startedAt: segment.startedAt,
        durationMs: segment.durationMs,
      });
    }

    if (cursor + 1 >= timeline.length) {
      finishPlan(reason);
      return;
    }

    state.cursor += 1;
    state.paused = false;
    state.pauseStartedAt = null;
    state.pausedDuration = 0;

    runCurrentSegment('set');
  }

  function runCurrentSegment(initialPhase) {
    if (!state) {
      return;
    }

    const entry = state.timeline[state.cursor];
    const { durationMs, restMs } = entry;

    if (!entry) {
      finishPlan('invalid');
      return;
    }

    state.status = initialPhase;
    state.segment = {
      type: initialPhase,
      startedAt: now(),
      durationMs: initialPhase === 'set' ? durationMs : restMs,
      restMs,
      setMeta: entry,
    };
    state.paused = false;
    state.pauseStartedAt = null;
    state.pausedDuration = 0;

    scheduleTimer(remainingMs());
    safeCall(onSetChange, snapshotState());
    safeCall(onTick, snapshotState());
  }

  function scheduleTimer(delayMs) {
    clearTimer();
    if (!state || delayMs <= 0 || state.paused) {
      return;
    }
    segmentTimer = setTimeout(onSegmentComplete, delayMs);
  }

  function onSegmentComplete() {
    if (!state) {
      return;
    }

    if (state.segment.type === 'set' && state.segment.restMs > 0) {
      runCurrentSegment('rest');
      return;
    }

    if (state.segment.type === 'rest') {
      next('rest-complete');
      return;
    }

    next('set-complete');
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      if (!state || state.paused || !state.segment) {
        return;
      }
      safeCall(onTick, snapshotState());
    }, DEFAULT_TICK_MS);
  }

  function stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function clearTimer() {
    if (segmentTimer) {
      clearTimeout(segmentTimer);
      segmentTimer = null;
    }
  }

  function remainingMs() {
    if (!state || !state.segment) {
      return 0;
    }
    const reference = state.paused ? state.pauseStartedAt : now();
    const elapsed = reference - state.segment.startedAt - state.pausedDuration;
    return Math.max(0, state.segment.durationMs - elapsed);
  }

  function finishPlan(reason) {
    const snapshot = snapshotState({ status: 'complete', reason });
    const completion = {
      plan: state.plan,
      finishedAt: now(),
      reason,
      completedSets: state.completed.slice(),
    };
    stopTicker();
    clearTimer();
    state = null;
    safeCall(onTick, snapshot);
    safeCall(onComplete, completion);
  }

  function snapshotState(overrides = {}) {
    if (!state) {
      return {
        status: 'idle',
        remainingMs: 0,
        activeSet: null,
        timeline: [],
        cursor: 0,
        totalSets: 0,
        paused: false,
        reason: overrides.reason || null,
      };
    }

    const { timeline, cursor, segment, paused, completed } = state;
    const activeEntry = timeline[cursor] || null;
    const remaining = remainingMs();
    const elapsed = segment
      ? Math.min(segment.durationMs, segment.durationMs - remaining)
      : 0;

    return {
      status: state.status,
      plan: state.plan,
      timeline,
      cursor,
      totalSets: timeline.length,
      activeSet: activeEntry,
      segment,
      paused,
      elapsedMs: elapsed,
      remainingMs: remaining,
      completedSets: completed,
      ...overrides,
    };
  }

  function getState() {
    return snapshotState();
  }

  return { start, stop, pause, resume, next, getState };
}

function normaliseSet(set = {}) {
  const durationMs = Math.max(0, Number(set.durationSec || set.duration || 0) * 1000);
  const restMs = Math.max(0, Number(set.restSec || set.rest || 0) * 1000);
  return {
    ...set,
    durationMs,
    restMs,
  };
}

function safeCall(fn, value) {
  if (typeof fn === 'function') {
    fn(value);
  }
}
