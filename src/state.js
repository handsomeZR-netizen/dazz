// 极简响应式 store：get / set / subscribe，订阅器只在被 set 的 key 变化时触发。
// 用法：
//   const store = createStore({ presetIdx: 0, strength: 1 });
//   const off = store.subscribe('presetIdx', (next, prev) => ...);
//   store.set('presetIdx', 2);
export function createStore(initial) {
  const state = { ...initial };
  const subs = new Map(); // key -> Set<fn>

  function get(key) {
    return state[key];
  }

  function set(key, next) {
    const prev = state[key];
    if (Object.is(prev, next)) return;
    state[key] = next;
    const ss = subs.get(key);
    if (ss) for (const fn of ss) fn(next, prev);
  }

  function subscribe(key, fn) {
    let ss = subs.get(key);
    if (!ss) subs.set(key, (ss = new Set()));
    ss.add(fn);
    return () => ss.delete(fn);
  }

  function snapshot() {
    return { ...state };
  }

  return { get, set, subscribe, snapshot };
}
