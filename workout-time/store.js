export function createStore(initialState = {}) {
  let state = structuredClone(initialState);
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function get() {
    return state;
  }

  function set(nextState) {
    state = structuredClone(nextState);
    emit();
  }

  function patch(partial) {
    state = { ...state, ...partial };
    emit();
  }

  function update(path, value) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('update requires a non-empty path array');
    }

    const nextState = structuredClone(state);
    let cursor = nextState;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      if (!(key in cursor)) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[path[path.length - 1]] = value;
    state = nextState;
    emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  return { get, set, patch, update, subscribe };
}

function structuredClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
