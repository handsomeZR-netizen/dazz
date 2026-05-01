// 用户自定义预设：spec 持久化 + 由 spec 构造可被渲染器使用的 preset 对象。
//
// 两种 spec 形态（共存于 IndexedDB userPresets store，按 kind 字段区分）：
//
// (a) 1D LUT（参数化曲线 + HSL 段），P2-12 编辑器产物，kind 缺省（向后兼容）：
// {
//   id: 'U_xxx', name, isUser: true,
//   anchors: [...], hsl: [...], grainAmp, vignette, stampColor,
// }
//
// (b) 3D LUT（导入自 .cube），P2-13 引入：
// {
//   id: 'U_xxx', name, isUser: true,
//   kind: '3d-lut',
//   lutSize: 33,                              // N（通常 17/33/64）
//   lutData: Uint8Array(N*N*N*3),             // 体素 r 最快、b 最慢；RGB 三个分量
//   grainAmp: 0, vignette: 0,                 // 默认 0；3D LUT 自带颜色，不再叠默认杂项
//   stampColor: '#ff8a3d',
// }
//
// HSL 在 1D-LUT 管线下是近似实现：每段被建模为「围绕一个亮度中心 mu 的高斯权重」附加 RGB tint。
// 这样虽不如 3D LUT 严谨，但与内置 10 款预设的 gauss-band 风格一致，且对编辑器交互足够直观。

import { gauss } from './curves.js';

// 6 个色相段。mu 是该色调被认为出现的平均亮度（用于在 LUT 上加权）。
// rgb 是该色调的归一化 RGB 方向。
const HSL_BANDS = [
  { key: 'R', label: '红', mu: 0.45, rgb: [1.00, 0.20, 0.20] },
  { key: 'Y', label: '黄', mu: 0.78, rgb: [1.00, 0.90, 0.30] },
  { key: 'G', label: '绿', mu: 0.55, rgb: [0.30, 0.90, 0.40] },
  { key: 'C', label: '青', mu: 0.62, rgb: [0.30, 0.85, 0.95] },
  { key: 'B', label: '蓝', mu: 0.40, rgb: [0.25, 0.45, 1.00] },
  { key: 'M', label: '品', mu: 0.55, rgb: [0.95, 0.40, 0.95] },
];
const BAND_SIGMA = 0.22;

export function getHslBands() {
  return HSL_BANDS.map((b) => ({ ...b, rgb: [...b.rgb] }));
}

// Catmull-Rom 单调插值。给 4 个锚点 [[x0,y0]..[x3,y3]]（x 升序），返回函数 f(x) -> y in [0,1]。
// 端点采用「镜像」方式生成虚拟控制点，保证两端不外溢。
export function makeCurve(anchors) {
  // 拷贝并按 x 升序
  const pts = [...anchors].map((p) => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))]);
  pts.sort((a, b) => a[0] - b[0]);
  // 修正首尾 x（0 / 1 锚点理论存在）
  if (pts.length < 2) return (x) => Math.min(1, Math.max(0, x));

  function evalSegment(p0, p1, p2, p3, t) {
    // Catmull-Rom uniform
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  return function f(x) {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    // 找包含 x 的段 i..i+1
    let i = 0;
    for (; i < pts.length - 1; i++) {
      if (x >= pts[i][0] && x <= pts[i + 1][0]) break;
    }
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const t = (x - x1) / Math.max(1e-6, x2 - x1);

    // 镜像端点
    const [x0, y0] = i === 0 ? [2 * x1 - x2, 2 * y1 - y2] : pts[i - 1];
    const [x3, y3] = i + 2 >= pts.length ? [2 * x2 - x1, 2 * y2 - y1] : pts[i + 2];

    // 仅对 y 做 Catmull-Rom，x 用线性 t（够用）
    let y = evalSegment(y0, y1, y2, y3, t);
    if (y < 0) y = 0; else if (y > 1) y = 1;
    void x0; void x3;
    return y;
  };
}

