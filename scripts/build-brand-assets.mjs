#!/usr/bin/env node
/**
 * Generates the complete Lernzeit brand asset set from one geometry definition.
 *
 *   node scripts/build-brand-assets.mjs           # write PNG + SVG masters
 *   node scripts/build-brand-assets.mjs --check   # fail if any output is stale
 *
 * The mark is a clock ring with two hands: a neutral, legible "learning time"
 * symbol that survives 48 px rendering and Android monochrome theming. Nothing
 * here derives from the Expo or React Native templates.
 *
 * Android adaptive icons: the inner 66/108 of the canvas is the guaranteed safe
 * zone, so all foreground geometry stays inside a circle of 0.58 * canvas.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  arcDistance,
  Canvas,
  capsuleDistance,
  circleDistance,
  hexToRgb,
  union,
} from './lib/raster.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

export const BRAND = {
  terracotta: '#B44D2B',
  terracottaDeep: '#8E3A1E',
  cream: '#F4E8D0',
  ink: '#3B281D',
  white: '#FFFFFF',
};

/** Hour hand direction, measured clockwise from twelve o'clock. */
const HOUR_HAND_DEGREES = 118;

/**
 * Mark geometry for one canvas. `scale` is the ring diameter relative to the
 * canvas, so the same definition serves full-bleed icons (0.62) and adaptive
 * foregrounds (0.52, well inside the safe zone).
 */
function markGeometry(size, scale) {
  const center = size / 2;
  const radius = (size * scale) / 2;
  const stroke = radius * 0.26;

  const ringOuter = circleDistance({ cx: center, cy: center, radius: radius + stroke / 2 });
  const ringInner = circleDistance({ cx: center, cy: center, radius: radius - stroke / 2 });
  const ring = (x, y) => Math.max(ringOuter(x, y), -ringInner(x, y));

  // Minute hand to twelve, hour hand to four: an unambiguous, calm clock face.
  const handThickness = stroke * 0.92;
  const minuteHand = capsuleDistance({
    x1: center,
    y1: center,
    x2: center,
    y2: center - radius * 0.62,
    thickness: handThickness,
  });
  const hourAngle = (HOUR_HAND_DEGREES * Math.PI) / 180;
  const hourHand = capsuleDistance({
    x1: center,
    y1: center,
    x2: center + Math.sin(hourAngle) * radius * 0.44,
    y2: center - Math.cos(hourAngle) * radius * 0.44,
    thickness: handThickness,
  });

  return {
    center,
    radius,
    stroke,
    handThickness,
    shape: union(ring, minuteHand, hourHand),
  };
}

function renderMark({ size, scale, background, foreground, opaque }) {
  const canvas = new Canvas(size, size);
  if (background) canvas.fill(hexToRgb(background));
  const geometry = markGeometry(size, scale);
  canvas.draw(geometry.shape, hexToRgb(foreground));
  return canvas.toPng({ opaque });
}

function renderSolid({ size, colour }) {
  const canvas = new Canvas(size, size);
  canvas.fill(hexToRgb(colour));
  return canvas.toPng({ opaque: true });
}

function renderFeatureGraphic() {
  const width = 1024;
  const height = 500;
  const canvas = new Canvas(width, height);
  canvas.fill(hexToRgb(BRAND.terracotta));

  // Soft geometric motif: concentric rings echoing the app mark.
  for (let index = 0; index < 5; index += 1) {
    const radius = height * (0.42 + index * 0.20);
    canvas.draw(
      arcDistance({
        cx: width * 0.80,
        cy: height * 0.52,
        radius,
        thickness: height * 0.018,
        halfApertureRadians: (135 * Math.PI) / 180,
      }),
      hexToRgb(BRAND.cream),
      0.16,
    );
  }

  // The mark itself, left aligned inside the safe area Play never crops.
  const markSize = Math.round(height * 0.62);
  const markCanvas = new Canvas(markSize, markSize);
  const geometry = markGeometry(markSize, 0.74);
  markCanvas.draw(geometry.shape, hexToRgb(BRAND.cream));

  const originX = Math.round(width * 0.10);
  const originY = Math.round((height - markSize) / 2);
  for (let y = 0; y < markSize; y += 1) {
    for (let x = 0; x < markSize; x += 1) {
      const source = (y * markSize + x) * 4;
      const alpha = markCanvas.data[source + 3];
      if (alpha <= 0) continue;
      const target = ((originY + y) * width + originX + x) * 4;
      const dstA = canvas.data[target + 3];
      const outA = alpha + dstA * (1 - alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        canvas.data[target + channel] =
          (markCanvas.data[source + channel] * alpha
            + canvas.data[target + channel] * dstA * (1 - alpha)) / outA;
      }
      canvas.data[target + 3] = outA;
    }
  }

  return canvas.toPng({ opaque: true });
}

