// Dazz Web — 入口编排：DOM 绑定 / 渲染主循环 / 各模块串联
import '../styles/index.css';

import { PRESETS } from './presets/index.js';
import { createRenderer, NOISE_SIZE } from './renderer/index.js';
import { startCamera, stopCamera, resizeCanvas } from './camera.js';
import { capture } from './capture.js';
import { Gallery } from './gallery/db.js';
import { BORDER_ORDER, BORDER_LABELS } from './borders.js';
import { formatDate } from './utils/date.js';
import { createToast } from './ui/toast.js';
import { createPresetStrip } from './ui/preset-strip.js';
import { createFxDrawer } from './ui/fx-drawer.js';
import { createAlbum } from './ui/album.js';
import { bindSwipe } from './input/gestures.js';
import { bindKeyboard } from './input/keyboard.js';
import { cameraSource, imageSource } from './source.js';
import { processBatch } from './batch.js';
import { centerCrop } from './utils/frame.js';

const $ = (id) => document.getElementById(id);

// ============== DOM ==============
const video = $('video');
const canvas = $('preview');
const flipBtn = $('flipBtn');
const importBtn = $('importBtn');
const importInput = $('importInput');
const dateBtn = $('dateBtn');
const borderBtn = $('borderBtn');
const ratioBtn = $('ratioBtn');
const effectsBtn = $('effectsBtn');
const fxDrawer = $('fxDrawer');
const shutterBtn = $('shutterBtn');
const filterBtn = $('filterBtn');
const strengthLabel = $('strengthLabel');
const datestampEl = $('datestamp');
const flashEl = $('flash');
const filterTag = $('filterTag');
const presetStripEl = $('presets');
const brandEl = document.querySelector('.brand');
const bodyEl = $('body');
const bodyBrand = $('bodyBrand');
const frameEl = document.querySelector('.frame');

const albumRefs = {
  album: $('album'),
  albumGrid: $('albumGrid'),
  albumEmpty: $('albumEmpty'),
  albumCloseBtn: $('albumClose'),
  albumExportBtn: $('albumExport'),
  albumCountEl: $('albumCount'),
  modal: $('modal'),
  modalImg: $('modalImg'),
  modalMeta: $('modalMeta'),
  closeModalBtn: $('closeModal'),
  deleteBtn: $('deleteBtn'),
  shareBtn: $('shareBtn'),
  downloadBtn: $('downloadBtn'),
  thumbBtn: $('thumbBtn'),
  thumbCount: $('thumbCount'),
};

// ============== 状态 ==============
let usingFront = false;
let strength = 1.0;
const strengthSteps = [1.0, 0.7, 0.4, 0.0];
const strengthLabels = ['100', '70', '40', 'OFF'];
let strengthIdx = 0;
let showDate = true;
let borderIdx = 0;
let currentSource = cameraSource(video);
let sourceChangeSeq = 0;

