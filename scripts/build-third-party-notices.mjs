#!/usr/bin/env node
/**
 * Builds THIRD_PARTY_NOTICES.md from the packages that actually reach the
 * production artefact.
 *
 *   node scripts/build-third-party-notices.mjs           # regenerate
 *   node scripts/build-third-party-notices.mjs --check    # fail when stale
 *
 * The inventory is read straight from package-lock.json (every entry that is not
 * marked `dev`), which is deterministic, works offline and needs no npm
 * subprocess. For every package the real LICENSE text shipped in node_modules is
 * embedded, because permissive licences such as MIT, BSD and Apache-2.0 all
 * require the copyright notice to travel with the binary.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const target = path.join(projectRoot, 'THIRD_PARTY_NOTICES.md');

/** Licences that may ship without further review. */
const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

/** Copyleft licences that must never appear in a linked mobile artefact. */
const FORBIDDEN_LICENSES = new Set([
  'AGPL-1.0-only', 'AGPL-1.0-or-later', 'AGPL-3.0-only', 'AGPL-3.0-or-later',
  'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'SSPL-1.0', 'BUSL-1.1', 'Commons-Clause',
]);

const LICENSE_FILE_PATTERN = /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[.-].*)?$/i;

function readPackageManifest(relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(projectRoot, relativePath, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every package-lock entry that is reachable without devDependencies, i.e. the
 * exact set `npm ci --omit=dev` would install.
 */
function collectProductionPackages() {
  const lock = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const seen = new Map();

  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    if (location === '' || entry.dev === true || entry.extraneous === true) continue;
    if (!location.includes('node_modules/')) continue;

    const name = entry.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const version = entry.version ?? 'unbekannt';
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;

    // Packages restricted to a specific os/cpu are only installed on matching
    // platforms. Reading their local files would make the generated output
    // depend on where it ran, so they are recorded from the lockfile alone.
    const platformSpecific = Boolean(entry.os || entry.cpu);
    const manifest = platformSpecific ? null : readPackageManifest(location);
    seen.set(key, {
      name,
      version,
      license: normalizeLicense(entry.license ?? manifest?.license ?? manifest?.licenses),
      homepage: typeof manifest?.homepage === 'string' ? manifest.homepage : null,
      resolvedPath: platformSpecific ? null : path.join(projectRoot, location),
      platformSpecific,
      platforms: platformSpecific
        ? [...(entry.os ?? []), ...(entry.cpu ?? [])].join(', ')
        : null,
      optional: entry.optional === true,
    });
  }
  return seen;
}

function normalizeLicense(license) {
  if (!license) return 'UNBEKANNT';
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) {
    const types = license.map(normalizeLicense).filter((value) => value !== 'UNBEKANNT');
    return types.length > 0 ? types.join(' OR ') : 'UNBEKANNT';
  }
  if (typeof license === 'object' && typeof license.type === 'string') return license.type;
  return 'UNBEKANNT';
}

/** Splits an SPDX expression into the individual identifiers it references. */
function licenseIdentifiers(expression) {
  return expression
    .replaceAll('(', ' ')
    .replaceAll(')', ' ')
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Classifies an SPDX expression. `A OR B` is acceptable as soon as one
 * alternative is allowed, because the licensee picks the alternative. `A AND B`
 * requires every part to be allowed.
 */
function classifyLicense(expression) {
  if (expression === 'UNBEKANNT') return 'unknown';
  const alternatives = expression
    .replaceAll('(', ' ')
    .replaceAll(')', ' ')
    .split(/\s+OR\s+/i)
    .map((value) => value.trim())
    .filter(Boolean);
  if (alternatives.length === 0) return 'unknown';

  const evaluated = alternatives.map((alternative) => {
    const parts = alternative.split(/\s+(?:AND|WITH)\s+/i).map((value) => value.trim()).filter(Boolean);
    if (parts.length === 0) return 'unknown';
    if (parts.some((part) => FORBIDDEN_LICENSES.has(part))) return 'forbidden';
    return parts.every((part) => ALLOWED_LICENSES.has(part)) ? 'allowed' : 'review';
  });

  if (evaluated.includes('allowed')) return 'allowed';
  if (evaluated.every((value) => value === 'forbidden')) return 'forbidden';
  return evaluated.includes('review') ? 'review' : 'unknown';
}

function readLicenseText(packagePath) {
  if (!packagePath) return null;
  let entries;
  try {
    entries = readdirSync(packagePath, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) return null;
  try {
    // Normalize line endings so the generated file is byte-identical whether it
    // was produced on Windows or on a Linux runner.
    const text = readFileSync(path.join(packagePath, files[0]), 'utf8')
      .replaceAll('\r\n', '\n')
      .trim();
    return text.length > 0 ? { file: files[0], text } : null;
  } catch {
    return null;
  }
}

/** Copyright lines are the part that legally must be reproduced. */
function copyrightLines(text) {
  if (!text) return [];
  return [...new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^copyright\b|^\(c\)\s|^©/i.test(line) && line.length < 200),
  )];
}

