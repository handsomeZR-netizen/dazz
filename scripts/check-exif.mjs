// 自检：构造一个最小 JPEG（仅 SOI + EOI），调用 injectExif 后断言 APP1/EXIF 段格式正确，
// 并粗略解析 IFD0 + ExifIFD，验证 Make/Model/Software/DateTime/ImageDescription/DateTimeOriginal 字段。
// 同时基准一次 1.5 MB blob 的注入耗时。
import { injectExif, makeDazzExifFields } from '../src/utils/exif.js';

// 极小 JPEG：SOI(0xFFD8) + EOI(0xFFD9)
const minimalJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function makeBlob(bytes, type = 'image/jpeg') {
  // Node 18+ 自带 Blob
  return new Blob([bytes], { type });
}

function readAscii(view, offset, count) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

function parseExif(bytes) {
  // 期望 bytes[0..1] = SOI, bytes[2..3] = APP1 marker
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('no SOI');
  if (bytes[2] !== 0xff || bytes[3] !== 0xe1) throw new Error('no APP1 marker after SOI');
  const segLen = (bytes[4] << 8) | bytes[5];
  const exifId = String.fromCharCode(bytes[6], bytes[7], bytes[8], bytes[9]);
  if (exifId !== 'Exif') throw new Error('APP1 not Exif: ' + exifId);
  if (bytes[10] !== 0 || bytes[11] !== 0) throw new Error('Exif id padding wrong');
  const tiffStart = 12;
  if (bytes[tiffStart] !== 0x49 || bytes[tiffStart + 1] !== 0x49) {
    throw new Error('expected little-endian TIFF');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint16(tiffStart + 2, true);
  if (magic !== 0x002a) throw new Error('bad TIFF magic');
  const ifd0Offset = dv.getUint32(tiffStart + 4, true);

  function readIfd(absStart) {
    const count = dv.getUint16(absStart, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
      const e = absStart + 2 + i * 12;
      const tag = dv.getUint16(e, true);
      const type = dv.getUint16(e + 2, true);
      const cnt = dv.getUint32(e + 4, true);
      let valueOffset = e + 8;
      // ASCII = type 2，单元 1 字节，>4 字节看 offset
      if (type === 2 && cnt > 4) {
        valueOffset = tiffStart + dv.getUint32(e + 8, true);
      } else if (type === 4 && cnt === 1) {
        // LONG 内联
        valueOffset = e + 8;
      }
      let value;
      if (type === 2) value = readAscii(dv, valueOffset, cnt);
      else if (type === 4) value = dv.getUint32(valueOffset, true);
      else value = '<?>';
      entries.push({ tag, type, cnt, value });
    }
    return entries;
  }

  const ifd0 = readIfd(tiffStart + ifd0Offset);
  const exifPtr = ifd0.find((e) => e.tag === 0x8769);
  let exifIfd = [];
  if (exifPtr) exifIfd = readIfd(tiffStart + exifPtr.value);
  return { segLen, ifd0, exifIfd };
}

function find(entries, tag) {
  return entries.find((e) => e.tag === tag)?.value;
}

async function main() {
  const fields = makeDazzExifFields({
    presetId: 'NC',
    borderId: 'classic',
    takenAt: new Date('2026-04-30T12:34:56'),
  });
  const blob = makeBlob(minimalJpeg);
  const out = await injectExif(blob, fields);
  const buf = new Uint8Array(await out.arrayBuffer());
  const parsed = parseExif(buf);

  const make = find(parsed.ifd0, 0x010f);
  const model = find(parsed.ifd0, 0x0110);
  const software = find(parsed.ifd0, 0x0131);
  const dateTime = find(parsed.ifd0, 0x0132);
  const desc = find(parsed.ifd0, 0x010e);
  const dto = find(parsed.exifIfd, 0x9003);

  const checks = [
    ['SOI present', buf[0] === 0xff && buf[1] === 0xd8],
    ['APP1 marker', buf[2] === 0xff && buf[3] === 0xe1],
    ['Exif id', String.fromCharCode(buf[6], buf[7], buf[8], buf[9]) === 'Exif'],
    ['Make', make === 'DazzWeb'],
    ['Model', model === 'OPPO Find X6'],
    ['Software', software === 'DazzWeb-NC'],
    ['DateTime', dateTime === '2026:04:30 12:34:56'],
    ['ImageDescription', desc === 'NC | classic'],
    ['DateTimeOriginal', dto === '2026:04:30 12:34:56'],
    ['Bytes after APP1 are original SOI tail', buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9],
  ];
  let ok = true;
  for (const [label, pass] of checks) {
    console.log((pass ? 'PASS' : 'FAIL') + ' ' + label);
    if (!pass) ok = false;
  }

  // 基准：构造一个 ~1.5 MB blob（就以随机 JPEG 字节数组冒充，内容不重要，injectExif 不解析现有数据）
  const big = new Uint8Array(1500 * 1024);
  big[0] = 0xff; big[1] = 0xd8;
  big[big.length - 2] = 0xff; big[big.length - 1] = 0xd9;
  const bigBlob = makeBlob(big);
  const N = 20;
  // 预热
  for (let i = 0; i < 3; i++) await injectExif(bigBlob, fields);
  const t0 = performance.now();
  for (let i = 0; i < N; i++) await injectExif(bigBlob, fields);
  const t1 = performance.now();
  const avg = (t1 - t0) / N;
  console.log(`AVG inject time on ~1.5MB blob: ${avg.toFixed(2)} ms (n=${N})`);

  if (!ok) {
    console.error('SELF-CHECK FAILED');
    process.exit(1);
  }
  console.log('SELF-CHECK OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
