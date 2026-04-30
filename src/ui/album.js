// 胶卷相册 + 详情视图 + 缩略图刷新 + 显影动画 + zip 导出。
import { Gallery } from '../gallery/db.js';
import { buildZip } from '../gallery/zip.js';

export function createAlbum({ refs, onToast }) {
  const {
    album, albumGrid, albumEmpty, albumCloseBtn, albumExportBtn, albumCountEl,
    modal, modalImg, modalMeta, closeModalBtn, deleteBtn, shareBtn, downloadBtn,
    thumbBtn, thumbCount,
  } = refs;

  let currentDetail = null;
  let thumbObjUrl = null;
  let detailObjUrl = null;

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

  async function renderAlbum() {
    const items = await Gallery.list();
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

  // bind
  thumbBtn.addEventListener('click', openAlbum);
  albumCloseBtn.addEventListener('click', closeAlbum);
  closeModalBtn.addEventListener('click', closeDetail);
  deleteBtn.addEventListener('click', deleteCurrent);
  shareBtn?.addEventListener('click', shareCurrent);
  albumExportBtn.addEventListener('click', exportAll);

  return {
    refreshThumb,
    openAlbum,
    closeAlbum,
    closeDetail,
    isAlbumOpen() { return !album.hidden; },
    isDetailOpen() { return !modal.hidden; },
  };
}
