// 胶卷相册 + 详情视图 + 缩略图刷新 + 显影动画 + zip 导出 + 多选拼贴。
import { Gallery } from '../gallery/db.js';
import { buildZip } from '../gallery/zip.js';
import { openCollagePanel } from './collage.js';

export function createAlbum({ refs, onToast }) {
  const {
    album, albumGrid, albumEmpty, albumCloseBtn, albumExportBtn, albumCountEl,
    albumHeader, albumTitleEl,
    modal, modalImg, modalMeta, closeModalBtn, deleteBtn, shareBtn, downloadBtn,
    thumbBtn, thumbCount,
  } = refs;

  let currentDetail = null;
  let thumbObjUrl = null;
  let detailObjUrl = null;

  // 多选状态
  let selectionMode = false;
  const selectedIds = new Set();
  let cachedItems = []; // 上一次 renderAlbum 的 items（用于 collage 时取 blob）
  let collageOpen = false;

  // ============== 多选 UI（动态创建） ==============
  const collageBtn = document.createElement('button');
  collageBtn.type = 'button';
  collageBtn.className = 'icon-btn album-collage-btn';
  collageBtn.title = '拼贴';
  collageBtn.setAttribute('aria-label', '拼贴');
  collageBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <rect x="13" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <rect x="3" y="13" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <rect x="13" y="13" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    </svg>
  `;
  // 插到 export 按钮之前
  if (albumExportBtn?.parentElement) {
    albumExportBtn.parentElement.insertBefore(collageBtn, albumExportBtn);
  }

  // 选中工具栏（接管 album-header 显示）：「取消 · 已选 N 张 · 下一步」
  const selectionBar = document.createElement('header');
  selectionBar.className = 'album-header album-header-selection';
  selectionBar.hidden = true;
  selectionBar.innerHTML = `
    <button type="button" class="icon-btn" data-act="cancel" aria-label="取消多选">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </button>
    <h2 class="album-title">已选 <span data-role="count">0</span> 张</h2>
    <button type="button" class="primary album-next-btn" data-act="next">下一步</button>
  `;
  // 紧跟原 album-header 之后
  const baseHeader = albumHeader || albumExportBtn?.closest('.album-header');
  if (baseHeader?.parentElement) {
    baseHeader.parentElement.insertBefore(selectionBar, baseHeader.nextSibling);
  }
  const selectionCountEl = selectionBar.querySelector('[data-role="count"]');

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
    if (selectionMode) exitSelectionMode({ silent: true });
    album.hidden = true;
    albumGrid.querySelectorAll('.album-cell').forEach((cell) => {
      const u = cell.dataset.url;
      if (u) URL.revokeObjectURL(u);
    });
    albumGrid.innerHTML = '';
  }

  async function renderAlbum() {
    const items = await Gallery.list();
    cachedItems = items;
    albumCountEl.textContent = String(items.length);
    albumGrid.innerHTML = '';
    if (items.length === 0) {
      albumEmpty.hidden = false;
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
      cell.addEventListener('click', () => onCellClick(it, cell));
      const remaining = remainingDevelop(it);
      if (remaining > 0) {
        cell.classList.add('developing');
        requestAnimationFrame(() => playDevelop(cell, remaining));
      }
      if (selectionMode && selectedIds.has(it.id)) {
        cell.classList.add('is-selected');
      }
      frag.appendChild(cell);
    }
    albumGrid.appendChild(frag);
  }

  function onCellClick(rec, cell) {
    if (selectionMode) {
      toggleSelected(rec.id, cell);
    } else {
      openDetail(rec);
    }
  }

  function toggleSelected(id, cell) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      cell.classList.remove('is-selected');
    } else {
      selectedIds.add(id);
      cell.classList.add('is-selected');
    }
    selectionCountEl.textContent = String(selectedIds.size);
    selectionBar.querySelector('.album-next-btn').disabled = selectedIds.size < 2;
  }

  function enterSelectionMode() {
    if (selectionMode) return;
    selectionMode = true;
    selectedIds.clear();
    album.classList.add('is-selecting');
    if (baseHeader) baseHeader.hidden = true;
    selectionBar.hidden = false;
    selectionCountEl.textContent = '0';
    selectionBar.querySelector('.album-next-btn').disabled = true;
  }

  function exitSelectionMode({ silent } = {}) {
    if (!selectionMode) return;
    selectionMode = false;
    selectedIds.clear();
    album.classList.remove('is-selecting');
    if (baseHeader) baseHeader.hidden = false;
    selectionBar.hidden = true;
    // 清掉每个 cell 的 selected 视觉
    albumGrid.querySelectorAll('.album-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
    if (!silent) onToast?.('已取消多选');
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

  async function exportAll() {
    const items = await Gallery.list();
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
      a.download = `dazz-roll-${new Date().toISOString().slice(0, 10)}.zip`;
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

  function onCollageEntry() {
    if (cachedItems.length < 2) {
      onToast?.('至少需要 2 张照片');
      return;
    }
    enterSelectionMode();
  }

  function gotoCollagePreview() {
    if (selectedIds.size < 2) {
      onToast?.('至少选 2 张');
      return;
    }
    // 按当前 cachedItems 顺序提取（保持时间倒序）
    const picks = cachedItems.filter((it) => selectedIds.has(it.id));
    if (picks.length < 2) {
      onToast?.('选中数据丢失');
      return;
    }
    collageOpen = true;
    openCollagePanel({
      items: picks,
      onToast,
      onClose: () => {
        collageOpen = false;
        // 退出多选回到普通相册
        exitSelectionMode({ silent: true });
      },
    });
  }

  // bind
  thumbBtn.addEventListener('click', openAlbum);
  albumCloseBtn.addEventListener('click', closeAlbum);
  closeModalBtn.addEventListener('click', closeDetail);
  deleteBtn.addEventListener('click', deleteCurrent);
  shareBtn?.addEventListener('click', shareCurrent);
  albumExportBtn.addEventListener('click', exportAll);
  collageBtn.addEventListener('click', onCollageEntry);
  selectionBar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') exitSelectionMode();
    else if (act === 'next') gotoCollagePreview();
  });

  return {
    refreshThumb,
    openAlbum,
    closeAlbum,
    closeDetail,
    isAlbumOpen() { return !album.hidden; },
    isDetailOpen() { return !modal.hidden; },
    isSelectionMode() { return selectionMode; },
    isCollageOpen() { return collageOpen; },
    exitSelectionMode,
  };
}
