import { gauss, sCurve } from './curves.js';

// Lomo LC-A：高对比 + 重暗角 + 光斑 + 偏蓝青阴影 + 洋红高光，玩具机经典风。
export const lomo = {
  id: 'L',
  name: 'Lomo',
  desc: 'L · Lo-Fi',
  stampColor: '#ff3da0',
  stampGlow: 'rgba(255, 61, 160, 0.7)',
  brandLabel: 'L · LC-A',
  developMs: 0,
  grainAmp: 8,
  vignette: 0.42,
  mono: false,
  leak: true,
  curve(x) {
    // 强 S 曲线 + 略压黑场，做出深邃阴影
    const base = sCurve(x, 1.45, 0.5) - 0.02;
    // 红：高光偏洋红
    const r = base + 0.07 * gauss(x, 0.85, 0.22) + 0.02;
    // 绿：中调略压（让红 / 蓝抢眼）
    const g = base - 0.05 * gauss(x, 0.55, 0.28);
    // 蓝：阴影强抬（青蓝阴影）+ 高光也提一点（洋红 = 红+蓝）
    const b = base + 0.10 * gauss(x, 0.20, 0.22) + 0.05 * gauss(x, 0.85, 0.22);
    return [r, g, b];
  },
};
