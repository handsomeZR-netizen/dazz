// 摄像头启动 / 切换 / 取景器尺寸适配。回调式 toast 由调用方传入。
let stream = null;

export async function startCamera(video, { front = false, onError } = {}) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const constraints = {
    audio: false,
    video: {
      facingMode: front ? 'user' : { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 1707 },
    },
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } catch (e2) {
      onError?.('无法访问摄像头：' + e2.message);
      throw e2;
    }
  }
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

// 获取当前视频 track，用于读取硬件 zoom capability / 应用约束
export function getVideoTrack() {
  if (!stream) return null;
  const tracks = stream.getVideoTracks();
  return tracks && tracks.length ? tracks[0] : null;
}

// 读取硬件 zoom 能力。返回 { min, max, step } 或 null。
export function getZoomCapability() {
  const track = getVideoTrack();
  if (!track || typeof track.getCapabilities !== 'function') return null;
  let caps;
  try {
    caps = track.getCapabilities();
  } catch (e) {
    return null;
  }
  if (!caps || !('zoom' in caps)) return null;
  const z = caps.zoom;
  // 部分实现是 { min, max, step }；少数是数字数组
  if (z && typeof z === 'object' && 'min' in z && 'max' in z) {
    const min = Number(z.min);
    const max = Number(z.max);
    if (!isFinite(min) || !isFinite(max) || max <= min) return null;
    const step = Number(z.step) || (max - min) / 100;
    return { min, max, step };
  }
  return null;
}

// 应用硬件 zoom。返回是否成功。
export async function applyHardwareZoom(zoom) {
  const track = getVideoTrack();
  if (!track || typeof track.applyConstraints !== 'function') return false;
  try {
    await track.applyConstraints({ advanced: [{ zoom }] });
    return true;
  } catch (e) {
    return false;
  }
}

// 根据视频/源的实际尺寸 + 取景器目标比例（默认 3:4）调整 canvas 内部分辨率。
// hasGL 决定 cap 上限：GPU 路径走 900，CPU 路径降到 540 以保证流畅。
export function resizeCanvas(canvas, sourceW, sourceH, { hasGL, target = 3 / 4 } = {}) {
  if (!sourceW || !sourceH) return null;
  const cap = hasGL ? 900 : 540;
  let w;
  let h;
  if (sourceW / sourceH > target) {
    h = Math.min(sourceH, cap);
    w = Math.round(h * target);
  } else {
    w = Math.min(sourceW, Math.round(cap * target));
    h = Math.round(w / target);
  }
  canvas.width = w;
  canvas.height = h;
  return { w, h };
}
