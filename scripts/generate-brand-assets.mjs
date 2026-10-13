import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'apps', 'mobile', 'assets');

const COLORS = {
  aqua: [123, 223, 242, 255],
  dark: [31, 36, 48, 255],
  gold: [255, 230, 109, 255],
  mint: [184, 247, 212, 255],
  transparent: [0, 0, 0, 0],
  white: [255, 255, 255, 255],
};

const crcTable = Array.from({ length: 256 }, (_, tableIndex) => {
  let value = tableIndex;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xFFFFFFFF;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const lengthBuffer = Buffer.alloc(4);
  const crcBuffer = Buffer.alloc(4);

  lengthBuffer.writeUInt32BE(data.length);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  const raw = Buffer.alloc((width * 4 + 1) * height);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function createCanvas(width, height, background = COLORS.transparent) {
  const pixels = Buffer.alloc(width * height * 4);

  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = background[0];
    pixels[index + 1] = background[1];
    pixels[index + 2] = background[2];
    pixels[index + 3] = background[3];
  }

  return { height, pixels, width };
}

function blendPixel(canvas, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || alpha <= 0) {
    return;
  }

  const index = (y * canvas.width + x) * 4;
  const sourceAlpha = (color[3] / 255) * alpha;
  const destAlpha = canvas.pixels[index + 3] / 255;
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);

  if (outAlpha <= 0) {
    return;
  }

  canvas.pixels[index] = Math.round(((color[0] * sourceAlpha) + (canvas.pixels[index] * destAlpha * (1 - sourceAlpha))) / outAlpha);
  canvas.pixels[index + 1] = Math.round(((color[1] * sourceAlpha) + (canvas.pixels[index + 1] * destAlpha * (1 - sourceAlpha))) / outAlpha);
  canvas.pixels[index + 2] = Math.round(((color[2] * sourceAlpha) + (canvas.pixels[index + 2] * destAlpha * (1 - sourceAlpha))) / outAlpha);
  canvas.pixels[index + 3] = Math.round(outAlpha * 255);
}

function drawCircle(canvas, centerX, centerY, radius, color) {
  const minX = Math.floor(centerX - radius - 1);
  const maxX = Math.ceil(centerX + radius + 1);
  const minY = Math.floor(centerY - radius - 1);
  const maxY = Math.ceil(centerY + radius + 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - distance));
      blendPixel(canvas, x, y, color, alpha);
    }
  }
}

function drawLine(canvas, from, to, width, color) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, width / 3)));

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    drawCircle(
      canvas,
      from.x + (to.x - from.x) * progress,
      from.y + (to.y - from.y) * progress,
      width / 2,
      color,
    );
  }
}

function cubic(from, controlA, controlB, to, progress) {
  const remaining = 1 - progress;

  return {
    x: remaining ** 3 * from.x
      + 3 * remaining ** 2 * progress * controlA.x
      + 3 * remaining * progress ** 2 * controlB.x
      + progress ** 3 * to.x,
    y: remaining ** 3 * from.y
      + 3 * remaining ** 2 * progress * controlA.y
      + 3 * remaining * progress ** 2 * controlB.y
      + progress ** 3 * to.y,
  };
}

function transformPoint(point, scale, offsetX, offsetY) {
  return {
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  };
}

function drawCubic(canvas, points, scale, offsetX, offsetY, width, color) {
  let previous = transformPoint(points[0], scale, offsetX, offsetY);

  for (let step = 1; step <= 90; step += 1) {
    const point = cubic(points[0], points[1], points[2], points[3], step / 90);
    const next = transformPoint(point, scale, offsetX, offsetY);

    drawLine(canvas, previous, next, width, color);
    previous = next;
  }
}

function drawMark(canvas, { color = COLORS.white, scale = 1, offsetX = 0, offsetY = 0, stroke = 5 } = {}) {
  const pathA = [
    [{ x: 12, y: 41 }, { x: 16, y: 19 }, { x: 38, y: 7 }, { x: 51, y: 22 }],
    [{ x: 51, y: 22 }, { x: 62, y: 35 }, { x: 44, y: 56 }, { x: 22, y: 48 }],
    [{ x: 22, y: 48 }, { x: 13, y: 45 }, { x: 9, y: 38 }, { x: 12, y: 29 }],
  ];
  const pathB = [[{ x: 18, y: 36 }, { x: 27, y: 21 }, { x: 43, y: 20 }, { x: 49, y: 32 }]];
  const pathC = [[{ x: 20, y: 47 }, { x: 31, y: 40 }, { x: 40, y: 29 }, { x: 45, y: 17 }]];

  for (const segment of pathA) {
    drawCubic(canvas, segment, scale, offsetX, offsetY, stroke * scale, color);
  }

  for (const segment of pathB) {
    drawCubic(canvas, segment, scale, offsetX, offsetY, stroke * scale, color);
  }

  for (const segment of pathC) {
    drawCubic(canvas, segment, scale, offsetX, offsetY, stroke * scale, color);
  }

  drawCircle(canvas, 18 * scale + offsetX, 28 * scale + offsetY, 3.5 * scale, color);
  drawCircle(canvas, 47 * scale + offsetX, 36 * scale + offsetY, 3.5 * scale, color);
}

function drawIcon(size) {
  const canvas = createCanvas(size, size, COLORS.dark);
  const scale = size / 96;

  drawCircle(canvas, size * 0.2, size * 0.18, size * 0.22, COLORS.aqua);
  drawCircle(canvas, size * 0.82, size * 0.78, size * 0.28, COLORS.mint);
  drawMark(canvas, {
    color: COLORS.gold,
    offsetX: size * 0.165,
    offsetY: size * 0.165,
    scale,
    stroke: 5.2,
  });

  return canvas;
}

function drawForeground(size, color = COLORS.gold) {
  const canvas = createCanvas(size, size, COLORS.transparent);
  const scale = size / 86;

  drawMark(canvas, {
    color,
    offsetX: size * 0.125,
    offsetY: size * 0.125,
    scale,
    stroke: 5.4,
  });

  return canvas;
}

function drawBackground(size) {
  const canvas = createCanvas(size, size, COLORS.dark);

  drawCircle(canvas, size * 0.16, size * 0.22, size * 0.28, COLORS.aqua);
  drawCircle(canvas, size * 0.86, size * 0.82, size * 0.34, COLORS.mint);

  return canvas;
}

function writePng(name, canvas) {
  writeFileSync(join(assetsDir, name), encodePng(canvas.width, canvas.height, canvas.pixels));
}

writePng('icon.png', drawIcon(1024));
writePng('splash-icon.png', drawIcon(1024));
writePng('android-icon-background.png', drawBackground(512));
writePng('android-icon-foreground.png', drawForeground(512));
writePng('android-icon-monochrome.png', drawForeground(432, COLORS.white));
writePng('favicon.png', drawIcon(48));
