#!/usr/bin/env node
/**
 * Release gate for production builds.
 *
 * Fails when any mandatory operator, legal or Supabase value is missing, is
 * still a placeholder such as example.invalid / your-project-id / [KONTAKT], or
 * when a tracked source file still carries a production placeholder.
 *
 * Usage:
 *   node scripts/check-release-config.mjs            # gate only when building for production
 *   node scripts/check-release-config.mjs --production   # always enforce the full gate
 *   node scripts/check-release-config.mjs --report       # list every field and its state
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const releaseConfig = require('../config/release-config.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));
const forceProduction = argv.has('--production');
const reportOnly = argv.has('--report');

const environment = process.env;
const enforce = forceProduction || releaseConfig.isProductionRelease(environment);

/**
 * Files that must never ship a placeholder. Generated artefacts are listed here
 * so a stale generated file cannot silently reintroduce a placeholder domain.
 */
const PRODUCTION_SOURCE_FILES = [
  'app.json',
  'public/account-deletion/index.html',
  'public/.well-known/assetlinks.json',
  'supabase/config.toml',
];

/** Literal tokens that are release blockers wherever they appear. */
const FORBIDDEN_TOKENS = [
  'example.invalid',
  'your-project-id',
  'your_public_key',
  'your_public_anon_key',
  '[NAME/FIRMA]',
  '[KONTAKT]',
  '[ANSCHRIFT]',
  '[ADRESSE]',
  '[SUPPORT-KONTAKT]',
  '[BESCHWERDEKONTAKT]',
  '[DATUM EINFÜGEN]',
];

function scanProductionSources() {
  const findings = [];
  for (const relative of PRODUCTION_SOURCE_FILES) {
    let content;
    try {
      content = readFileSync(path.join(projectRoot, relative), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const token of FORBIDDEN_TOKENS) {
        if (line.includes(token)) {
          findings.push({
            envVar: `${relative}:${index + 1}`,
            label: 'Platzhalter in einer produktionsrelevanten Datei',
            reason: 'placeholder',
            detail: `Enthält „${token}“.`,
          });
        }
      }
      // Bracket placeholders in the German legal wording, e.g. [KONTAKT-E-MAIL EINFÜGEN].
      const bracket = line.match(/\[[A-ZÄÖÜ][^\]]{3,}\]/);
      if (bracket) {
        findings.push({
          envVar: `${relative}:${index + 1}`,
          label: 'Rechtlicher Platzhalter',
          reason: 'placeholder',
          detail: `Enthält „${bracket[0]}“.`,
        });
      }
    });
  }
  return findings;
}

function printReport() {
  const values = releaseConfig.resolveOperatorValues(environment);
  const issues = releaseConfig.collectReleaseBlockers(environment);
  const blocked = new Map(issues.map((issue) => [issue.envVar, issue]));

  process.stdout.write('Betreiber- und Release-Konfiguration\n');
  process.stdout.write(`${'-'.repeat(72)}\n`);
  for (const field of releaseConfig.OPERATOR_FIELDS) {
    const issue = blocked.get(field.envVar);
    const state = issue ? (issue.reason === 'missing' ? 'FEHLT' : issue.reason === 'placeholder' ? 'PLATZHALTER' : 'FORMAT') : 'OK';
    const shown = values[field.key] || '(leer)';
    process.stdout.write(`[${state.padEnd(11)}] ${field.envVar}\n`);
    process.stdout.write(`               ${field.label}\n`);
    process.stdout.write(`               Aktuell: ${shown}\n`);
  }
  process.stdout.write(`${'-'.repeat(72)}\n`);
  process.stdout.write(`Offene Pflichtangaben: ${issues.length}\n`);
}

const issues = [
  ...releaseConfig.collectReleaseBlockers(environment),
  ...(enforce ? scanProductionSources() : []),
];

if (reportOnly) {
  printReport();
  const sourceFindings = scanProductionSources();
  if (sourceFindings.length > 0) {
    process.stdout.write('\nPlatzhalter in produktionsrelevanten Dateien:\n');
    for (const finding of sourceFindings) {
      process.stdout.write(`- ${finding.envVar}: ${finding.detail}\n`);
    }
  }
  process.exit(0);
}

if (!enforce) {
  process.stdout.write(
    issues.length === 0
      ? 'Release-Gate: Entwicklungsmodus, alle Betreiberangaben sind bereits vollständig.\n'
      : `Release-Gate: Entwicklungsmodus. ${issues.length} Pflichtangabe(n) sind noch Testwerte; Production-Builds werden damit blockiert.\n`,
  );
  process.exit(0);
}

if (issues.length > 0) {
  process.stderr.write(`${releaseConfig.formatReleaseBlockerReport(issues)}\n`);
  process.exit(1);
}

process.stdout.write('Release-Gate bestanden: alle Betreiber-, Rechts- und Supabase-Pflichtangaben sind gesetzt.\n');