/** SVG master, derived from the same numbers as the raster geometry above. */
function markSvg({ size, scale, background, foreground }) {
  const geometry = markGeometry(size, scale);
  const { center, radius, stroke, handThickness } = geometry;
  const hourAngle = (HOUR_HAND_DEGREES * Math.PI) / 180;
  const backgroundLayer = background
    ? `  <rect width="${size}" height="${size}" fill="${background}"/>\n`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Lernzeit">
  <title>Lernzeit</title>
${backgroundLayer}  <circle cx="${center}" cy="${center}" r="${radius.toFixed(2)}" fill="none" stroke="${foreground}" stroke-width="${stroke.toFixed(2)}"/>
  <line x1="${center}" y1="${center}" x2="${center}" y2="${(center - radius * 0.62).toFixed(2)}" stroke="${foreground}" stroke-width="${handThickness.toFixed(2)}" stroke-linecap="round"/>
  <line x1="${center}" y1="${center}" x2="${(center + Math.sin(hourAngle) * radius * 0.44).toFixed(2)}" y2="${(center - Math.cos(hourAngle) * radius * 0.44).toFixed(2)}" stroke="${foreground}" stroke-width="${handThickness.toFixed(2)}" stroke-linecap="round"/>
</svg>
`;
}

const OUTPUTS = [
  // --- Application icons ---------------------------------------------------
  {
    file: 'assets/images/icon.png',
    note: 'App-Icon 1024x1024, vollflaechig, wird von Android und iOS maskiert.',
    build: () => renderMark({ size: 1024, scale: 0.62, background: BRAND.terracotta, foreground: BRAND.cream, opaque: true }),
  },
  {
    file: 'assets/images/android-icon-foreground.png',
    note: 'Adaptive-Icon-Vordergrund 432x432, Motiv innerhalb der Safe Zone.',
    build: () => renderMark({ size: 432, scale: 0.52, background: null, foreground: BRAND.cream, opaque: false }),
  },
  {
    file: 'assets/images/android-icon-background.png',
    note: 'Adaptive-Icon-Hintergrund 432x432, deckende Markenfarbe.',
    build: () => renderSolid({ size: 432, colour: BRAND.terracotta }),
  },
  {
    file: 'assets/images/android-icon-monochrome.png',
    note: 'Monochromes Android-Icon 432x432, schwarze Silhouette auf Transparenz.',
    build: () => renderMark({ size: 432, scale: 0.52, background: null, foreground: '#000000', opaque: false }),
  },
  {
    file: 'assets/images/splash-icon.png',
    note: 'Splashscreen-Motiv 512x512 auf transparentem Grund.',
    build: () => renderMark({ size: 512, scale: 0.70, background: null, foreground: BRAND.cream, opaque: false }),
  },
  {
    file: 'assets/images/favicon.png',
    note: 'Web-Favicon 48x48.',
    build: () => renderMark({ size: 48, scale: 0.74, background: BRAND.terracotta, foreground: BRAND.cream, opaque: true }),
  },
  // --- Play Store ----------------------------------------------------------
  {
    file: 'assets/store/play-icon-512.png',
    note: 'Play-Store-Icon 512x512, 32 bit, ohne Transparenz und ohne eigene Rundung.',
    build: () => renderMark({ size: 512, scale: 0.62, background: BRAND.terracotta, foreground: BRAND.cream, opaque: true }),
  },
  {
    file: 'assets/store/play-feature-graphic-1024x500.png',
    note: 'Play-Feature-Grafik 1024x500, ohne Text, damit nichts abgeschnitten wird.',
    build: renderFeatureGraphic,
  },
  // --- Vector masters ------------------------------------------------------
  {
    file: 'assets/brand/lernzeit-mark.svg',
    note: 'Vektor-Master des Markenzeichens auf Markenfarbe.',
    build: () => Buffer.from(markSvg({ size: 1024, scale: 0.62, background: BRAND.terracotta, foreground: BRAND.cream }), "utf8"),
  },
  {
    file: 'assets/brand/lernzeit-mark-monochrome.svg',
    note: 'Vektor-Master der Silhouette fuer Themed Icons und Druck.',
    build: () => Buffer.from(markSvg({ size: 432, scale: 0.52, background: null, foreground: "#000000" }), "utf8"),
  },
];

function outputPath(relative) {
  return path.join(projectRoot, relative);
}

let stale = 0;
for (const output of OUTPUTS) {
  const target = outputPath(output.file);
  const content = output.build();
  if (checkOnly) {
    let current;
    try {
      current = readFileSync(target);
    } catch {
      current = null;
    }
    if (!current || !current.equals(content)) {
      stale += 1;
      process.stderr.write(`Nicht aktuell: ${output.file}\n`);
    }
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  process.stdout.write(`${output.file.padEnd(52)} ${(content.length / 1024).toFixed(1)} KB  ${output.note}\n`);
}

if (checkOnly) {
  if (stale > 0) {
    process.stderr.write(`\n${stale} Brand-Asset(s) weichen von der Quelle ab. "npm run assets:build" ausfuehren.\n`);
    process.exit(1);
  }
  process.stdout.write('Alle Brand-Assets stimmen mit scripts/build-brand-assets.mjs ueberein.\n');
}
