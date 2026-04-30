/* Dazz Web — 多滤镜胶片相机
 * 支持 4 种胶片预设：NC / FX / G / D，每个预设包含色调 LUT、颗粒、暗角、日期戳颜色与可选光斑。
 */
(() => {
  // ============== DOM ==============
  const video = document.getElementById('video');
  const canvas = document.getElementById('preview');
  // 渲染上下文延后获取：先试 WebGL2，失败回退 2D
  let ctx = null;        // CanvasRenderingContext2D（2D 路径）
  let GL = null;         // GL 渲染器对象（GL 路径），见下面 createGLRenderer

  const flipBtn = document.getElementById('flipBtn');
  const dateBtn = document.getElementById('dateBtn');
  const borderBtn = document.getElementById('borderBtn');
  const shutterBtn = document.getElementById('shutterBtn');
  const filterBtn = document.getElementById('filterBtn');
  const strengthLabel = document.getElementById('strengthLabel');
  const datestampEl = document.getElementById('datestamp');
  const flashEl = document.getElementById('flash');
  const thumbBtn = document.getElementById('thumbBtn');
  const filterTag = document.getElementById('filterTag');
  const presetStrip = document.getElementById('presets');
  const brandEl = document.querySelector('.brand');
  const bodyEl = document.getElementById('body');
  const bodyBrand = document.getElementById('bodyBrand');

  const modal = document.getElementById('modal');
  const modalImg = document.getElementById('modalImg');
  const modalMeta = document.getElementById('modalMeta');
  const closeModalBtn = document.getElementById('closeModal');
  const deleteBtn = document.getElementById('deleteBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const toast = document.getElementById('toast');
  const thumbCount = document.getElementById('thumbCount');

  const album = document.getElementById('album');
  const albumGrid = document.getElementById('albumGrid');
  const albumEmpty = document.getElementById('albumEmpty');
  const albumCloseBtn = document.getElementById('albumClose');
  const albumExportBtn = document.getElementById('albumExport');
  const albumCountEl = document.getElementById('albumCount');

  // ============== 预设定义 ==============
  // 每个预设的 LUT 构造函数：输入 0..1 标量 x，返回 [r, g, b] (0..1)
  const PRESETS = [
    {
      id: 'NC',
      name: 'Nostalgic',
      desc: 'NC · Nostalgic',
      stampColor: '#ff8a3d',
      stampGlow:  'rgba(255, 138, 61, 0.7)',
      brandLabel: 'NC-FILM',
      developMs: 1500,
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
      brandLabel: 'FX-CINE',
      developMs: 0,
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
      brandLabel: 'GRAIN ZERO',
      developMs: 0,
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
      brandLabel: 'D · SINGLE',
      developMs: 3000,
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
  let presetIdx = 0;
  let preset = PRESETS[0];
  let borderIdx = 0;
  const BORDER_ORDER = ['none', '35mm', 'polaroid', 'square'];
  const BORDER_LABELS = { none: '无边框', '35mm': '35mm 胶片', polaroid: '拍立得', square: '方画幅' };

  // 当前详情视图打开的记录（用于删除按钮）
  let currentDetail = null;
  // 缩略图当前 object URL（关闭时撤销）
  let thumbObjUrl = null;
  let detailObjUrl = null;
  // 容量上限
  const MAX_PHOTOS = 200;

  // ============== Gallery (IndexedDB) ==============
  const Gallery = (() => {
    const DB = 'dazz-cam', STORE = 'photos';
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const s = db.createObjectStore(STORE, { keyPath: 'id' });
            s.createIndex('ts', 'ts');
          }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
      });
      return dbp;
    }
    async function add(blob, meta = {}) {
      const db = await open();
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const record = { id, ts: Date.now(), blob, ...meta };
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = e => reject(e.target.error);
      });
    }
    async function list() {
      const db = await open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const idx = tx.objectStore(STORE).index('ts');
        const items = [];
        idx.openCursor(null, 'prev').onsuccess = e => {
          const c = e.target.result;
          if (c) { items.push(c.value); c.continue(); }
          else resolve(items);
        };
      });
    }
    async function remove(id) {
      const db = await open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
      });
    }
    async function count() {
      const db = await open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        tx.objectStore(STORE).count().onsuccess = e => resolve(e.target.result);
      });
    }
    async function trim(maxN) {
      const items = await list();
      if (items.length <= maxN) return 0;
      const db = await open();
      const dropped = items.slice(maxN);
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const s = tx.objectStore(STORE);
        for (const it of dropped) s.delete(it.id);
        tx.oncomplete = () => resolve(dropped.length);
      });
    }
    async function latest() {
      const items = await list();
      return items[0] || null;
    }
    return { open, add, list, remove, count, trim, latest };
  })();

  // ============== STORE-mode ZIP（无外部依赖） ==============
  const CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC32_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function buildZip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const e of entries) {
      const data = new Uint8Array(await e.blob.arrayBuffer());
      const nameBytes = enc.encode(e.name);
      const c = crc32(data);
      const lfh = new ArrayBuffer(30);
      const dv = new DataView(lfh);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, c, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      parts.push(new Uint8Array(lfh), nameBytes, data);
      const cdh = new ArrayBuffer(46);
      const cv = new DataView(cdh);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, c, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.push(new Uint8Array(cdh), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const cdOffset = offset;
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true);
    return new Blob([...parts, ...central, new Uint8Array(eocd)], { type: 'application/zip' });
  }

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
    // GL 路径分辨率上限可以更高（GPU 处理更快）
    const cap = GL ? 900 : 540;
    let w, h;
    if (vw / vh > target) { h = Math.min(vh, cap); w = Math.round(h * target); }
    else { w = Math.min(vw, Math.round(cap * target)); h = Math.round(w / target); }
    canvas.width = w;
    canvas.height = h;
    if (GL) GL.setSize(w, h);
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

  // ============== WebGL2 渲染器 ==============
  const VS_SOURCE = `#version 300 es
in vec2 aPos;
in vec2 aUv;
out vec2 vUv;
out vec2 vVideoUv;
uniform vec2 uUvOffset;
uniform vec2 uUvScale;
uniform float uMirror;
void main() {
  vUv = aUv;
  vec2 uv = aUv;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  vVideoUv = uUvOffset + uv * uUvScale;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const FS_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D uVideo;
uniform sampler2D uLut;
uniform sampler2D uNoise;
uniform float uStrength;
uniform float uGrainAmp;
uniform float uVignette;
uniform float uLeak;
uniform float uMono;
uniform vec2  uNoiseShift;
uniform vec2  uResolution;
in vec2 vUv;
in vec2 vVideoUv;
out vec4 outColor;
void main() {
  vec3 src = texture(uVideo, vVideoUv).rgb;
  vec3 c;
  if (uMono > 0.5) {
    float y = dot(src, vec3(0.299, 0.587, 0.114));
    float v = texture(uLut, vec2(y, 0.5)).r;
    c = vec3(v);
  } else {
    c = vec3(
      texture(uLut, vec2(src.r, 0.5)).r,
      texture(uLut, vec2(src.g, 0.5)).g,
      texture(uLut, vec2(src.b, 0.5)).b
    );
  }
  vec2 d = vUv - 0.5;
  float r = length(d) * 1.41421356;
  float t = max(0.0, (r - 0.55) / 0.45);
  c *= (1.0 - uVignette * t * t);
  if (uLeak > 0.5) {
    vec2 lc = vec2(1.05, -0.05);
    float ld = length(vUv - lc) / 0.85;
    float lt = max(0.0, 1.0 - ld);
    float lk = lt * lt * 0.55;
    c += vec3(60.0, 22.0, 28.0) * lk / 255.0;
  }
  vec2 nuv = (vUv * uResolution / 256.0) + uNoiseShift;
  float n = texture(uNoise, nuv).r;
  c += (n - 0.5) * 2.0 * uGrainAmp / 255.0;
  c = mix(src, c, uStrength);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  function createGLRenderer(cvs) {
    const gl = cvs.getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) return null;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('shader compile:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }
    const vs = compile(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = compile(gl.FRAGMENT_SHADER, FS_SOURCE);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);

    // 全屏 quad（注意 UV：上下翻转以对齐 video texture y 轴）
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      // pos      uv (y 翻转)
      -1, -1,    0, 1,
       1, -1,    1, 1,
      -1,  1,    0, 0,
       1,  1,    1, 0,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aUv  = gl.getAttribLocation(prog, 'aUv');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    const u = {};
    for (const name of ['uVideo','uLut','uNoise','uStrength','uGrainAmp','uVignette','uLeak','uMono','uNoiseShift','uResolution','uUvOffset','uUvScale','uMirror']) {
      u[name] = gl.getUniformLocation(prog, name);
    }

    // Video texture
    const videoTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // LUT texture (256x1, RGBA)
    const lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 占位（实际 LUT 在 setPreset 里上传）
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(256 * 4));

    // Noise texture 256x256 R8
    const noiseTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const noiseU8 = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
    for (let i = 0; i < noiseTile.length; i++) noiseU8[i] = noiseTile[i] + 128;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NOISE_SIZE, NOISE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, noiseU8);

    gl.uniform1i(u.uVideo, 0);
    gl.uniform1i(u.uLut, 1);
    gl.uniform1i(u.uNoise, 2);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    return {
      gl,
      setSize(w, h) {
        gl.viewport(0, 0, w, h);
      },
      setPreset(p) {
        // 把 lutR/G/B 打包成 RGBA 256x1
        const lutData = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) {
          lutData[i * 4 + 0] = p.lutR[i];
          lutData[i * 4 + 1] = p.lutG[i];
          lutData[i * 4 + 2] = p.lutB[i];
          lutData[i * 4 + 3] = 255;
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
      },
      draw(videoEl, opts) {
        const { uvOffset, uvScale, mirror, strength, preset, noiseShift, w, h } = opts;
        // 上传视频帧
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, videoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoEl);

        gl.uniform1f(u.uStrength, strength);
        gl.uniform1f(u.uGrainAmp, preset.grainAmp);
        gl.uniform1f(u.uVignette, preset.vignette);
        gl.uniform1f(u.uLeak, preset.leak ? 1.0 : 0.0);
        gl.uniform1f(u.uMono, preset.mono ? 1.0 : 0.0);
        gl.uniform2f(u.uNoiseShift, noiseShift[0], noiseShift[1]);
        gl.uniform2f(u.uResolution, w, h);
        gl.uniform2f(u.uUvOffset, uvOffset[0], uvOffset[1]);
        gl.uniform2f(u.uUvScale, uvScale[0], uvScale[1]);
        gl.uniform1f(u.uMirror, mirror ? 1.0 : 0.0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    };
  }

  // ============== 滤镜核心（CPU 回退） ==============
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

      if (GL) {
        noiseOffset = (noiseOffset + 17) & (NOISE_SIZE * NOISE_SIZE - 1);
        const nx = (noiseOffset & (NOISE_SIZE - 1)) / NOISE_SIZE;
        const ny = (((noiseOffset / NOISE_SIZE) | 0) & (NOISE_SIZE - 1)) / NOISE_SIZE;
        GL.draw(video, {
          uvOffset: [sx / vw, sy / vh],
          uvScale:  [sw / vw, sh / vh],
          mirror: usingFront,
          strength,
          preset,
          noiseShift: [nx, ny],
          w: cw, h: ch,
        });
      } else {
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
    }
    requestAnimationFrame(drawFrame);
  }

  // ============== 边框合成 ==============
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function bakeStamps(ctx, x, y, w, h, preset, showDate) {
    const fontPx = Math.round(h * 0.034);
    const padding = Math.round(h * 0.022);
    ctx.save();
    ctx.font = `700 ${Math.round(fontPx * 0.7)}px "Courier New", monospace`;
    ctx.fillStyle = 'rgba(255, 235, 200, 0.85)';
    ctx.shadowColor = preset.stampGlow;
    ctx.shadowBlur = 6;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(preset.id, x + padding, y + padding);
    if (showDate) {
      ctx.font = `700 ${fontPx}px "Courier New", monospace`;
      ctx.fillStyle = preset.stampColor;
      ctx.shadowColor = preset.stampGlow;
      ctx.shadowBlur = 8;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatDate(new Date()), x + w - padding, y + h - padding);
    }
    ctx.restore();
  }

  // 每个边框：返回 { canvas, imgRect } — imgRect 是图像在最终画布上的矩形
  const BORDERS = {
    none(src) {
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      return { canvas: c, ctx, imgRect: { x: 0, y: 0, w: src.width, h: src.height } };
    },
    '35mm'(src, p) {
      const w = src.width, h = src.height;
      const bar = Math.round(h * 0.085);
      const c = document.createElement('canvas');
      c.width = w; c.height = h + bar * 2;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src, 0, bar);
      // 齿孔
      const holeW = bar * 0.5, holeH = bar * 0.42;
      const gap = holeW * 1.7;
      const count = Math.max(1, Math.floor((w - holeW * 0.5) / gap));
      const totalSpan = (count - 1) * gap + holeW;
      const start = (w - totalSpan) / 2;
      ctx.fillStyle = '#1a1a1a';
      for (let i = 0; i < count; i++) {
        const xh = start + i * gap;
        roundRect(ctx, xh, (bar - holeH) / 2, holeW, holeH, holeH * 0.22);
        ctx.fill();
        roundRect(ctx, xh, c.height - bar + (bar - holeH) / 2, holeW, holeH, holeH * 0.22);
        ctx.fill();
      }
      // 底部：胶片标识 + 帧号
      ctx.fillStyle = p.stampColor;
      ctx.font = `700 ${Math.round(bar * 0.36)}px "Courier New", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${p.id} 200`, 14, c.height - bar / 2);
      ctx.textAlign = 'right';
      ctx.fillText('· 36 →', w - 14, c.height - bar / 2);
      return { canvas: c, ctx, imgRect: { x: 0, y: bar, w, h } };
    },
    polaroid(src) {
      const w = src.width, h = src.height;
      const side = Math.round(w * 0.06);
      const top = Math.round(h * 0.06);
      const bottom = Math.round(h * 0.22);
      const c = document.createElement('canvas');
      c.width = w + side * 2; c.height = h + top + bottom;
      const ctx = c.getContext('2d');
      // 米白纸面
      ctx.fillStyle = '#f5efe1';
      ctx.fillRect(0, 0, c.width, c.height);
      // 微阴影
      const grd = ctx.createLinearGradient(0, 0, 0, c.height);
      grd.addColorStop(0, 'rgba(0,0,0,0.04)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, c.width, c.height);
      // 图像
      ctx.drawImage(src, side, top);
      // 图像四周细黑线
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(side - 0.5, top - 0.5, w + 1, h + 1);
      return { canvas: c, ctx, imgRect: { x: side, y: top, w, h } };
    },
    square(src) {
      const w = src.width, h = src.height;
      const side = Math.min(w, h);
      const sx = (w - side) / 2, sy = (h - side) / 2;
      const border = Math.max(2, Math.round(side * 0.012));
      const c = document.createElement('canvas');
      c.width = side + border * 2; c.height = side + border * 2;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src, sx, sy, side, side, border, border, side, side);
      return { canvas: c, ctx, imgRect: { x: border, y: border, w: side, h: side } };
    },
  };

  function composeOutput(src, borderId, p, showDate) {
    const fn = BORDERS[borderId] || BORDERS.none;
    const { canvas: out, ctx, imgRect } = fn(src, p);
    bakeStamps(ctx, imgRect.x, imgRect.y, imgRect.w, imgRect.h, p, showDate);
    return out;
  }

  // ============== 拍照（边框合成 + 水印 + 入库） ==============
  function capture() {
    if (!canvas.width) return;

    flashEl.classList.remove('fire');
    void flashEl.offsetWidth;
    flashEl.classList.add('fire');

    const borderId = BORDER_ORDER[borderIdx];
    const out = composeOutput(canvas, borderId, preset, showDate);

    const presetId = preset.id;
    const developMs = preset.developMs || 0;
    out.toBlob(async (blob) => {
      if (!blob) { showToast('保存失败'); return; }
      try {
        await Gallery.add(blob, { presetId, borderId, developMs });
        const dropped = await Gallery.trim(MAX_PHOTOS);
        if (dropped) showToast(`已保留最近 ${MAX_PHOTOS} 张`);
        else if (developMs > 0) showToast(`已捕获 · 显影 ${(developMs / 1000).toFixed(1)}s`);
        await refreshThumb();
      } catch (e) {
        showToast('保存失败：' + (e.message || e.name));
      }
    }, 'image/jpeg', 0.92);
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
    bodyEl.dataset.preset = preset.id;
    bodyBrand.textContent = preset.brandLabel;
    if (GL) GL.setPreset(preset);

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

  borderBtn.addEventListener('click', () => {
    borderIdx = (borderIdx + 1) % BORDER_ORDER.length;
    const id = BORDER_ORDER[borderIdx];
    document.querySelector('.frame').dataset.border = id;
    showToast('边框：' + BORDER_LABELS[id]);
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

  thumbBtn.addEventListener('click', openAlbum);
  albumCloseBtn.addEventListener('click', closeAlbum);
  closeModalBtn.addEventListener('click', closeDetail);
  deleteBtn.addEventListener('click', async () => {
    if (!currentDetail) return;
    if (!confirm('删除这张照片？')) return;
    await Gallery.remove(currentDetail.id);
    showToast('已删除');
    closeDetail();
    if (!album.hidden) await renderAlbum();
    await refreshThumb();
  });
  albumExportBtn.addEventListener('click', exportAll);

  // ============== 显影 ==============
  function isDeveloped(rec) {
    if (!rec.developMs) return true;
    return (Date.now() - rec.ts) >= rec.developMs;
  }
  function remainingDevelop(rec) {
    if (!rec.developMs) return 0;
    return Math.max(0, rec.developMs - (Date.now() - rec.ts));
  }
  // 在元素上播放显影动画：从模糊→清晰，剩余时间为 ms
  function playDevelop(el, ms) {
    if (ms <= 0) {
      el.style.filter = '';
      el.style.transition = '';
      return;
    }
    el.style.filter = 'blur(8px) brightness(0.45) saturate(0.3)';
    el.style.transition = 'none';
    void el.offsetWidth;
    el.style.transition = `filter ${ms}ms ease-out`;
    el.style.filter = 'none';
    setTimeout(() => {
      el.style.transition = '';
      el.style.filter = '';
    }, ms + 80);
  }

  // ============== 相册 / 详情视图 ==============
  async function refreshThumb() {
    const latest = await Gallery.latest();
    const n = await Gallery.count();
    if (thumbObjUrl) { URL.revokeObjectURL(thumbObjUrl); thumbObjUrl = null; }
    if (latest) {
      thumbObjUrl = URL.createObjectURL(latest.blob);
      thumbBtn.style.backgroundImage = `url(${thumbObjUrl})`;
      thumbBtn.querySelector('.thumb-empty')?.remove();
      playDevelop(thumbBtn, remainingDevelop(latest));
    } else {
      thumbBtn.style.backgroundImage = '';
      thumbBtn.style.filter = '';
      if (!thumbBtn.querySelector('.thumb-empty')) {
        const span = document.createElement('span');
        span.className = 'thumb-empty';
        span.textContent = '×';
        thumbBtn.prepend(span);
      }
    }
    if (n > 0) {
      thumbCount.hidden = false;
      thumbCount.textContent = String(n);
    } else {
      thumbCount.hidden = true;
    }
  }

  async function openAlbum() {
    await renderAlbum();
    album.hidden = false;
  }
  function closeAlbum() {
    album.hidden = true;
    // 释放网格中的 object URL
    albumGrid.querySelectorAll('.album-cell').forEach(cell => {
      const u = cell.dataset.url;
      if (u) URL.revokeObjectURL(u);
    });
    albumGrid.innerHTML = '';
  }
  async function renderAlbum() {
    const items = await Gallery.list();
    albumCountEl.textContent = String(items.length);
    albumGrid.innerHTML = '';
    if (items.length === 0) {
      albumEmpty.hidden = false;
      return;
    }
    albumEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const cell = document.createElement('div');
      cell.className = 'album-cell';
      const url = URL.createObjectURL(it.blob);
      cell.dataset.url = url;
      cell.dataset.id = it.id;
      cell.dataset.preset = it.presetId || '';
      cell.style.backgroundImage = `url(${url})`;
      cell.addEventListener('click', () => openDetail(it));
      const remaining = remainingDevelop(it);
      if (remaining > 0) {
        cell.classList.add('developing');
        // 给 DOM 一帧时间显示初始模糊态
        requestAnimationFrame(() => playDevelop(cell, remaining));
      }
      frag.appendChild(cell);
    }
    albumGrid.appendChild(frag);
  }

  function openDetail(rec) {
    currentDetail = rec;
    if (detailObjUrl) URL.revokeObjectURL(detailObjUrl);
    detailObjUrl = URL.createObjectURL(rec.blob);
    modalImg.src = detailObjUrl;
    downloadBtn.href = detailObjUrl;
    downloadBtn.download = `${(rec.presetId || 'dazz').toLowerCase()}-${rec.id}.jpg`;
    const d = new Date(rec.ts);
    const remaining = remainingDevelop(rec);
    const status = remaining > 0 ? ` · 显影中 ${(remaining / 1000).toFixed(1)}s` : '';
    modalMeta.textContent = `${rec.presetId || ''} · ${d.toLocaleString()}${status}`;
    modal.hidden = false;
    if (remaining > 0) {
      requestAnimationFrame(() => playDevelop(modalImg, remaining));
      // 显影完成后清掉状态文字
      setTimeout(() => {
        if (currentDetail === rec) {
          modalMeta.textContent = `${rec.presetId || ''} · ${d.toLocaleString()}`;
        }
      }, remaining + 100);
    }
  }
  function closeDetail() {
    modal.hidden = true;
    currentDetail = null;
    if (detailObjUrl) {
      // 延迟撤销以避免下载链接立即失效
      const u = detailObjUrl;
      detailObjUrl = null;
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
  }

  async function exportAll() {
    const items = await Gallery.list();
    if (items.length === 0) { showToast('胶卷是空的'); return; }
    showToast('打包中…');
    try {
      const entries = items.map(it => ({
        name: `${(it.presetId || 'dazz').toLowerCase()}-${it.id}.jpg`,
        blob: it.blob,
      }));
      const zipBlob = await buildZip(entries);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dazz-roll-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      showToast('导出失败：' + (e.message || e.name));
    }
  }

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
    if (e.key === 'Escape') {
      if (!modal.hidden) { closeDetail(); return; }
      if (!album.hidden) { closeAlbum(); return; }
    }
    // 视图打开时不切预设
    if (!modal.hidden || !album.hidden) return;
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

  // 初始化渲染器：先尝试 WebGL2，失败回退 Canvas2D
  GL = createGLRenderer(canvas);
  if (!GL) {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    console.warn('WebGL2 不可用，使用 CPU 渲染');
  }

  buildPresetStrip();
  setPreset(0);

  // 启动时恢复缩略图与计数
  Gallery.open()
    .then(refreshThumb)
    .catch(err => showToast('胶卷库不可用：' + err.message));

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
