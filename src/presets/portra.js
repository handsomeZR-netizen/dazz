import { gauss, sCurve } from './curves.js';

// Portra 400：柔肤、低对比、暖橘高光、蓝紫阴影。家庭 / 人像金标。
export const portra = {
  id: 'P',
  name: 'Portra 400',
  desc: 'P · Skin Tone',
  stampColor: '#f7c89c',
  stampGlow: 'rgba(247, 200, 156, 0.65)',
  brandLabel: 'P · 400',
  developMs: 0,
  grainAmp: 5,
  vignette: 0.16,
  mono: false,
  leak: false,
  curve(x) {
    // 整体抬黑场 + 柔 S 曲线，避免对比过强
    const base = 0.04 + sCurve(x, 1.05, 0.5) * 0.96;
    // 红：高光偏橘黄，阴影正常
    const r = base + 0.06 * gauss(x, 0.80, 0.25) + 0.02 * gauss(x, 0.55, 0.30);
    // 绿：略低于红，柔肤需要
    const g = base + 0.02 * gauss(x, 0.60, 0.30) - 0.01;
    // 蓝：阴影偏紫（提一点蓝），高光偏黄（压蓝）
    const b = base + 0.05 * gauss(x, 0.20, 0.22) - 0.07 * gauss(x, 0.85, 0.25);
    return [r, g, b];
  },
};
