#!/usr/bin/env node
/**
 * Generates the operator-hosted static pages from the central configuration:
 *   - public/account-deletion/index.html  (Play-required, reachable without app or login)
 *   - public/.well-known/assetlinks.json  (Android App Links verification)
 *
 * Development run (no operator variables set): writes a clearly marked draft
 * with Testwert values and an empty fingerprint list, so the repository has a
 * deterministic checked-in state.
 *
 * Production run (release gate active, see isProductionRelease): every one of
 * the following aborts with exit code 1 instead of writing a file:
 *   - missing or placeholder operator values
 *   - the reserved .invalid development domain
 *   - a visible development banner on the generated page
 *   - missing ANDROID_SHA256_CERT_FINGERPRINTS
 *   - a malformed fingerprint (anything that is not 32 colon separated hex bytes)
 *   - an empty fingerprint list after normalisation
 *   - an unexpected Android package name
 *
 * An invalid fingerprint is never merely filtered out: silently dropping it
 * would produce a file that looks complete while App Links verification stays
 * broken, and the HTTPS recovery link would open a browser instead of the app.
 *
 *   ANDROID_SHA256_CERT_FINGERPRINTS=AA:BB:.. node scripts/build-public-pages.mjs
 *
 * The fingerprint comes from Play Console > Test and release > App integrity >
 * App signing key certificate (SHA-256).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const releaseConfig = require('../config/release-config.cjs');
const publicPages = require('./lib/public-pages.cjs');
const appJson = require('../app.json');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.env;
const argv = new Set(process.argv.slice(2));
const enforce = argv.has('--production') || releaseConfig.isProductionRelease(environment);

const EXPECTED_ANDROID_PACKAGE = 'de.lernzeit.app';
const androidPackage = appJson.expo?.android?.package;

const operator = releaseConfig.resolveOperatorValues(environment);
const operatorIssues = releaseConfig.collectOperatorReleaseIssues(environment);
const isDevelopment = operatorIssues.length > 0;

const { fingerprints, invalid } = publicPages.parseFingerprints(
  environment.ANDROID_SHA256_CERT_FINGERPRINTS,
);

const accountDeletionHtml = publicPages.renderAccountDeletionPage(operator, { isDevelopment });
const assetLinksJson = publicPages.renderAssetLinks(androidPackage, fingerprints);

if (enforce) {
  const blockers = [];

  if (operatorIssues.length > 0) {
    blockers.push(
      `${operatorIssues.length} Betreiberangabe(n) fehlen oder sind Testwerte: `
      + `${operatorIssues.map((issue) => issue.envVar).join(', ')}.`,
    );
  }
  if (androidPackage !== EXPECTED_ANDROID_PACKAGE) {
    blockers.push(
      `Android-Paketname ist "${androidPackage}", erwartet "${EXPECTED_ANDROID_PACKAGE}".`,
    );
  }
  if (invalid.length > 0) {
    blockers.push(
      `Ungueltige SHA-256-Fingerprints: ${invalid.join(', ')}. `
      + 'Erwartet werden genau 32 hexadezimale Bytes im Format AA:BB:...:99.',
    );
  }
  if (fingerprints.length === 0) {
    blockers.push(
      'ANDROID_SHA256_CERT_FINGERPRINTS enthaelt keinen gueltigen Fingerprint. '
      + 'Ohne Fingerprint verifiziert Android den App Link nicht.',
    );
  }

  blockers.push(...publicPages.collectAccountDeletionPageIssues(accountDeletionHtml, operator)
    .map((issue) => `Kontoloeschseite: ${issue}`));
  blockers.push(...publicPages.collectAssetLinksIssues(assetLinksJson, EXPECTED_ANDROID_PACKAGE)
    .map((issue) => `assetlinks.json: ${issue}`));

  if (blockers.length > 0) {
    process.stderr.write('\nDie oeffentlichen Seiten koennen nicht produktiv erzeugt werden:\n');
    for (const blocker of blockers) process.stderr.write(`- ${blocker}\n`);
    process.stderr.write(
      '\nEs wurde keine Datei geschrieben. Setze die EXPO_PUBLIC_*-Betreibervariablen und\n'
      + 'ANDROID_SHA256_CERT_FINGERPRINTS (Play Console > App-Integritaet > App-Signaturschluessel)\n'
      + 'und starte den Lauf erneut.\n',
    );
    process.exit(1);
  }
}

const accountDeletionPath = path.join(projectRoot, 'public', 'account-deletion', 'index.html');
const assetLinksPath = path.join(projectRoot, 'public', '.well-known', 'assetlinks.json');

mkdirSync(path.dirname(accountDeletionPath), { recursive: true });
mkdirSync(path.dirname(assetLinksPath), { recursive: true });
writeFileSync(accountDeletionPath, accountDeletionHtml, 'utf8');
writeFileSync(assetLinksPath, assetLinksJson, 'utf8');

process.stdout.write(`Erzeugt: ${path.relative(projectRoot, accountDeletionPath)}\n`);
process.stdout.write(`Erzeugt: ${path.relative(projectRoot, assetLinksPath)}\n`);
process.stdout.write(
  `Fingerprints: ${fingerprints.length === 0 ? '(keine)' : fingerprints.join(', ')}\n`,
);

if (!enforce && (fingerprints.length === 0 || invalid.length > 0 || isDevelopment)) {
  process.stdout.write(
    '\nEntwicklungsfassung. Fuer die Veroeffentlichung muessen die EXPO_PUBLIC_*-Betreibervariablen\n'
    + 'und ANDROID_SHA256_CERT_FINGERPRINTS gesetzt sein; ohne sie bricht der Lauf mit aktivem\n'
    + 'Release-Gate ab (node scripts/build-public-pages.mjs --production).\n',
  );
  if (invalid.length > 0) {
    process.stdout.write(`Ignorierte ungueltige Fingerprints: ${invalid.join(', ')}\n`);
  }
}
