import { buildLut } from './curves.js';
import { nc } from './nc.js';
import { fx } from './fx.js';
import { g } from './g.js';
import { d } from './d.js';

export const PRESETS = [nc, fx, g, d].map(buildLut);
