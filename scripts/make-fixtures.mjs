// 生成 6 张已知颜色的 1280x960 JPEG 测试图，存到 test-fixtures/
// 不依赖外部图像库——用 Buffer + 一个最小 JPEG 头不太现实，所以用 Node canvas 替代品：
// 直接用 zlib + 写一个最小 PPM，再让 Chromium 转换不实际。
// 最稳的做法：用 Node 自带 + 写 PNG（zlib 压缩 IDAT），浏览器 createImageBitmap 接受 PNG。
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pngSolid(width, height, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihd = Buffer.alloc(13);
  ihd.writeUInt32BE(width, 0);
  ihd.writeUInt32BE(height, 4);
  ihd[8] = 8; // bit depth
  ihd[9] = 2; // color type RGB
  ihd[10] = 0;
  ihd[11] = 0;
  ihd[12] = 0;
  // 每行 = 1 个 filter byte + width*3 像素
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const off = y * rowLen + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihd), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const FIXTURES = [
  { name: 'sample-red.png',  rgb: [220, 60, 60] },
  { name: 'sample-green.png', rgb: [60, 200, 80] },
  { name: 'sample-blue.png',  rgb: [60, 90, 220] },
  { name: 'sample-skin.png',  rgb: [220, 180, 150] },
  { name: 'sample-sky.png',   rgb: [120, 180, 220] },
  { name: 'sample-gray.png',  rgb: [128, 128, 128] },
];

for (const { name, rgb } of FIXTURES) {
  const buf = pngSolid(1280, 960, rgb);
  writeFileSync(`./test-fixtures/${name}`, buf);
  console.log('wrote', name, '(' + buf.length + ' bytes)');
}
