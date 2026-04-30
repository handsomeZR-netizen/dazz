// 共享的预生成噪声 + 暗角 / 光斑缓存。GL 路径与 CPU 路径都用同一份噪声 tile。
export const NOISE_SIZE = 256;

export const noiseTile = new Int8Array(NOISE_SIZE * NOISE_SIZE);
for (let i = 0; i < noiseTile.length; i++) {
  noiseTile[i] = (Math.random() * 254 - 127) | 0; // ±127，使用时按预设振幅缩放
}

export const noiseUnsigned = (() => {
  const u = new Uint8Array(noiseTile.length);
  for (let i = 0; i < noiseTile.length; i++) u[i] = noiseTile[i] + 128;
  return u;
})();

const cache = {
  vignette: null,
  vignetteKey: '',
  leak: null,
  leakKey: '',
};

// 返回 Float32Array(w*h)，每个像素是亮度乘子 (1 - depth*t^2)
export function getVignette(w, h, depth) {
  const key = `${w}x${h}@${depth}`;
  if (cache.vignetteKey === key) return cache.vignette;
  const v = new Float32Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;
      const t = Math.max(0, (r - 0.55) / 0.45);
      v[y * w + x] = 1 - depth * (t * t);
    }
  }
  cache.vignette = v;
  cache.vignetteKey = key;
  return v;
}

// 光斑：从右上角向下扩散的暖色泄漏，强度 0..0.55
export function getLeak(w, h) {
  const key = `${w}x${h}`;
  if (cache.leakKey === key) return cache.leak;
  const v = new Float32Array(w * h);
  const cx = w * 1.05;
  const cy = h * -0.05;
  const radius = Math.max(w, h) * 0.85;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / radius;
      const t = Math.max(0, 1 - d);
      v[y * w + x] = t * t * 0.55;
    }
  }
  cache.leak = v;
  cache.leakKey = key;
  return v;
}
