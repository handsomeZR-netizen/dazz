/* NC Cam — 模仿 Dazz NC 滤镜的网页相机
 * 滤镜风格：复古胶片，暖橙色高光，青色阴影，提亮黑位（哑光），轻微颗粒和暗角，橙色日期戳
 */
(() => {
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

  const modal = document.getElementById('modal');
  const modalImg = document.getElementById('modalImg');
  const closeModalBtn = document.getElementById('closeModal');
  const downloadBtn = document.getElementById('downloadBtn');
  const toast = document.getElementById('toast');

  // ============== 状态 ==============
  let stream = null;
  let usingFront = false;
  let stopRender = false;
  let strength = 1.0;          // 滤镜强度 0..1
  const strengthSteps = [1.0, 0.7, 0.4, 0.0];
  const strengthLabels = ['100', '70', '40', 'OFF'];
  let strengthIdx = 0;
  let showDate = true;
  let lastShot = null;         // dataURL

  // ============== 启动相机 ==============
  async function startCamera(front = false) {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
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
      // 某些设备不支持 environment，回退到任意摄像头
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
    // 输出画布按 3:4 比例裁切
    const target = 3 / 4;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cap = 540; // 预览分辨率上限，兼顾性能
    let w, h;
    if (vw / vh > target) {
      h = Math.min(vh, cap);
      w = Math.round(h * target);
    } else {
      w = Math.min(vw, Math.round(cap * target));
      h = Math.round(w / target);
    }
    canvas.width  = w;
    canvas.height = h;
  }

  // ============== NC 滤镜 LUT ==============
  // 三通道独立的 256 元素查找表，用于色调映射
  const lutR = new Uint8ClampedArray(256);
  const lutG = new Uint8ClampedArray(256);
  const lutB = new Uint8ClampedArray(256);

  function buildLUTs() {
    for (let i = 0; i < 256; i++) {
      const x = i / 255;

      // 整体的"哑光"曲线：提亮黑位，压暗高光，弱化对比
      // matte(x) = lift + (1 - lift - rolloff) * x + rolloff * x^0.7
      const lift = 0.06;
      const matte = lift + (0.94 - 0.05) * x + 0.05 * Math.pow(x, 0.7);

      // 红色：在中高光额外加暖（+橙），阴影微微减弱
      const r = matte
        + 0.10 * Math.exp(-Math.pow((x - 0.75) / 0.30, 2)) // 高光暖
        - 0.03 * Math.exp(-Math.pow((x - 0.15) / 0.20, 2)); // 阴影微减

      // 绿色：S 曲线，整体略压一点点（避免发青苹果绿）
      const g = matte
        + 0.04 * Math.exp(-Math.pow((x - 0.65) / 0.30, 2))
        - 0.02;

      // 蓝色：阴影提亮（青调），高光压暗（暖调）
      const b = matte
        + 0.08 * Math.exp(-Math.pow((x - 0.20) / 0.25, 2)) // 阴影偏青
        - 0.10 * Math.exp(-Math.pow((x - 0.80) / 0.30, 2)); // 高光去蓝

      lutR[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      lutG[i] = Math.max(0, Math.min(255, Math.round(g * 255)));
      lutB[i] = Math.max(0, Math.min(255, Math.round(b * 255)));
    }
  }
  buildLUTs();

  // 颗粒噪声平铺（预生成，避免每帧 Math.sin）
  const NOISE_SIZE = 256;
  const noiseTile = new Int8Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < noiseTile.length; i++) {
    // ±7 的均匀噪声
    noiseTile[i] = (Math.random() * 14 - 7) | 0;
  }
  let noiseOffset = 0;

  // 暗角缓存
  let vignetteCache = null;
  let vignetteSize = '';
  function getVignette(w, h) {
    const key = `${w}x${h}`;
    if (vignetteSize === key && vignetteCache) return vignetteCache;
    const v = new Float32Array(w * h);
    const cx = w / 2, cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const r = Math.sqrt(dx * dx + dy * dy) / maxR;
        // 半径 0.55 之后开始压暗，最暗约 -28%
        const t = Math.max(0, (r - 0.55) / 0.45);
        v[y * w + x] = 1 - 0.28 * (t * t);
      }
    }
    vignetteCache = v;
    vignetteSize = key;
    return v;
  }

  // ============== 渲染循环 ==============
  function applyFilter(imageData, s) {
    const data = imageData.data;
    const w = imageData.width, h = imageData.height;
    const vig = getVignette(w, h);
    const inv = 1 - s;

    // 噪声偏移：每帧滚动，制造活动颗粒
    noiseOffset = (noiseOffset + 17) & (NOISE_SIZE * NOISE_SIZE - 1);
    const NMASK = NOISE_SIZE - 1;

    let p = 0, vi = 0;
    for (let y = 0; y < h; y++) {
      const ny = (y & NMASK) * NOISE_SIZE;
      for (let x = 0; x < w; x++) {
        const r0 = data[p];
        const g0 = data[p + 1];
        const b0 = data[p + 2];

        // LUT 颜色映射
        let r = lutR[r0];
        let g = lutG[g0];
        let b = lutB[b0];

        // 暗角
        const vf = vig[vi++];
        r *= vf; g *= vf; b *= vf;

        // 颗粒
        const grain = noiseTile[(ny + ((x + noiseOffset) & NMASK))];
        r += grain; g += grain; b += grain;

        // 强度混合
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
    if (stopRender) return;
    if (video.readyState >= 2 && canvas.width) {
      // cover-fit: 把视频裁切绘制到画布
      const cw = canvas.width, ch = canvas.height;
      const vw = video.videoWidth, vh = video.videoHeight;
      const cr = cw / ch, vr = vw / vh;
      let sx, sy, sw, sh;
      if (vr > cr) {
        // 视频更宽 — 裁左右
        sh = vh; sw = vh * cr;
        sx = (vw - sw) / 2; sy = 0;
      } else {
        sw = vw; sh = vw / cr;
        sx = 0; sy = (vh - sh) / 2;
      }

      ctx.save();
      if (usingFront) {
        // 前置摄像头镜像
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
      }
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

  // ============== 拍照 ==============
  function capture() {
    if (!canvas.width) return;

    // 闪屏
    flashEl.classList.remove('fire');
    void flashEl.offsetWidth; // 触发动画重启
    flashEl.classList.add('fire');

    // 在离屏画布上烘焙最终图：当前 canvas 内容 + 日期戳 + 品牌字
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext('2d');
    octx.drawImage(canvas, 0, 0);

    // 烘焙日期戳与品牌 LOGO
    const fontPx = Math.round(off.height * 0.034);
    const padding = Math.round(off.height * 0.022);

    // 品牌 NC
    octx.font = `700 ${Math.round(fontPx * 0.7)}px "Courier New", monospace`;
    octx.fillStyle = 'rgba(255, 235, 200, 0.85)';
    octx.shadowColor = 'rgba(255, 138, 61, 0.4)';
    octx.shadowBlur = 6;
    octx.textAlign = 'left';
    octx.textBaseline = 'top';
    octx.fillText('NC', padding, padding);

    if (showDate) {
      octx.font = `700 ${fontPx}px "Courier New", monospace`;
      octx.fillStyle = '#ff8a3d';
      octx.shadowColor = 'rgba(255, 138, 61, 0.7)';
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
    downloadBtn.download = `nc-cam-${Date.now()}.jpg`;
    modal.hidden = false;
  });

  closeModalBtn.addEventListener('click', () => {
    modal.hidden = true;
  });

  // 实时刷新日期戳
  function tickDate() {
    datestampEl.textContent = formatDate(new Date());
  }
  tickDate();
  setInterval(tickDate, 60_000);

  // ============== Toast ==============
  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1400);
  }

  // ============== 启动 ==============
  window.addEventListener('resize', resizeCanvas);
  video.addEventListener('loadedmetadata', resizeCanvas);

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('当前浏览器不支持摄像头 API');
    return;
  }

  startCamera(false).then(() => {
    requestAnimationFrame(drawFrame);
  }).catch(() => {
    // 错误已在 startCamera 中提示
  });
})();
