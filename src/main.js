// Dazz Web — 入口编排：DOM 绑定 / 渲染主循环 / 各模块串联
import '../styles/index.css';

import { PRESETS, loadAndAttachUserPresets, attachUserSpec, detachUserPreset } from './presets/index.js';
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
import { createEditor } from './ui/editor.js';
import { bindSwipe } from './input/gestures.js';
import { bindKeyboard } from './input/keyboard.js';
import { cameraSource, imageSource } from './source.js';
import { processBatch } from './batch.js';
import { centerCrop } from './utils/frame.js';
import { createRecorder, isVideoSupported, formatElapsed, makeVideoFilename } from './recorder.js';

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
const videoBtn = $('videoBtn');
const recTimeEl = $('recTime');
const fxDrawer = $('fxDrawer');
const shutterBtn = $('shutterBtn');
const filterBtn = $('filterBtn');
const strengthLabel = $('strengthLabel');
const strengthSlider = $('strengthSlider');
const strengthRange = $('strengthRange');
const strengthSliderValue = $('strengthSliderValue');
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
  albumTabs: $('albumTabs'),
  albumHeader: document.querySelector('#album .album-header'),
  modal: $('modal'),
  modalImg: $('modalImg'),
  modalMeta: $('modalMeta'),
  closeModalBtn: $('closeModal'),
  deleteBtn: $('deleteBtn'),
  shareBtn: $('shareBtn'),
  downloadBtn: $('downloadBtn'),
  thumbBtn: $('thumbBtn'),
  thumbCount: $('thumbCount'),
  modalGroupPick: $('modalGroupPick'),
  modalGroupName: $('modalGroupName'),
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

// 当前激活的相册分组（默认 ALL）。新拍照片入此分组。
let activeLabel = 'ALL';

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
  onAdd: () => editor.open(),
  onDeleteUser: (preset) => handleDeleteUserPreset(preset),
});
presetStrip.build();
presetStrip.setPreset(0);

// ============== 自定义滤镜编辑器 ==============
const editor = createEditor({
  onSave: async (spec) => {
    try {
      await Gallery.userPresetsPut(spec);
    } catch (e) {
      showToast('保存失败：' + (e?.message || e));
      throw e;
    }
    const preset = attachUserSpec(spec);
    presetStrip.rebuild(preset.id);
    showToast('已保存：' + spec.name);
  },
});

function handleDeleteUserPreset(preset) {
  if (!preset?.isUser) return;
  if (!confirm(`删除自定义预设「${preset.name}」？`)) return;
  Gallery.userPresetsDelete(preset.id)
    .then(() => {
      const prevActiveId = presetStrip.current?.id;
      const wasActive = prevActiveId === preset.id;
      detachUserPreset(preset.id);
      // 已删除当前激活预设：回退到第一项（NC）；否则保留之前的激活 id
      presetStrip.rebuild(wasActive ? PRESETS[0]?.id : prevActiveId);
      showToast('已删除：' + preset.name);
    })
    .catch((e) => showToast('删除失败：' + (e?.message || e)));
}

// ============== 特效抽屉 ==============
createFxDrawer({
  drawerEl: fxDrawer,
  openBtn: effectsBtn,
  effects,
  getFlashArmed: () => flashArmed,
  setFlashArmed: (v) => { flashArmed = v; },
});

// ============== 相册 ==============
const albumApi = createAlbum({
  refs: albumRefs,
  onToast: showToast,
  getActiveLabel: () => activeLabel,
  setActiveLabel: (label) => { activeLabel = label || 'ALL'; },
});

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
    albumLabel: activeLabel,
  });
}

// ============== 视频录制 ==============
const VIDEO_MAX_SEC = 60;
let videoMode = false;
let recorder = null;
let videoSupported = isVideoSupported();

function updateRecTime(ms) {
  recTimeEl.textContent = formatElapsed(ms);
}

