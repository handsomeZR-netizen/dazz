// CPU 回退路径：在 ImageData 上做 LUT + 暗角 + 颗粒 + 光斑（D 预设）。
// 不支持 halation / fisheye / flash —— 调用方在 GL 不可用时应隐藏特效入口。
import { NOISE_SIZE, noiseTile, getVignette, getLeak } from './noise.js';

let noiseOffset = 0;

export function createCPURenderer(cvs) {
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  let curPreset = null;

  return {
    kind: 'cpu',
    setSize() {
      // canvas 直接被 resize；CPU 路径不需要额外动作
    },
    setPreset(p) {
      curPreset = p;
    },
    // 与 GL 接口一致：source 可以是 video / image / canvas / ImageBitmap
    draw(source, opts) {
      const { uvOffset, uvScale, mirror, strength, w, h } = opts;
      // uvOffset/uvScale 是相对源的归一化矩形；CPU 路径需要换成像素坐标
      const sw0 = source.videoWidth || source.naturalWidth || source.width;
      const sh0 = source.videoHeight || source.naturalHeight || source.height;
      const sx = uvOffset[0] * sw0;
      const sy = uvOffset[1] * sh0;
      const sw = uvScale[0] * sw0;
      const sh = uvScale[1] * sh0;

      ctx.save();
      if (mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
      ctx.restore();

      if (strength > 0 && curPreset) {
        const img = ctx.getImageData(0, 0, w, h);
        applyFilter(img, strength, curPreset);
        ctx.putImageData(img, 0, 0);
      }
    },
  };
}

function applyFilter(imageData, s, preset) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const vig = getVignette(w, h, preset.vignette);
  const leakMap = preset.leak ? getLeak(w, h) : null;

  const lutR = preset.lutR;
  const lutG = preset.lutG;
  const lutB = preset.lutB;
  const grainAmp = preset.grainAmp / 127;
  const mono = preset.mono;
  const inv = 1 - s;

  noiseOffset = (noiseOffset + 17) & (NOISE_SIZE * NOISE_SIZE - 1);
  const NMASK = NOISE_SIZE - 1;

  let p = 0;
  let vi = 0;
  for (let y = 0; y < h; y++) {
    const ny = (y & NMASK) * NOISE_SIZE;
    for (let x = 0; x < w; x++) {
      const r0 = data[p];
      const g0 = data[p + 1];
      const b0 = data[p + 2];

      let r = lutR[r0];
      let g = lutG[g0];
      let b = lutB[b0];

      if (mono) {
        const yLum = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
        r = lutR[yLum | 0];
        g = r;
        b = r;
      }

      const vf = vig[vi];
      r *= vf;
      g *= vf;
      b *= vf;

      if (leakMap) {
        const lk = leakMap[vi];
        r += 60 * lk;
        g += 22 * lk;
        b += 28 * lk;
      }
      vi++;

      const grain = noiseTile[ny + ((x + noiseOffset) & NMASK)] * grainAmp;
      r += grain;
      g += grain;
      b += grain;

      if (s < 1) {
        r = r * s + r0 * inv;
        g = g * s + g0 * inv;
        b = b * s + b0 * inv;
      }

      data[p] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      p += 4;
    }
  }
}
