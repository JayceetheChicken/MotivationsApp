'use strict';

/**
 * Production dependency audit with an exact, expiring exception list.
 *
 * Every advisory of at least moderate severity fails the check unless an
 * entry below names its GHSA id AND package and has not expired. Unused
 * entries fail too, so the list cannot silently outlive the finding it
 * justified. Only add advisories without any patched upstream release whose
 * vulnerable code is not part of the shipped app bundle.
 */

const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });
const MINIMUM_SEVERITY = 'moderate';

const AUDIT_EXCEPTIONS = Object.freeze([
  Object.freeze({
    ghsa: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    expires: '2026-12-15',
    reason: 'No patched release (<=3.0.3 = latest). Reached only through micromatch in '
      + 'Metro/Jest file matching at build and test time with repository-controlled globs; '
      + 'not bundled into the app.',
  }),
  Object.freeze({
    ghsa: 'GHSA-86w9-cpqp-85rv',
    package: 'node-forge',
    expires: '2026-12-15',
    reason: 'No patched release (<=1.4.0 = latest). Used only by @expo/cli for EAS Update '
      + 'code signing, which this project does not use; not bundled into the app.',
  }),
]);

// Canonical GHSA ids are `GHSA-` followed by lowercase segments.
function normalizeGhsa(id) {
  return `GHSA${String(id).slice(4).toLowerCase()}`;
}

function ghsaFromUrl(url) {
  const match = /\/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$/i.exec(String(url ?? ''));
  return match ? normalizeGhsa(match[1]) : null;
}

/** Unique root advisories (the `via` objects) at or above the threshold. */
function collectAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      const rank = SEVERITY_RANK[via.severity] ?? SEVERITY_RANK.critical;
      if (rank < SEVERITY_RANK[MINIMUM_SEVERITY]) continue;
      const ghsa = ghsaFromUrl(via.url);
      const key = `${ghsa ?? via.url ?? via.source}:${via.name}`;
      if (!advisories.has(key)) {
        advisories.set(key, {
          ghsa,
          package: String(via.name ?? ''),
          severity: String(via.severity ?? 'unknown'),
          range: String(via.range ?? ''),
          title: String(via.title ?? ''),
          url: String(via.url ?? ''),
        });
      }
    }
  }
  return [...advisories.values()];
}

/**
 * @param {unknown} report parsed `npm audit --json` output
 * @param {readonly {ghsa: string, package: string, expires: string}[]} exceptions
 * @param {string} today ISO date (YYYY-MM-DD)
 */
function evaluateAudit(report, exceptions = AUDIT_EXCEPTIONS, today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  const accepted = [];
  if (!report || typeof report !== 'object' || 'error' in report || !report.vulnerabilities) {
    return { errors: ['npm audit lieferte kein auswertbares Ergebnis.'], accepted };
  }
  const used = new Set();
  for (const advisory of collectAdvisories(report)) {
    const exception = advisory.ghsa
      ? exceptions.find((entry) => normalizeGhsa(entry.ghsa) === advisory.ghsa && entry.package === advisory.package)
      : undefined;
    const label = `${advisory.package} ${advisory.severity} ${advisory.ghsa ?? advisory.url} (${advisory.title})`;
    if (!exception) {
      errors.push(`Ungeprüfter Befund: ${label}`);
      continue;
    }
    used.add(exception);
    if (exception.expires < today) {
      errors.push(`Ausnahme abgelaufen am ${exception.expires}: ${label}`);
      continue;
    }
    accepted.push({ ...advisory, expires: exception.expires });
  }
  for (const exception of exceptions) {
    if (!used.has(exception)) {
      errors.push(`Ausnahme ohne Befund entfernen: ${exception.package} ${exception.ghsa}`);
    }
  }
  return { errors, accepted };
}

module.exports = {
  AUDIT_EXCEPTIONS,
  MINIMUM_SEVERITY,
  collectAdvisories,
  evaluateAudit,
};
