// 特效抽屉：halation / fisheye 既可开关又可拖滑杆调强度，flash 仍是"装填模式"
import { FX_DEFAULTS } from '../capture.js';

const MIN_ON_VALUE = 0.05; // 开启时的最低记忆值，避免开了滑杆却是 0

export function createFxDrawer({ drawerEl, openBtn, effects, getFlashArmed, setFlashArmed }) {
  function toggleVisible() {
    drawerEl.hidden = !drawerEl.hidden;
  }

  openBtn.addEventListener('click', toggleVisible);
  document.addEventListener('click', (e) => {
    if (drawerEl.hidden) return;
    if (drawerEl.contains(e.target) || openBtn.contains(e.target)) return;
    drawerEl.hidden = true;
  });

  // 每个 key 的「关掉前最后一次的强度」记忆，初始为 FX_DEFAULTS
  const lastValue = {
    halation: FX_DEFAULTS.halation,
    fisheye: FX_DEFAULTS.fisheye,
  };

  function syncRow(row) {
    const key = row.dataset.fx;
    const range = row.querySelector('.fx-range');
    const status = row.querySelector('.fx-status');
    const value = effects[key] || 0;
    const on = value > 0;
    row.classList.toggle('on', on);
    if (range) {
      range.disabled = !on;
      range.value = String(Math.round(value * 100));
    }
    if (status) {
      status.textContent = on ? `${Math.round(value * 100)}` : '关';
    }
  }

  // halation / fisheye：div.fx-toggle-row 包含 button.fx-row-head + input.fx-range
  drawerEl.querySelectorAll('.fx-toggle-row').forEach((row) => {
    const key = row.dataset.fx;
    const head = row.querySelector('.fx-row-head');
    const range = row.querySelector('.fx-range');

    // 点标题区 → toggle 开关
    head?.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = effects[key] || 0;
      if (cur > 0) {
        // 关：记住当前值（不小于 MIN_ON_VALUE），归零
        lastValue[key] = Math.max(cur, MIN_ON_VALUE);
        effects[key] = 0;
      } else {
        // 开：恢复上次记忆值（不小于 MIN_ON_VALUE）
        const restore = Math.max(lastValue[key] || FX_DEFAULTS[key] || MIN_ON_VALUE, MIN_ON_VALUE);
        effects[key] = restore;
        lastValue[key] = restore;
      }
      syncRow(row);
    });

    // 拖滑杆 → 实时改 effects 值，>0 视为开
    range?.addEventListener('input', (e) => {
      e.stopPropagation();
      const v = Number(range.value) / 100;
      effects[key] = v;
      if (v > 0) lastValue[key] = v;
      syncRow(row);
    });
    // 阻止滑杆上的点击/按下冒泡到外层（外层 click 用来判断关闭抽屉）
    range?.addEventListener('click', (e) => e.stopPropagation());
    range?.addEventListener('pointerdown', (e) => e.stopPropagation());

    // 初始同步
    syncRow(row);
  });

  // flash：保留原装填逻辑
  drawerEl.querySelectorAll('.fx-toggle[data-arm="true"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const armed = !getFlashArmed();
      setFlashArmed(armed);
      btn.classList.toggle('armed', armed);
      btn.querySelector('.fx-status').textContent = armed ? '待发射' : '关';
    });
  });

  return {
    hide() { drawerEl.hidden = true; },
    isVisible() { return !drawerEl.hidden; },
    hideRoot() { openBtn.style.display = 'none'; },
  };
}
