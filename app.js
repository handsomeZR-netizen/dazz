/* Dazz Web — 多滤镜胶片相机
 * 支持 4 种胶片预设：NC / FX / G / D，每个预设包含色调 LUT、颗粒、暗角、日期戳颜色与可选光斑。
 */
(() => {
  // ============== DOM ==============
  const video = document.getElementById('video');
  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const flipBtn = document.getElementById('flipBtn');
  const dateBtn = document.getElementById('dateBtn');
  const shutterBtn = document.getElementById('shutterBtn');
  const filterBtn = document.getElementById('filterBtn');
  const strengthLabel = document.getElementById('strengthLabel');
  const datestampEl = document.getElementById('datestamp');
  const flashEl = document.getElementById('flash');
  const thumbBtn = document.getElementById('thumbBtn');
  const filterTag = document.getElementById('filterTag');
  const presetStrip = document.getElementById('presets');
  const brandEl = document.querySelector('.brand');

  const modal = document.getElementById('modal');
  const modalImg = document.getElementById('modalImg');
  const closeModalBtn = document.getElementById('closeModal');
  const downloadBtn = document.getElementById('downloadBtn');
  const toast = document.getElementById('toast');

  // ============== 预设定义 ==============
  // 每个预设的 LUT 构造函数：输入 0..1 标量 x，返回 [r, g, b] (0..1)
  const PRESETS = [
    {
      id: 'NC',
      name: 'Nostalgic',
      desc: 'NC · Nostalgic',
      stampColor: '#ff8a3d',
      stampGlow:  'rgba(255, 138, 61, 0.7)',
      grainAmp: 7,
      vignette: 0.28,
      mono: false,
      leak: false,
      curve(x) {
        const lift = 0.06;
        const matte = lift + 0.89 * x + 0.05 * Math.pow(x, 0.7);
        const r = matte + 0.10 * gauss(x, 0.75, 0.30) - 0.03 * gauss(x, 0.15, 0.20);
        const g = matte + 0.04 * gauss(x, 0.65, 0.30) - 0.02;
        const b = matte + 0.08 * gauss(x, 0.20, 0.25) - 0.10 * gauss(x, 0.80, 0.30);
        return [r, g, b];
      },
    },
    {
      id: 'FX',
      name: 'Fujifilm',
      desc: 'FX · Cinematic',
      stampColor: '#ffc857',
      stampGlow:  'rgba(255, 200, 87, 0.6)',
      grainAmp: 4,
      vignette: 0.18,
      mono: false,
      leak: false,
      curve(x) {
        // 强对比 S 曲线 + 青调阴影 + 翠绿中调
        const s = sCurve(x, 1.25, 0.5);
        const r = s - 0.04 * gauss(x, 0.30, 0.25) + 0.03 * gauss(x, 0.85, 0.20);
        const g = s + 0.05 * gauss(x, 0.55, 0.25) - 0.02 * gauss(x, 0.20, 0.20);
        const b = s + 0.06 * gauss(x, 0.25, 0.25) - 0.05 * gauss(x, 0.85, 0.20);
        return [r, g, b];
      },
    },
    {
      id: 'G',
      name: 'Grain B&W',
      desc: 'G · Mono',
      stampColor: '#f4ede0',
      stampGlow:  'rgba(244, 237, 224, 0.45)',
      grainAmp: 14,
      vignette: 0.34,
      mono: true,
      leak: false,
      curve(x) {
        // 高反差 S 曲线，所有通道一致
        const v = sCurve(x, 1.45, 0.48) - 0.03;
        return [v, v, v];
      },
    },
    {
      id: 'D',
      name: 'Disposable',
      desc: 'D · Single Use',
      stampColor: '#ff5b5b',
      stampGlow:  'rgba(255, 91, 91, 0.7)',
      grainAmp: 9,
      vignette: 0.22,
      mono: false,
      leak: true,
      curve(x) {
        // 一次性相机：轻度褪色 + 洋红粉调高光 + 微微偏黄阴影
        const lift = 0.09;
        const matte = lift + 0.82 * x + 0.03 * Math.pow(x, 0.6);
        const r = matte + 0.06 * gauss(x, 0.85, 0.25) + 0.04 * gauss(x, 0.40, 0.30);
        const g = matte - 0.04 * gauss(x, 0.85, 0.25) - 0.02;
        const b = matte + 0.05 * gauss(x, 0.85, 0.25) - 0.03 * gauss(x, 0.30, 0.25);
        return [r, g, b];
      },
    },
  ];

  function gauss(x, mu, sigma) {
    return Math.exp(-Math.pow((x - mu) / sigma, 2));
  }
  // 简单 S 曲线：contrast 控制强度，pivot 是中心点
  function sCurve(x, contrast, pivot) {
    const t = (x - pivot) * contrast;
    return pivot + (Math.tanh(t) / Math.tanh(contrast * 0.5)) * 0.5;
  }

  // 为每个预设构建 LUT
  for (const p of PRESETS) {
    const lutR = new Uint8ClampedArray(256);
    const lutG = new Uint8ClampedArray(256);
    const lutB = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = p.curve(i / 255);
      lutR[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      lutG[i] = Math.max(0, Math.min(255, Math.round(g * 255)));
      lutB[i] = Math.max(0, Math.min(255, Math.round(b * 255)));
    }
    p.lutR = lutR; p.lutG = lutG; p.lutB = lutB;
  }

  // ============== 状态 ==============
  let stream = null;
  let usingFront = false;
  let strength = 1.0;
  const strengthSteps = [1.0, 0.7, 0.4, 0.0];
  const strengthLabels = ['100', '70', '40', 'OFF'];
  let strengthIdx = 0;
  let showDate = true;
  let lastShot = null;
  let presetIdx = 0;
  let preset = PRESETS[0];

  // ============== 启动相机 ==============
  async function startCamera(front = false) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    const constraints = {
      audio: false,
      video: {
        facingMode: front ? 'user' : { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 1707 },
      },
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (e2) {
        showToast('无法访问摄像头：' + e2.message);
        throw e2;
      }
    }
    video.srcObject = stream;
    await video.play();
    resizeCanvas();
  }

  function resizeCanvas() {
    if (!video.videoWidth) return;
    const target = 3 / 4;
    const vw = video.videoWidth, vh = video.videoHeight;
    const cap = 540;
    let w, h;
    if (vw / vh > target) { h = Math.min(vh, cap); w = Math.round(h * target); }
    else { w = Math.min(vw, Math.round(cap * target)); h = Math.round(w / target); }
    canvas.width = w;
    canvas.height = h;
  }

  // ============== 预生成纹理（噪声 / 暗角 / 光斑） ==============
  const NOISE_SIZE = 256;
  const noiseTile = new Int8Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < noiseTile.length; i++) {
    noiseTile[i] = (Math.random() * 254 - 127) | 0; // ±127，使用时按预设振幅缩放
  }
  let noiseOffset = 0;

  const cache = {
    vignette: null, vignetteKey: '',
    leak: null,     leakKey: '',
  };

  function getVignette(w, h, depth) {
    const key = `${w}x${h}@${depth}`;
    if (cache.vignetteKey === key) return cache.vignette;
    const v = new Float32Array(w * h);
    const cx = w / 2, cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const r = Math.sqrt(dx * dx + dy * dy) / maxR;
        const t = Math.max(0, (r - 0.55) / 0.45);
        v[y * w + x] = 1 - depth * (t * t);
      }
    }
    cache.vignette = v; cache.vignetteKey = key;
    return v;
  }

  // 光斑：从右上角向下扩散的暖色泄漏
  function getLeak(w, h) {
    const key = `${w}x${h}`;
    if (cache.leakKey === key) return cache.leak;
    const v = new Float32Array(w * h);
    // 中心点放在画面外右上角
    const cx = w * 1.05;
    const cy = h * -0.05;
    const radius = Math.max(w, h) * 0.85;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / radius;
        const t = Math.max(0, 1 - d);
        v[y * w + x] = t * t * 0.55;
      }
    }
    cache.leak = v; cache.leakKey = key;
    return v;
  }

  // ============== 滤镜核心 ==============
  function applyFilter(imageData, s) {
    const data = imageData.data;
    const w = imageData.width, h = imageData.height;
    const vig = getVignette(w, h, preset.vignette);
    const leakMap = preset.leak ? getLeak(w, h) : null;

    const lutR = preset.lutR, lutG = preset.lutG, lutB = preset.lutB;
    const grainAmp = preset.grainAmp / 127; // 归一化乘子
    const mono = preset.mono;
    const inv = 1 - s;

    noiseOffset = (noiseOffset + 17) & (NOISE_SIZE * NOISE_SIZE - 1);
    const NMASK = NOISE_SIZE - 1;

    let p = 0, vi = 0;
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
          // LUT 已经是相同三通道，再依原图亮度做权重确保色彩信息丢弃
          const yLum = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
          r = lutR[yLum | 0]; g = r; b = r;
        }

        // 暗角
        const vf = vig[vi];
        r *= vf; g *= vf; b *= vf;

        // 光斑（D 预设）
        if (leakMap) {
          const lk = leakMap[vi];
          r += 60 * lk;
          g += 22 * lk;
          b += 28 * lk;
        }
        vi++;

        // 颗粒
        const grain = noiseTile[ny + ((x + noiseOffset) & NMASK)] * grainAmp;
        r += grain; g += grain; b += grain;

        if (s < 1) {
          r = r * s + r0 * inv;
          g = g * s + g0 * inv;
          b = b * s + b0 * inv;
        }

        data[p]     = r < 0 ? 0 : r > 255 ? 255 : r;
        data[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        p += 4;
      }
    }
  }

  function drawFrame() {
    if (video.readyState >= 2 && canvas.width) {
      const cw = canvas.width, ch = canvas.height;
      const vw = video.videoWidth, vh = video.videoHeight;
      const cr = cw / ch, vr = vw / vh;
      let sx, sy, sw, sh;
      if (vr > cr) { sh = vh; sw = vh * cr; sx = (vw - sw) / 2; sy = 0; }
      else         { sw = vw; sh = vw / cr; sx = 0; sy = (vh - sh) / 2; }

      ctx.save();
      if (usingFront) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
      ctx.restore();

      if (strength > 0) {
        const img = ctx.getImageData(0, 0, cw, ch);
        applyFilter(img, strength);
        ctx.putImageData(img, 0, 0);
      }
    }
    requestAnimationFrame(drawFrame);
  }

  // ============== 拍照（烘焙水印） ==============
  function capture() {
    if (!canvas.width) return;

    flashEl.classList.remove('fire');
    void flashEl.offsetWidth;
    flashEl.classList.add('fire');

    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext('2d');
    octx.drawImage(canvas, 0, 0);

    const fontPx = Math.round(off.height * 0.034);
    const padding = Math.round(off.height * 0.022);

    octx.font = `700 ${Math.round(fontPx * 0.7)}px "Courier New", monospace`;
    octx.fillStyle = 'rgba(255, 235, 200, 0.85)';
    octx.shadowColor = preset.stampGlow;
    octx.shadowBlur = 6;
    octx.textAlign = 'left';
    octx.textBaseline = 'top';
    octx.fillText(preset.id, padding, padding);

    if (showDate) {
      octx.font = `700 ${fontPx}px "Courier New", monospace`;
      octx.fillStyle = preset.stampColor;
      octx.shadowColor = preset.stampGlow;
      octx.shadowBlur = 8;
      octx.textAlign = 'right';
      octx.textBaseline = 'bottom';
      octx.fillText(formatDate(new Date()), off.width - padding, off.height - padding);
    }
    octx.shadowBlur = 0;

    const url = off.toDataURL('image/jpeg', 0.92);
    lastShot = url;
    thumbBtn.style.backgroundImage = `url(${url})`;
    thumbBtn.querySelector('.thumb-empty')?.remove();

    showToast('已捕获 · 点左下查看');
  }

  function formatDate(d) {
    const y = String(d.getFullYear()).slice(-2);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `'${y} ${m} ${day}`;
  }

  // ============== 切换预设 ==============
  function setPreset(idx) {
    presetIdx = (idx + PRESETS.length) % PRESETS.length;
    preset = PRESETS[presetIdx];
    filterTag.textContent = preset.desc;
    brandEl.textContent = preset.id;
    datestampEl.style.color = preset.stampColor;
    datestampEl.style.textShadow = `0 0 4px ${preset.stampGlow}, 0 0 12px ${preset.stampGlow}`;

    // 更新选中态
    presetStrip.querySelectorAll('.preset-chip').forEach((el, i) => {
      el.classList.toggle('active', i === presetIdx);
    });
    // 滚动到中央
    const active = presetStrip.querySelector('.preset-chip.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function buildPresetStrip() {
    presetStrip.innerHTML = '';
    PRESETS.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'preset-chip' + (i === 0 ? ' active' : '');
      btn.dataset.idx = String(i);
      btn.innerHTML = `<span class="chip-id">${p.id}</span><span class="chip-name">${p.name}</span>`;
      btn.addEventListener('click', () => setPreset(i));
      presetStrip.appendChild(btn);
    });
  }

  // ============== 交互 ==============
  shutterBtn.addEventListener('click', capture);

  flipBtn.addEventListener('click', async () => {
    usingFront = !usingFront;
    await startCamera(usingFront);
  });

  dateBtn.addEventListener('click', () => {
    showDate = !showDate;
    datestampEl.classList.toggle('hidden', !showDate);
    showToast(showDate ? '日期戳：开' : '日期戳：关');
  });

  filterBtn.addEventListener('click', () => {
    strengthIdx = (strengthIdx + 1) % strengthSteps.length;
    strength = strengthSteps[strengthIdx];
    strengthLabel.textContent = strengthLabels[strengthIdx];
    showToast('滤镜强度 ' + strengthLabels[strengthIdx]);
  });

  thumbBtn.addEventListener('click', () => {
    if (!lastShot) return;
    modalImg.src = lastShot;
    downloadBtn.href = lastShot;
    downloadBtn.download = `${preset.id.toLowerCase()}-${Date.now()}.jpg`;
    modal.hidden = false;
  });

  closeModalBtn.addEventListener('click', () => { modal.hidden = true; });

  // 滑动手势：在取景器上左右滑动切换预设
  let touchStartX = null, touchStartY = null;
  const frame = document.querySelector('.frame');
  frame.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  frame.addEventListener('touchend', e => {
    if (touchStartX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      setPreset(presetIdx + (dx < 0 ? 1 : -1));
    }
    touchStartX = touchStartY = null;
  }, { passive: true });

  // 键盘支持（开发友好）
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  setPreset(presetIdx - 1);
    if (e.key === 'ArrowRight') setPreset(presetIdx + 1);
    if (e.key === ' ')          { e.preventDefault(); capture(); }
  });

  // ============== 日期 / Toast / 启动 ==============
  function tickDate() {
    datestampEl.textContent = formatDate(new Date());
  }
  tickDate();
  setInterval(tickDate, 60_000);

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1400);
  }

  buildPresetStrip();
  setPreset(0);

  window.addEventListener('resize', resizeCanvas);
  video.addEventListener('loadedmetadata', resizeCanvas);

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('当前浏览器不支持摄像头 API');
    return;
  }

  startCamera(false).then(() => {
    requestAnimationFrame(drawFrame);
  }).catch(() => {});
})();
