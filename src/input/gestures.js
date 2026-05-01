// 取景器左右滑动：水平偏移 > 60px 且明显大于垂直偏移时切预设
// shouldIgnore 用于在 pinch 期间禁用滑切（即使 touchstart 时只有一指，
// 紧跟着可能有第二指落下进入 pinch；touchend 时再判断一次）。
export function bindSwipe(el, { onLeft, onRight, shouldIgnore } = {}) {
  let sx = null;
  let sy = null;
  let multiTouchSeen = false;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) {
      // 多指：直接放弃当前 swipe 跟踪
      multiTouchSeen = true;
      sx = sy = null;
      return;
    }
    multiTouchSeen = false;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
      multiTouchSeen = true;
      sx = sy = null;
    }
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx == null) return;
    if (multiTouchSeen) { sx = sy = null; return; }
    if (typeof shouldIgnore === 'function' && shouldIgnore()) {
      sx = sy = null;
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) onLeft?.();
      else onRight?.();
    }
    sx = sy = null;
  }, { passive: true });
  el.addEventListener('touchcancel', () => {
    sx = sy = null;
    multiTouchSeen = false;
  }, { passive: true });
}
