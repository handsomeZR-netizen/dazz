import { buildLut } from './curves.js';
import { nc } from './nc.js';
import { fx } from './fx.js';
import { g } from './g.js';
import { d } from './d.js';
import { portra } from './portra.js';
import { cinestill } from './cinestill.js';
import { ektar } from './ektar.js';
import { pro400h } from './pro400h.js';
import { hp5 } from './hp5.js';
import { lomo } from './lomo.js';

export const PRESETS = [nc, fx, g, d, portra, cinestill, ektar, pro400h, hp5, lomo].map(buildLut);
