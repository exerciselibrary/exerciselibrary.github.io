// Tiny reactive store for cross-panel updates
export function createStore(initial) {
  let state = structuredClone(initial);
  const subs = new Set();
  const get = () => state;
  const set = (next) => { state = next; subs.forEach(fn => fn(state)); };
  const patch = (p) => set({ ...state, ...p });
  const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
  return { get, set, patch, subscribe };
}
