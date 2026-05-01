// 极简 EXIF 注入：只写不读，把 ASCII 字段塞进 JPEG 流的 APP1/EXIF 段。
// 不依赖 piexifjs。约定：传入的 blob 没有现成 EXIF（拍照/批量管线 toBlob 直出）。
//
// 写入字段（IFD0）：
//   0x010E ImageDescription
//   0x010F Make
//   0x0110 Model
//   0x0131 Software
//   0x0132 DateTime
//   0x9003 DateTimeOriginal（放到 ExifIFD，由 0x8769 ExifOffset 指过去）

const TAG = {
  ImageDescription: 0x010e,
  Make: 0x010f,
  Model: 0x0110,
  DateTime: 0x0132,
  Software: 0x0131,
  ExifOffset: 0x8769,
  DateTimeOriginal: 0x9003,
};

const TYPE_ASCII = 2;

function asciiBytes(str) {
  // EXIF ASCII 必须以 \0 结尾
  const safe = String(str ?? '').replace(/[^\x20-\x7e]/g, '?');
  const out = new Uint8Array(safe.length + 1);
  for (let i = 0; i < safe.length; i++) out[i] = safe.charCodeAt(i) & 0x7f;
  out[safe.length] = 0;
  return out;
}

// 把 Date 格式化成 EXIF DateTime "YYYY:MM:DD HH:MM:SS"
export function formatExifDateTime(d) {
  const date = d instanceof Date ? d : new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    ':' + pad(date.getMonth() + 1) +
    ':' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) +
    ':' + pad(date.getMinutes()) +
    ':' + pad(date.getSeconds())
  );
}

// 构造 IFD：entries = [{ tag, type, count, valueBytes }]
// 返回 { ifd: Uint8Array, dataArea: Uint8Array }，其中 ifd 中 >4 字节的 value 用相对 offset 占位（待外部修正）。
// 简化做法：所有 value 都放进 dataArea，>4 字节走 offset，≤4 字节内联。
function buildIfd(entries, ifdStartOffset, nextIfdOffset = 0) {
  // ifd 结构：count(2) + 12*entries + nextIfdOffset(4)
  const ifdSize = 2 + entries.length * 12 + 4;
  const ifd = new Uint8Array(ifdSize);
  const dv = new DataView(ifd.buffer);
  dv.setUint16(0, entries.length, true);

  // dataArea 紧跟 ifd 之后；offset 是相对于 TIFF header 起点
  const dataStart = ifdStartOffset + ifdSize;
  const dataChunks = [];
  let dataCursor = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = 2 + i * 12;
    dv.setUint16(off, e.tag, true);
    dv.setUint16(off + 2, e.type, true);
    dv.setUint32(off + 4, e.count, true);

    const valueSize = e.valueBytes.length;
    if (valueSize <= 4) {
      // 内联，左对齐填零
      for (let b = 0; b < valueSize; b++) ifd[off + 8 + b] = e.valueBytes[b];
      for (let b = valueSize; b < 4; b++) ifd[off + 8 + b] = 0;
    } else {
      // 写入 dataArea，记录偏移（相对 TIFF header 起点）
      const absOffset = dataStart + dataCursor;
      dv.setUint32(off + 8, absOffset, true);
      dataChunks.push(e.valueBytes);
      dataCursor += valueSize;
      // EXIF 通常按字对齐，这里保险加一个偶数对齐
      if (dataCursor % 2 === 1) {
        dataChunks.push(new Uint8Array([0]));
        dataCursor += 1;
      }
    }
  }

  // 写 nextIfdOffset
  dv.setUint32(2 + entries.length * 12, nextIfdOffset, true);

  // 合并 dataArea
  let dataLen = 0;
  for (const c of dataChunks) dataLen += c.length;
  const dataArea = new Uint8Array(dataLen);
  let p = 0;
  for (const c of dataChunks) {
    dataArea.set(c, p);
    p += c.length;
  }

  return { ifd, dataArea };
}