const packages = [...collectProductionPackages().values()]
  .filter((entry) => entry.name !== 'lernzeit-app')
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const byLicense = new Map();
const unknown = [];
const forbidden = [];
const review = [];

for (const entry of packages) {
  entry.licenseText = readLicenseText(entry.resolvedPath);
  entry.copyrights = copyrightLines(entry.licenseText?.text ?? null);

  const classification = classifyLicense(entry.license);
  if (classification === 'unknown') unknown.push(entry);
  else if (classification === 'forbidden') forbidden.push(entry);
  else if (classification === 'review') review.push(entry);

  const bucket = byLicense.get(entry.license) ?? [];
  bucket.push(entry);
  byLicense.set(entry.license, bucket);
}

const sortedLicenses = [...byLicense.entries()].sort(
  (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
);

const lines = [];
lines.push('# Third-Party-Lizenzen');
lines.push('');
lines.push('<!-- Erzeugt von scripts/build-third-party-notices.mjs. Nicht manuell bearbeiten. -->');
lines.push('<!-- Aktualisieren mit: npm run licenses:build -->');
lines.push('');
lines.push('Diese Datei listet alle Pakete, die laut `package-lock.json` ohne devDependencies in das');
lines.push('Produktionsartefakt von **Lernzeit** einfliessen, inklusive Lizenztyp und der');
lines.push('reproduktionspflichtigen Copyright-Hinweise.');
lines.push('');
lines.push('Der eigene Anwendungscode von Lernzeit wird dadurch **nicht** unter eine');
lines.push('Open-Source-Lizenz gestellt.');
lines.push('');
lines.push('## Zusammenfassung');
lines.push('');
lines.push(`- Erfasste Pakete: **${packages.length}**`);
lines.push(`- Verschiedene Lizenzausdruecke: **${byLicense.size}**`);
lines.push(`- Copyleft-Lizenzen mit Verbot fuer verlinkte Artefakte: **${forbidden.length}**`);
lines.push(`- Lizenzen ohne Freigabe in der Allowlist: **${review.length}**`);
lines.push(`- Pakete ohne erkennbare Lizenzangabe: **${unknown.length}**`);
lines.push('');
lines.push('| Lizenz | Pakete |');
lines.push('| --- | ---: |');
for (const [license, entries] of sortedLicenses) {
  lines.push(`| \`${license}\` | ${entries.length} |`);
}
lines.push('');

if (forbidden.length > 0) {
  lines.push('## Blockierende Lizenzen');
  lines.push('');
  for (const entry of forbidden) lines.push(`- \`${entry.name}@${entry.version}\` - ${entry.license}`);
  lines.push('');
}
if (review.length > 0) {
  lines.push('## Lizenzen mit Pruefbedarf');
  lines.push('');
  for (const entry of review) lines.push(`- \`${entry.name}@${entry.version}\` - ${entry.license}`);
  lines.push('');
}
if (unknown.length > 0) {
  lines.push('## Pakete ohne Lizenzangabe');
  lines.push('');
  for (const entry of unknown) lines.push(`- \`${entry.name}@${entry.version}\``);
  lines.push('');
}

lines.push('## Reproduktionspflichtige Copyright-Hinweise');
lines.push('');
lines.push('Die folgenden Hinweise stammen aus den LICENSE-Dateien der jeweiligen Pakete in');
lines.push('`node_modules` und muessen mit der Anwendung ausgeliefert werden.');
lines.push('');

for (const entry of packages) {
  lines.push(`### ${entry.name}@${entry.version}`);
  lines.push('');
  lines.push(`- Lizenz: \`${entry.license}\``);
  if (entry.homepage) lines.push(`- Projektseite: ${entry.homepage}`);
  if (entry.platformSpecific) {
    lines.push(`- Plattformspezifisch (${entry.platforms}); Lizenztext liegt im Paket unter \`LICENSE\`.`);
  } else if (entry.licenseText) {
    lines.push(`- Lizenzdatei im Paket: \`${entry.licenseText.file}\``);
  }
  if (entry.copyrights.length > 0) {
    lines.push('');
    for (const copyright of entry.copyrights) lines.push(`> ${copyright}`);
  } else if (!entry.platformSpecific) {
    lines.push('- Kein eigener Copyright-Vermerk in der Lizenzdatei gefunden.');
  }
  lines.push('');
}

lines.push('## Vollstaendige Lizenztexte');
lines.push('');
lines.push('Die ungekuerzten Lizenztexte der oben genannten Pakete liegen in den jeweiligen');
lines.push('Paketverzeichnissen unter `node_modules/<paket>/LICENSE` und sind ueber die in');
lines.push('`package-lock.json` festgeschriebenen Versionen und Integrity-Hashes eindeutig');
lines.push('reproduzierbar. Die haeufigsten Lizenztexte sind hier vollstaendig wiedergegeben.');
lines.push('');

const canonicalTexts = new Map();
for (const entry of packages) {
  if (!entry.licenseText) continue;
  const identifiers = licenseIdentifiers(entry.license);
  if (identifiers.length !== 1) continue;
  const [identifier] = identifiers;
  if (canonicalTexts.has(identifier)) continue;
  canonicalTexts.set(identifier, { text: entry.licenseText.text, source: `${entry.name}@${entry.version}` });
}
for (const [identifier, value] of [...canonicalTexts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`### ${identifier}`);
  lines.push('');
  lines.push(`Wortlaut aus \`${value.source}\`:`);
  lines.push('');
  lines.push('```text');
  lines.push(value.text);
  lines.push('```');
  lines.push('');
}

const content = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

if (checkOnly) {
  let current = null;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = null;
  }
  const problems = [];
  if (current !== content) problems.push('THIRD_PARTY_NOTICES.md ist nicht aktuell. "npm run licenses:build" ausfuehren.');
  if (forbidden.length > 0) problems.push(`${forbidden.length} Paket(e) mit blockierender Copyleft-Lizenz gefunden.`);
  if (unknown.length > 0) problems.push(`${unknown.length} Paket(e) ohne erkennbare Lizenzangabe gefunden.`);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    for (const entry of [...forbidden, ...unknown]) {
      process.stderr.write(`- ${entry.name}@${entry.version}: ${entry.license}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `Lizenzinventur aktuell: ${packages.length} Produktionspakete, ${byLicense.size} Lizenzausdruecke, `
    + `${review.length} mit Pruefbedarf.\n`,
  );
} else {
  writeFileSync(target, content, 'utf8');
  process.stdout.write(
    `THIRD_PARTY_NOTICES.md geschrieben: ${packages.length} Pakete, ${byLicense.size} Lizenzausdruecke.\n`,
  );
  if (review.length > 0) process.stdout.write(`Pruefbedarf: ${review.map((e) => `${e.name} (${e.license})`).join(', ')}\n`);
  if (unknown.length > 0) process.stdout.write(`Ohne Lizenzangabe: ${unknown.map((e) => e.name).join(', ')}\n`);
}
