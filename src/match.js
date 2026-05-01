// P2-17 自动色彩匹配：上传一张参考图 → 分析 RGB 直方图 → 生成 5 分位锚点（R/G/B 各一组）→
// 喂给 buildPresetFromSpec 形成一条 user preset。
//
// 核心思路（分位锚点法，而非完整 histogram matching）：
//   - 把图缩到 256×256，逐像素累计 R/G/B 计数
//   - 对每通道分别求 5 个累计分位 P5/P25/P50/P75/P95
//   - 锚点：input = 该 q 在中性 identity CDF 下的位置（即 q 本身）
//          output = 该 q 在参考图 CDF 下的实际亮度（即 percentile）
//   - 与 P2-12 的 4 锚点亮度曲线 + Catmull-Rom 同款数学，每通道独立曲线
//
// 这样得到的 LUT 对一张「参考」中性灰图近似 identity；对偏暖的参考图，红/黄通道分位更高
// → 渲染时把当前图朝那个色调推。
//
// 性能：256×256 = 65 536 像素，3×256 直方图 + 3 次累计；典型耗时 30-80ms。
//
// 导出：
//   analyzeReference(file) -> Promise<spec>
// 返回的 spec 形态（与 P2-12 兼容，并扩展了 channelAnchors / kind）：
//   {
//     id: '',                 // 由调用方分配（newUserPresetId）
//     name: '<根据文件名生成>',
//     isUser: true,
//     kind: 'match',
//     referenceName: 'IMG_xxx.JPG',
//     anchors: [...],         // 亮度轴锚点（为兼容 buildPresetFromSpec 仍提供，等于 RGB 平均）
//     channelAnchors: { r: [[x,y]..5], g: [...], b: [...] },
//     hsl: [6 段全 0],
//     grainAmp, vignette, stampColor,
//   }

const SAMPLE_SIZE = 256;
const QUANTILES = [0.05, 0.25, 0.50, 0.75, 0.95];

export async function analyzeReference(file, opts = {}) {
  if (!file) throw new Error('未选择参考图');
  const sampleSize = opts.sampleSize || SAMPLE_SIZE;

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const bitmap = await decodeBitmap(file, sampleSize);
  const imageData = drawToCanvas(bitmap, sampleSize);
  bitmap.close?.();

  const histos = buildHistograms(imageData);
  const channelAnchors = histos.map((h) => quantileAnchors(h, QUANTILES));
  const lumaAnchors = mergeLumaAnchors(channelAnchors);

  const referenceName = file.name || 'reference';
  const baseName = displayName(referenceName);
  const stampColor = pickStampColor(channelAnchors);

  const spec = {
    id: '',
    isUser: true,
    kind: 'match',
    referenceName,
    name: baseName,
    shortId: shortIdFromName(baseName),
    anchors: lumaAnchors,
    channelAnchors: {
      r: channelAnchors[0],
      g: channelAnchors[1],
      b: channelAnchors[2],
    },
    hsl: [
      { h: 0, s: 0, l: 0 },
      { h: 0, s: 0, l: 0 },
      { h: 0, s: 0, l: 0 },
      { h: 0, s: 0, l: 0 },
      { h: 0, s: 0, l: 0 },
      { h: 0, s: 0, l: 0 },
    ],
    grainAmp: 5,
    vignette: 0.18,
    stampColor,
  };

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  spec.analyzeMs = Math.round(t1 - t0);
  return spec;
}

// ============== 解码 + 缩放 ==============
async function decodeBitmap(file, sampleSize) {
  // 优先 createImageBitmap 的 resize（与 src/source.js 同源），失败再回退 canvas。
  try {
    return await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: sampleSize,
      resizeHeight: sampleSize,
      resizeQuality: 'medium',
    });
  } catch (_) {
    // ignore
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    bitmap = await createImageBitmap(file);
  }
  return bitmap;
}

