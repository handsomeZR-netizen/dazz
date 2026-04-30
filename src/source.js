const MAX_IMAGE_SHORT_SIDE = 1280;

export function cameraSource(video) {
  return {
    kind: 'camera',
    element: video,
    get intrinsicW() {
      return video.videoWidth || 0;
    },
    get intrinsicH() {
      return video.videoHeight || 0;
    },
    isReady() {
      return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
    },
  };
}

export async function imageSource(file, { maxShortSide = MAX_IMAGE_SHORT_SIDE } = {}) {
  const { width, height } = await readImageSize(file);
  const { targetW, targetH, needsResize } = fitShortSide(width, height, maxShortSide);
  const bitmap = await createSizedBitmap(file, { targetW, targetH, needsResize });

  return {
    kind: 'image',
    element: bitmap,
    intrinsicW: bitmap.width,
    intrinsicH: bitmap.height,
    isReady() {
      return true;
    },
    close() {
      bitmap.close?.();
    },
  };
}

function fitShortSide(width, height, maxShortSide) {
  const shortSide = Math.min(width, height);
  if (shortSide <= maxShortSide) {
    return { targetW: width, targetH: height, needsResize: false };
  }

  const scale = maxShortSide / shortSide;
  return {
    targetW: Math.round(width * scale),
    targetH: Math.round(height * scale),
    needsResize: true,
  };
}

async function createSizedBitmap(file, { targetW, targetH, needsResize }) {
  const baseOptions = { imageOrientation: 'from-image' };
  if (needsResize) {
    try {
      return await createImageBitmap(file, {
        ...baseOptions,
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high',
      });
    } catch (err) {
      // Older implementations may omit resize options; fall back to a canvas pass.
    }
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, baseOptions);
  } catch (err) {
    bitmap = await createImageBitmap(file);
  }
  if (!needsResize || Math.min(bitmap.width, bitmap.height) <= Math.min(targetW, targetH)) {
    return bitmap;
  }

  const scaled = await downsampleBitmap(bitmap, targetW, targetH);
  bitmap.close?.();
  return scaled;
}

async function downsampleBitmap(bitmap, width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return createImageBitmap(offscreen);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return createImageBitmap(canvas);
}

function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}
