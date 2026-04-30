import { sCurve } from './curves.js';

export const g = {
  id: 'G',
  name: 'Grain B&W',
  desc: 'G · Mono',
  stampColor: '#f4ede0',
  stampGlow: 'rgba(244, 237, 224, 0.45)',
  brandLabel: 'GRAIN ZERO',
  developMs: 0,
  grainAmp: 14,
  vignette: 0.34,
  mono: true,
  leak: false,
  curve(x) {
    const v = sCurve(x, 1.45, 0.48) - 0.03;
    return [v, v, v];
  },
};
