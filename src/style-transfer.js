// P2-15 — TF.js arbitrary image stylization (实验功能).
//
// 设计要点：
// - tfjs 运行时与模型权重均通过 CDN 动态加载，不打进 bundle。
// - 模型来自 reiinakano/arbitrary-image-stylization-tfjs（MobileNet 风格预测 + 可分离卷积转换器）。
// - 模型 + tfjs 仅在用户首次点击「开始」时下载，后续缓存在内存。
// - 输入短边压到 SHORT_SIDE_MAX 以保证 ≤5s/张（桌面 WebGL）。

const TFJS_ESM_URL = 'https://esm.sh/@tensorflow/tfjs@4.22.0';

// jsdelivr 的 gh CDN 直接拉 GitHub 仓库的 model.json + 权重 shard。
// 这两个目录里 model.json 的 weightsManifest.paths 是相对路径（group1-shard*），
// tfjs 会在同一目录下解析它们。
const STYLE_NET_URL =
  'https://cdn.jsdelivr.net/gh/reiinakano/arbitrary-image-stylization-tfjs@master/saved_model_style_js/model.json';
const TRANSFORM_NET_URL =
  'https://cdn.jsdelivr.net/gh/reiinakano/arbitrary-image-stylization-tfjs@master/saved_model_transformer_separable_js/model.json';

export const SHORT_SIDE_MAX = 384;

let tfPromise = null;
let modelsPromise = null;

// 动态加载 tfjs runtime（ESM CDN）。
// 用 @vite-ignore 注释让 Vite 不要分析这个 dynamic import —— 它是运行时加载的外部模块。
function loadTfjs() {
  if (!tfPromise) {
    tfPromise = import(/* @vite-ignore */ TFJS_ESM_URL).then(async (mod) => {
      const tf = mod.default || mod;
      // 优先 webgl backend；不可用则 fallback CPU。
      try {
        await tf.setBackend('webgl');
      } catch {
        try { await tf.setBackend('cpu'); } catch {}
      }
      await tf.ready();
      return tf;
    });
  }
  return tfPromise;
}

/**
 * 加载 style + transformer 两个 GraphModel。第一次会触发 ~12MB 下载（浏览器/CDN 会缓存）。
 */
export async function loadModel({ onProgress } = {}) {
  if (modelsPromise) return modelsPromise;
  modelsPromise = (async () => {
    const tf = await loadTfjs();
    onProgress?.('加载风格预测网络…');
    const styleNet = await tf.loadGraphModel(STYLE_NET_URL);
    onProgress?.('加载转换网络…');
    const transformNet = await tf.loadGraphModel(TRANSFORM_NET_URL);
    return { tf, styleNet, transformNet };
  })().catch((err) => {
    // 失败时清掉缓存，下次可重试
    modelsPromise = null;
    throw err;
  });
  return modelsPromise;
}

/**
 * 把任意 source（Blob / ImageBitmap / HTMLImageElement）画到 canvas 上，短边 ≤ maxShort。
 * 返回 OffscreenCanvas 或普通 Canvas（用于喂给 tf.browser.fromPixels）。
 */
async function toResizedCanvas(source, maxShort = SHORT_SIDE_MAX) {
  let bitmap;
  if (source instanceof ImageBitmap) {
    bitmap = source;
  } else if (source instanceof Blob) {
    bitmap = await createImageBitmap(source);
  } else if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
    bitmap = await createImageBitmap(source);
  } else {
    throw new Error('不支持的图像源');
  }
  const sw = bitmap.width;
  const sh = bitmap.height;
  const short = Math.min(sw, sh);
  const scale = short > maxShort ? maxShort / short : 1;
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (!canvas.width) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  // 释放 bitmap
  if (bitmap !== source && typeof bitmap.close === 'function') bitmap.close();
  return canvas;
}

/**
 * 跑一次风格迁移。返回 { blob, w, h, ms }。blob 是 image/jpeg。
 *
 * @param {Blob|ImageBitmap|HTMLImageElement|HTMLCanvasElement} contentSource 内容图
 * @param {Blob|ImageBitmap|HTMLImageElement|HTMLCanvasElement} styleSource 风格图
 * @param {object} opts
 * @param {number}   opts.strength 0..1，风格混合强度（默认 1）
 * @param {number}   opts.shortSide 短边像素上限（默认 SHORT_SIDE_MAX）
 * @param {number}   opts.quality jpeg 质量（默认 0.92）
 * @param {(stage:string)=>void} opts.onProgress 进度回调
 */
export async function styleTransfer(contentSource, styleSource, opts = {}) {
  const {
    strength = 1.0,
    shortSide = SHORT_SIDE_MAX,
    quality = 0.92,
    onProgress,
  } = opts;
  const t0 = performance.now();

  const { tf, styleNet, transformNet } = await loadModel({ onProgress });

  onProgress?.('准备图像…');
  const [contentCanvas, styleCanvas] = await Promise.all([
    toResizedCanvas(contentSource, shortSide),
    toResizedCanvas(styleSource, shortSide),
  ]);

  onProgress?.('提取风格…');
  // tf.tidy 自动释放中间张量
  const stylized = tf.tidy(() => {
    const contentT = tf.browser.fromPixels(contentCanvas).toFloat().div(255).expandDims();
    const styleT = tf.browser.fromPixels(styleCanvas).toFloat().div(255).expandDims();

    let bottleneck = styleNet.predict(styleT);
    if (strength < 0.999) {
      const contentBottleneck = styleNet.predict(contentT);
      bottleneck = bottleneck.mul(tf.scalar(strength))
        .add(contentBottleneck.mul(tf.scalar(1 - strength)));
    }

    onProgress?.('合成风格化结果…');
    const out = transformNet.predict([contentT, bottleneck]).squeeze();
    // clamp 到 [0,1]
    return out.clipByValue(0, 1);
  });

  onProgress?.('生成图片…');
  // toPixels 返回 Uint8Array，shape [h, w, 3] -> 我们手动构造 ImageData
  const [h, w] = stylized.shape;
  const data = await tf.browser.toPixels(stylized);
  stylized.dispose();

  // 写到 canvas 然后 toBlob
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  const imgData = octx.createImageData(w, h);
  imgData.data.set(data);
  octx.putImageData(imgData, 0, 0);

  const blob = await new Promise((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob 返回 null'))),
      'image/jpeg',
      quality,
    );
  });

  const ms = Math.round(performance.now() - t0);
  return { blob, w, h, ms };
}

/**
 * 给 UI 用的预热入口：仅触发模型下载，不跑推理。
 */
export async function warmupModel(onProgress) {
  await loadModel({ onProgress });
}
