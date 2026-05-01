// 拼贴预览面板：选项 + 实时预览 + 导出 jpeg。
import { composeCollage } from '../collage.js';

const LAYOUTS = [
  { id: 1, label: '1×N' },
  { id: 2, label: '2×N' },
  { id: 3, label: '3×N' },
];
const GAPS = [0, 8, 16];
const BGS = [
  { id: 'black', label: '黑', swatch: '#000' },
  { id: 'white', label: '白', swatch: '#fff' },
  { id: 'film', label: '胶片白', swatch: '#f5efe1' },
];

function pad(n) { return String(n).padStart(2, '0'); }
function formatStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function openCollagePanel({ items, onClose, onToast }) {
  if (!items || items.length < 2) {
    onToast?.('至少选 2 张');
    onClose?.();
    return;
  }

  const opts = { columns: 2, gap: 8, bg: 'black' };
  let previewSeq = 0;
  let previewUrl = null;

  // 容器
  const overlay = document.createElement('div');
  overlay.className = 'collage-panel';
  overlay.innerHTML = `
    <header class="collage-header">
      <button type="button" class="icon-btn" data-act="close" aria-label="关闭">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
      <span class="collage-title">拼贴 · ${items.length} 张</span>
      <button type="button" class="primary collage-export" data-act="export">导出</button>
    </header>
    <div class="collage-preview-wrap">
      <div class="collage-preview-inner">
        <img class="collage-preview-img" alt="拼贴预览" />
        <div class="collage-preview-loading" hidden>处理中…</div>
      </div>
    </div>
    <div class="collage-controls">
      <div class="collage-row">
        <span class="collage-row-label">布局</span>
        <div class="collage-seg" data-group="columns">
          ${LAYOUTS.map((l) => `<button type="button" data-val="${l.id}">${l.label}</button>`).join('')}
        </div>
      </div>
      <div class="collage-row">
        <span class="collage-row-label">间距</span>
        <div class="collage-seg" data-group="gap">
          ${GAPS.map((g) => `<button type="button" data-val="${g}">${g}px</button>`).join('')}
        </div>
      </div>
      <div class="collage-row">
        <span class="collage-row-label">背景</span>
        <div class="collage-seg collage-seg-bg" data-group="bg">
          ${BGS.map((b) => `<button type="button" data-val="${b.id}" title="${b.label}"><span class="collage-swatch" style="background:${b.swatch}"></span>${b.label}</button>`).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const previewImg = overlay.querySelector('.collage-preview-img');
  const loadingEl = overlay.querySelector('.collage-preview-loading');

  function syncSelected() {
    overlay.querySelectorAll('.collage-seg').forEach((seg) => {
      const group = seg.dataset.group;
      const val = String(opts[group]);
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.val === val);
      });
    });
  }

  async function refreshPreview() {
    const seq = ++previewSeq;
    loadingEl.hidden = false;
    try {
      const blob = await composeCollage(items, {
        columns: opts.columns,
        gap: opts.gap,
        bg: opts.bg,
        previewMaxWidth: 720,
        quality: 0.85,
      });
      if (seq !== previewSeq) return;
      const url = URL.createObjectURL(blob);
      const old = previewUrl;
      previewUrl = url;
      previewImg.src = url;
      if (old) setTimeout(() => URL.revokeObjectURL(old), 500);
    } catch (e) {
      if (seq !== previewSeq) return;
      onToast?.('预览失败：' + (e.message || e.name));
    } finally {
      if (seq === previewSeq) loadingEl.hidden = true;
    }
  }

  overlay.addEventListener('click', async (e) => {
    const segBtn = e.target.closest('.collage-seg button');
    if (segBtn) {
      const group = segBtn.parentElement.dataset.group;
      const raw = segBtn.dataset.val;
      const val = group === 'bg' ? raw : Number(raw);
      if (opts[group] !== val) {
        opts[group] = val;
        syncSelected();
        refreshPreview();
      }
      return;
    }
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const act = actBtn.dataset.act;
    if (act === 'close') {
      teardown();
    } else if (act === 'export') {
      await doExport(actBtn);
    }
  });

  async function doExport(btn) {
    btn.disabled = true;
    btn.textContent = '导出中…';
    const t0 = performance.now();
    try {
      const blob = await composeCollage(items, {
        columns: opts.columns,
        gap: opts.gap,
        bg: opts.bg,
        quality: 0.9,
      });
      const ms = (performance.now() - t0) | 0;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dazz-collage-${formatStamp()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      onToast?.(`已导出 (${(blob.size / 1024).toFixed(0)} KB · ${ms} ms)`);
      teardown();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '导出';
      onToast?.('导出失败：' + (e.message || e.name));
    }
  }

  function teardown() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    onClose?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      teardown();
    }
  }
  document.addEventListener('keydown', onKey);

  syncSelected();
  refreshPreview();

  return { close: teardown };
}
