import { gauss, sCurve } from './curves.js';

// Fuji Pro 400H：青翠中性绿、自然肤色、低饱和的婚摄经典款。
export const pro400h = {
  id: 'H',
  name: 'Pro 400H',
  desc: 'H · Pastel',
  stampColor: '#9bd1a6',
  stampGlow: 'rgba(155, 209, 166, 0.6)',
  brandLabel: 'H · 400H',
  developMs: 0,
  grainAmp: 4,
  vignette: 0.18,
  mono: false,
  leak: false,
  curve(x) {
    // 低对比、提黑场（pastel 感）
    const base = 0.06 + sCurve(x, 0.95, 0.5) * 0.92;
    // 红：略压（避免肤色过红）
    const r = base - 0.02 * gauss(x, 0.55, 0.30);
    // 绿：中调显著提（标志性青翠绿）
    const g = base + 0.07 * gauss(x, 0.55, 0.28) + 0.02 * gauss(x, 0.30, 0.30);
    // 蓝：阴影偏青（绿蓝混调）、高光略低
    const b = base + 0.04 * gauss(x, 0.30, 0.25) - 0.03 * gauss(x, 0.85, 0.25);
    return [r, g, b];
  },
};