// 构造完整的 EXIF APP1 段（含 marker + length + "Exif\0\0" + TIFF + IFD0 + ExifIFD）。
function buildApp1(fields) {
  // 收集 IFD0 字段
  const ifd0Entries = [];
  if (fields.imageDescription != null) {
    const v = asciiBytes(fields.imageDescription);
    ifd0Entries.push({ tag: TAG.ImageDescription, type: TYPE_ASCII, count: v.length, valueBytes: v });
  }
  if (fields.make != null) {
    const v = asciiBytes(fields.make);
    ifd0Entries.push({ tag: TAG.Make, type: TYPE_ASCII, count: v.length, valueBytes: v });
  }
  if (fields.model != null) {
    const v = asciiBytes(fields.model);
    ifd0Entries.push({ tag: TAG.Model, type: TYPE_ASCII, count: v.length, valueBytes: v });
  }
  if (fields.dateTime != null) {
    const v = asciiBytes(fields.dateTime);
    ifd0Entries.push({ tag: TAG.DateTime, type: TYPE_ASCII, count: v.length, valueBytes: v });
  }
  if (fields.software != null) {
    const v = asciiBytes(fields.software);
    ifd0Entries.push({ tag: TAG.Software, type: TYPE_ASCII, count: v.length, valueBytes: v });
  }

  // ExifIFD 字段
  const exifIfdEntries = [];
  if (fields.dateTimeOriginal != null) {
    const v = asciiBytes(fields.dateTimeOriginal);
    exifIfdEntries.push({ tag: TAG.DateTimeOriginal, type: TYPE_ASCII, count: v.length, valueBytes: v });
  }

  // EXIF 标签必须按 tag 升序
  ifd0Entries.sort((a, b) => a.tag - b.tag);
  exifIfdEntries.sort((a, b) => a.tag - b.tag);

  // 给 IFD0 加一个 ExifOffset 占位（如有 ExifIFD）；占位值之后回填
  let exifOffsetEntryIdx = -1;
  if (exifIfdEntries.length > 0) {
    const placeholder = new Uint8Array(4); // 内联 4 字节 LONG
    ifd0Entries.push({
      tag: TAG.ExifOffset,
      type: 4, // LONG
      count: 1,
      valueBytes: placeholder,
    });
    ifd0Entries.sort((a, b) => a.tag - b.tag);
    exifOffsetEntryIdx = ifd0Entries.findIndex((e) => e.tag === TAG.ExifOffset);
  }

  // TIFF header 起点 = "Exif\0\0" 之后；offset 全部相对 TIFF header 起点
  // IFD0 起点 = 8（标准）
  const TIFF_HEADER_SIZE = 8;
  const IFD0_OFFSET = 8;

  // 先构造 IFD0（offset 相对 TIFF header），需要知道 ExifIFD 的位置
  // 流程：先估算 IFD0 + IFD0 dataArea 长度，再放 ExifIFD
  // 第一遍构造 IFD0 拿到 size
  const ifd0Tmp = buildIfd(ifd0Entries, IFD0_OFFSET, 0);
  // 注意 buildIfd 里如果有 ExifOffset 占位，我们需要知道占位 entry 的位置后回填
  const ifd0Size = ifd0Tmp.ifd.length;
  const ifd0DataLen = ifd0Tmp.dataArea.length;

  // ExifIFD 紧跟 IFD0 dataArea 之后
  const exifIfdOffset = IFD0_OFFSET + ifd0Size + ifd0DataLen;

  // 回填 ExifOffset 占位 entry 的 value
  if (exifOffsetEntryIdx !== -1) {
    const off = 2 + exifOffsetEntryIdx * 12 + 8;
    const dv = new DataView(ifd0Tmp.ifd.buffer);
    dv.setUint32(off, exifIfdOffset, true);
  }

  // 构造 ExifIFD
  let exifIfdBytes = new Uint8Array(0);
  let exifIfdData = new Uint8Array(0);
  if (exifIfdEntries.length > 0) {
    const built = buildIfd(exifIfdEntries, exifIfdOffset, 0);
    exifIfdBytes = built.ifd;
    exifIfdData = built.dataArea;
  }

  // 拼装 TIFF body：[TIFF header 8B] + [IFD0] + [IFD0 data] + [ExifIFD] + [ExifIFD data]
  const tiffBodyLen =
    TIFF_HEADER_SIZE +
    ifd0Size +
    ifd0DataLen +
    exifIfdBytes.length +
    exifIfdData.length;
  const tiff = new Uint8Array(tiffBodyLen);
  // TIFF header："II" 0x2A00 (LE) 0x08000000 (offset to IFD0)
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  const tdv = new DataView(tiff.buffer);
  tdv.setUint16(2, 0x002a, true);
  tdv.setUint32(4, IFD0_OFFSET, true);
  let cursor = TIFF_HEADER_SIZE;
  tiff.set(ifd0Tmp.ifd, cursor); cursor += ifd0Size;
  tiff.set(ifd0Tmp.dataArea, cursor); cursor += ifd0DataLen;
  if (exifIfdBytes.length) {
    tiff.set(exifIfdBytes, cursor); cursor += exifIfdBytes.length;
    tiff.set(exifIfdData, cursor); cursor += exifIfdData.length;
  }

  // APP1 段 = 0xFF 0xE1 + length(2, big-endian, 含 length 自身但不含 marker) + "Exif\0\0" + TIFF body
  const exifId = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segPayloadLen = exifId.length + tiff.length;
  const segLen = 2 + segPayloadLen; // length 字段含自身
  if (segLen > 0xffff) {
    throw new Error('EXIF segment too large');
  }
  const seg = new Uint8Array(2 + segLen);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg[2] = (segLen >> 8) & 0xff;
  seg[3] = segLen & 0xff;
  seg.set(exifId, 4);
  seg.set(tiff, 4 + exifId.length);
  return seg;
}

// 把 EXIF APP1 段插入到 SOI 之后（紧邻第一个 marker 前）。返回新的 Uint8Array。
function spliceExifIntoJpeg(bytes, app1) {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Not a JPEG: missing SOI');
  }
  const out = new Uint8Array(bytes.length + app1.length);
  // SOI
  out[0] = 0xff;
  out[1] = 0xd8;
  // APP1
  out.set(app1, 2);
  // 其余
  out.set(bytes.subarray(2), 2 + app1.length);
  return out;
}

// 主入口：返回带 EXIF 的新 Blob。原 blob 不变。
export async function injectExif(blob, fields) {
  if (!blob) return blob;
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const app1 = buildApp1(fields);
  const merged = spliceExifIntoJpeg(bytes, app1);
  return new Blob([merged], { type: blob.type || 'image/jpeg' });
}

// 方便业务侧拼字段
export function makeDazzExifFields({ presetId, borderId, takenAt }) {
  const date = takenAt instanceof Date ? takenAt : new Date(takenAt || Date.now());
  const dt = formatExifDateTime(date);
  return {
    make: 'DazzWeb',
    model: 'OPPO Find X6',
    software: 'DazzWeb-' + (presetId || 'unknown'),
    dateTime: dt,
    dateTimeOriginal: dt,
    imageDescription: (presetId || 'unknown') + ' | ' + (borderId || 'none'),
  };
}

// 测试/自检用：导出内部构造器
export const __test = { buildApp1, spliceExifIntoJpeg, asciiBytes };
