/**
 * Single implementation of the operator/release configuration contract.
 *
 * Deliberately CommonJS with no dependencies so that the identical code runs in
 * three places:
 *   - the app bundle (imported by src/legal/operator.ts, bundled by Metro),
 *   - the Expo config (app.config.js, which aborts production builds),
 *   - the release gate (scripts/check-release-config.mjs, used by CI).
 *
 * It never contains operator data. Real values come from EXPO_PUBLIC_* only.
 */

const catalogue = require('./operator-fields.json');

/** @type {readonly {key:string,envVar:string,label:string,requirement:'required'|'optional',kind:'text'|'email'|'https-url'|'iso-date',description:string}[]} */
const OPERATOR_FIELDS = catalogue.fields;

/**
 * Reserved TLD from RFC 2606. Everything derived from it is a development
 * marker that must never survive the production release gate.
 */
const DEVELOPMENT_MARKER_DOMAIN = 'lernzeit.invalid';
const DEVELOPMENT_MARKER_PREFIX = 'Testwert';

/** Values that identify an unfinished configuration entry. */
const PLACEHOLDER_PATTERNS = [
  /\[[^\]]*\]/,
  /(?:^|[@.])(?:invalid|example|test|localhost)(?:$|[.\s/])/i,
  /example\.(?:com|org|net)/i,
  /your[-_]project[-_]id/i,
  /your_public|your_anon/i,
  /platzhalter|entwurfsfassung|testwert|changeme|replace[-_ ]?me/i,
  /\bTODO\b|\bFIXME\b|\bTBD\b/i,
  /einf(?:u|ü)gen|erg(?:a|ä)nzen|noch festzulegen/i,
  /^x{3,}$/i,
  // Epoch zero is the development marker for iso-date fields and is never a
  // legitimate legal effective date.
  /^1970-01-01$/,
];

const EMAIL_PATTERN = /^[^\s@,;<>"']+@[^\s@,;<>"'.]+(?:\.[^\s@,;<>"'.]+)+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} value */
function isPlaceholderValue(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(candidate));
}

/**
 * Accepts only a clean HTTPS origin with an optional base path. Returns null for
 * anything that must not become a public legal or Android App Links base.
 * @param {string} value
 * @returns {string | null}
 */
function normalizeHttpsBaseUrl(value) {
  try {
    const parsed = new URL(String(value ?? '').trim());
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || parsed.port
    ) return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** @param {{key:string,label:string,kind:string}} field */
function developmentValue(field) {
  switch (field.kind) {
    case 'email':
      return `${field.key.toLowerCase()}@${DEVELOPMENT_MARKER_DOMAIN}`;
    case 'https-url':
      return `https://${DEVELOPMENT_MARKER_DOMAIN}`;
    case 'iso-date':
      return '1970-01-01';
    default:
      return `${DEVELOPMENT_MARKER_PREFIX}: ${field.label} (nur Entwicklungsbuild)`;
  }
}

/**
 * Resolves every operator field. Missing required values fall back to clearly
 * marked development values so debug builds stay usable.
 * @param {Record<string, string | undefined>} environment
 * @returns {Record<string, string>}
 */
function resolveOperatorValues(environment) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const field of OPERATOR_FIELDS) {
    const provided = environment[field.envVar]?.trim();
    if (provided) {
      values[field.key] = field.kind === 'https-url'
        ? normalizeHttpsBaseUrl(provided) ?? developmentValue(field)
        : provided;
      continue;
    }
    values[field.key] = field.requirement === 'optional' ? '' : developmentValue(field);
  }
  return values;
}

/** @param {{key:string,envVar:string,label:string,kind:string}} field @param {string} value */
function formatIssue(field, value) {
  const base = { key: field.key, envVar: field.envVar, label: field.label, reason: 'invalid-format' };
  switch (field.kind) {
    case 'email':
      return EMAIL_PATTERN.test(value)
        ? null
        : { ...base, detail: 'Keine gültige E-Mail-Adresse.' };
    case 'https-url':
      return normalizeHttpsBaseUrl(value)
        ? null
        : { ...base, detail: 'Keine saubere HTTPS-Basis-URL ohne Zugangsdaten, Port, Query oder Fragment.' };
    case 'iso-date':
      return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : { ...base, detail: 'Kein gültiges Datum im Format YYYY-MM-DD.' };
    default:
      return null;
  }
}

/**
 * Every reason why the environment must not be released. Empty means all
 * mandatory operator details are present, well formed and real.
 * @param {Record<string, string | undefined>} environment
 */
function collectOperatorReleaseIssues(environment) {
  const issues = [];
  for (const field of OPERATOR_FIELDS) {
    const raw = environment[field.envVar]?.trim() ?? '';
    if (!raw) {
      if (field.requirement === 'required') {
        issues.push({
          key: field.key,
          envVar: field.envVar,
          label: field.label,
          reason: 'missing',
          detail: field.description,
        });
      }
      continue;
    }
    if (isPlaceholderValue(raw)) {
      issues.push({
        key: field.key,
        envVar: field.envVar,
        label: field.label,
        reason: 'placeholder',
        detail: `Der Wert „${raw}“ ist noch ein Platzhalter oder Testwert.`,
      });
      continue;
    }
    const issue = formatIssue(field, raw);
    if (issue) issues.push(issue);
  }
  return issues;
}

