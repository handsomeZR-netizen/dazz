import { composeOutput, BORDER_ORDER } from './borders.js';
import { Gallery } from './gallery/db.js';
import { createRenderer } from './renderer/index.js';
import { resizeCanvas } from './camera.js';
import { imageSource } from './source.js';
import { centerCrop } from './utils/frame.js';

const MAX_PHOTOS = 200;

function makeCanvas() {
  return document.createElement('canvas');
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片编码失败'));
    }, 'image/jpeg', 0.92);
  });
}

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function processOne(file, ctx, opts) {
  const source = await imageSource(file);
  try {
    const { canvas, renderer } = ctx;
    const dim = resizeCanvas(canvas, source.intrinsicW, source.intrinsicH, { hasGL: opts.hasGL, target: opts.target });
    const { w, h } = dim;
    const { uvOffset, uvScale } = centerCrop(source.intrinsicW, source.intrinsicH, w, h);
    const preset = opts.preset;
    renderer.setSize(w, h);
    renderer.setPreset(preset);
    renderer.draw(source.element, {
      uvOffset,
      uvScale,
      mirror: false,
      strength: opts.strength,
      preset,
      noiseShift: [0, 0],
      w,
      h,
      effects: { halation: 0, fisheye: 0, flash: 0 },
    });

    const borderId = BORDER_ORDER[opts.borderIdx] || BORDER_ORDER[0];
    const out = composeOutput(canvas, borderId, preset, opts.showDate);
    const blob = await canvasToBlob(out);
    await Gallery.add(blob, {
      presetId: preset.id,
      borderId,
      developMs: preset.developMs || 0,
    });
  } finally {
    source.close?.();
  }
}

export async function processBatch(files, opts) {
  const list = Array.from(files || []).filter((file) => file?.type?.startsWith('image/'));
  const total = list.length;
  if (!total) return { total: 0, imported: 0, failed: 0, elapsedMs: 0 };

  const started = performance.now();
  const canvas = makeCanvas();
  const renderer = createRenderer(canvas);
  const ctx = { canvas, renderer };
  let imported = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    opts.onProgress?.({ current: i + 1, total, imported, failed });
    await yieldToMain();
    try {
      await processOne(list[i], ctx, {
        ...opts,
        hasGL: renderer.kind === 'gl' && opts.hasGL !== false,
      });
      imported++;
    } catch (err) {
      failed++;
      opts.onError?.(err, list[i], i);
    }
  }

  const dropped = await Gallery.trim(MAX_PHOTOS);
  const elapsedMs = performance.now() - started;
  const result = { total, imported, failed, dropped, elapsedMs, rendererKind: renderer.kind };
  await opts.onDone?.(result);
  return result;
}
