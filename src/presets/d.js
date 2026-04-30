import { gauss } from './curves.js';

export const d = {
  id: 'D',
  name: 'Disposable',
  desc: 'D · Single Use',
  stampColor: '#ff5b5b',
  stampGlow: 'rgba(255, 91, 91, 0.7)',
  brandLabel: 'D · SINGLE',
  developMs: 3000,
  grainAmp: 9,
  vignette: 0.22,
  mono: false,
  leak: true,
  curve(x) {
    const lift = 0.09;
    const matte = lift + 0.82 * x + 0.03 * Math.pow(x, 0.6);
    const r = matte + 0.06 * gauss(x, 0.85, 0.25) + 0.04 * gauss(x, 0.40, 0.30);
    const g = matte - 0.04 * gauss(x, 0.85, 0.25) - 0.02;
    const b = matte + 0.05 * gauss(x, 0.85, 0.25) - 0.03 * gauss(x, 0.30, 0.25);
    return [r, g, b];
  },
};