function downloadVideo(blob, mimeType, extension) {
  const filename = makeVideoFilename(presetStrip.current?.id, extension);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 让浏览器拿到 blob 后再回收
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function startVideoRecording() {
  if (recorder?.isRecording()) return;
  recorder = createRecorder({
    canvas,
    fps: 30,
    maxSec: VIDEO_MAX_SEC,
    onTick: (ms) => updateRecTime(ms),
    onStop: ({ blob, mimeType, extension, durationMs }) => {
      shutterBtn.classList.remove('recording');
      recTimeEl.hidden = true;
      updateRecTime(0);
      if (!blob || blob.size === 0) {
        showToast('录制失败：无数据');
        return;
      }
      downloadVideo(blob, mimeType, extension);
      showToast(`已保存视频 · ${formatElapsed(durationMs)}`);
    },
    onError: (err) => {
      shutterBtn.classList.remove('recording');
      recTimeEl.hidden = true;
      showToast('录制失败：' + (err?.message || err?.name || 'unknown'));
    },
  });
  if (!recorder) {
    showToast('当前浏览器不支持视频录制');
    return;
  }
  const ok = recorder.start();
  if (!ok) return;
  shutterBtn.classList.add('recording');
  recTimeEl.hidden = false;
  updateRecTime(0);
}

function stopVideoRecording() {
  if (!recorder?.isRecording()) return;
  recorder.stop();
}

function setVideoMode(on) {
  if (on && !videoSupported) {
    showToast('当前浏览器不支持视频录制');
    return;
  }
  videoMode = on;
  videoBtn.classList.toggle('is-active', on);
  videoBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  shutterBtn.classList.toggle('video-mode', on);
  shutterBtn.setAttribute('aria-label', on ? '录制视频' : '拍照');
  if (!on) {
    if (recorder?.isRecording()) recorder.stop();
    shutterBtn.classList.remove('recording');
    recTimeEl.hidden = true;
    updateRecTime(0);
  }
}

function onShutterAction() {
  if (videoMode) {
    if (recorder?.isRecording()) {
      stopVideoRecording();
    } else {
      startVideoRecording();
    }
    return;
  }
  doShutter();
}

shutterBtn.addEventListener('click', onShutterAction);

if (!videoSupported) {
  videoBtn.classList.add('is-disabled');
  videoBtn.setAttribute('aria-disabled', 'true');
  videoBtn.title = '当前浏览器不支持视频录制';
}

videoBtn.addEventListener('click', () => {
  if (!videoSupported) {
    showToast('当前浏览器不支持视频录制');
    return;
  }
  setVideoMode(!videoMode);
});

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
    albumLabel: activeLabel,
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

// ============== 强度控制：短按循环 + 长按浮层滑杆 ==============
const LONG_PRESS_MS = 350;
const LONG_PRESS_MOVE_PX = 8; // 超过则取消长按（视为滚动/取消）
const SLIDER_AUTOHIDE_MS = 1500;

function cycleStrengthStep() {
  strengthIdx = (strengthIdx + 1) % strengthSteps.length;
  strength = strengthSteps[strengthIdx];
  strengthLabel.textContent = strengthLabels[strengthIdx];
  // 若滑杆正显示，也保持视觉同步
  if (!strengthSlider.hidden) {
    const pct = Math.round(strength * 100);
    strengthRange.value = String(pct);
    strengthSliderValue.textContent = String(pct);
  }
  showToast('滤镜强度 ' + strengthLabels[strengthIdx]);
}

function setStrengthDirect(value01) {
  // 直接设置 strength（绕过 4 档离散步进），并把 strengthIdx 同步到「最近档」用于下次短按起点。
  const v = Math.max(0, Math.min(1, value01));
  strength = v;
  // 显示百分比（整数）
  const pct = Math.round(v * 100);
  strengthLabel.textContent = String(pct);
  // 把 strengthIdx 对齐到最近的预设档，使后续短按从合理位置起步
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < strengthSteps.length; i += 1) {
    const d = Math.abs(strengthSteps[i] - v);
    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
  }
  strengthIdx = bestIdx;
}

let pressTimer = null;
let pressStartX = 0;
let pressStartY = 0;
let pressActivePointerId = null;
let longPressTriggered = false;
let pressMoved = false;
let sliderAutoHideTimer = null;
let sliderInteracting = false;

