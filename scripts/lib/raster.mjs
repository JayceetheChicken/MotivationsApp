/**
 * Minimal dependency-free 2D rasterizer and PNG encoder.
 *
 * Shapes are described as signed distance functions, which gives exact
 * analytic anti-aliasing without any native image dependency. That keeps the
 * brand asset build reproducible on every machine and in CI.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // Straight (non-premultiplied) RGBA in 0..1.
    this.data = new Float64Array(width * height * 4);
  }

  /** Fills the whole canvas with an opaque colour. */
  fill([r, g, b], alpha = 1) {
    for (let index = 0; index < this.data.length; index += 4) {
      this.data[index] = r;
      this.data[index + 1] = g;
      this.data[index + 2] = b;
      this.data[index + 3] = alpha;
    }
  }

  /**
   * Composites a shape. `distance(x, y)` returns the signed distance in pixels
   * (negative inside). Coverage is derived from the distance, which yields
   * smooth edges at every size.
   */
  draw(distance, [r, g, b], alpha = 1) {
    const { width, height, data } = this;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const d = distance(x + 0.5, y + 0.5);
        // 1px wide analytic edge band.
        const coverage = Math.min(Math.max(0.5 - d, 0), 1) * alpha;
        if (coverage <= 0) continue;
        const index = (y * width + x) * 4;
        const dstA = data[index + 3];
        const outA = coverage + dstA * (1 - coverage);
        if (outA <= 0) continue;
        data[index] = (r * coverage + data[index] * dstA * (1 - coverage)) / outA;
        data[index + 1] = (g * coverage + data[index + 1] * dstA * (1 - coverage)) / outA;
        data[index + 2] = (b * coverage + data[index + 2] * dstA * (1 - coverage)) / outA;
        data[index + 3] = outA;
      }
    }
  }

  /** Removes coverage where the shape is, used for punch-out effects. */
  erase(distance) {
    const { width, height, data } = this;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const d = distance(x + 0.5, y + 0.5);
        const coverage = Math.min(Math.max(0.5 - d, 0), 1);
        if (coverage <= 0) continue;
        const index = (y * width + x) * 4;
        data[index + 3] *= 1 - coverage;
      }
    }
  }

  toPng({ opaque = false } = {}) {
    const { width, height, data } = this;
    const bytesPerPixel = opaque ? 3 : 4;
    const raw = Buffer.alloc(height * (1 + width * bytesPerPixel));
    let offset = 0;
    for (let y = 0; y < height; y += 1) {
      raw[offset] = 0; // filter: none
      offset += 1;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const a = data[index + 3];
        // Opaque output composites onto white so no transparency survives.
        const composite = (channel) => (opaque ? channel * a + 1 * (1 - a) : channel);
        raw[offset] = Math.round(Math.min(Math.max(composite(data[index]), 0), 1) * 255);
        raw[offset + 1] = Math.round(Math.min(Math.max(composite(data[index + 1]), 0), 1) * 255);
        raw[offset + 2] = Math.round(Math.min(Math.max(composite(data[index + 2]), 0), 1) * 255);
        if (!opaque) raw[offset + 3] = Math.round(Math.min(Math.max(a, 0), 1) * 255);
        offset += bytesPerPixel;
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = opaque ? 2 : 6; // colour type: truecolour / truecolour+alpha
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

// --- Signed distance functions ---------------------------------------------

/** Circle outline segment with round caps, centred on the negative Y axis gap. */
export function arcDistance({ cx, cy, radius, thickness, halfApertureRadians, rotationRadians = 0 }) {
  const sinA = Math.sin(halfApertureRadians);
  const cosA = Math.cos(halfApertureRadians);
  const half = thickness / 2;
  const cosR = Math.cos(rotationRadians);
  const sinR = Math.sin(rotationRadians);
  return (x, y) => {
    let px = x - cx;
    let py = y - cy;
    const rx = px * cosR - py * sinR;
    const ry = px * sinR + py * cosR;
    px = Math.abs(rx);
    py = ry;
    const outside = cosA * px > sinA * py;
    if (outside) {
      const dx = px - sinA * radius;
      const dy = py - cosA * radius;
      return Math.hypot(dx, dy) - half;
    }
    return Math.abs(Math.hypot(px, py) - radius) - half;
  };
}

/** Line segment with round caps. */
export function capsuleDistance({ x1, y1, x2, y2, thickness }) {
  const half = thickness / 2;
  const bax = x2 - x1;
  const bay = y2 - y1;
  const lengthSquared = bax * bax + bay * bay;
  return (x, y) => {
    const pax = x - x1;
    const pay = y - y1;
    const h = lengthSquared === 0 ? 0 : Math.min(Math.max((pax * bax + pay * bay) / lengthSquared, 0), 1);
    return Math.hypot(pax - bax * h, pay - bay * h) - half;
  };
}

export function circleDistance({ cx, cy, radius }) {
  return (x, y) => Math.hypot(x - cx, y - cy) - radius;
}

export function roundedRectDistance({ cx, cy, halfWidth, halfHeight, radius }) {
  return (x, y) => {
    const dx = Math.abs(x - cx) - halfWidth + radius;
    const dy = Math.abs(y - cy) - halfHeight + radius;
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    return outside + Math.min(Math.max(dx, dy), 0) - radius;
  };
}

/** Union of several shapes. */
export function union(...distances) {
  return (x, y) => {
    let best = Infinity;
    for (const distance of distances) best = Math.min(best, distance(x, y));
    return best;
  };
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ];
}
