// 特效抽屉：halation / fisheye 是开关，flash 是"装填模式"（拍下一张时触发）
import { FX_DEFAULTS } from '../capture.js';

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

  drawerEl.querySelectorAll('.fx-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.fx;
      const arm = btn.dataset.arm === 'true';
      if (arm) {
        const armed = !getFlashArmed();
        setFlashArmed(armed);
        btn.classList.toggle('armed', armed);
        btn.querySelector('.fx-status').textContent = armed ? '待发射' : '关';
      } else {
        const on = effects[key] === 0;
        effects[key] = on ? FX_DEFAULTS[key] : 0;
        btn.classList.toggle('on', on);
        btn.querySelector('.fx-status').textContent = on ? '开' : '关';
      }
    });
  });

  return {
    hide() { drawerEl.hidden = true; },
    isVisible() { return !drawerEl.hidden; },
    hideRoot() { openBtn.style.display = 'none'; },
  };
}
