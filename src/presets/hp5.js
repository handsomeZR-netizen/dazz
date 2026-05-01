import { sCurve } from './curves.js';

// Ilford HP5 Plus：经典 ISO 400 黑白，中等对比，明显但顺滑的颗粒。
export const hp5 = {
  id: 'I',
  name: 'HP5',
  desc: 'I · Mono Classic',
  stampColor: '#cfcfcf',
  stampGlow: 'rgba(207, 207, 207, 0.4)',
  brandLabel: 'I · HP5+',
  developMs: 0,
  grainAmp: 11,
  vignette: 0.26,
  mono: true,
  leak: false,
  curve(x) {
    // 中等 S 曲线，比 G 预设更柔，保留更多中间灰
    const v = sCurve(x, 1.20, 0.50) - 0.01;
    return [v, v, v];
  },
};
