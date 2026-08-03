#!/usr/bin/env node
/**
 * Asserts that the resolved Expo configuration is release-safe.
 *
 *   npx expo config --type public --json > expo-config.json
 *   node scripts/verify-expo-config.mjs expo-config.json
 *
 * Checks the values Google Play binds permanently or rejects at upload time:
 * package name, versionCode, target SDK, App Links host, backup behaviour and
 * the absence of placeholder domains.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const releaseConfig = require('../config/release-config.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.argv[2];
if (!configPath) {
  process.stderr.write('Aufruf: node scripts/verify-expo-config.mjs <expo-config.json>\n');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(path.resolve(projectRoot, configPath), 'utf8'));
// `expo config --json` wraps the manifest, `--type public` returns it directly.
const config = raw.expo ?? raw;
const android = config.android ?? {};

export const EXPECTED = {
  androidPackage: 'de.lernzeit.app',
  targetSdkVersion: 36,
  minSdkVersion: 24,
};

const failures = [];
const notes = [];

function require_(condition, message) {
  if (!condition) failures.push(message);
}

require_(
  android.package === EXPECTED.androidPackage,
  `Android-Paketname ist "${android.package}", erwartet "${EXPECTED.androidPackage}".`,
);
require_(
  Number.isInteger(android.versionCode) && android.versionCode >= 1,
  `Android versionCode fehlt oder ist ungueltig: ${JSON.stringify(android.versionCode)}.`,
);
require_(
  typeof config.version === 'string' && /^\d+\.\d+\.\d+$/.test(config.version),
  `App-Version muss dem Schema x.y.z folgen, gefunden: ${JSON.stringify(config.version)}.`,
);
require_(android.allowBackup === false, 'android.allowBackup muss false sein, damit Kontodaten nicht in Cloud-Backups landen.');
require_(config.scheme === 'lernzeit' || config.scheme?.includes?.('lernzeit'), 'Das private URL-Scheme "lernzeit" fehlt.');

const buildProperties = (config.plugins ?? []).find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
);
const androidBuildProperties = buildProperties?.[1]?.android ?? {};
require_(
  androidBuildProperties.targetSdkVersion === EXPECTED.targetSdkVersion,
  `targetSdkVersion muss ${EXPECTED.targetSdkVersion} sein, gefunden: ${androidBuildProperties.targetSdkVersion}.`,
);
require_(
  androidBuildProperties.compileSdkVersion === EXPECTED.targetSdkVersion,
  `compileSdkVersion muss ${EXPECTED.targetSdkVersion} sein, gefunden: ${androidBuildProperties.compileSdkVersion}.`,
);
require_(
  Number.isInteger(androidBuildProperties.minSdkVersion) && androidBuildProperties.minSdkVersion >= EXPECTED.minSdkVersion,
  `minSdkVersion muss mindestens ${EXPECTED.minSdkVersion} sein, gefunden: ${androidBuildProperties.minSdkVersion}.`,
);
require_(
  androidBuildProperties.usesCleartextTraffic === false,
  'usesCleartextTraffic muss false sein.',
);

const intentFilters = android.intentFilters ?? [];
const appLink = intentFilters.find((filter) => filter.autoVerify === true);
require_(Boolean(appLink), 'Es ist kein verifizierter Android App Link (autoVerify) konfiguriert.');

const appLinkHost = appLink?.data?.[0]?.host ?? appLink?.data?.host;
if (appLinkHost) {
  if (releaseConfig.isPlaceholderValue(appLinkHost)) {
    failures.push(`Der App-Links-Host "${appLinkHost}" ist noch ein Platzhalter.`);
  } else {
    notes.push(`App-Links-Host: ${appLinkHost}`);
  }
} else {
  failures.push('Der App-Links-Host konnte nicht aus der aufgeloesten Config gelesen werden.');
}

const privateScheme = intentFilters.find(
  (filter) => (filter.data?.[0]?.scheme ?? filter.data?.scheme) === 'lernzeit',
);
require_(Boolean(privateScheme), 'Der private Recovery-Deep-Link lernzeit://auth/update-password fehlt.');

// No placeholder may survive anywhere in the resolved configuration.
const serialized = JSON.stringify(config);
for (const token of ['example.invalid', 'your-project-id', '[NAME/FIRMA]', '[KONTAKT]', 'lernzeit.invalid']) {
  if (serialized.includes(token)) failures.push(`Die aufgeloeste Expo-Config enthaelt den Platzhalter "${token}".`);
}

// Secrets must never be inlined into the public manifest.
for (const pattern of [/service_role/i, /sb_secret_/, /SUPABASE_SERVICE_ROLE/i]) {
  if (pattern.test(serialized)) failures.push(`Die aufgeloeste Expo-Config enthaelt ein Secret-Muster: ${pattern}.`);
}

for (const note of notes) process.stdout.write(`${note}\n`);
process.stdout.write(`Paket: ${android.package}  Version: ${config.version}  versionCode: ${android.versionCode}\n`);
process.stdout.write(`targetSdk: ${androidBuildProperties.targetSdkVersion}  minSdk: ${androidBuildProperties.minSdkVersion}\n`);

if (failures.length > 0) {
  process.stderr.write('\nDie aufgeloeste Expo-Config ist nicht release-tauglich:\n');
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}
process.stdout.write('Expo-Config erfuellt alle Release-Anforderungen.\n');
