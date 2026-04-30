// 预设条：横滚的 chip 列表 + 切预设逻辑（顶栏标签、机身配色、水印颜色）
import { PRESETS } from '../presets/index.js';

export function createPresetStrip({ stripEl, refs, onChange }) {
  const { filterTag, brandEl, datestampEl, bodyEl, bodyBrand } = refs;

  function build() {
    stripEl.innerHTML = '';
    PRESETS.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'preset-chip' + (i === 0 ? ' active' : '');
      btn.dataset.idx = String(i);
      btn.innerHTML = `<span class="chip-id">${p.id}</span><span class="chip-name">${p.name}</span>`;
      btn.addEventListener('click', () => api.setPreset(i));
      stripEl.appendChild(btn);
    });
  }

  let presetIdx = 0;

  function setPreset(idx) {
    presetIdx = (idx + PRESETS.length) % PRESETS.length;
    const preset = PRESETS[presetIdx];
    filterTag.textContent = preset.desc;
    brandEl.textContent = preset.id;
    datestampEl.style.color = preset.stampColor;
    datestampEl.style.textShadow = `0 0 4px ${preset.stampGlow}, 0 0 12px ${preset.stampGlow}`;
    bodyEl.dataset.preset = preset.id;
    bodyBrand.textContent = preset.brandLabel;

    stripEl.querySelectorAll('.preset-chip').forEach((el, i) => {
      el.classList.toggle('active', i === presetIdx);
    });
    const active = stripEl.querySelector('.preset-chip.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

    onChange?.(preset, presetIdx);
  }

  const api = {
    build,
    setPreset,
    next() { setPreset(presetIdx + 1); },
    prev() { setPreset(presetIdx - 1); },
    get index() { return presetIdx; },
    get current() { return PRESETS[presetIdx]; },
  };
  return api;
}
