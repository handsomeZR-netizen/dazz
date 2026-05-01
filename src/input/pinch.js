// 双指捏合检测 + 双击重置。
// 用 pointer events 跟踪两根手指（或两支笔/鼠标按下），返回相对距离比 ratio。
// onPinch(ratio) 在每一次 move 时调用，ratio = currentDist / lastDist，调用方应将 zoom *= ratio。
// onPinchStart / onPinchEnd 用于在开始/结束时同步状态（例如冻结/释放 swipe）。
// onReset 由双击触发。
export function bindPinch(el, { onPinch, onPinchStart, onPinchEnd, onReset } = {}) {
  // pointerId -> { x, y }
  const pointers = new Map();
  let lastDist = 0;
  let pinching = false;

  function distOfTwo() {
    const it = pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onDown(e) {
    if (!e.isPrimary && pointers.size === 0) {
      // 不是主指针且没有已记录指针时忽略，避免乱
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      lastDist = distOfTwo();
      pinching = true;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      onPinchStart?.();
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinching && pointers.size >= 2) {
      // 阻止此时的滚动 / 滑动手势
      if (e.cancelable) e.preventDefault();
      const cur = distOfTwo();
      if (lastDist > 0 && cur > 0) {
        const ratio = cur / lastDist;
        // 微小抖动忽略，避免抖
        if (Math.abs(ratio - 1) > 0.001) {
          onPinch?.(ratio);
        }
        lastDist = cur;
      }
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (pinching && pointers.size < 2) {
      pinching = false;
      lastDist = 0;
      onPinchEnd?.();
    }
  }

  // pointer events 不支持双击，监听 dblclick（移动端会 polyfill）
  let lastTap = 0;
  function onTouchEnd() {
    const now = performance.now();
    if (now - lastTap < 300) {
      onReset?.();
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove, { passive: false });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onUp);
  el.addEventListener('dblclick', () => onReset?.());
  // 触摸双击 fallback（Safari iOS 在某些情况不发 dblclick）
  el.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1 && pointers.size === 0) onTouchEnd();
  }, { passive: true });

  return {
    isPinching() { return pinching; },
    pointerCount() { return pointers.size; },
  };
}

// 工具：判断是否处于多指交互（用于让 swipe 在 pinch 期间退避）
export function activePointerCount(handle) {
  return handle?.pointerCount?.() ?? 0;
}