const ASPECT_TARGETS = { '3:4': 3 / 4, '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16 };
const ASPECT_ORDER = ['3:4', '1:1', '16:9', '9:16'];
let currentAspect = '3:4';
frameEl.dataset.aspect = currentAspect;

const effects = { halation: 0, fisheye: 0, flash: 0 };
let flashArmed = false;
let flashFlare = 0;

// ============== 工具 ==============
const showToast = createToast($('toast'));

// ============== 渲染器 ==============
const renderer = createRenderer(canvas);
const hasGL = renderer.kind === 'gl';
if (!hasGL) {
  // CPU 路径不支持进阶特效，隐藏入口
  effectsBtn.style.display = 'none';
}

function applyResize() {
  if (!currentSource.intrinsicW || !currentSource.intrinsicH) return;
  const target = ASPECT_TARGETS[currentAspect];
  const dim = resizeCanvas(canvas, currentSource.intrinsicW, currentSource.intrinsicH, { hasGL, target });
  if (dim) renderer.setSize(dim.w, dim.h);
}

function updateSourceUi() {
  const imageMode = currentSource.kind === 'image';
  importBtn.classList.toggle('is-active', imageMode);
  flipBtn.title = imageMode ? '返回相机' : '翻转摄像头';
  flipBtn.setAttribute('aria-label', imageMode ? '返回相机' : '翻转摄像头');
}

function disposeSource(source) {
  if (source?.kind === 'image') source.close?.();
}

async function setSourceImage(file) {
  if (!file) return;
  const seq = ++sourceChangeSeq;
  try {
    const nextSource = await imageSource(file);
    if (seq !== sourceChangeSeq) {
      disposeSource(nextSource);
      return;
    }
    const previousSource = currentSource;
    stopCamera();
    video.pause();
    video.srcObject = null;
    currentSource = nextSource;
    disposeSource(previousSource);
    applyResize();
    updateSourceUi();
    showToast('已导入图片');
  } catch (err) {
    showToast('导入失败：' + (err.message || err.name));
  }
}

async function setSourceCamera({ toast = false } = {}) {
  const seq = ++sourceChangeSeq;
  try {
    const previousSource = currentSource;
    await startCamera(video, { front: usingFront, onError: showToast });
    if (seq !== sourceChangeSeq) {
      if (currentSource.kind === 'image') {
        stopCamera();
        video.pause();
        video.srcObject = null;
      }
      return;
    }
    currentSource = cameraSource(video);
    disposeSource(previousSource);
    applyResize();
    updateSourceUi();
    if (toast) showToast('已切回相机');
  } catch (err) {
    showToast('无法切回相机：' + (err.message || err.name));
  }
}

// ============== 预设条 ==============
const presetStrip = createPresetStrip({
  stripEl: presetStripEl,
  refs: { filterTag, brandEl, datestampEl, bodyEl, bodyBrand },
  onChange(preset) {
    renderer.setPreset(preset);
  },
});
presetStrip.build();
presetStrip.setPreset(0);

// ============== 特效抽屉 ==============
createFxDrawer({
  drawerEl: fxDrawer,
  openBtn: effectsBtn,
  effects,
  getFlashArmed: () => flashArmed,
  setFlashArmed: (v) => { flashArmed = v; },
});

// ============== 相册 ==============
const albumApi = createAlbum({ refs: albumRefs, onToast: showToast });

// ============== 拍照 ==============
function doShutter() {
  capture({
    canvas,
    flashEl,
    fxDrawer,
    preset: presetStrip.current,
    borderIdx,
    showDate,
    flashArmed,
    setFlashArmed: (v) => { flashArmed = v; },
    setFlashFlare: (v) => { flashFlare = v; },
    hasGL,
    onToast: showToast,
    onSaved: albumApi.refreshThumb,
  });
}
shutterBtn.addEventListener('click', doShutter);

// ============== 顶栏交互 ==============
flipBtn.addEventListener('click', async () => {
  if (currentSource.kind === 'image') {
    await setSourceCamera({ toast: true });
    return;
  }
  usingFront = !usingFront;
  await startCamera(video, { front: usingFront, onError: showToast });
  currentSource = cameraSource(video);
  applyResize();
});

importBtn.addEventListener('click', () => {
  importInput.value = '';
  importInput.click();
});

importInput.addEventListener('change', async () => {
  const files = Array.from(importInput.files || []);
  if (files.length <= 1) {
    await setSourceImage(files[0]);
    return;
  }

  await processBatch(files, {
    preset: presetStrip.current,
    borderIdx,
    showDate,
    strength,
    hasGL,
    target: ASPECT_TARGETS[currentAspect],
    onProgress: ({ current, total }) => showToast(`批量处理 ${current}/${total}`),
    onError: (err, file) => {
      const name = file?.name ? `${file.name}：` : '';
      showToast('导入失败：' + name + (err.message || err.name));
    },
    onDone: async ({ imported }) => {
      showToast(`已导入 ${imported} 张`);
      await albumApi.refreshThumb();
    },
  });
});

borderBtn.addEventListener('click', () => {
  borderIdx = (borderIdx + 1) % BORDER_ORDER.length;
  const id = BORDER_ORDER[borderIdx];
  frameEl.dataset.border = id;
  showToast('边框：' + BORDER_LABELS[id]);
});

ratioBtn.addEventListener('click', () => {
  const idx = ASPECT_ORDER.indexOf(currentAspect);
  currentAspect = ASPECT_ORDER[(idx + 1) % ASPECT_ORDER.length];
  frameEl.dataset.aspect = currentAspect;
  applyResize();
  showToast('画幅：' + currentAspect);
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

// ============== 输入 ==============
bindSwipe(frameEl, {
  onLeft: () => presetStrip.next(),
  onRight: () => presetStrip.prev(),
});

bindKeyboard({
  onEsc: () => {
    if (albumApi.isDetailOpen()) { albumApi.closeDetail(); return; }
    if (albumApi.isAlbumOpen()) { albumApi.closeAlbum(); return; }
    if (!fxDrawer.hidden) { fxDrawer.hidden = true; }
  },
  onLeft: () => presetStrip.prev(),
  onRight: () => presetStrip.next(),
  onShutter: doShutter,
  anyOverlayOpen: () => albumApi.isDetailOpen() || albumApi.isAlbumOpen() || !fxDrawer.hidden,
});

// ============== 主渲染循环 ==============
let noiseOffset = 0;
function drawFrame() {
  if (currentSource.isReady() && canvas.width) {
    const cw = canvas.width;
    const ch = canvas.height;
    const { uvOffset, uvScale } = centerCrop(currentSource.intrinsicW, currentSource.intrinsicH, cw, ch);

    noiseOffset = (noiseOffset + 17) & (NOISE_SIZE * NOISE_SIZE - 1);
    const nx = (noiseOffset & (NOISE_SIZE - 1)) / NOISE_SIZE;
    const ny = (((noiseOffset / NOISE_SIZE) | 0) & (NOISE_SIZE - 1)) / NOISE_SIZE;
    if (flashFlare > 0) flashFlare = Math.max(0, flashFlare - 0.04);

    renderer.draw(currentSource.element, {
      uvOffset,
      uvScale,
      mirror: currentSource.kind === 'camera' && usingFront,
      strength,
      preset: presetStrip.current,
      noiseShift: [nx, ny],
      w: cw,
      h: ch,
      effects: {
        halation: effects.halation,
        fisheye: effects.fisheye,
        flash: Math.max(effects.flash, flashFlare),
      },
    });
  }
  requestAnimationFrame(drawFrame);
}

// ============== 日期戳更新 ==============
function tickDate() {
  datestampEl.textContent = formatDate(new Date());
}
tickDate();
setInterval(tickDate, 60_000);

// ============== 启动 ==============
window.addEventListener('resize', applyResize);
video.addEventListener('loadedmetadata', applyResize);
updateSourceUi();

Gallery.open()
  .then(albumApi.refreshThumb)
  .catch((err) => showToast('胶卷库不可用：' + err.message));

requestAnimationFrame(drawFrame);

if (!navigator.mediaDevices?.getUserMedia) {
  showToast('当前浏览器不支持摄像头 API');
} else {
  setSourceCamera()
    .catch(() => {});
}
