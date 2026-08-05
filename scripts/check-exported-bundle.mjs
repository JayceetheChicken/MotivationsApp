#!/usr/bin/env node
/**
 * Scans a built export for values that must never ship, and proves which
 * password recovery transport the built app really uses.
 *
 *   npx expo export --platform web --output-dir dist
 *   node scripts/check-exported-bundle.mjs dist
 *
 * Three independent checks:
 *
 *  1. No secret shapes. Everything under EXPO_PUBLIC_* is intentionally public;
 *     what must not appear is a service-role key, a database password, a
 *     private key or a signing secret. Supabase keys are JWTs, so the literal
 *     text "service_role" never occurs in a built bundle - every JWT candidate
 *     is decoded and classified instead (scripts/lib/bundle-scan.cjs, which
 *     uses the same decoder as the release gate and the app runtime).
 *  2. When the release gate is active, the resolved operator values must
 *     actually be present in the bundle. Metro only inlines literal
 *     `process.env.EXPO_PUBLIC_X` references, so a refactor could otherwise
 *     pass the gate while shipping development placeholders.
 *  3. The auth build attestation embedded in the export must say that the
 *     active recovery transport is the verified HTTPS App Link on the expected
 *     host. This reads the value out of the built bytes rather than recomputing
 *     it - see scripts/lib/recovery-attestation.cjs for why that distinction
 *     matters and how the attestation survives quoting and minification.
 *
 * Files are read race-free through a single descriptor; a file that cannot be
 * inspected fails the scan instead of passing silently.
 *
 * Scope note: this runs against the *web* export, which is the artefact CI can
 * build reproducibly. The Android manifest half of the same contract - intent
 * filters and the absence of a private recovery filter - is asserted by
 * scripts/verify-expo-config.mjs against `expo config --type public --json`.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const releaseConfig = require('../config/release-config.cjs');
const { scanExportDirectory } = require('./lib/bundle-scan.cjs');
const recoveryAttestation = require('./lib/recovery-attestation.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const root = process.argv[2];
if (!root) {
  process.stderr.write('Aufruf: node scripts/check-exported-bundle.mjs <verzeichnis>\n');
  process.exit(2);
}

const { scanned, skipped, findings, unreadable, documents } = scanExportDirectory(root);

process.stdout.write(`Export geprueft: ${scanned} Textdateien, ${skipped} Binaerdateien uebersprungen.\n`);

if (unreadable.length > 0) {
  process.stderr.write('\nNicht pruefbare Dateien im Export (der Scan gilt damit als fehlgeschlagen):\n');
  for (const entry of unreadable) process.stderr.write(`- ${entry.file}: ${entry.reason}\n`);
  process.exit(1);
}

if (findings.length > 0) {
  process.stderr.write('\nGeheimnisverdacht im Export:\n');
  for (const finding of findings) {
    process.stderr.write(`- ${finding.file}: ${finding.name}\n    ${finding.detail}\n`);
  }
  process.exit(1);
}
process.stdout.write('Keine Secret-Muster und keine unerlaubten JWTs im Export gefunden.\n');

const isProduction = releaseConfig.isProductionRelease(process.env);

if (isProduction) {
  const blockers = releaseConfig.collectReleaseBlockers(process.env);
  if (blockers.length > 0) {
    process.stderr.write(`${releaseConfig.formatReleaseBlockerReport(blockers)}\n`);
    process.exit(1);
  }

  // The bundle must contain the real values, not the development fallbacks.
  const operator = releaseConfig.resolveOperatorValues(process.env);
  const mustAppear = ['operatorName', 'operatorAddress', 'privacyContactEmail', 'supportEmail'];
  const missing = mustAppear.filter(
    (key) => !documents.some(({ content }) => content.includes(operator[key])),
  );
  const leaked = documents.some(
    ({ content }) => content.includes(`@${releaseConfig.DEVELOPMENT_MARKER_DOMAIN}`),
  );

  // What the app will really do, read out of the built artefact.
  const expected = releaseConfig.resolveAuthBuildConfiguration(process.env);
  const recoveryIssues = recoveryAttestation.collectProductionRecoveryIssues(documents, expected);

  if (missing.length > 0 || leaked || recoveryIssues.length > 0) {
    process.stderr.write('\nDer Export ist nicht release-tauglich:\n');
    for (const key of missing) process.stderr.write(`- "${operator[key]}" (${key}) kommt im Bundle nicht vor.\n`);
    if (leaked) process.stderr.write(`- Es sind noch Entwicklungs-Adressen auf @${releaseConfig.DEVELOPMENT_MARKER_DOMAIN} enthalten.\n`);
    for (const issue of recoveryIssues) process.stderr.write(`- ${issue}\n`);
    process.stderr.write(
      `\nUrsache ist fast immer, dass eine Variable in ${path.relative(projectRoot, path.join(projectRoot, 'src/legal/operator.ts'))}\n`
      + 'nicht literal als process.env.EXPO_PUBLIC_X gelesen wird. Metro kann nur literale Zugriffe inlinen.\n',
    );
    process.exit(1);
  }
  process.stdout.write('Die konfigurierten Betreiberangaben sind im Export nachweisbar enthalten.\n');
  const { found } = recoveryAttestation.findAttestations(documents);
  process.stdout.write(`Gebuendelte Recovery-Attestierung: ${found[0].attestation}\n`);
} else {
  // Scanned without the environment that produced the export - a scan may
  // legitimately run that way. The attestation is then the only source of truth
  // and is checked for existence, uniqueness and internal consistency.
  const recoveryIssues = recoveryAttestation.collectAttestationConsistencyIssues(documents);
  if (recoveryIssues.length > 0) {
    process.stderr.write('\nDie gebuendelte Auth-Build-Attestierung ist nicht stimmig:\n');
    for (const issue of recoveryIssues) process.stderr.write(`- ${issue}\n`);
    process.exit(1);
  }
  const { found } = recoveryAttestation.findAttestations(documents);
  process.stdout.write(`Gebuendelte Recovery-Attestierung: ${found[0].attestation}\n`);
}
