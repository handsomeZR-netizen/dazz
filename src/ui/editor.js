// 自定义滤镜编辑器 (P2-12)：modal-style 全屏编辑器。
// 左侧实时预览（CPU 路径，作用于一张内置渐变测试图）；右侧曲线 + HSL + 杂项 + 命名保存。
//
// 入口：createEditor({ onSave(spec) })，返回 { open(initialSpec) }。

import { defaultSpec, validateName, getHslBands, makeCurve, buildPresetFromSpec, newUserPresetId } from '../presets/user.js';
import { buildLut } from '../presets/curves.js';

const PREVIEW_W = 320;
const PREVIEW_H = 240;
const CURVE_W = 240;
const CURVE_H = 240;
const ANCHOR_R = 7;

export function createEditor({ onSave, onCancel }) {
  let root = null;
  let spec = null;
  let testImage = null; // ImageData
  let previewCanvas = null;
  let previewCtx = null;
  let curveCanvas = null;
  let curveCtx = null;
  let nameInput = null;
  let stampInput = null;
  let grainInput = null;
  let grainLabel = null;
  let vignInput = null;
  let vignLabel = null;
  let dragging = -1; // 当前拖动的锚点索引

  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'editor-modal';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="editor-shell" role="dialog" aria-label="自定义滤镜编辑器">
        <header class="editor-head">
          <button type="button" class="editor-btn" data-act="cancel">取消</button>
          <h2 class="editor-title">自定义滤镜</h2>
          <div class="editor-head-actions">
            <button type="button" class="editor-btn" data-act="reset">重置</button>
            <button type="button" class="editor-btn primary" data-act="save">保存</button>
          </div>
        </header>
        <div class="editor-body">
          <section class="editor-preview">
            <canvas class="editor-preview-canvas" width="${PREVIEW_W}" height="${PREVIEW_H}"></canvas>
            <div class="editor-preview-hint">实时预览（测试图）</div>
            <div class="editor-name-row">
              <label class="editor-label" for="editorName">名称</label>
              <input type="text" id="editorName" class="editor-input" maxlength="12" placeholder="1-12 字符" />
            </div>
            <div class="editor-name-row">
              <label class="editor-label" for="editorStamp">水印颜色</label>
              <input type="color" id="editorStamp" class="editor-color" />
            </div>
            <div class="editor-slider-row">
              <label class="editor-label">颗粒</label>
              <input type="range" min="0" max="20" step="1" class="editor-range" data-key="grain" />
              <span class="editor-val" data-val="grain">6</span>
            </div>
            <div class="editor-slider-row">
              <label class="editor-label">暗角</label>
              <input type="range" min="0" max="50" step="1" class="editor-range" data-key="vignette" />
              <span class="editor-val" data-val="vignette">18</span>
            </div>
          </section>
          <section class="editor-controls">
            <div class="editor-section">
              <h3 class="editor-section-title">曲线</h3>
              <canvas class="editor-curve-canvas" width="${CURVE_W}" height="${CURVE_H}"></canvas>
              <div class="editor-section-hint">拖动 4 个锚点调整明度曲线</div>
            </div>
            <div class="editor-section">
              <h3 class="editor-section-title">HSL · 6 段</h3>
              <div class="editor-hsl"></div>
            </div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    // 缓存 DOM 引用
    previewCanvas = root.querySelector('.editor-preview-canvas');
    previewCtx = previewCanvas.getContext('2d');
    curveCanvas = root.querySelector('.editor-curve-canvas');
    curveCtx = curveCanvas.getContext('2d');
    nameInput = root.querySelector('#editorName');
    stampInput = root.querySelector('#editorStamp');
    grainInput = root.querySelector('[data-key="grain"]');
    vignInput = root.querySelector('[data-key="vignette"]');
    grainLabel = root.querySelector('[data-val="grain"]');
    vignLabel = root.querySelector('[data-val="vignette"]');

    bindHeaderActions();
    bindCurveDrag();
    bindMisc();
    buildHslRows();
    buildTestImage();
  }

  function bindHeaderActions() {
    root.querySelector('[data-act="cancel"]').addEventListener('click', close);
    root.querySelector('[data-act="reset"]').addEventListener('click', () => {
      const keepName = spec.name;
      spec = { ...defaultSpec(), name: keepName };
      syncToUi();
      redrawAll();
    });
    root.querySelector('[data-act="save"]').addEventListener('click', handleSave);
    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });
    document.addEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (root.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function bindMisc() {
    nameInput.addEventListener('input', () => { spec.name = nameInput.value; });
    stampInput.addEventListener('input', () => { spec.stampColor = stampInput.value; redrawPreview(); });
    grainInput.addEventListener('input', () => {
      const v = Number(grainInput.value);
      spec.grainAmp = v;
      grainLabel.textContent = String(v);
      redrawPreview();
    });
    vignInput.addEventListener('input', () => {
      const v = Number(vignInput.value);
      spec.vignette = v / 100;
      vignLabel.textContent = String(v);
      redrawPreview();
    });
  }

  function buildHslRows() {
    const wrap = root.querySelector('.editor-hsl');
    wrap.innerHTML = '';
    const bands = getHslBands();
    bands.forEach((band, idx) => {
      const row = document.createElement('div');
      row.className = 'editor-hsl-row';
      row.innerHTML = `
        <div class="editor-hsl-head">
          <span class="editor-hsl-swatch" style="background:rgb(${Math.round(band.rgb[0]*255)},${Math.round(band.rgb[1]*255)},${Math.round(band.rgb[2]*255)})"></span>
          <span class="editor-hsl-key">${band.label}</span>
        </div>
        <div class="editor-hsl-grid">
          <label>H</label>
          <input type="range" min="-100" max="100" step="1" data-band="${idx}" data-axis="h" />
          <span data-band-val="${idx}-h">0</span>
          <label>S</label>
          <input type="range" min="-100" max="100" step="1" data-band="${idx}" data-axis="s" />
          <span data-band-val="${idx}-s">0</span>
          <label>L</label>
          <input type="range" min="-100" max="100" step="1" data-band="${idx}" data-axis="l" />
          <span data-band-val="${idx}-l">0</span>
        </div>
      `;
      wrap.appendChild(row);
    });
    wrap.querySelectorAll('input[type="range"]').forEach((el) => {
      el.addEventListener('input', () => {
        const i = Number(el.dataset.band);
        const axis = el.dataset.axis;
        const v = Number(el.value);
        spec.hsl[i][axis] = v;
        const lbl = wrap.querySelector(`[data-band-val="${i}-${axis}"]`);
        if (lbl) lbl.textContent = String(v);
        redrawPreview();
      });
    });
  }

  // ============== 测试图：渐变 + 6 色块 + 黑灰白条，覆盖足够多的输入亮度 ==============
  function buildTestImage() {
    const cv = document.createElement('canvas');
    cv.width = PREVIEW_W;
    cv.height = PREVIEW_H;
    const ctx = cv.getContext('2d');
    // 背景：水平灰阶
    const grad = ctx.createLinearGradient(0, 0, PREVIEW_W, 0);
    grad.addColorStop(0, '#000');
    grad.addColorStop(1, '#fff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H * 0.45);
    // 中间：6 色块
    const colors = ['#d33', '#dc3', '#3c5', '#3cd', '#36d', '#c3d'];
    const bw = PREVIEW_W / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * bw, PREVIEW_H * 0.45, bw, PREVIEW_H * 0.30);
    });
    // 下：肤色 / 蓝天 渐变
    const grad2 = ctx.createLinearGradient(0, 0, PREVIEW_W, 0);
    grad2.addColorStop(0, '#f1c8a0'); // 肤色
    grad2.addColorStop(0.5, '#7aa6d6'); // 蓝天
    grad2.addColorStop(1, '#3a4f70'); // 暗蓝
    ctx.fillStyle = grad2;
    ctx.fillRect(0, PREVIEW_H * 0.75, PREVIEW_W, PREVIEW_H * 0.25);
    testImage = ctx.getImageData(0, 0, PREVIEW_W, PREVIEW_H);
  }

  // ============== 曲线 canvas 绘制 + 拖动 ==============
  function bindCurveDrag() {
    curveCanvas.addEventListener('pointerdown', (e) => {
      const { x, y } = canvasPos(curveCanvas, e);
      // 命中最近锚点
      let bestI = -1, bestD = ANCHOR_R * ANCHOR_R * 4;
      spec.anchors.forEach((p, i) => {
        const px = p[0] * CURVE_W;
        const py = (1 - p[1]) * CURVE_H;
        const d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d < bestD) { bestD = d; bestI = i; }
      });
      if (bestI < 0) return;
      dragging = bestI;
      curveCanvas.setPointerCapture(e.pointerId);
    });
    curveCanvas.addEventListener('pointermove', (e) => {
      if (dragging < 0) return;
      const { x, y } = canvasPos(curveCanvas, e);
      let nx = clamp(x / CURVE_W, 0, 1);
      let ny = clamp(1 - y / CURVE_H, 0, 1);
      // 端点 x 锁定
      const isFirst = dragging === 0;
      const isLast = dragging === spec.anchors.length - 1;
      if (isFirst) nx = 0;
      if (isLast) nx = 1;
      // 中间锚点不能越过相邻
      if (!isFirst) nx = Math.max(nx, spec.anchors[dragging - 1][0] + 0.02);
      if (!isLast) nx = Math.min(nx, spec.anchors[dragging + 1][0] - 0.02);
      spec.anchors[dragging] = [nx, ny];
      redrawAll();
    });
    const endDrag = (e) => {
      if (dragging >= 0) {
        try { curveCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      dragging = -1;
    };
    curveCanvas.addEventListener('pointerup', endDrag);
    curveCanvas.addEventListener('pointercancel', endDrag);
  }

  function drawCurve() {
    const ctx = curveCtx;
    ctx.clearRect(0, 0, CURVE_W, CURVE_H);
    // 背景
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, 0, CURVE_W, CURVE_H);
    // 网格
    ctx.strokeStyle = '#1f1f1f';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * CURVE_W;
      const y = (i / 4) * CURVE_H;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CURVE_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CURVE_W, y); ctx.stroke();
    }
    // 对角参考线
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.moveTo(0, CURVE_H); ctx.lineTo(CURVE_W, 0); ctx.stroke();
    // 曲线
    const f = makeCurve(spec.anchors);
    ctx.strokeStyle = '#ff8a3d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let px = 0; px <= CURVE_W; px++) {
      const x = px / CURVE_W;
      const y = (1 - f(x)) * CURVE_H;
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
    // 锚点
    spec.anchors.forEach((p, i) => {
      const px = p[0] * CURVE_W;
      const py = (1 - p[1]) * CURVE_H;
      ctx.fillStyle = i === dragging ? '#fff' : '#ff8a3d';
      ctx.beginPath();
      ctx.arc(px, py, ANCHOR_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  // ============== 预览：用 LUT 应用到 testImage（CPU），再叠暗角 ==============
  function redrawPreview() {
    if (!testImage) return;
    // 构造一份临时 preset 拿到 LUT
    const probe = buildLut(buildPresetFromSpec({
      ...spec,
      id: 'preview',
      name: spec.name || 'preview',
    }));
    const src = testImage.data;
    const out = previewCtx.createImageData(PREVIEW_W, PREVIEW_H);
    const dst = out.data;
    const lutR = probe.lutR, lutG = probe.lutG, lutB = probe.lutB;
    for (let i = 0; i < src.length; i += 4) {
      // 轻微地：用各通道的 LUT。等同于「以 R 输入查 R-LUT」，与渲染器一致。
      dst[i + 0] = lutR[src[i + 0]];
      dst[i + 1] = lutG[src[i + 1]];
      dst[i + 2] = lutB[src[i + 2]];
      dst[i + 3] = 255;
    }
    // 暗角（径向衰减）
    const vAmt = probe.vignette;
    if (vAmt > 0) {
      const cx = PREVIEW_W / 2, cy = PREVIEW_H / 2;
      const maxR = Math.hypot(cx, cy);
      let p = 0;
      for (let y = 0; y < PREVIEW_H; y++) {
        for (let x = 0; x < PREVIEW_W; x++) {
          const dx = x - cx, dy = y - cy;
          const r = Math.hypot(dx, dy) / maxR;
          // 平滑衰减：r^2
          const k = 1 - vAmt * Math.min(1, r * r);
          dst[p] = Math.round(dst[p] * k);
          dst[p + 1] = Math.round(dst[p + 1] * k);
          dst[p + 2] = Math.round(dst[p + 2] * k);
          p += 4;
        }
      }
    }
    // 颗粒（简单白噪叠加）
    const gAmt = probe.grainAmp;
    if (gAmt > 0) {
      for (let i = 0; i < dst.length; i += 4) {
        const n = (Math.random() - 0.5) * gAmt * 2;
        dst[i + 0] = clamp255(dst[i + 0] + n);
        dst[i + 1] = clamp255(dst[i + 1] + n);
        dst[i + 2] = clamp255(dst[i + 2] + n);
      }
    }
    previewCtx.putImageData(out, 0, 0);
  }

  function redrawAll() {
    drawCurve();
    redrawPreview();
  }

  function syncToUi() {
    nameInput.value = spec.name || '';
    stampInput.value = normalizeHex(spec.stampColor) || '#ff8a3d';
    grainInput.value = String(spec.grainAmp);
    grainLabel.textContent = String(spec.grainAmp);
    vignInput.value = String(Math.round(spec.vignette * 100));
    vignLabel.textContent = String(Math.round(spec.vignette * 100));
    // HSL
    spec.hsl.forEach((cfg, idx) => {
      ['h', 's', 'l'].forEach((axis) => {
        const el = root.querySelector(`input[data-band="${idx}"][data-axis="${axis}"]`);
        if (el) el.value = String(cfg[axis] || 0);
        const lbl = root.querySelector(`[data-band-val="${idx}-${axis}"]`);
        if (lbl) lbl.textContent = String(cfg[axis] || 0);
      });
    });
  }

  function handleSave() {
    const err = validateName(spec.name);
    if (err) {
      alert(err);
      nameInput.focus();
      return;
    }
    // 保存：分配 id（编辑既有也复用旧 id）
    if (!spec.id) spec.id = newUserPresetId();
    // shortId 取名字前 3 字符大写（不含空格）
    spec.shortId = (spec.name.replace(/\s+/g, '').slice(0, 3) || 'USR').toUpperCase();
    // clone 出干净 spec
    const clean = {
      id: spec.id,
      isUser: true,
      name: spec.name.trim(),
      shortId: spec.shortId,
      anchors: spec.anchors.map((p) => [p[0], p[1]]),
      hsl: spec.hsl.map((c) => ({ h: c.h | 0, s: c.s | 0, l: c.l | 0 })),
      grainAmp: spec.grainAmp,
      vignette: spec.vignette,
      stampColor: spec.stampColor,
    };
    Promise.resolve(onSave?.(clean))
      .then(() => close())
      .catch((e) => alert('保存失败：' + (e?.message || e)));
  }

  function open(initial) {
    ensureRoot();
    spec = initial ? deepCloneSpec(initial) : defaultSpec();
    if (!spec.hsl || spec.hsl.length < 6) spec.hsl = defaultSpec().hsl;
    if (!spec.anchors || spec.anchors.length < 2) spec.anchors = defaultSpec().anchors;
    syncToUi();
    redrawAll();
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    nameInput.focus();
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    onCancel?.();
  }

  return { open, close };
}

// ============== utils ==============
function canvasPos(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clamp255(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
function deepCloneSpec(s) {
  return {
    id: s.id || '',
    name: s.name || '',
    shortId: s.shortId,
    isUser: true,
    anchors: (s.anchors || []).map((p) => [p[0], p[1]]),
    hsl: (s.hsl || []).map((c) => ({ h: c.h || 0, s: c.s || 0, l: c.l || 0 })),
    grainAmp: s.grainAmp ?? 6,
    vignette: s.vignette ?? 0.18,
    stampColor: s.stampColor || '#ff8a3d',
  };
}
function normalizeHex(c) {
  if (!c) return '#ff8a3d';
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
  return '#ff8a3d';
}
