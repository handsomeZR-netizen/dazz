// 视频录制：用 canvas.captureStream() 抓预览帧 → MediaRecorder 编码。
// 不录音频；按 maxSec 限制最长录制时长，超时自动停止。

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=h264',
  'video/mp4',
];

export function pickSupportedMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // 部分浏览器对未识别 mimeType 直接抛错，忽略继续尝试。
    }
  }
  return null;
}

export function isVideoSupported() {
  if (typeof MediaRecorder === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined' ||
      typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return false;
  }
  return pickSupportedMime() !== null;
}

export function extensionForMime(mime) {
  if (!mime) return 'webm';
  if (mime.startsWith('video/mp4')) return 'mp4';
  return 'webm';
}

// 创建录制器。返回 { start, stop, isRecording, mimeType, extension }。
// onTick(elapsedMs) 每 250ms 触发，用于 UI 计时刷新。
// onStop({ blob, mimeType, extension, durationMs }) 录制结束时触发。
// onError(err) 录制过程中出错触发。
export function createRecorder({ canvas, fps = 30, maxSec = 60, onTick, onStop, onError }) {
  const mimeType = pickSupportedMime();
  if (!mimeType) {
    return null;
  }

  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let tickTimer = null;
  let maxTimer = null;
  let recording = false;

  function clearTimers() {
    if (tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (maxTimer != null) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  }

  function teardownStream() {
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      stream = null;
    }
  }

  function start() {
    if (recording) return false;
    try {
      stream = canvas.captureStream(fps);
    } catch (err) {
      onError?.(err);
      return false;
    }
    chunks = [];
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      teardownStream();
      onError?.(err);
      return false;
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      onError?.(e.error || new Error('MediaRecorder error'));
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAt;
      const blob = new Blob(chunks, { type: mimeType });
      chunks = [];
      teardownStream();
      recording = false;
      clearTimers();
      onStop?.({ blob, mimeType, extension: extensionForMime(mimeType), durationMs });
    };
    try {
      recorder.start(1000); // 每秒 emit 一个 chunk，便于增量收集
    } catch (err) {
      teardownStream();
      onError?.(err);
      return false;
    }
    startedAt = Date.now();
    recording = true;
    onTick?.(0);
    tickTimer = setInterval(() => {
      if (!recording) return;
      onTick?.(Date.now() - startedAt);
    }, 250);
    maxTimer = setTimeout(() => {
      if (recording) stop();
    }, maxSec * 1000);
    return true;
  }

  function stop() {
    if (!recording || !recorder) return false;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch (err) {
      onError?.(err);
    }
    return true;
  }

  return {
    start,
    stop,
    isRecording: () => recording,
    mimeType,
    extension: extensionForMime(mimeType),
  };
}

// 简易格式化：00:12 / 01:05
export function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 文件名生成：dazz-video-<yyyymmddhhmm>-<presetId>.<ext>
export function makeVideoFilename(presetId, ext, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const stamp = `${y}${mo}${d}${h}${mi}`;
  const safePreset = (presetId || 'preset').replace(/[^A-Za-z0-9_-]/g, '');
  return `dazz-video-${stamp}-${safePreset}.${ext}`;
}
