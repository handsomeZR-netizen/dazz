// Adobe / Resolve `.cube` 3D LUT 解析与打包
//
// .cube 标准（极简版）：
//   - 文本文件，UTF-8（容许 BOM）
//   - 行 `#` 开头：注释
//   - 行 `TITLE "xxx"`：可选标题
//   - 行 `LUT_3D_SIZE N`：网格尺寸（必须；常见 17 / 33 / 64）
//   - 行 `DOMAIN_MIN x y z` / `DOMAIN_MAX x y z`：可选域；本实现读取但仅用于线性归一化
//     （内置预设默认 0..1，越界数据会在归一化后被 clamp）
//   - LUT 数据行：`r g b`（三个浮点），共 N^3 行；顺序为 r 最快、g 次之、b 最慢（标准约定）
//
// 输出：
//   parseCube(text) -> { size, title, domainMin, domainMax, data: Float32Array(N*N*N*3) }
//   data 内顺序保持原始：index = ((b*N) + g) * N + r （即 r 走最快），三个分量按 R G B 排列
//
// cubeToTexture(parsed) -> { size, texPixels: Uint8Array(N*N*N*3), texW: N*N, texH: N }
//   把 N×N×N 体素打包成 (N*N) × N 的 RGB8 2D 切片纹理：z 切片横向排列。
//   - x 切片内 = 体素 r（0..N-1）
//   - y 切片内 = 体素 g（0..N-1）
//   - 切片号  = 体素 b（0..N-1），切片在水平方向上一字排开
//   shader 端通过 (z0 + r) * (1/N), g 即可寻址某切片中的某体素，配合 LINEAR 插值天然得到
//   xy 双线性；z 维度由 shader 手动两次采样混合（三线性）。

const TWO_PI_GUARD = 0; // (no-op，仅为防止打包器把本文件视作空 ESM)

export function parseCube(text) {
  if (typeof text !== 'string') {
    throw new Error('parseCube: 输入需为字符串');
  }
  // 兼容 BOM / CRLF / 全角空格
  const cleaned = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n');

  let size = 0;
  let title = '';
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  let saw1D = false;
  // 先扫一遍头部 / 收集数据行
  const dataRows = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // 去掉注释（# 之后内容）
    const noComment = raw.replace(/#.*/, '').trim();
    if (!noComment) continue;
    // 用空白拆分；首 token 决定语义
    const tokens = noComment.split(/\s+/);
    const head = tokens[0].toUpperCase();

    if (head === 'TITLE') {
      // TITLE "xxx" 或 TITLE xxx
      const m = /^TITLE\s+(.*)$/i.exec(noComment);
      if (m) title = m[1].replace(/^"(.*)"$/, '$1');
      continue;
    }
    if (head === 'LUT_3D_SIZE') {
      const n = parseInt(tokens[1], 10);
      if (!Number.isFinite(n) || n < 2 || n > 256) {
        throw new Error(`parseCube: LUT_3D_SIZE 非法（${tokens[1]}）`);
      }
      size = n;
      continue;
    }
    if (head === 'LUT_1D_SIZE') {
      saw1D = true;
      continue;
    }
    if (head === 'DOMAIN_MIN') {
      domainMin = [parseFloat(tokens[1]) || 0, parseFloat(tokens[2]) || 0, parseFloat(tokens[3]) || 0];
      continue;
    }
    if (head === 'DOMAIN_MAX') {
      domainMax = [parseFloat(tokens[1]) || 1, parseFloat(tokens[2]) || 1, parseFloat(tokens[3]) || 1];
      continue;
    }
    // 数据行：必须形如 3 个浮点
    if (tokens.length < 3) continue; // 容错：忽略碎片行
    const r = parseFloat(tokens[0]);
    const g = parseFloat(tokens[1]);
    const b = parseFloat(tokens[2]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      dataRows.push(r, g, b);
    }
  }

  if (saw1D && size === 0) {
    throw new Error('parseCube: 检测到 1D LUT（LUT_1D_SIZE），暂不支持，请导出 3D LUT');
  }
  if (!size) {
    throw new Error('parseCube: 缺少 LUT_3D_SIZE');
  }
  const expected = size * size * size * 3;
  if (dataRows.length < expected) {
    throw new Error(`parseCube: 数据行数不足（期望 ${expected / 3}，得到 ${dataRows.length / 3}）`);
  }
  // 截掉末尾多余（容错某些导出器多出 1 行空白）
  const data = new Float32Array(expected);
  for (let i = 0; i < expected; i++) data[i] = dataRows[i];

  // domain 归一化到 0..1（仅在用户给非默认 domain 时生效）。LUT 输出值不变。
  // 注：domain 是描述输入色度范围的，对 LUT「内容」本身不需要做事；保留信息供调用方使用。
  void domainMin;
  void domainMax;
  void TWO_PI_GUARD;

  return {
    size,
    title,
    domainMin,
    domainMax,
    data,
  };
}

