// 导入 .cube 3D LUT 文件 → 解析 → 命名 → 持久化为用户预设。
//
// 暴露 createCubeImporter({ onSave(spec), onError(msg) })：
//   - openPicker()：弹文件选择框；用户选了 .cube 后弹一个 prompt 询问名称（默认取文件名）
//     校验通过后调用 onSave(spec)（外部负责写入 IndexedDB 和挂到 PRESETS）
//
// 设计上不直接依赖 Gallery / PRESETS，方便 UI 层组合（与编辑器 onSave 一致）。

import { parseCube } from '../lut3d.js';
import { newUserPresetId, validateName } from '../presets/user.js';

export function createCubeImporter({ onSave, onError }) {
  // 复用同一个 hidden input；按需创建一次
  let input = null;
  function ensureInput() {
    if (input) return input;
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cube,application/octet-stream,text/plain';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.addEventListener('change', onPicked);
    document.body.appendChild(input);
    return input;
  }

  async function onPicked() {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCube(text);
      const N = parsed.size;
      // 体素总数不能爆炸：限制 N ≤ 64（一般 33/64，.cube 上限通常 64）
      if (N > 64) throw new Error(`LUT 尺寸 ${N} 太大（上限 64）`);
      // 把解析结果转成 Uint8Array(N^3*3)
      const lutData = new Uint8Array(N * N * N * 3);
      for (let i = 0; i < lutData.length; i++) {
        let v = Math.round(parsed.data[i] * 255);
        if (v < 0) v = 0; else if (v > 255) v = 255;
        lutData[i] = v;
      }
      // 默认名：去掉扩展名后取前 12 字（编辑器 / 校验上限一致）
      const baseName = file.name.replace(/\.(cube|CUBE|Cube)$/, '');
      let suggested = (parsed.title || baseName || 'CUBE').slice(0, 12).trim();
      if (!suggested) suggested = 'CUBE';

      const userName = window.prompt('为该 LUT 命名（1-12 字符）：', suggested);
      if (userName == null) return; // 取消
      const trimmed = userName.trim();
      const err = validateName(trimmed);
      if (err) {
        onError?.(err);
        return;
      }

      const shortId = (trimmed.replace(/\s+/g, '').slice(0, 3) || 'CUB').toUpperCase();
      const spec = {
        id: newUserPresetId(),
        name: trimmed,
        shortId,
        isUser: true,
        kind: '3d-lut',
        lutSize: N,
        lutData,
        grainAmp: 0,
        vignette: 0,
        stampColor: '#7fc8ff',
      };
      await Promise.resolve(onSave?.(spec));
    } catch (e) {
      const msg = e?.message || String(e);
      onError?.('导入失败：' + msg);
    }
  }

  return {
    openPicker() {
      ensureInput().click();
    },
  };
}
