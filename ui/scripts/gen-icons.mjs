/* global Buffer */
// アイコン生成(依存なし)。`node ui/scripts/gen-icons.mjs` で ui/public/icons/ に PNG を書く。
// 緑地に、白いレシートの簡単な図形(オリジナル)。maskable は安全領域(中央80%)に収める。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const GREEN = [0x1f, 0x5c, 0x4b];
const WHITE = [0xf3, 0xf5, 0xf4];

function crc32(buf) {
  let crc = ~0;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// scale: 図形の大きさ。maskable は小さめにして安全領域に収める
function render(size, scale) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  const w = size * 0.5 * scale;
  const h = size * 0.64 * scale;
  const x0 = (size - w) / 2;
  const y0 = (size - h) / 2;
  const tooth = w / 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = GREEN;
      if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) {
        c = WHITE;
        // 下端のぎざぎざ
        const phase = ((x - x0) % tooth) / tooth;
        if (y > y0 + h - (phase < 0.5 ? phase : 1 - phase) * tooth) c = GREEN;
        // 明細の線
        const rel = (y - y0) / h;
        for (const [a, b, len] of [[0.16, 0.22, 0.7], [0.34, 0.4, 0.55], [0.52, 0.58, 0.65]]) {
          if (rel >= a && rel < b && x >= x0 + w * 0.15 && x < x0 + w * (0.15 + len)) c = GREEN;
        }
      }
      const i = y * stride + 1 + x * 3;
      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8bit
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(out, { recursive: true });
const jobs = [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, 0.78],
  ["apple-touch-icon.png", 180, 1],
];
for (const [name, size, scale] of jobs) fs.writeFileSync(path.join(out, name), render(size, scale));