/**
 * Supabase must point at a real project over HTTPS with a public key.
 * @param {Record<string, string | undefined>} environment
 */
function collectSupabaseReleaseIssues(environment) {
  const issues = [];
  const url = environment.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const publicKey = (
    environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    || environment.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()
    || ''
  );

  if (!url) {
    issues.push({
      key: 'supabaseUrl',
      envVar: 'EXPO_PUBLIC_SUPABASE_URL',
      label: 'Supabase-Projekt-URL',
      reason: 'missing',
      detail: 'Ohne Projekt-URL sind Registrierung, Login und Kontolöschung deaktiviert.',
    });
  } else if (isPlaceholderValue(url) || !normalizeHttpsBaseUrl(url)) {
    issues.push({
      key: 'supabaseUrl',
      envVar: 'EXPO_PUBLIC_SUPABASE_URL',
      label: 'Supabase-Projekt-URL',
      reason: isPlaceholderValue(url) ? 'placeholder' : 'invalid-format',
      detail: `„${url}“ ist keine echte HTTPS-Projekt-URL.`,
    });
  }

  if (!publicKey) {
    issues.push({
      key: 'supabasePublicKey',
      envVar: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      label: 'Supabase Publishable- beziehungsweise Anon-Key',
      reason: 'missing',
      detail: 'Öffentlicher Client-Key des Produktionsprojekts. Niemals den service_role-Key verwenden.',
    });
  } else if (isPlaceholderValue(publicKey)) {
    issues.push({
      key: 'supabasePublicKey',
      envVar: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      label: 'Supabase Publishable- beziehungsweise Anon-Key',
      reason: 'placeholder',
      detail: 'Der hinterlegte Key ist noch ein Platzhalter.',
    });
  } else if (
    !publicKey.startsWith('sb_publishable_')
    && !/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(publicKey)
  ) {
    issues.push({
      key: 'supabasePublicKey',
      envVar: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      label: 'Supabase Publishable- beziehungsweise Anon-Key',
      reason: 'invalid-format',
      detail: 'Erwartet wird ein sb_publishable_-Key oder ein Anon-JWT.',
    });
  } else if (/service_role/.test(publicKey) || publicKey.startsWith('sb_secret_')) {
    issues.push({
      key: 'supabasePublicKey',
      envVar: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      label: 'Supabase Publishable- beziehungsweise Anon-Key',
      reason: 'invalid-format',
      detail: 'Ein Secret- beziehungsweise service_role-Key darf niemals in die App gelangen.',
    });
  }

  return issues;
}

/**
 * Complete release gate. Empty result means the environment may be built for
 * production.
 * @param {Record<string, string | undefined>} environment
 */
function collectReleaseBlockers(environment) {
  return [
    ...collectOperatorReleaseIssues(environment),
    ...collectSupabaseReleaseIssues(environment),
  ];
}

/** @param {readonly {envVar:string,label:string,reason:string,detail:string}[]} issues */
function formatReleaseBlockerReport(issues) {
  const lines = [
    `Der Production-Build wurde abgebrochen: ${issues.length} Pflichtangabe(n) fehlen oder sind noch Platzhalter.`,
    '',
  ];
  for (const issue of issues) {
    lines.push(`- ${issue.envVar} (${issue.label})`);
    lines.push(`    ${issue.reason === 'missing' ? 'Fehlt' : issue.reason === 'placeholder' ? 'Platzhalter' : 'Ungültiges Format'}: ${issue.detail}`);
  }
  lines.push('');
  lines.push('Setze die Werte als EAS-Environment-Variablen des Profils "production" oder in der lokalen Build-Umgebung.');
  lines.push('Die vollständige Feldliste steht in config/operator-fields.json und docs/operator-configuration.md.');
  return lines.join('\n');
}

/**
 * True when the current invocation must satisfy the production gate.
 * @param {Record<string, string | undefined>} environment
 */
function isProductionRelease(environment) {
  if (environment.LERNZEIT_SKIP_RELEASE_GATE === '1') return false;
  if (environment.LERNZEIT_RELEASE_GATE === '1') return true;
  if (environment.EAS_BUILD_PROFILE === 'production') return true;
  return environment.EAS_BUILD === 'true' && environment.EAS_BUILD_PROFILE !== 'development';
}

module.exports = {
  OPERATOR_FIELDS,
  DEVELOPMENT_MARKER_DOMAIN,
  PLACEHOLDER_PATTERNS,
  isPlaceholderValue,
  normalizeHttpsBaseUrl,
  resolveOperatorValues,
  collectOperatorReleaseIssues,
  collectSupabaseReleaseIssues,
  collectReleaseBlockers,
  formatReleaseBlockerReport,
  isProductionRelease,
};
