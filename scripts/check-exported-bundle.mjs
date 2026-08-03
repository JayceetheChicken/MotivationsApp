#!/usr/bin/env node
/**
 * Scans a built export for values that must never ship.
 *
 *   npx expo export --platform web --output-dir dist
 *   node scripts/check-exported-bundle.mjs dist
 *
 * Two independent checks:
 *
 *  1. No secret shapes. Everything under EXPO_PUBLIC_* is intentionally public;
 *     what must not appear is a service-role key, a database password, a
 *     private key or a signing secret.
 *  2. When the release gate is active, the resolved operator values must
 *     actually be present in the bundle. Metro only inlines literal
 *     `process.env.EXPO_PUBLIC_X` references, so a refactor could otherwise
 *     pass the gate while shipping development placeholders.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const releaseConfig = require('../config/release-config.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const root = process.argv[2];
if (!root) {
  process.stderr.write('Aufruf: node scripts/check-exported-bundle.mjs <verzeichnis>\n');
  process.exit(2);
}

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.map', '.txt', '.webmanifest']);

const SECRET_PATTERNS = [
  { name: 'Supabase service-role JWT', pattern: /"role"\s*:\s*"service_role"/ },
  { name: 'Supabase service-role Bezeichner', pattern: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']{8,}/ },
  { name: 'Supabase Secret-Key', pattern: /\bsb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'Privater Schluessel im PEM-Format', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Google-Service-Account-Key', pattern: /"type"\s*:\s*"service_account"/ },
  { name: 'AWS Access Key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub-Token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Expo-Access-Token', pattern: /\bexp_[A-Za-z0-9]{24,}\b/ },
  { name: 'Postgres-Verbindungsstring mit Passwort', pattern: /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/ },
];

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

let scanned = 0;
let skipped = 0;
const findings = [];
const corpus = [];

for (const file of walk(root)) {
  const extension = path.extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) {
    skipped += 1;
    continue;
  }
  if (statSync(file).size > 32 * 1024 * 1024) {
    skipped += 1;
    continue;
  }
  const content = readFileSync(file, 'utf8');
  scanned += 1;
  corpus.push(content);
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) findings.push({ file: path.relative(root, file), name });
  }
}

process.stdout.write(`Export geprueft: ${scanned} Textdateien, ${skipped} Binaerdateien uebersprungen.\n`);

if (findings.length > 0) {
  process.stderr.write('\nGeheimnisverdacht im Export:\n');
  for (const finding of findings) process.stderr.write(`- ${finding.file}: ${finding.name}\n`);
  process.exit(1);
}
process.stdout.write('Keine Secret-Muster im Export gefunden.\n');

if (releaseConfig.isProductionRelease(process.env)) {
  const blockers = releaseConfig.collectReleaseBlockers(process.env);
  if (blockers.length > 0) {
    process.stderr.write(`${releaseConfig.formatReleaseBlockerReport(blockers)}\n`);
    process.exit(1);
  }

  // The bundle must contain the real values, not the development fallbacks.
  const operator = releaseConfig.resolveOperatorValues(process.env);
  const mustAppear = ['operatorName', 'operatorAddress', 'privacyContactEmail', 'supportEmail'];
  const missing = mustAppear.filter(
    (key) => !corpus.some((content) => content.includes(operator[key])),
  );
  const leaked = corpus.some((content) => content.includes(`@${releaseConfig.DEVELOPMENT_MARKER_DOMAIN}`));

  if (missing.length > 0 || leaked) {
    process.stderr.write('\nDer Export enthaelt nicht die konfigurierten Betreiberangaben:\n');
    for (const key of missing) process.stderr.write(`- "${operator[key]}" (${key}) kommt im Bundle nicht vor.\n`);
    if (leaked) process.stderr.write(`- Es sind noch Entwicklungs-Adressen auf @${releaseConfig.DEVELOPMENT_MARKER_DOMAIN} enthalten.\n`);
    process.stderr.write(
      `\nUrsache ist fast immer, dass eine Variable in ${path.relative(projectRoot, path.join(projectRoot, 'src/legal/operator.ts'))}\n`
      + 'nicht literal als process.env.EXPO_PUBLIC_X gelesen wird. Metro kann nur literale Zugriffe inlinen.\n',
    );
    process.exit(1);
  }
  process.stdout.write('Die konfigurierten Betreiberangaben sind im Export nachweisbar enthalten.\n');
}
