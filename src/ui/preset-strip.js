// 预设条：横滚的 chip 列表 + 切预设逻辑（顶栏标签、机身配色、水印颜色）
// 用户预设 chip 右上角带 × 删除按钮（点击触发 onDeleteUser）。
import { PRESETS } from '../presets/index.js';

export function createPresetStrip({ stripEl, refs, onChange, onDeleteUser, onAdd, onImportCube, onMatch }) {
  const { filterTag, brandEl, datestampEl, bodyEl, bodyBrand } = refs;

  function build() {
    stripEl.innerHTML = '';
    PRESETS.forEach((p, i) => stripEl.appendChild(buildChip(p, i)));
    if (onAdd) stripEl.appendChild(buildAddChip());
    if (onImportCube) stripEl.appendChild(buildImportCubeChip());
    if (onMatch) stripEl.appendChild(buildMatchChip());
  }

  function buildChip(p, i) {
    const btn = document.createElement('button');
    btn.className = 'preset-chip' + (i === presetIdx ? ' active' : '');
    btn.dataset.idx = String(i);
    btn.dataset.id = p.id;
    const shortLabel = p.shortId || p.id;
    btn.innerHTML = `<span class="chip-id">${shortLabel}</span><span class="chip-name">${escapeHtml(p.name)}</span>`;
    if (p.isUser) {
      const del = document.createElement('span');
      del.className = 'chip-del';
      del.textContent = '×';
      del.title = '删除此预设';
      del.setAttribute('aria-label', '删除此预设');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onDeleteUser) onDeleteUser(p);
      });
      btn.appendChild(del);
    }
    btn.addEventListener('click', () => {
      const idx = PRESETS.indexOf(p);
      if (idx >= 0) api.setPreset(idx);
    });
    return btn;
  }

  function buildAddChip() {
    const btn = document.createElement('button');
    btn.className = 'preset-chip preset-chip-add';
    btn.title = '新建自定义预设';
    btn.setAttribute('aria-label', '新建自定义预设');
    btn.innerHTML = '<span class="chip-id">+</span><span class="chip-name">新建</span>';
    btn.addEventListener('click', () => onAdd?.());
    return btn;
  }

  function buildImportCubeChip() {
    const btn = document.createElement('button');
    btn.className = 'preset-chip preset-chip-add';
    btn.title = '导入 .cube 3D LUT';
    btn.setAttribute('aria-label', '导入 .cube 3D LUT');
    btn.innerHTML = '<span class="chip-id">⤓</span><span class="chip-name">LUT</span>';
    btn.addEventListener('click', () => onImportCube?.());
    return btn;
  }

  function buildMatchChip() {
    const btn = document.createElement('button');
    btn.className = 'preset-chip preset-chip-match';
    btn.title = '匹配参考图';
    btn.setAttribute('aria-label', '匹配参考图');
    btn.innerHTML = '<span class="chip-id">★</span><span class="chip-name">匹配</span>';
    btn.addEventListener('click', () => onMatch?.());
    return btn;
  }

  let presetIdx = 0;

  function setPreset(idx) {
    presetIdx = (idx + PRESETS.length) % PRESETS.length;
    const preset = PRESETS[presetIdx];
    filterTag.textContent = preset.desc;
    brandEl.textContent = preset.shortId || preset.id;
    datestampEl.style.color = preset.stampColor;
    datestampEl.style.textShadow = `0 0 4px ${preset.stampGlow}, 0 0 12px ${preset.stampGlow}`;
    bodyEl.dataset.preset = preset.id;
    bodyBrand.textContent = preset.brandLabel;

    stripEl.querySelectorAll('.preset-chip').forEach((el) => {
      const i = Number(el.dataset.idx);
      el.classList.toggle('active', i === presetIdx);
    });
    const active = stripEl.querySelector('.preset-chip.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

    onChange?.(preset, presetIdx);
  }

  // 外部新增/删除用户预设后调用：重建 chips，并把当前激活索引（按 id）尽量保留。
  function rebuild(activeId) {
    const targetId = activeId ?? PRESETS[presetIdx]?.id;
    build();
    let nextIdx = PRESETS.findIndex((p) => p.id === targetId);
    if (nextIdx < 0) nextIdx = 0;
    presetIdx = nextIdx;
    setPreset(nextIdx);
  }

  const api = {
    build,
    rebuild,
    setPreset,
    next() { setPreset(presetIdx + 1); },
    prev() { setPreset(presetIdx - 1); },
    get index() { return presetIdx; },
    get current() { return PRESETS[presetIdx]; },
  };
  return api;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
