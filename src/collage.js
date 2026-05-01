// 拼贴合成：把多张照片按列数 / 间距 / 背景色拼成一张 jpeg。
// 不依赖 DOM UI，便于 ui/collage.js 复用做预览与导出。

const BG_PRESETS = {
  black: '#000000',
  white: '#ffffff',
  film: '#f5efe1',
};

export function resolveBg(bg) {
  if (typeof bg === 'string') {
    if (BG_PRESETS[bg]) return BG_PRESETS[bg];
    if (bg.startsWith('#')) return bg;
  }
  return BG_PRESETS.black;
}

async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fallback below
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e?.error || new Error('image load failed'));
    img.src = URL.createObjectURL(blob);
  });
}

function bitmapSize(bm) {
  return {
    w: bm.width || bm.naturalWidth || 0,
    h: bm.height || bm.naturalHeight || 0,
  };
}

/**
 * 计算拼贴布局：每张图按列宽等比缩放（保持比例），每行高度 = 该行中所有缩放后图像的最大高度。
 * 不匹配的最后一行（图数 < 列数）水平居中。
 *
 * @returns {{
 *   canvasW: number, canvasH: number,
 *   cellW: number,
 *   cells: Array<{ x: number, y: number, w: number, h: number, idx: number }>,
 * }}
 */
export function planCollage(sizes, { columns, gap, targetWidth }) {
  const cols = Math.max(1, columns | 0);
  const g = Math.max(0, gap | 0);
  const tw = Math.max(64, targetWidth | 0);
  const cellW = Math.max(1, Math.floor((tw - g * (cols + 1)) / cols));

  const rows = [];
  for (let i = 0; i < sizes.length; i += cols) {
    rows.push(sizes.slice(i, i + cols));
  }

  const cells = [];
  let yCursor = g;
  rows.forEach((row, rIdx) => {
    // 每张缩放后高度
    const heights = row.map((s) => (s.w > 0 ? Math.round(cellW * (s.h / s.w)) : cellW));
    const rowH = Math.max(...heights);
    // 居中（最后一行不足列数时整行居中）
    const rowItemCount = row.length;
    const rowSpan = rowItemCount * cellW + (rowItemCount - 1) * g;
    const xStart = Math.round((tw - rowSpan) / 2);
    for (let i = 0; i < rowItemCount; i += 1) {
      const x = xStart + i * (cellW + g);
      const h = heights[i];
      const y = yCursor + Math.round((rowH - h) / 2);
      cells.push({
        x,
        y,
        w: cellW,
        h,
        idx: rIdx * cols + i,
      });
    }
    yCursor += rowH + g;
  });

  return {
    canvasW: tw,
    canvasH: yCursor, // last gap already added at end
    cellW,
    cells,
  };
}

/**
 * 实际把图像绘制到 canvas，并把结果作为 blob 返回。
 * 当 previewMaxWidth 给定时使用预览缩略尺寸（更快、更省内存）。
 */
export async function composeCollage(items, opts = {}) {
  const {
    columns = 2,
    gap = 8,
    bg = 'black',
    previewMaxWidth = null, // 预览模式时限制宽度
    quality = 0.9,
    mime = 'image/jpeg',
  } = opts;

  if (!items || items.length === 0) {
    throw new Error('no items');
  }

  const bitmaps = await Promise.all(items.map((it) => loadBitmap(it.blob)));
  const sizes = bitmaps.map(bitmapSize);

  // 决定最终画布宽度：取所选图的最大原始宽 * columns 上限（再夹到合理范围）
  // 预览模式 → 限制宽度
  let targetWidth;
  if (previewMaxWidth) {
    targetWidth = previewMaxWidth;
  } else {
    const repWidth = Math.max(...sizes.map((s) => s.w || 0)) || 1080;
    targetWidth = Math.max(640, Math.min(4096, repWidth * columns));
  }

  const plan = planCollage(sizes, { columns, gap, targetWidth });
  const canvas = document.createElement('canvas');
  canvas.width = plan.canvasW;
  canvas.height = plan.canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = resolveBg(bg);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const cell of plan.cells) {
    const bm = bitmaps[cell.idx];
    if (!bm) continue;
    ctx.drawImage(bm, cell.x, cell.y, cell.w, cell.h);
  }

  // 释放
  for (const bm of bitmaps) {
    if (bm && typeof bm.close === 'function') {
      try { bm.close(); } catch { /* noop */ }
    }
  }

  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('toBlob returned null'));
    }, mime, quality);
  });
}

export const COLLAGE_BG_PRESETS = BG_PRESETS;
