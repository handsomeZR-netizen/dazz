// 拍照管线：触发闪屏动画 → 边框合成 + 水印 → toBlob 入库 → 缩略图刷新。
import { Gallery } from './gallery/db.js';
import { composeOutput, BORDER_ORDER } from './borders.js';
import { injectExif, makeDazzExifFields } from './utils/exif.js';

const MAX_PHOTOS = 200;

// FX_DEFAULTS 与 ui/fx-drawer 共用，先放在这里集中维护
export const FX_DEFAULTS = { halation: 0.55, fisheye: 0.5, flash: 0.85 };

// 装填闪光：等下一帧让着色器把爆光画进去后再抓帧
export function capture({
  canvas, flashEl, fxDrawer, preset, borderIdx, showDate,
  flashArmed, setFlashArmed, setFlashFlare, hasGL, onToast, onSaved,
}) {
  if (!canvas.width) return;
  if (flashArmed && hasGL) {
    setFlashFlare(FX_DEFAULTS.flash);
    setFlashArmed(false);
    const ftog = fxDrawer.querySelector('[data-fx="flash"]');
    if (ftog) {
      ftog.classList.remove('armed');
      ftog.querySelector('.fx-status').textContent = '关';
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        doCapture({ canvas, flashEl, preset, borderIdx, showDate, onToast, onSaved }),
      ),
    );
  } else {
    doCapture({ canvas, flashEl, preset, borderIdx, showDate, onToast, onSaved });
  }
}

function doCapture({ canvas, flashEl, preset, borderIdx, showDate, onToast, onSaved }) {
  flashEl.classList.remove('fire');
  void flashEl.offsetWidth;
  flashEl.classList.add('fire');

  const borderId = BORDER_ORDER[borderIdx];
  const out = composeOutput(canvas, borderId, preset, showDate);

  const presetId = preset.id;
  const developMs = preset.developMs || 0;
  out.toBlob(async (blob) => {
    if (!blob) {
      onToast?.('保存失败');
      return;
    }
    try {
      let stamped = blob;
      try {
        stamped = await injectExif(
          blob,
          makeDazzExifFields({ presetId, borderId, takenAt: new Date() }),
        );
      } catch {
        // EXIF 注入失败不影响主流程，回退到原始 blob
        stamped = blob;
      }
      await Gallery.add(stamped, { presetId, borderId, developMs });
      const dropped = await Gallery.trim(MAX_PHOTOS);
      if (dropped) onToast?.(`已保留最近 ${MAX_PHOTOS} 张`);
      else if (developMs > 0) onToast?.(`已捕获 · 显影 ${(developMs / 1000).toFixed(1)}s`);
      await onSaved?.();
    } catch (e) {
      onToast?.('保存失败：' + (e.message || e.name));
    }
  }, 'image/jpeg', 0.92);
}
