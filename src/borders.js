// 边框合成 + 水印烘焙。每个边框函数返回 { canvas, ctx, imgRect }，
// imgRect 是原图在结果画布上的位置，水印基于此矩形定位。
import { formatDate } from './utils/date.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bakeStamps(ctx, x, y, w, h, preset, showDate) {
  const fontPx = Math.round(h * 0.034);
  const padding = Math.round(h * 0.022);
  ctx.save();
  ctx.font = `700 ${Math.round(fontPx * 0.7)}px "Courier New", monospace`;
  ctx.fillStyle = 'rgba(255, 235, 200, 0.85)';
  ctx.shadowColor = preset.stampGlow;
  ctx.shadowBlur = 6;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(preset.id, x + padding, y + padding);
  if (showDate) {
    ctx.font = `700 ${fontPx}px "Courier New", monospace`;
    ctx.fillStyle = preset.stampColor;
    ctx.shadowColor = preset.stampGlow;
    ctx.shadowBlur = 8;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatDate(new Date()), x + w - padding, y + h - padding);
  }
  ctx.restore();
}

export const BORDERS = {
  none(src) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    return { canvas: c, ctx, imgRect: { x: 0, y: 0, w: src.width, h: src.height } };
  },
  '35mm'(src, p) {
    const w = src.width;
    const h = src.height;
    const bar = Math.round(h * 0.085);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h + bar * 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, bar);
    const holeW = bar * 0.5;
    const holeH = bar * 0.42;
    const gap = holeW * 1.7;
    const count = Math.max(1, Math.floor((w - holeW * 0.5) / gap));
    const totalSpan = (count - 1) * gap + holeW;
    const start = (w - totalSpan) / 2;
    ctx.fillStyle = '#1a1a1a';
    for (let i = 0; i < count; i++) {
      const xh = start + i * gap;
      roundRect(ctx, xh, (bar - holeH) / 2, holeW, holeH, holeH * 0.22);
      ctx.fill();
      roundRect(ctx, xh, c.height - bar + (bar - holeH) / 2, holeW, holeH, holeH * 0.22);
      ctx.fill();
    }
    ctx.fillStyle = p.stampColor;
    ctx.font = `700 ${Math.round(bar * 0.36)}px "Courier New", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${p.id} 200`, 14, c.height - bar / 2);
    ctx.textAlign = 'right';
    ctx.fillText('· 36 →', w - 14, c.height - bar / 2);
    return { canvas: c, ctx, imgRect: { x: 0, y: bar, w, h } };
  },
  polaroid(src) {
    const w = src.width;
    const h = src.height;
    const side = Math.round(w * 0.06);
    const top = Math.round(h * 0.06);
    const bottom = Math.round(h * 0.22);
    const c = document.createElement('canvas');
    c.width = w + side * 2;
    c.height = h + top + bottom;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f5efe1';
    ctx.fillRect(0, 0, c.width, c.height);
    const grd = ctx.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, 'rgba(0,0,0,0.04)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, side, top);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(side - 0.5, top - 0.5, w + 1, h + 1);
    return { canvas: c, ctx, imgRect: { x: side, y: top, w, h } };
  },
  square(src) {
    const w = src.width;
    const h = src.height;
    const side = Math.min(w, h);
    const sx = (w - side) / 2;
    const sy = (h - side) / 2;
    const border = Math.max(2, Math.round(side * 0.012));
    const c = document.createElement('canvas');
    c.width = side + border * 2;
    c.height = side + border * 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, sx, sy, side, side, border, border, side, side);
    return { canvas: c, ctx, imgRect: { x: border, y: border, w: side, h: side } };
  },
};

export const BORDER_ORDER = ['none', '35mm', 'polaroid', 'square'];
export const BORDER_LABELS = {
  none: '无边框',
  '35mm': '35mm 胶片',
  polaroid: '拍立得',
  square: '方画幅',
};

export function composeOutput(src, borderId, preset, showDate) {
  const fn = BORDERS[borderId] || BORDERS.none;
  const { canvas: out, ctx, imgRect } = fn(src, preset);
  bakeStamps(ctx, imgRect.x, imgRect.y, imgRect.w, imgRect.h, preset, showDate);
  return out;
}
