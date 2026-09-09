#!/usr/bin/env node
/**
 * Asserts that the resolved Expo configuration is release-safe.
 *
 *   npx expo config --type public --json > expo-config.json
 *   node scripts/verify-expo-config.mjs expo-config.json
 *
 * Checks the values Google Play binds permanently or rejects at upload time
 * (package name, versionCode, target SDK, backup behaviour) and the password
 * recovery transport of the current build profile: a production manifest must
 * declare the verified HTTPS App Link and must *not* declare a private
 * `lernzeit://auth/update-password` intent filter, while a development or
 * preview manifest must declare exactly the opposite.
 *
 * The checks themselves live in scripts/lib/expo-config-check.cjs so
 * __tests__/release-scripts.test.ts can run them against deliberately broken
 * manifests.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { collectExpoConfigIssues, EXPECTED } = require('./lib/expo-config-check.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.argv[2];
if (!configPath) {
  process.stderr.write('Aufruf: node scripts/verify-expo-config.mjs <expo-config.json>\n');
  process.exit(2);
}

export { EXPECTED };

const raw = JSON.parse(readFileSync(path.resolve(projectRoot, configPath), 'utf8'));
const { failures, notes, summary } = collectExpoConfigIssues(raw, process.env);

for (const note of notes) process.stdout.write(`${note}\n`);
process.stdout.write(
  `Paket: ${summary.androidPackage}  Version: ${summary.version}  versionCode: ${summary.versionCode}\n`,
);
process.stdout.write(
  `targetSdk: ${summary.targetSdkVersion}  minSdk: ${summary.minSdkVersion}\n`,
);
process.stdout.write(
  `Recovery: ${summary.recoveryTransport} -> ${summary.recoveryRedirectUrl}`
  + `  privater Intent-Filter: ${summary.hasPrivateRecoveryFilter ? 'ja' : 'nein'}\n`,
);

if (failures.length > 0) {
  process.stderr.write('\nDie aufgeloeste Expo-Config ist nicht release-tauglich:\n');
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}
process.stdout.write('Expo-Config erfuellt alle Release-Anforderungen.\n');
