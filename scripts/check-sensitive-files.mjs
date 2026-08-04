#!/usr/bin/env node
/**
 * Rejects tracked files whose *name* alone says they must not be in the
 * repository: signing keys, service-account JSON, dotenv files, database dumps.
 *
 * The rules live in scripts/lib/sensitive-files.cjs so the Jest suite can test
 * every filename case directly.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findSensitiveTrackedPaths } = require('./lib/sensitive-files.cjs');

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbidden = findSensitiveTrackedPaths(tracked);

if (forbidden.length > 0) {
  process.stderr.write('Verbotene sensible Dateinamen sind getrackt:\n');
  for (const finding of forbidden) {
    process.stderr.write(`- ${finding.path} (${finding.rule}: ${finding.description})\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Keine verbotenen sensiblen Dateinamen im Git-Index gefunden (${tracked.length} Dateien geprueft).\n`,
  );
}
