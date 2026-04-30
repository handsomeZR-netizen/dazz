export function createToast(toastEl) {
  let timer = null;
  return function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      toastEl.hidden = true;
    }, 1400);
  };
}
