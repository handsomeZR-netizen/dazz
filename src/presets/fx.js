import { gauss, sCurve } from './curves.js';

export const fx = {
  id: 'FX',
  name: 'Fujifilm',
  desc: 'FX · Cinematic',
  stampColor: '#ffc857',
  stampGlow: 'rgba(255, 200, 87, 0.6)',
  brandLabel: 'FX-CINE',
  developMs: 0,
  grainAmp: 4,
  vignette: 0.18,
  mono: false,
  leak: false,
  curve(x) {
    const s = sCurve(x, 1.25, 0.5);
    const r = s - 0.04 * gauss(x, 0.30, 0.25) + 0.03 * gauss(x, 0.85, 0.20);
    const g = s + 0.05 * gauss(x, 0.55, 0.25) - 0.02 * gauss(x, 0.20, 0.20);
    const b = s + 0.06 * gauss(x, 0.25, 0.25) - 0.05 * gauss(x, 0.85, 0.20);
    return [r, g, b];
  },
};
