// 高斯峰：用来在 LUT 曲线上叠局部色相偏移
export function gauss(x, mu, sigma) {
  return Math.exp(-Math.pow((x - mu) / sigma, 2));
}

// S 曲线：contrast 控制强度，pivot 是中心点
export function sCurve(x, contrast, pivot) {
  const t = (x - pivot) * contrast;
  return pivot + (Math.tanh(t) / Math.tanh(contrast * 0.5)) * 0.5;
}

// 把 preset.curve 烘成 3 条 LUT（256 项）。预设对象会被原地附加 lutR/G/B。
export function buildLut(preset) {
  const lutR = new Uint8ClampedArray(256);
  const lutG = new Uint8ClampedArray(256);
  const lutB = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = preset.curve(i / 255);
    lutR[i] = clamp255(r * 255);
    lutG[i] = clamp255(g * 255);
    lutB[i] = clamp255(b * 255);
  }
  preset.lutR = lutR;
  preset.lutG = lutG;
  preset.lutB = lutB;
  return preset;
}

function clamp255(v) {
  v = Math.round(v);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
