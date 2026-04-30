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
