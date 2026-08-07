#!/usr/bin/env node
/**
 * Asserts that the AndroidManifest.xml `expo prebuild` generated matches the
 * build profile it was generated for.
 *
 *   npx expo prebuild --platform android --clean --no-install
 *   node scripts/verify-native-linking.mjs android/app/src/main/AndroidManifest.xml
 *
 * `scripts/verify-expo-config.mjs` checks Expo's *input*; this checks its
 * output. Everything between the two is `@expo/config-plugins`, which is the
 * component that actually decides whether `lernzeit://` ends up in the shipped
 * manifest.
 *
 * Production must prove: the verified HTTPS App Link on the operator host with
 * android:autoVerify="true" and the exact path /update-password, and no
 * android:scheme="lernzeit" anywhere at all. Development and preview must prove
 * the exact opposite.
 *
 * The checks live in scripts/lib/native-linking-check.cjs so
 * __tests__/release-scripts.test.ts can run them against deliberately broken
 * manifests.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { collectNativeLinkingIssues } = require('./lib/native-linking-check.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.argv[2]
  ?? path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');

let xml;
try {
  xml = readFileSync(path.resolve(projectRoot, manifestPath), 'utf8');
} catch (error) {
  process.stderr.write(
    `Das AndroidManifest.xml unter "${manifestPath}" ist nicht lesbar: ${error?.message ?? error}\n`
    + 'Erzeuge es zuerst mit: npx expo prebuild --platform android --clean --no-install\n',
  );
  process.exit(2);
}

const { failures, notes, summary } = collectNativeLinkingIssues(xml, process.env);

for (const note of notes) process.stdout.write(`${note}\n`);
process.stdout.write(
  `Profil: ${summary.buildProfile}  Transport: ${summary.recoveryTransport}\n`,
);
process.stdout.write(
  `Intent-Filter: ${summary.intentFilters}  lernzeit-Scheme-Eintraege: ${summary.customSchemeEntries}`
  + `  verifizierte Recovery-App-Links: ${summary.verifiedRecoveryAppLinks}`
  + `  private Recovery-Filter: ${summary.privateRecoveryFilters}\n`,
);

if (failures.length > 0) {
  process.stderr.write(`\nDas generierte AndroidManifest.xml passt nicht zum Profil "${summary.buildProfile}":\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}
process.stdout.write('Das generierte AndroidManifest.xml entspricht dem Buildprofil.\n');
