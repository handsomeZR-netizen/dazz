// 胶卷相册 + 详情视图 + 缩略图刷新 + 显影动画 + zip 导出 + 分组（自定义文件夹）。
import { Gallery, DEFAULT_LABEL } from '../gallery/db.js';
import { buildZip } from '../gallery/zip.js';

const LABEL_MAX_LEN = 8;
const LONG_PRESS_MS = 500;

export function createAlbum({ refs, onToast, getActiveLabel, setActiveLabel }) {
  const {
    album, albumGrid, albumEmpty, albumCloseBtn, albumExportBtn, albumCountEl,
    albumTabs,
    modal, modalImg, modalMeta, closeModalBtn, deleteBtn, shareBtn, downloadBtn,
    thumbBtn, thumbCount,
    modalGroupPick, modalGroupName,
  } = refs;

  let currentDetail = null;
  let thumbObjUrl = null;
  let detailObjUrl = null;

  // 当前激活分组（默认 ALL）。如果父级提供 getter/setter 则委托过去。
  let internalActiveLabel = DEFAULT_LABEL;
  function activeLabel() {
    if (typeof getActiveLabel === 'function') return getActiveLabel() || DEFAULT_LABEL;
    return internalActiveLabel;
  }
  function applyActiveLabel(next) {
    const l = next || DEFAULT_LABEL;
    if (typeof setActiveLabel === 'function') setActiveLabel(l);
    else internalActiveLabel = l;
  }

  function isDeveloped(rec) {
    if (!rec.developMs) return true;
    return Date.now() - rec.ts >= rec.developMs;
  }
  function remainingDevelop(rec) {
    if (!rec.developMs) return 0;
    return Math.max(0, rec.developMs - (Date.now() - rec.ts));
  }
  function photoFilename(rec) {
    return `${(rec.presetId || 'dazz').toLowerCase()}-${rec.id}.jpg`;
  }
  function createPhotoFile(rec) {
    return new File([rec.blob], photoFilename(rec), {
      type: 'image/jpeg',
      lastModified: rec.ts || Date.now(),
    });
  }
  function canSharePhoto(rec) {
    if (!shareBtn || typeof File !== 'function' || typeof navigator.share !== 'function') return false;
    try {
      return navigator.canShare?.({ files: [createPhotoFile(rec)] }) === true;
    } catch {
      return false;
    }
  }
  function playDevelop(el, ms) {
    if (ms <= 0) {
      el.style.filter = '';
      el.style.transition = '';
      return;
    }
    el.style.filter = 'blur(8px) brightness(0.45) saturate(0.3)';
    el.style.transition = 'none';
    void el.offsetWidth;
    el.style.transition = `filter ${ms}ms ease-out`;
    el.style.filter = 'none';
    setTimeout(() => {
      el.style.transition = '';
      el.style.filter = '';
    }, ms + 80);
  }

  async function refreshThumb() {
    const latest = await Gallery.latest();
    const n = await Gallery.count();
    if (thumbObjUrl) {
      URL.revokeObjectURL(thumbObjUrl);
      thumbObjUrl = null;
    }
    if (latest) {
      thumbObjUrl = URL.createObjectURL(latest.blob);
      thumbBtn.style.backgroundImage = `url(${thumbObjUrl})`;
      thumbBtn.querySelector('.thumb-empty')?.remove();
      playDevelop(thumbBtn, remainingDevelop(latest));
    } else {
      thumbBtn.style.backgroundImage = '';
      thumbBtn.style.filter = '';
      if (!thumbBtn.querySelector('.thumb-empty')) {
        const span = document.createElement('span');
        span.className = 'thumb-empty';
        span.textContent = '×';
        thumbBtn.prepend(span);
      }
    }
    if (n > 0) {
      thumbCount.hidden = false;
      thumbCount.textContent = String(n);
    } else {
      thumbCount.hidden = true;
    }
  }

  async function openAlbum() {
    await renderAlbum();
    album.hidden = false;
  }

  function closeAlbum() {
    album.hidden = true;
    albumGrid.querySelectorAll('.album-cell').forEach((cell) => {
      const u = cell.dataset.url;
      if (u) URL.revokeObjectURL(u);
    });
    albumGrid.innerHTML = '';
  }

  // —— Tab 条 —— //
  function attachTabLongPress(btn, label) {
    let timer = null;
    let triggered = false;
    const cancel = () => {
      if (timer != null) { clearTimeout(timer); timer = null; }
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      triggered = false;
      cancel();
      timer = setTimeout(() => {
        triggered = true;
        onTabLongPress(label);
      }, LONG_PRESS_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      btn.addEventListener(ev, cancel),
    );
    btn.addEventListener('click', (e) => {
      if (triggered) {
        e.preventDefault();
        e.stopPropagation();
        triggered = false;
      }
    });
  }

  async function onTabLongPress(label) {
    if (label === DEFAULT_LABEL) return;
    const choice = prompt(
      `分组 "${label}" — 输入新名字（最多 ${LABEL_MAX_LEN} 字）；留空并确定 = 删除该分组（其照片回到 ALL）。`,
      label,
    );
    if (choice === null) return; // 取消
    const trimmed = (choice || '').trim();
    if (trimmed === '') {
      // 删除
      if (!confirm(`删除分组 "${label}"？该分组下所有照片将回到 ALL。`)) return;
      const moved = await Gallery.removeLabel(label);
      onToast?.(`已删除 · ${moved} 张回到 ALL`);
      if (activeLabel() === label) applyActiveLabel(DEFAULT_LABEL);
      await renderAlbum();
      return;
    }
    if (!Gallery.isValidNewLabel(trimmed)) {
      onToast?.('名字无效（1-8 字，非 ALL）');
      return;
    }
    if (trimmed === label) return;
    // 重命名 = 把所有该 label 的记录改名
    const items = await Gallery.listByLabel(label);
    for (const it of items) {
      await Gallery.setLabel(it.id, trimmed);
    }
    if (activeLabel() === label) applyActiveLabel(trimmed);
    onToast?.(`已重命名为 ${trimmed}`);
    await renderAlbum();
  }

  async function onAddTab() {
    const name = prompt(`新建分组名（1-${LABEL_MAX_LEN} 字，不能是 ALL）`, '');
    if (name === null) return;
    const trimmed = (name || '').trim();
    if (!Gallery.isValidNewLabel(trimmed)) {
      onToast?.('名字无效（1-8 字，非 ALL）');
      return;
    }
    // 注意：空分组没有照片，所以 listLabels 不会包含它，但我们立即把它设为激活分组。
    applyActiveLabel(trimmed);
    onToast?.(`已切到 ${trimmed}`);
    await renderAlbum();
  }

  async function buildTabs() {
    if (!albumTabs) return;
    const labels = await Gallery.listLabels();
    const current = activeLabel();
    // 如果当前激活分组不在已知 labels 里（新建空分组场景），也临时塞进去
    if (!labels.includes(current)) labels.push(current);

    albumTabs.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const label of labels) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'album-tab' + (label === current ? ' active' : '');
      btn.textContent = label;
      btn.dataset.label = label;
      btn.addEventListener('click', async () => {
        if (activeLabel() === label) return;
        applyActiveLabel(label);
        await renderAlbum();
      });
      attachTabLongPress(btn, label);
      frag.appendChild(btn);
    }
    // 末尾 +
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'album-tab add';
    addBtn.textContent = '+';
    addBtn.setAttribute('aria-label', '新建分组');
    addBtn.addEventListener('click', onAddTab);
    frag.appendChild(addBtn);
    albumTabs.appendChild(frag);
  }

  async function renderAlbum() {
    await buildTabs();
    const current = activeLabel();
    const items = await Gallery.listByLabel(current);
    albumCountEl.textContent = String(items.length);
    // 释放上一轮的 url
    albumGrid.querySelectorAll('.album-cell').forEach((cell) => {
      const u = cell.dataset.url;
      if (u) URL.revokeObjectURL(u);
    });
    albumGrid.innerHTML = '';
    if (items.length === 0) {
      albumEmpty.hidden = false;
      albumEmpty.textContent = current === DEFAULT_LABEL ? '还没有拍过照片' : `分组 "${current}" 还没有照片`;
      return;
    }
    albumEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const cell = document.createElement('div');
      cell.className = 'album-cell';
      const url = URL.createObjectURL(it.blob);
      cell.dataset.url = url;
      cell.dataset.id = it.id;
      cell.dataset.preset = it.presetId || '';
      cell.style.backgroundImage = `url(${url})`;
      cell.addEventListener('click', () => openDetail(it));
      const remaining = remainingDevelop(it);
      if (remaining > 0) {
        cell.classList.add('developing');
        requestAnimationFrame(() => playDevelop(cell, remaining));
      }
      frag.appendChild(cell);
    }
    albumGrid.appendChild(frag);
  }

  function updateModalGroupPick(rec) {
    if (!modalGroupName) return;
    modalGroupName.textContent = rec.albumLabel || DEFAULT_LABEL;
  }

  function openDetail(rec) {
    currentDetail = rec;
    if (detailObjUrl) URL.revokeObjectURL(detailObjUrl);
    detailObjUrl = URL.createObjectURL(rec.blob);
    modalImg.src = detailObjUrl;
    downloadBtn.href = detailObjUrl;
    downloadBtn.download = photoFilename(rec);
    if (shareBtn) shareBtn.hidden = !canSharePhoto(rec);
    const d = new Date(rec.ts);
    const remaining = remainingDevelop(rec);
    const status = remaining > 0 ? ` · 显影中 ${(remaining / 1000).toFixed(1)}s` : '';
    modalMeta.textContent = `${rec.presetId || ''} · ${d.toLocaleString()}${status}`;
    updateModalGroupPick(rec);
    modal.hidden = false;
    if (remaining > 0) {
      requestAnimationFrame(() => playDevelop(modalImg, remaining));
      setTimeout(() => {
        if (currentDetail === rec) {
          modalMeta.textContent = `${rec.presetId || ''} · ${d.toLocaleString()}`;
        }
      }, remaining + 100);
    }
  }

  function closeDetail() {
    modal.hidden = true;
    currentDetail = null;
    if (shareBtn) shareBtn.hidden = true;
    if (detailObjUrl) {
      const u = detailObjUrl;
      detailObjUrl = null;
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
  }

  async function pickGroupForDetail() {
    if (!currentDetail) return;
    const labels = await Gallery.listLabels();
    const current = activeLabel();
    if (!labels.includes(current)) labels.push(current);
    const cur = currentDetail.albumLabel || DEFAULT_LABEL;
    const lines = labels.map((l, i) => `${i + 1}. ${l}${l === cur ? ' (当前)' : ''}`);
    lines.push(`${labels.length + 1}. + 新建分组…`);
    const raw = prompt(
      '把这张移动到哪个分组？\n' + lines.join('\n') + '\n请输入序号：',
      String(labels.indexOf(cur) + 1 || 1),
    );
    if (raw === null) return;
    const n = parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > labels.length + 1) {
      onToast?.('无效输入');
      return;
    }
    let target;
    if (n === labels.length + 1) {
      const name = prompt(`新建分组名（1-${LABEL_MAX_LEN} 字，不能是 ALL）`, '');
      if (name === null) return;
      const trimmed = (name || '').trim();
      if (!Gallery.isValidNewLabel(trimmed)) {
        onToast?.('名字无效（1-8 字，非 ALL）');
        return;
      }
      target = trimmed;
    } else {
      target = labels[n - 1];
    }
    if (target === cur) return;
    await Gallery.setLabel(currentDetail.id, target);
    currentDetail.albumLabel = target;
    updateModalGroupPick(currentDetail);
    onToast?.(`已移动到 ${target}`);
    if (!album.hidden) await renderAlbum();
    await refreshThumb();
  }

  async function exportAll() {
    // 仅导出当前分组（更直观）
    const current = activeLabel();
    const items = await Gallery.listByLabel(current);
    if (items.length === 0) {
      onToast?.('胶卷是空的');
      return;
    }
    onToast?.('打包中…');
    try {
      const entries = items.map((it) => ({
        name: photoFilename(it),
        blob: it.blob,
      }));
      const zipBlob = await buildZip(entries);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = current === DEFAULT_LABEL
        ? `dazz-roll-${stamp}.zip`
        : `dazz-${current.toLowerCase()}-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      onToast?.('导出失败：' + (e.message || e.name));
    }
  }

  async function deleteCurrent() {
    if (!currentDetail) return;
    if (!confirm('删除这张照片？')) return;
    await Gallery.remove(currentDetail.id);
    onToast?.('已删除');
    closeDetail();
    if (!album.hidden) await renderAlbum();
    await refreshThumb();
  }

  async function shareCurrent() {
    if (!currentDetail) return;
    try {
      const file = createPhotoFile(currentDetail);
      if (navigator.canShare?.({ files: [file] }) !== true) {
        shareBtn.hidden = true;
        return;
      }
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      onToast?.('分享失败：' + (e?.message || e?.name || '未知错误'));
    }
  }

  // bind
  thumbBtn.addEventListener('click', openAlbum);
  albumCloseBtn.addEventListener('click', closeAlbum);
  closeModalBtn.addEventListener('click', closeDetail);
  deleteBtn.addEventListener('click', deleteCurrent);
  shareBtn?.addEventListener('click', shareCurrent);
  albumExportBtn.addEventListener('click', exportAll);
  modalGroupPick?.addEventListener('click', pickGroupForDetail);

  return {
    refreshThumb,
    openAlbum,
    closeAlbum,
    closeDetail,
    isAlbumOpen() { return !album.hidden; },
    isDetailOpen() { return !modal.hidden; },
    refresh: renderAlbum,
    getActiveLabel: activeLabel,
    setActiveLabel(label) {
      applyActiveLabel(label || DEFAULT_LABEL);
    },
  };
}
