// 键盘快捷键：Esc 收叠层，方向键切预设，空格快门
export function bindKeyboard({ onEsc, onLeft, onRight, onShutter, anyOverlayOpen }) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      onEsc?.();
      return;
    }
    if (anyOverlayOpen?.()) return;
    if (e.key === 'ArrowLeft') onLeft?.();
    if (e.key === 'ArrowRight') onRight?.();
    if (e.key === ' ') {
      e.preventDefault();
      onShutter?.();
    }
  });
}
