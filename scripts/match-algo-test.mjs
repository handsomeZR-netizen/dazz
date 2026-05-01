// 离线快速测试 P2-17 的核心算法：合成 5 种典型色彩分布，
// 对每张图算出 5 分位锚点，并打印「每通道在 50% 分位的 LUT 输出值」，
// 用于验证不同色调（暖/冷/低对比/高对比/偏绿）会得到合理的曲线方向。
//
// 这里直接 inline 算法（与 src/match.js 一致），避免引 ImageData 依赖。

import { performance } from 'node:perf_hooks';

const QUANTILES = [0.05, 0.25, 0.50, 0.75, 0.95];
const SAMPLE = 256;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function quantileAnchors(hist, qs) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (total === 0) {
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
  const raw = [[0, 0]];
  for (let i = 0; i < qs.length; i++) raw.push([qs[i], values[i]]);
  raw.push([1, 1]);
  for (let i = 1; i < raw.length; i++) {
    if (raw[i][1] < raw[i - 1][1]) raw[i][1] = raw[i - 1][1];
  }
  for (let i = 1; i < raw.length; i++) {
    if (raw[i][0] <= raw[i - 1][0]) raw[i][0] = Math.min(1, raw[i - 1][0] + 0.001);
  }
  const merged = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    if (raw[i][0] - last[0] < 0.02) {
      merged[merged.length - 1] = [Math.min(1, last[0] + 0.02), (last[1] + raw[i][1]) * 0.5];
    } else {
      merged.push(raw[i]);
    }
  }
  return merged.map((p) => [clamp01(p[0]), clamp01(p[1])]);
}

function makeCurve(anchors) {
  const pts = [...anchors].map((p) => [clamp01(p[0]), clamp01(p[1])]);
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return (x) => clamp01(x);
  function eval4(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  return function (x) {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let i = 0;
    for (; i < pts.length - 1; i++) if (x >= pts[i][0] && x <= pts[i + 1][0]) break;
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const t = (x - x1) / Math.max(1e-6, x2 - x1);
    const [_, y0] = i === 0 ? [2 * x1 - x2, 2 * y1 - y2] : pts[i - 1];
    const [__, y3] = i + 2 >= pts.length ? [2 * x2 - x1, 2 * y2 - y1] : pts[i + 2];
    let y = eval4(y0, y1, y2, y3, t);
    return clamp01(y);
  };
}

// 合成一个图的 RGB 三通道直方图。每像素从 [meanR, meanG, meanB] 周围加噪声。
function synthesize(meanR, meanG, meanB, spread) {
  const N = SAMPLE * SAMPLE;
  const hR = new Uint32Array(256);
  const hG = new Uint32Array(256);
  const hB = new Uint32Array(256);
  // 三段「内容」：30% 暗色、40% 中调、30% 亮色，让分位有意义
  for (let p = 0; p < N; p++) {
    const seg = p < 0.30 * N ? 0 : p < 0.70 * N ? 1 : 2;
    const base = seg === 0 ? 0.18 : seg === 1 ? 0.50 : 0.82;
    const tintR = meanR / 128 - 1; // [-1..1]
    const tintG = meanG / 128 - 1;
    const tintB = meanB / 128 - 1;
    const jitter = () => (Math.random() - 0.5) * spread;
    const r = clamp01(base + tintR * 0.18 + jitter()) * 255;
    const g = clamp01(base + tintG * 0.18 + jitter()) * 255;
    const b = clamp01(base + tintB * 0.18 + jitter()) * 255;
    hR[Math.round(r)]++;
    hG[Math.round(g)]++;
    hB[Math.round(b)]++;
  }
  return [hR, hG, hB];
}

function run(name, meanR, meanG, meanB, spread) {
  const t0 = performance.now();
  const [hR, hG, hB] = synthesize(meanR, meanG, meanB, spread);
  const aR = quantileAnchors(hR, QUANTILES);
  const aG = quantileAnchors(hG, QUANTILES);
  const aB = quantileAnchors(hB, QUANTILES);
  const fR = makeCurve(aR);
  const fG = makeCurve(aG);
  const fB = makeCurve(aB);
  const t1 = performance.now();
  // 对中性灰输入 (0.5) 看 LUT 输出
  const at50 = [fR(0.5), fG(0.5), fB(0.5)].map((v) => Math.round(v * 255));
  const at25 = [fR(0.25), fG(0.25), fB(0.25)].map((v) => Math.round(v * 255));
  const at75 = [fR(0.75), fG(0.75), fB(0.75)].map((v) => Math.round(v * 255));
  console.log(`[${name}] 合成耗时 ${(t1 - t0).toFixed(1)}ms`);
  console.log(`  P25 → R/G/B = ${at25.join(' / ')}`);
  console.log(`  P50 → R/G/B = ${at50.join(' / ')}`);
  console.log(`  P75 → R/G/B = ${at75.join(' / ')}`);
  return { at25, at50, at75 };
}

console.log('=== P2-17 算法离线测试（合成直方图） ===\n');

run('A 中性灰', 128, 128, 128, 0.03);
run('B 暖色（偏红黄）', 200, 150, 90, 0.03);
run('C 冷色（偏蓝青）', 90, 130, 200, 0.03);
run('D 偏绿（森林）', 110, 170, 100, 0.03);
run('E 高对比+品红', 180, 80, 160, 0.05);

console.log('\n期望：B 在 P50 时 R>G>B；C 在 P50 时 B>G>R；D 在 P50 时 G 最大；A 三通道近似相等。');