function clearPressTimer() {
  if (pressTimer != null) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function clearAutoHide() {
  if (sliderAutoHideTimer != null) {
    clearTimeout(sliderAutoHideTimer);
    sliderAutoHideTimer = null;
  }
}

function showSlider() {
  clearAutoHide();
  // 同步 range 当前值到 strength
  strengthRange.value = String(Math.round(strength * 100));
  strengthSliderValue.textContent = strengthRange.value;
  strengthSlider.hidden = false;
  strengthSlider.setAttribute('aria-hidden', 'false');
}

function hideSlider() {
  clearAutoHide();
  strengthSlider.hidden = true;
  strengthSlider.setAttribute('aria-hidden', 'true');
  sliderInteracting = false;
  filterBtn.classList.remove('is-pressed');
}

function scheduleAutoHide() {
  clearAutoHide();
  sliderAutoHideTimer = setTimeout(() => {
    if (!sliderInteracting) hideSlider();
  }, SLIDER_AUTOHIDE_MS);
}

filterBtn.addEventListener('pointerdown', (e) => {
  // 仅响应主指针 / 主按钮（鼠标左键、触摸、笔）
  if (e.button !== undefined && e.button !== 0) return;
  pressActivePointerId = e.pointerId;
  pressStartX = e.clientX;
  pressStartY = e.clientY;
  longPressTriggered = false;
  pressMoved = false;
  filterBtn.classList.add('is-pressed');
  clearPressTimer();
  pressTimer = setTimeout(() => {
    longPressTriggered = true;
    showSlider();
  }, LONG_PRESS_MS);
});

filterBtn.addEventListener('pointermove', (e) => {
  if (pressActivePointerId !== e.pointerId) return;
  const dx = e.clientX - pressStartX;
  const dy = e.clientY - pressStartY;
  if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) {
    pressMoved = true;
    if (!longPressTriggered) clearPressTimer();
  }
});

function endPress(e) {
  if (e && pressActivePointerId !== e.pointerId) return;
  clearPressTimer();
  filterBtn.classList.remove('is-pressed');
  const wasLong = longPressTriggered;
  const wasMoved = pressMoved;
  pressActivePointerId = null;
  if (wasLong) {
    // 长按结束：1500ms 后自动隐藏（除非用户继续与 slider 交互）
    if (!sliderInteracting) scheduleAutoHide();
  } else if (!wasMoved) {
    // 短按：循环 4 档
    cycleStrengthStep();
  }
  longPressTriggered = false;
  pressMoved = false;
}

filterBtn.addEventListener('pointerup', endPress);
filterBtn.addEventListener('pointercancel', endPress);
filterBtn.addEventListener('pointerleave', (e) => {
  // 指针离开按钮但未抬起时也取消长按计时（避免悬停滑出后才弹出）
  if (pressActivePointerId !== e.pointerId) return;
  if (longPressTriggered) return; // 已弹出滑杆则保留
  clearPressTimer();
});

// 阻止短按转成 click 后又触发额外的 click 副作用：filterBtn 没有原 click 处理了。
// 但保留键盘可达性：Enter/Space 键也走短按循环。
filterBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    cycleStrengthStep();
  }
});

// ============== 滑杆交互 ==============
strengthRange.addEventListener('pointerdown', () => {
  sliderInteracting = true;
  clearAutoHide();
});

strengthRange.addEventListener('input', () => {
  const pct = Number(strengthRange.value);
  strengthSliderValue.textContent = String(pct);
  setStrengthDirect(pct / 100);
});

function endSliderInteraction() {
  if (!sliderInteracting) return;
  sliderInteracting = false;
  scheduleAutoHide();
}
strengthRange.addEventListener('pointerup', endSliderInteraction);
strengthRange.addEventListener('pointercancel', endSliderInteraction);
strengthRange.addEventListener('change', endSliderInteraction);

// 点击其它位置即时隐藏
document.addEventListener('pointerdown', (e) => {
  if (strengthSlider.hidden) return;
  if (strengthSlider.contains(e.target)) return;
  if (filterBtn.contains(e.target)) return;
  hideSlider();
}, true);

// ============== 输入 ==============
bindSwipe(frameEl, {
  onLeft: () => presetStrip.next(),
  onRight: () => presetStrip.prev(),
});

bindKeyboard({
  onEsc: () => {
    if (albumApi.isCollageOpen?.()) return; // collage 面板自己处理 ESC
    if (albumApi.isDetailOpen()) { albumApi.closeDetail(); return; }
    if (albumApi.isSelectionMode?.()) { albumApi.exitSelectionMode(); return; }
    if (albumApi.isAlbumOpen()) { albumApi.closeAlbum(); return; }
    if (!fxDrawer.hidden) { fxDrawer.hidden = true; }
  },
  onLeft: () => presetStrip.prev(),
  onRight: () => presetStrip.next(),
  onShutter: onShutterAction,
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
  .then(async () => {
    try {
      const attached = await loadAndAttachUserPresets();
      if (attached.length) presetStrip.rebuild(presetStrip.current?.id);
    } catch (e) {
      console.warn('[main] load user presets failed', e);
    }
    await albumApi.refreshThumb();
  })
  .catch((err) => showToast('胶卷库不可用：' + err.message));

requestAnimationFrame(drawFrame);

if (!navigator.mediaDevices?.getUserMedia) {
  showToast('当前浏览器不支持摄像头 API');
} else {
  setSourceCamera()
    .catch(() => {});
}
