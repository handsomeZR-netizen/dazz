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
import { Gallery } from '../gallery/db.js';
import { buildPresetFromSpec } from './user.js';

// 内置 10 款预设。PRESETS 是一个可变数组（运行时会向尾部 push 用户预设）。
// 任何引用方都应直接读取 PRESETS（数组身份不变，只 push/splice），见 ui/preset-strip.js。
export const PRESETS = [nc, fx, g, d, portra, cinestill, ektar, pro400h, hp5, lomo].map(buildLut);

// 内置预设的数量（用户预设永远 append 在这之后）
export const BUILTIN_COUNT = PRESETS.length;

// 启动期：从 IndexedDB 读取所有用户 preset spec，构造并 attach 到 PRESETS 末尾。
// 失败时静默吞掉（用 console.warn），不要阻塞渲染。
export async function loadAndAttachUserPresets() {
  let specs = [];
  try {
    specs = await Gallery.userPresetsList();
  } catch (e) {
    console.warn('[presets] load user presets failed:', e);
    return [];
  }
  const attached = [];
  for (const spec of specs) {
    try {
      const preset = buildLut(buildPresetFromSpec(spec));
      PRESETS.push(preset);
      attached.push(preset);
    } catch (e) {
      console.warn('[presets] build user preset failed:', spec?.id, e);
    }
  }
  return attached;
}

// 添加一条用户 spec（外部已经写入 IndexedDB）。返回构造好的 preset，已 push 到 PRESETS 末尾。
export function attachUserSpec(spec) {
  const preset = buildLut(buildPresetFromSpec(spec));
  PRESETS.push(preset);
  return preset;
}

// 从 PRESETS 中移除指定 id。返回被移除的索引（找不到返回 -1）。
export function detachUserPreset(id) {
  const idx = PRESETS.findIndex((p) => p.id === id);
  if (idx < 0) return -1;
  PRESETS.splice(idx, 1);
  return idx;
}
