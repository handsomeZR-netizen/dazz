// 取景器左右滑动：水平偏移 > 60px 且明显大于垂直偏移时切预设
export function bindSwipe(el, { onLeft, onRight }) {
  let sx = null;
  let sy = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) onLeft?.();
      else onRight?.();
    }
    sx = sy = null;
  }, { passive: true });
}
