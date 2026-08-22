import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CREAM = [244, 234, 220, 255];
const BROWN = [74, 50, 36, 255];
const GREEN = [61, 107, 69, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(pixels, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels[y].copy(raw, row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

function drawMark(size) {
  const rows = Array.from({ length: size }, () => Buffer.alloc(size * 4));
  const s = size / 64;
  const set = (x, y, rgba) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const o = xi * 4;
    rows[yi][o] = rgba[0];
    rows[yi][o + 1] = rgba[1];
    rows[yi][o + 2] = rgba[2];
    rows[yi][o + 3] = rgba[3];
  };
  const insideRoundRect = (x, y, r) => {
    const rr = r;
    if (x >= rr && x < size - rr && y >= 0 && y < size) return true;
    if (y >= rr && y < size - rr && x >= 0 && x < size) return true;
    const corners = [
      [rr, rr],
      [size - 1 - rr, rr],
      [rr, size - 1 - rr],
      [size - 1 - rr, size - 1 - rr],
    ];
    return corners.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr);
  };
  const r = 14 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      set(x, y, insideRoundRect(x, y, r) ? CREAM : [0, 0, 0, 0]);
    }
  }
  const circle = (cx, cy, rad) => {
    const R = rad * s;
    const X = cx * s;
    const Y = cy * s;
    const minx = Math.max(0, Math.floor(X - R - 1));
    const maxx = Math.min(size - 1, Math.ceil(X + R + 1));
    const miny = Math.max(0, Math.floor(Y - R - 1));
    const maxy = Math.min(size - 1, Math.ceil(Y + R + 1));
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        if ((x - X) ** 2 + (y - Y) ** 2 <= R * R) set(x, y, GREEN);
      }
    }
  };
  const thickLine = (x0, y0, x1, y1, w) => {
    const steps = Math.max(size, Math.hypot((x1 - x0) * s, (y1 - y0) * s) * 2);
    const hw = (w * s) / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (x0 + (x1 - x0) * t) * s;
      const y = (y0 + (y1 - y0) * t) * s;
      for (let dy = -hw; dy <= hw; dy++) {
        for (let dx = -hw; dx <= hw; dx++) {
          if (dx * dx + dy * dy <= hw * hw) set(x + dx, y + dy, BROWN);
        }
      }
    }
  };
  thickLine(32, 50, 32, 28, 3.4);
  thickLine(32, 30, 24, 20, 2.8);
  thickLine(32, 30, 40, 20, 2.8);
  thickLine(32, 36, 21, 34, 2.4);
  thickLine(32, 36, 43, 34, 2.4);
  circle(24, 19.6, 6.6);
  circle(40, 19.6, 6.6);
  circle(20.8, 34.2, 5.1);
  circle(43.2, 34.2, 5.1);
  return rows;
}

function writeIco(path, pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  const bodies = [];
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    bodies.push(png);
    offset += png.length;
  }
  writeFileSync(path, Buffer.concat([header, ...entries, ...bodies]));
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
mkdirSync(pub, { recursive: true });

function pngAt(size) {
  return encodePng(drawMark(size), size);
}

writeFileSync(join(pub, "icon.png"), pngAt(512));
writeFileSync(join(pub, "icon-192.png"), pngAt(192));
writeFileSync(join(pub, "icon-512.png"), pngAt(512));
writeFileSync(join(pub, "apple-touch-icon.png"), pngAt(180));
writeFileSync(join(pub, "favicon-32.png"), pngAt(32));
writeIco(join(pub, "favicon.ico"), [
  { size: 16, png: pngAt(16) },
  { size: 32, png: pngAt(32) },
  { size: 48, png: pngAt(48) },
]);
console.log("Wrote Family Tree icons to public/");
