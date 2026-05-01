import { gauss, sCurve } from './curves.js';

// CineStill 800T：钨丝灯电影质感。阴影青蓝、高光泛红橙、颗粒明显。
// 红光晕（halation）由 shader 处理，预设里用偏红 stampGlow + 大颗粒近似。
export const cinestill = {
  id: 'C',
  name: 'CineStill 800T',
  desc: 'C · Tungsten',
  stampColor: '#ff5b6b',
  stampGlow: 'rgba(255, 91, 107, 0.7)',
  brandLabel: 'C · 800T',
  developMs: 1200,
  grainAmp: 9,
  vignette: 0.28,
  mono: false,
  leak: false,
  curve(x) {
    const base = sCurve(x, 1.15, 0.48);
    // 红：高光强提（钨丝高光泛红橙）
    const r = base + 0.10 * gauss(x, 0.82, 0.28) + 0.03;
    // 绿：略压（青蓝阴影需要降绿）
    const g = base - 0.04 * gauss(x, 0.30, 0.30) + 0.02 * gauss(x, 0.70, 0.25);
    // 蓝：阴影强抬（青蓝调），高光略压
    const b = base + 0.10 * gauss(x, 0.25, 0.22) - 0.04 * gauss(x, 0.85, 0.20);
    return [r, g, b];
  },
};