// 把 parseCube 的结果打包为可以直接 texImage2D 上传的 RGB8 2D 切片纹理。
// 切片排列：z=0 切片放在 [0..N-1, 0..N-1]；z=1 在 [N..2N-1, 0..N-1]；…… 共 N 个切片，水平串接。
// 像素布局（行优先，从上到下、从左到右）：
//   row y, col (z*N + x) -> (r=x, g=y, b=z) 体素
//
// 接受 data 为 Float32Array（0..1，由 parseCube 产出）或 Uint8Array（0..255，由 IndexedDB 读出）。
export function cubeToTexture(parsed) {
  const { size, data } = parsed;
  const N = size;
  const texW = N * N;
  const texH = N;
  const px = new Uint8Array(texW * texH * 3);
  const isByte = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const di = (((b * N) + g) * N + r) * 3;
        const pi = ((g * texW) + (b * N + r)) * 3;
        if (isByte) {
          px[pi + 0] = data[di + 0];
          px[pi + 1] = data[di + 1];
          px[pi + 2] = data[di + 2];
        } else {
          px[pi + 0] = clamp255(data[di + 0] * 255);
          px[pi + 1] = clamp255(data[di + 1] * 255);
          px[pi + 2] = clamp255(data[di + 2] * 255);
        }
      }
    }
  }
  return { size: N, texPixels: px, texW, texH };
}

// 在 CPU 路径里也支持 3D LUT：三线性查表。输入是 0..255 整数；输出 0..255 整数。
// preset.lut3d = { size, data: Float32Array, ... } 由 attach3DLut 挂上。
export function sample3DLut(lut3d, r0, g0, b0) {
  const N = lut3d.size;
  const fr = (r0 / 255) * (N - 1);
  const fg = (g0 / 255) * (N - 1);
  const fb = (b0 / 255) * (N - 1);
  const r1i = Math.floor(fr), g1i = Math.floor(fg), b1i = Math.floor(fb);
  const r2i = Math.min(N - 1, r1i + 1), g2i = Math.min(N - 1, g1i + 1), b2i = Math.min(N - 1, b1i + 1);
  const tr = fr - r1i, tg = fg - g1i, tb = fb - b1i;
  const data = lut3d.data;
  function at(r, g, b, c) { return data[(((b * N) + g) * N + r) * 3 + c]; }
  let out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c000 = at(r1i, g1i, b1i, c);
    const c100 = at(r2i, g1i, b1i, c);
    const c010 = at(r1i, g2i, b1i, c);
    const c110 = at(r2i, g2i, b1i, c);
    const c001 = at(r1i, g1i, b2i, c);
    const c101 = at(r2i, g1i, b2i, c);
    const c011 = at(r1i, g2i, b2i, c);
    const c111 = at(r2i, g2i, b2i, c);
    const c00 = c000 * (1 - tr) + c100 * tr;
    const c10 = c010 * (1 - tr) + c110 * tr;
    const c01 = c001 * (1 - tr) + c101 * tr;
    const c11 = c011 * (1 - tr) + c111 * tr;
    const c0 = c00 * (1 - tg) + c10 * tg;
    const c1 = c01 * (1 - tg) + c11 * tg;
    out[c] = c0 * (1 - tb) + c1 * tb;
  }
  return [
    clamp255(out[0] * 255),
    clamp255(out[1] * 255),
    clamp255(out[2] * 255),
  ];
}

function clamp255(v) {
  v = Math.round(v);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
