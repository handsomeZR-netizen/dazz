import { gauss } from './curves.js';

export const nc = {
  id: 'NC',
  name: 'Nostalgic',
  desc: 'NC · Nostalgic',
  stampColor: '#ff8a3d',
  stampGlow: 'rgba(255, 138, 61, 0.7)',
  brandLabel: 'NC-FILM',
  developMs: 1500,
  grainAmp: 7,
  vignette: 0.28,
  mono: false,
  leak: false,
  curve(x) {
    const lift = 0.06;
    const matte = lift + 0.89 * x + 0.05 * Math.pow(x, 0.7);
    const r = matte + 0.10 * gauss(x, 0.75, 0.30) - 0.03 * gauss(x, 0.15, 0.20);
    const g = matte + 0.04 * gauss(x, 0.65, 0.30) - 0.02;
    const b = matte + 0.08 * gauss(x, 0.20, 0.25) - 0.10 * gauss(x, 0.80, 0.30);
    return [r, g, b];
  },
};
