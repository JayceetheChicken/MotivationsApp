#!/usr/bin/env node
/**
 * Fails unless the APK carries exactly the expected release signer.
 *
 *   node scripts/check-apk-signer.mjs <apksigner> <apk> <expected-sha256>
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkApkSigner } = require('./lib/apk-signer-check.cjs');

const [apksigner, apk, expected] = process.argv.slice(2);
if (!apksigner || !apk || process.argv.length !== 5) {
  process.stderr.write('Aufruf: node scripts/check-apk-signer.mjs <apksigner> <apk> <expected-sha256>\n');
  process.exit(2);
}

const result = spawnSync(apksigner, ['verify', '--print-certs', apk], { encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(`apksigner verify fehlgeschlagen:\n${result.error?.message ?? (result.stderr || result.stdout)}\n`);
  process.exit(1);
}

const { errors, digests } = checkApkSigner(result.stdout, expected);
if (errors.length > 0) {
  process.stderr.write('\nAPK-Signatur abgelehnt:\n');
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exit(1);
}
process.stdout.write(`APK-Signer bestätigt: ${digests[0]}\n`);
