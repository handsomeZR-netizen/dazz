// P2-15 — 风格迁移浮层。
// 调用：openStylePanel({ contentBlob, onSaved, onToast })
//
// 流程：上传风格图 → 点「开始」 → 加载模型 + 推理 → 预览结果 → 「保存」入胶卷。
//
// 失败时（模型下载失败 / 推理报错）：toast 报错 + 关闭浮层，不阻塞主页面。

import { styleTransfer } from '../style-transfer.js';
import { Gallery } from '../gallery/db.js';

export function openStylePanel({ contentBlob, onSaved, onToast }) {
  if (!contentBlob) {
    onToast?.('没有内容图');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'style-panel';
  overlay.innerHTML = `
    <header class="style-header">
      <button type="button" class="icon-btn" data-act="close" aria-label="取消">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
      <span class="style-title">风格迁移 · 实验</span>
      <button type="button" class="primary style-save" data-act="save" disabled>保存</button>
    </header>
    <div class="style-body">
      <div class="style-thumbs">
        <div class="style-thumb">
          <span class="style-thumb-label">内容图</span>
          <img class="style-thumb-img" data-role="contentImg" alt="内容图" />
        </div>
        <div class="style-thumb">
          <span class="style-thumb-label">风格图</span>
          <button type="button" class="style-thumb-pick" data-act="pickStyle">
            <span data-role="styleHint">点击选择</span>
            <img class="style-thumb-img" data-role="styleImg" hidden alt="风格图" />
          </button>
          <input type="file" accept="image/*" hidden data-role="styleInput" />
        </div>
      </div>

      <div class="style-result-wrap">
        <div class="style-result-placeholder" data-role="placeholder">
          <p>选风格图后点「开始」<br/>桌面 Chrome 单张约 2-4s</p>
        </div>
        <img class="style-result-img" data-role="resultImg" hidden alt="风格化结果" />
        <div class="style-progress" data-role="progress" hidden>
          <span class="style-spinner" aria-hidden="true"></span>
          <span data-role="progressText">处理中…</span>
        </div>
      </div>
    </div>
    <footer class="style-actions">
      <button type="button" class="primary style-run" data-act="run" disabled>开始</button>
    </footer>
  `;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const contentImgEl = $('[data-role="contentImg"]');
  const styleImgEl = $('[data-role="styleImg"]');
  const styleHint = $('[data-role="styleHint"]');
  const styleInput = $('[data-role="styleInput"]');
  const placeholder = $('[data-role="placeholder"]');
  const resultImgEl = $('[data-role="resultImg"]');
  const progressEl = $('[data-role="progress"]');
  const progressText = $('[data-role="progressText"]');
  const runBtn = $('[data-act="run"]');
  const saveBtn = $('[data-act="save"]');

  let styleBlob = null;
  let resultBlob = null;
  const objUrls = [];
  function trackUrl(blob) {
    const u = URL.createObjectURL(blob);
    objUrls.push(u);
    return u;
  }

  // 内容图缩略
  contentImgEl.src = trackUrl(contentBlob);

  function setProgress(text) {
    if (text) {
      progressEl.hidden = false;
      progressText.textContent = text;
    } else {
      progressEl.hidden = true;
    }
  }

  function setRunning(on) {
    runBtn.disabled = on || !styleBlob;
    overlay.querySelector('[data-act="pickStyle"]').disabled = on;
    overlay.querySelector('[data-act="close"]').disabled = on;
  }

  async function pickStyle() {
    styleInput.value = '';
    styleInput.click();
  }

  styleInput.addEventListener('change', () => {
    const file = styleInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast?.('请选择图片文件');
      return;
    }
    styleBlob = file;
    styleImgEl.src = trackUrl(file);
    styleImgEl.hidden = false;
    styleHint.hidden = true;
    runBtn.disabled = false;
  });

  async function run() {
    if (!styleBlob) return;
    setRunning(true);
    setProgress('准备模型…');
    resultImgEl.hidden = true;
    placeholder.hidden = true;
    resultBlob = null;
    saveBtn.disabled = true;

    try {
      const { blob, ms } = await styleTransfer(contentBlob, styleBlob, {
        onProgress: (s) => setProgress(s),
      });
      resultBlob = blob;
      const u = trackUrl(blob);
      resultImgEl.src = u;
      resultImgEl.hidden = false;
      saveBtn.disabled = false;
      setProgress('');
      onToast?.(`完成 · ${(ms / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error('[style-transfer] failed', err);
      onToast?.('风格迁移失败：' + (err?.message || err?.name || '未知错误'));
      teardown();
      return;
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    if (!resultBlob) return;
    try {
      await Gallery.add(resultBlob, {
        presetId: 'STYLE',
        borderId: 'none',
        developMs: 0,
      });
      onToast?.('已保存到胶卷');
      onSaved?.();
      teardown();
    } catch (err) {
      onToast?.('保存失败：' + (err?.message || err?.name));
    }
  }

  function teardown() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    // 延迟回收 URL，避免 modal-img 还没 unbind
    setTimeout(() => {
      for (const u of objUrls) URL.revokeObjectURL(u);
    }, 1000);
  }

  function onKey(e) {
    // 仅在没有进行中的推理时允许 ESC 关闭
    if (e.key === 'Escape' && progressEl.hidden) {
      e.stopPropagation();
      teardown();
    }
  }
  document.addEventListener('keydown', onKey);

  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') {
      if (progressEl.hidden) teardown();
    } else if (act === 'pickStyle') {
      pickStyle();
    } else if (act === 'run') {
      run();
    } else if (act === 'save') {
      save();
    }
  });

  return { close: teardown };
}
