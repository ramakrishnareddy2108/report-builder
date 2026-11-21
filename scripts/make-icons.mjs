// Writes the app icons (public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png)
// without any image library: shapes are drawn with supersampling and encoded as PNG with zlib.
//
//   node scripts/make-icons.mjs
//
// The picture is three bars (a tiny bar chart) on a dark rounded square, the same as public/icon.svg.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [23, 23, 23];
const FG = [250, 250, 250];

// Shapes in a 32 x 32 design grid: [x, y, width, height, corner radius].
const BARS = [
  [7, 17, 5, 8, 1.5],
  [13.5, 11, 5, 14, 1.5],
  [20, 6, 5, 19, 1.5],
];
const BASELINE = [6, 26.5, 20, 1.6, 0.8];

function inRoundRect(px, py, [x, y, w, h, r]) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/**
 * Pixel colour at design coordinates. `maskable` = full-bleed square with the picture scaled to the
 * central 62% (Android crops maskable icons to a circle or squircle).
 */
function sample(u, v, maskable) {
  if (!maskable && !inRoundRect(u, v, [0, 0, 32, 32, 7])) return null; // transparent corner
  let x = u;
  let y = v;
  if (maskable) {
    const s = 0.62;
    x = (u - 16) / s + 16;
    y = (v - 16) / s + 16;
  }
  return [...BARS, BASELINE].some((s) => inRoundRect(x, y, s)) ? FG : BG;
}

function render(size, maskable) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let py = 0; py < size; py++) {
    raw[o++] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(((px + (sx + 0.5) / SS) / size) * 32, ((py + (sy + 0.5) / SS) / size) * 32, maskable);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const n = SS * SS;
      raw[o++] = a ? Math.round(r / a) : 0;
      raw[o++] = a ? Math.round(g / a) : 0;
      raw[o++] = a ? Math.round(b / a) : 0;
      raw[o++] = Math.round((a / n) * 255);
    }
  }
  return png(size, size, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, raw) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', render(192, false));
writeFileSync('public/icon-512.png', render(512, false));
writeFileSync('public/icon-maskable-512.png', render(512, true));
// iOS does not round or mask transparent corners well: give it a full-bleed square.
writeFileSync('public/apple-touch-icon.png', render(180, true));
console.log('Icons written to public/');
