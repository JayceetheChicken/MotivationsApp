#!/usr/bin/env node
/**
 * Validates npm install hooks before they execute and, when explicitly asked,
 * rebuilds only the exact reviewed packages applicable to this runner.
 *
 *   node scripts/check-install-scripts.mjs --check-lock
 *   npm ci --ignore-scripts
 *   node scripts/check-install-scripts.mjs --rebuild
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const policy = require('./lib/install-script-policy.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? '--check-lock';

if (!['--check-lock', '--rebuild'].includes(mode) || process.argv.length > 3) {
  process.stderr.write(
    'Aufruf: node scripts/check-install-scripts.mjs [--check-lock|--rebuild]\n',
  );
  process.exit(2);
}

const result = mode === '--rebuild'
  ? policy.rebuildVettedPackages(projectRoot)
  : policy.validateProjectPolicy(projectRoot);

if (result.errors.length > 0) {
  process.stderr.write('\nInstall-Skript-Policy verletzt:\n');
  for (const error of result.errors) process.stderr.write(`- ${error}\n`);
  process.stderr.write(
    '\nKeine Lifecycle-Skripte ausfuehren. Pruefe Version, Tarball-Integritaet, Plattform\n'
    + 'und den exakten Hook-Befehl, bevor die Policy bewusst aktualisiert wird.\n',
  );
  process.exit(1);
}

if (mode === '--rebuild') {
  for (const entry of result.rebuilt) {
    process.stdout.write(`Explizit ausgefuehrt: ${entry.name}@${entry.version} (${Object.keys(entry.hooks).join(', ')})\n`);
  }
  process.stdout.write(`${result.rebuilt.length} anwendbare(s) Install-Skript(e) kontrolliert ausgefuehrt.\n`);
} else {
  for (const entry of policy.VETTED_INSTALL_SCRIPTS) {
    process.stdout.write(
      `Freigegeben: ${entry.name}@${entry.version} [${entry.os.join(',') || 'alle OS'}] - ${entry.reason}\n`,
    );
  }
  process.stdout.write('Lockfile-Install-Skript-Policy bestanden.\n');
}
