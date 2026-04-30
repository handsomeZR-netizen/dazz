// 居中裁切：把 srcW x srcH 的源裁到 dstW x dstH 的画幅中央，返回像素与归一化 UV。
export function centerCrop(srcW, srcH, dstW, dstH) {
  const cr = dstW / dstH;
  const sr = srcW / srcH;
  let sx;
  let sy;
  let sw;
  let sh;
  if (sr > cr) {
    sh = srcH;
    sw = srcH * cr;
    sx = (srcW - sw) / 2;
    sy = 0;
  } else {
    sw = srcW;
    sh = srcW / cr;
    sx = 0;
    sy = (srcH - sh) / 2;
  }
  return {
    sx,
    sy,
    sw,
    sh,
    uvOffset: [sx / srcW, sy / srcH],
    uvScale: [sw / srcW, sh / srcH],
  };
}
