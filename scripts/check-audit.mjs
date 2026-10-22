#!/usr/bin/env node
/**
 * Runs the production dependency audit and fails on every advisory of at
 * least moderate severity that is not an exact, unexpired entry in
 * scripts/lib/audit-policy.cjs. See docs/dependency-audit.md.
 *
 *   node scripts/check-audit.mjs
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { evaluateAudit } = require('./lib/audit-policy.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// npm exits non-zero whenever it finds advisories; only the JSON matters.
// Windows can only start npm.cmd through a shell; the command is constant.
const options = { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
const audit = process.platform === 'win32'
  ? spawnSync('npm audit --omit=dev --json', { ...options, shell: true })
  : spawnSync('npm', ['audit', '--omit=dev', '--json'], options);

let report = null;
try {
  report = JSON.parse(audit.stdout);
} catch {
  report = null;
}

const { errors, accepted } = evaluateAudit(report);
for (const advisory of accepted) {
  process.stdout.write(
    `Geprüfte Ausnahme bis ${advisory.expires}: ${advisory.package} ${advisory.severity} ${advisory.ghsa}\n`,
  );
}
if (errors.length > 0) {
  process.stderr.write('\nAbhängigkeits-Audit fehlgeschlagen:\n');
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.stderr.write('\nSiehe docs/dependency-audit.md. Keine Ausnahme ohne fehlenden Upstream-Fix ergänzen.\n');
  process.exit(1);
}
process.stdout.write('Abhängigkeits-Audit bestanden.\n');