function drawToCanvas(bitmap, sampleSize) {
  const w = sampleSize, h = sampleSize;
  let ctx;
  if (typeof OffscreenCanvas !== 'undefined') {
    const off = new OffscreenCanvas(w, h);
    ctx = off.getContext('2d', { willReadFrequently: true });
  } else {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    ctx = cv.getContext('2d', { willReadFrequently: true });
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// ============== 直方图 / 分位 ==============
function buildHistograms(imageData) {
  const data = imageData.data;
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  for (let i = 0, n = data.length; i < n; i += 4) {
    // 跳过完全透明像素
    if (data[i + 3] === 0) continue;
    r[data[i + 0]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
  }
  return [r, g, b];
}

// 在直方图上计算给定分位列表 q[]（0..1），返回锚点 [[q, value/255], ...] 升序。
// 端点用 (0,0) (1,1) 锁定，避免曲线在两端外溢。
function quantileAnchors(hist, qs) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (total === 0) {
    // 全空：identity
    return [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]];
  }
  const targets = qs.map((q) => Math.max(1, Math.min(total - 1, Math.round(q * total))));
  const values = new Array(qs.length);
  let acc = 0, ti = 0;
  for (let i = 0; i < 256 && ti < targets.length; i++) {
    acc += hist[i];
    while (ti < targets.length && acc >= targets[ti]) {
      values[ti] = i / 255;
      ti++;
    }
  }
  while (ti < targets.length) { values[ti] = 1; ti++; }

  // 锚点：x = qs[i]（identity 上的位置），y = values[i]（参考图上的实际值）
  // 外加 (0,0) 和 (1,1)，并合并过近的锚点。
  const raw = [[0, 0]];
  for (let i = 0; i < qs.length; i++) raw.push([qs[i], values[i]]);
  raw.push([1, 1]);

  // 单调化：让 y 不递减（避免曲线倒挂）
  for (let i = 1; i < raw.length; i++) {
    if (raw[i][1] < raw[i - 1][1]) raw[i][1] = raw[i - 1][1];
  }
  // x 单调化（理论上 qs 已升序+端点）
  for (let i = 1; i < raw.length; i++) {
    if (raw[i][0] <= raw[i - 1][0]) raw[i][0] = Math.min(1, raw[i - 1][0] + 0.001);
  }
  // 合并 x 距离过近的锚点（避免曲线插值数值不稳）
  const merged = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    if (raw[i][0] - last[0] < 0.02) {
      // 用平均 y
      merged[merged.length - 1] = [
        Math.min(1, last[0] + 0.02),
        (last[1] + raw[i][1]) * 0.5,
      ];
    } else {
      merged.push(raw[i]);
    }
  }
  // 截断 y 到 [0,1]
  for (const p of merged) {
    p[0] = clamp01(p[0]);
    p[1] = clamp01(p[1]);
  }
  return merged;
}

// 把 RGB 三组锚点的 y 平均，作为亮度兼容轴（buildPresetFromSpec 默认使用 spec.anchors）。
function mergeLumaAnchors(channelAnchors) {
  const [ra, ga, ba] = channelAnchors;
  const len = Math.min(ra.length, ga.length, ba.length);
  const out = [];
  for (let i = 0; i < len; i++) {
    const x = (ra[i][0] + ga[i][0] + ba[i][0]) / 3;
    // ITU-R BT.601 灰度系数（保留色相中性）
    const y = 0.2989 * ra[i][1] + 0.5870 * ga[i][1] + 0.1140 * ba[i][1];
    out.push([clamp01(x), clamp01(y)]);
  }
  return out;
}

// 简单地由 P75 处的 RGB 推一个水印色（让 chip 视觉接近参考的亮调色温）。
function pickStampColor(channelAnchors) {
  const [ra, ga, ba] = channelAnchors;
  // 找到 x ≈ 0.75 的锚点（quantileAnchors 中的第 4 个，索引取倒数第 2）
  const idx = Math.max(0, ra.length - 2);
  const r = Math.round(clamp01(ra[idx][1]) * 255);
  const g = Math.round(clamp01(ga[idx][1]) * 255);
  const b = Math.round(clamp01(ba[idx][1]) * 255);
  return '#' + toHex2(r) + toHex2(g) + toHex2(b);
}

// ============== 文件名 → 预设名 ==============
function displayName(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim();
  if (!base) return '匹配';
  // 截到 12 字符（与 validateName 上限一致）
  return base.slice(0, 12);
}

function shortIdFromName(name) {
  const cleaned = String(name || '').replace(/\s+/g, '').toUpperCase();
  if (!cleaned) return 'MTC';
  return cleaned.slice(0, 3);
}

// ============== utils ==============
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function toHex2(n) {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, '0');
}