// 把 spec 转成 preset 对象（不 buildLut，由调用方决定 / 或在 attachLut 之后挂上）。
// preset 形态与内置一致：{ id, name, desc, stampColor, stampGlow, brandLabel, developMs,
//                         grainAmp, vignette, mono, leak, curve(x)->[r,g,b] }
//
// 当 spec.channelAnchors 存在（P2-17 自动色彩匹配）时，curve 直接用三条独立曲线，
// 不再叠 HSL 段（match 出来的 hsl 全 0，叠了也无效，但跳过更省 CPU）。
export function buildPresetFromSpec(spec) {
  const id = spec.id;
  const name = spec.name || id;
  const shortId = (spec.shortId || name).slice(0, 3).toUpperCase();
  const isMatch = spec.kind === 'match' && spec.channelAnchors;

  let curveFn;
  if (isMatch) {
    const cR = makeCurve(spec.channelAnchors.r);
    const cG = makeCurve(spec.channelAnchors.g);
    const cB = makeCurve(spec.channelAnchors.b);
    curveFn = (x) => [cR(x), cG(x), cB(x)];
  } else {
    const curve = makeCurve(spec.anchors);
    // 每段贡献的 rgb 偏移因子（saturation 让 tint 拉向其 rgb，lightness 全通道整体抬升）
    const bandFns = (spec.hsl || []).slice(0, HSL_BANDS.length).map((cfg, idx) => {
      const band = HSL_BANDS[idx];
      const sNorm = (cfg.s || 0) / 100;
      const lNorm = (cfg.l || 0) / 100;
      const hueShift = (cfg.h || 0) / 100; // 在 -1..1 之间，向相邻段倾斜
      // 简单 hue shift：对该段的 rgb 与「相邻 mu」rgb 之间插值
      const next = HSL_BANDS[(idx + 1) % HSL_BANDS.length].rgb;
      const prev = HSL_BANDS[(idx + HSL_BANDS.length - 1) % HSL_BANDS.length].rgb;
      const dir = hueShift >= 0
        ? lerp3(band.rgb, next, hueShift)
        : lerp3(band.rgb, prev, -hueShift);
      return function apply(x, rgb) {
        const w = gauss(x, band.mu, BAND_SIGMA);
        // saturation：把当前 [y,y,y] 拉向 dir 方向（dir - y）
        const y = (rgb[0] + rgb[1] + rgb[2]) / 3;
        rgb[0] += sNorm * w * (dir[0] - y) + lNorm * w * 0.18;
        rgb[1] += sNorm * w * (dir[1] - y) + lNorm * w * 0.18;
        rgb[2] += sNorm * w * (dir[2] - y) + lNorm * w * 0.18;
      };
    });
    curveFn = (x) => {
      const y = curve(x);
      const rgb = [y, y, y];
      for (const fn of bandFns) fn(x, rgb);
      return rgb;
    };
  }

  return {
    id,
    shortId,
    name,
    desc: `${shortId} · ${name}`,
    stampColor: spec.stampColor || '#ff8a3d',
    stampGlow: hexToGlow(spec.stampColor || '#ff8a3d'),
    brandLabel: shortId + (isMatch ? '-MTC' : '-USR'),
    developMs: 0,
    grainAmp: clamp(spec.grainAmp ?? 6, 0, 20),
    vignette: clamp(spec.vignette ?? 0.2, 0, 0.5),
    mono: false,
    leak: false,
    isUser: true,
    spec, // 保留原始 spec，便于「再编辑」（未来）
    curve: curveFn,
  };
}

// 从 3D LUT spec 构造 preset 对象。preset 字段沿用内置 schema，
// 额外携带 kind/lutSize/lutData 供 GL 渲染器走 3D 路径。
// 同时给出从 .cube 体素「主对角线」抽出的 1D 近似 LUT，作为 CPU 路径回退。
export function buildPresetFrom3DLutSpec(spec) {
  const id = spec.id;
  const name = spec.name || id;
  const shortId = (spec.shortId || name).slice(0, 3).toUpperCase();
  const N = spec.lutSize | 0;
  const data = spec.lutData;
  if (!N || !(data instanceof Uint8Array) || data.length !== N * N * N * 3) {
    throw new Error('3D LUT spec 数据无效');
  }
  // 主对角线近似（r=g=b=t）抽 256 个 1D 采样：CPU 路径退化用，与 GL 路径不完全一致但够看。
  const lutR = new Uint8ClampedArray(256);
  const lutG = new Uint8ClampedArray(256);
  const lutB = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (N - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(N - 1, i0 + 1);
    const f = t - i0;
    const off0 = (((i0 * N) + i0) * N + i0) * 3;
    const off1 = (((i1 * N) + i1) * N + i1) * 3;
    lutR[i] = (data[off0 + 0] * (1 - f) + data[off1 + 0] * f) | 0;
    lutG[i] = (data[off0 + 1] * (1 - f) + data[off1 + 1] * f) | 0;
    lutB[i] = (data[off0 + 2] * (1 - f) + data[off1 + 2] * f) | 0;
  }
  return {
    id,
    shortId,
    name,
    desc: `${shortId} · ${name}`,
    stampColor: spec.stampColor || '#7fc8ff',
    stampGlow: hexToGlow(spec.stampColor || '#7fc8ff'),
    brandLabel: shortId + '-CUBE',
    developMs: 0,
    grainAmp: clamp(spec.grainAmp ?? 0, 0, 20),
    vignette: clamp(spec.vignette ?? 0, 0, 0.5),
    mono: false,
    leak: false,
    isUser: true,
    spec,
    // 3D LUT 渲染所需字段
    kind: '3d-lut',
    lutSize: N,
    lutData: data,
    // 1D 退化字段，CPU 路径与 buildLut 直接复用
    lutR,
    lutG,
    lutB,
  };
}

// ============== 默认 spec（编辑器初次打开） ==============
export function defaultSpec() {
  return {
    id: '',
    name: '',
    isUser: true,
    anchors: [[0, 0], [0.33, 0.33], [0.67, 0.67], [1, 1]],
    hsl: HSL_BANDS.map(() => ({ h: 0, s: 0, l: 0 })),
    grainAmp: 6,
    vignette: 0.18,
    stampColor: '#ff8a3d',
  };
}

// ============== 名称校验 ==============
const RESERVED_IDS = new Set(['NC', 'FX', 'G', 'D', 'P', 'C', 'E', 'H', 'I', 'L']);

export function validateName(name) {
  const s = String(name || '').trim();
  if (!s) return '名称不能为空';
  if (s.length > 12) return '名称需 1-12 字符';
  const upper = s.toUpperCase();
  if (RESERVED_IDS.has(upper)) return `不能与内置预设同名（${upper}）`;
  return null;
}

export function newUserPresetId() {
  return 'U_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ============== 工具 ==============
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function hexToGlow(hex) {
  // #rrggbb -> rgba(r,g,b,0.6)
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'rgba(255,138,61,0.6)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.6)`;
}
