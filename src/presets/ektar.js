import { gauss, sCurve } from './curves.js';

// Kodak Ektar 100：风光金标。强饱和、强对比、红绿浓郁、蓝天通透。
export const ektar = {
  id: 'E',
  name: 'Ektar 100',
  desc: 'E · Vivid',
  stampColor: '#ffb347',
  stampGlow: 'rgba(255, 179, 71, 0.7)',
  brandLabel: 'E · 100',
  developMs: 0,
  grainAmp: 3,
  vignette: 0.22,
  mono: false,
  leak: false,
  curve(x) {
    // 强 S 曲线给冲击力
    const base = sCurve(x, 1.35, 0.5);
    // 红：中调到高光强提（典型的 Ektar 红）
    const r = base + 0.08 * gauss(x, 0.65, 0.25) + 0.04 * gauss(x, 0.85, 0.20);
    // 绿：中调强提（草绿 / 树绿浓郁）
    const g = base + 0.06 * gauss(x, 0.55, 0.28) - 0.02 * gauss(x, 0.20, 0.20);
    // 蓝：高光略压（蓝天不发青）、阴影微提
    const b = base + 0.03 * gauss(x, 0.30, 0.25) - 0.06 * gauss(x, 0.85, 0.25);
    return [r, g, b];
  },
};
