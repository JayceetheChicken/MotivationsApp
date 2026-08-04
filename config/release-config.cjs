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

// --- Supabase public key validation ----------------------------------------
//
// The client may only ever carry an anon key. A service_role JWT grants full
// database access and bypasses every RLS policy, so it must be rejected by
// inspecting the decoded payload. Searching the encoded token for the literal
// "service_role" does not work: the payload is Base64URL encoded.
//
// Implemented without atob, Buffer or TextDecoder so the exact same code runs
// in Node, in CI and inside the Hermes bundle.

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Decodes a Base64URL segment to bytes. Returns null for any character outside
 * the alphabet or for a structurally impossible length.
 * @param {string} segment
 * @returns {number[] | null}
 */
function decodeBase64UrlBytes(segment) {
  const cleaned = segment.replace(/=+$/, '');
  if (cleaned.length === 0) return null;
  // A Base64 group of 4 characters carries 3 bytes; a remainder of 1 is invalid.
  if (cleaned.length % 4 === 1) return null;

  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of cleaned) {
    const value = BASE64URL_ALPHABET.indexOf(character);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

/**
 * Strict UTF-8 decoder. Returns null on any malformed sequence, so a payload
 * that is not valid UTF-8 can never reach JSON.parse.
 * @param {readonly number[]} bytes
 * @returns {string | null}
 */
function decodeUtf8(bytes) {
  let result = '';
  for (let index = 0; index < bytes.length;) {
    const byte = bytes[index];
    let codePoint;
    let length;

    if (byte < 0x80) {
      codePoint = byte;
      length = 1;
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = byte & 0x1f;
      length = 2;
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = byte & 0x0f;
      length = 3;
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint = byte & 0x07;
      length = 4;
    } else {
      return null;
    }

    if (index + length > bytes.length) return null;
    for (let offset = 1; offset < length; offset += 1) {
      const continuation = bytes[index + offset];
      if ((continuation & 0xc0) !== 0x80) return null;
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    // Reject overlong encodings, surrogates and out-of-range code points.
    if (length === 2 && codePoint < 0x80) return null;
    if (length === 3 && codePoint < 0x800) return null;
    if (length === 4 && codePoint < 0x10000) return null;
    if (codePoint > 0x10ffff) return null;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;

    result += String.fromCodePoint(codePoint);
    index += length;
  }
  return result;
}

/**
 * Decodes the payload of a JWT without verifying its signature. Signature
 * verification is impossible here and unnecessary: the point is to refuse to
 * ship a key whose own claims say it is privileged.
 * @param {string} token
 * @returns {{ ok: true, payload: Record<string, unknown> } | { ok: false, reason: string }}
 */
function decodeJwtPayload(token) {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return { ok: false, reason: `Ein JWT muss genau drei Segmente haben, gefunden: ${segments.length}.` };
  }
  if (segments.some((segment) => segment.length === 0)) {
    return { ok: false, reason: 'Mindestens ein JWT-Segment ist leer.' };
  }

  const bytes = decodeBase64UrlBytes(segments[1]);
  if (!bytes) return { ok: false, reason: 'Der JWT-Payload ist kein gültiges Base64URL.' };

  const text = decodeUtf8(bytes);
  if (text === null) return { ok: false, reason: 'Der JWT-Payload ist kein gültiges UTF-8.' };

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Der JWT-Payload ist kein gültiges JSON.' };
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'Der JWT-Payload ist kein JSON-Objekt.' };
  }
  return { ok: true, payload };
}

/** The only role a key embedded in the app may carry. */
const ALLOWED_JWT_ROLE = 'anon';
const FORBIDDEN_JWT_ROLE = 'service_role';

/**
 * Single source of truth for "may this key be shipped inside the app?".
 * Used by the release gate, the Expo config, the bundle scan and the app's own
 * runtime configuration check.
 * @param {string} value
 * @returns {{ valid: boolean, kind: string, reason: string }}
 */
function classifySupabasePublicKey(value) {
  const key = String(value ?? '').trim();

  if (!key) {
    return { valid: false, kind: 'missing', reason: 'Es ist kein öffentlicher Supabase-Key gesetzt.' };
  }
  if (key.startsWith('sb_secret_')) {
    return {
      valid: false,
      kind: 'secret-key',
      reason: 'Das ist ein Supabase-Secret-Key. Ein Secret- oder service_role-Key darf niemals in die App gelangen.',
    };
  }
  if (key.startsWith('sb_publishable_')) {
    return key.length > 'sb_publishable_'.length
      ? { valid: true, kind: 'publishable', reason: 'Publishable Key.' }
      : { valid: false, kind: 'publishable-empty', reason: 'Der Publishable Key besteht nur aus dem Präfix.' };
  }

  const decoded = decodeJwtPayload(key);
  if (!decoded.ok) {
    return { valid: false, kind: 'malformed-jwt', reason: decoded.reason };
  }

  const role = decoded.payload.role;
  if (typeof role !== 'string' || role.length === 0) {
    return {
      valid: false,
      kind: 'jwt-role-missing',
      reason: 'Der JWT enthält kein role-Feld. Nur ein Anon-Key darf ausgeliefert werden.',
    };
  }
  if (role === FORBIDDEN_JWT_ROLE) {
    return {
      valid: false,
      kind: 'jwt-service-role',
      reason: 'Der JWT trägt die Rolle service_role. Dieser Key umgeht jede RLS-Policy und darf niemals in die App gelangen.',
    };
  }
  if (role !== ALLOWED_JWT_ROLE) {
    return {
      valid: false,
      kind: 'jwt-role-unknown',
      reason: `Der JWT trägt die unbekannte Rolle „${role}“. Erlaubt ist ausschließlich „${ALLOWED_JWT_ROLE}“.`,
    };
  }
  return { valid: true, kind: 'anon-jwt', reason: 'Anon-JWT.' };
}

/** Convenience wrapper for callers that only need a yes/no answer. */
function isShippableSupabasePublicKey(value) {
  return classifySupabasePublicKey(value).valid;
}

// --- Embedded JWT detection in built artefacts ------------------------------
//
// A JWT inside an export never appears as readable JSON, so grepping for
// "role":"service_role" finds nothing. Instead every JWT-shaped candidate is
// located and decoded with the same decoder used above.
//
// The candidate pattern is deliberately narrow: the first segment must start
// with "eyJ", which is the Base64URL encoding of the two characters `{"` that
// begin every JOSE header. A candidate is only ever reported once its payload
// really decodes to a JSON object, so ordinary Base64 blobs, hashes and
// minified identifiers cannot be mistaken for a token.

/** Fresh regex per call: a shared /g regex would carry lastIndex between scans. */
function jwtCandidatePattern() {
  return /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
}

/**
 * All JWT-shaped substrings of a text, de-duplicated.
 * @param {string} text
 * @returns {string[]}
 */
function findJwtCandidates(text) {
  return [...new Set(String(text ?? '').match(jwtCandidatePattern()) ?? [])];
}

/**
 * Verdict for a token found inside a built artefact.
 *
 * `isJwt: false` means the candidate did not decode to a JSON object and is
 * therefore not a token at all — no finding is raised for it.
 * @param {string} token
 * @returns {{ isJwt: boolean, allowed: boolean, role: string | null, reason: string }}
 */
function classifyEmbeddedJwt(token) {
  const decoded = decodeJwtPayload(token);
  if (!decoded.ok) {
    return { isJwt: false, allowed: true, role: null, reason: decoded.reason };
  }

  const role = typeof decoded.payload.role === 'string' ? decoded.payload.role : null;
  if (role === ALLOWED_JWT_ROLE) {
    return { isJwt: true, allowed: true, role, reason: 'Anon-JWT, im Client erlaubt.' };
  }
  if (role === FORBIDDEN_JWT_ROLE) {
    return {
      isJwt: true,
      allowed: false,
      role,
      reason: 'Eingebetteter JWT mit der Rolle service_role. Dieser Key umgeht jede RLS-Policy.',
    };
  }
  return {
    isJwt: true,
    allowed: false,
    role,
    reason: role === null
      ? 'Eingebetteter JWT ohne role-Feld. Nur ein Anon-JWT darf im Bundle liegen.'
      : `Eingebetteter JWT mit der Rolle „${role}“. Erlaubt ist ausschließlich „${ALLOWED_JWT_ROLE}“.`,
  };
}

/**
 * EAS build profiles that are known to be non-production. Only these may skip
 * the release gate; anything unknown is treated as production.
 */
const NON_PRODUCTION_PROFILES = new Set(['development', 'preview']);

// --- Password recovery callback --------------------------------------------
//
// Exactly one place derives the recovery callback. app.config.js (App Link
// intent filter), src/auth/navigation.ts (the accepted host) and
// resetPasswordForEmail() all read from here, so the domain cannot drift.

const RECOVERY_PATH = '/update-password';
const RECOVERY_QUERY = 'type=recovery';
/** Private scheme callback, used for development, preview and as platform fallback. */
const PASSWORD_RECOVERY_SCHEME_URL = `lernzeit://auth${RECOVERY_PATH}?${RECOVERY_QUERY}`;

function passwordRecoverySchemeUrl() {
  return PASSWORD_RECOVERY_SCHEME_URL;
}

/**
 * The one derivation of the operator host. app.config.js (App Link intent
 * filter), src/legal/operator.ts and the recovery URL below all call this, so
 * no caller can build a second, slightly different host.
 * @param {string} baseUrl
 */
function legalSiteHostFromBaseUrl(baseUrl) {
  const base = normalizeHttpsBaseUrl(baseUrl ?? '');
  if (!base) return DEVELOPMENT_MARKER_DOMAIN;
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return DEVELOPMENT_MARKER_DOMAIN;
  }
}

/**
 * Host of the operator domain, or the development marker when none is set.
 * @param {Record<string, string | undefined>} environment
 */
function legalSiteHostFromEnvironment(environment) {
  return legalSiteHostFromBaseUrl(environment.EXPO_PUBLIC_LEGAL_SITE_URL ?? '');
}

/**
 * Verified HTTPS App Link callback on the operator domain, or null when no
 * usable domain is configured.
 * @param {Record<string, string | undefined>} environment
 */
function passwordRecoveryHttpsUrl(environment) {
  const base = normalizeHttpsBaseUrl(environment.EXPO_PUBLIC_LEGAL_SITE_URL ?? '');
  if (!base) return null;
  const host = legalSiteHostFromEnvironment(environment);
  if (host === DEVELOPMENT_MARKER_DOMAIN || isPlaceholderValue(host)) return null;
  // Always the bare origin plus the fixed path: the parser accepts nothing else.
  return `https://${host}${RECOVERY_PATH}?${RECOVERY_QUERY}`;
}

/**
 * The redirect handed to Supabase `resetPasswordForEmail`.
 *
 * A verified Android App Link is preferred because it cannot be hijacked by
 * another app that claims the same custom scheme. The private scheme remains
 * the fallback whenever no verified domain exists, which is exactly the
 * development and preview case; a production build cannot reach that branch
 * because the release gate refuses to build without a real domain.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {{ url: string, kind: 'https-app-link' | 'custom-scheme' }}
 */
function recoveryRedirectUrl(environment) {
  const https = passwordRecoveryHttpsUrl(environment);
  return https
    ? { url: https, kind: 'https-app-link' }
    : { url: PASSWORD_RECOVERY_SCHEME_URL, kind: 'custom-scheme' };
}

/**
 * A production build must reach the app through a verified HTTPS App Link.
 * The private scheme can be claimed by any other installed app, so a recovery
 * mail that carries `lernzeit://` is a genuine account-takeover risk. This is a
 * release blocker in its own right and not merely a consequence of the missing
 * legal site URL, so the report states the actual danger.
 * @param {Record<string, string | undefined>} environment
 */
function collectRecoveryReleaseIssues(environment) {
  if (passwordRecoveryHttpsUrl(environment)) return [];
  return [{
    key: 'passwordRecoveryRedirect',
    envVar: 'EXPO_PUBLIC_LEGAL_SITE_URL',
    label: 'Passwort-Recovery-Callback',
    reason: 'missing',
    detail:
      'Ohne echte Betreiberdomain fällt resetPasswordForEmail auf das private Schema '
      + `${PASSWORD_RECOVERY_SCHEME_URL} zurück. Ein Production-Build darf das nie tun, weil `
      + 'jede andere installierte App dasselbe Schema beanspruchen kann.',
  }];
}

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
  } else {
    const classification = classifySupabasePublicKey(publicKey);
    if (!classification.valid) {
      issues.push({
        key: 'supabasePublicKey',
        envVar: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        label: 'Supabase Publishable- beziehungsweise Anon-Key',
        reason: 'invalid-format',
        // The concrete reason matters here: "service_role" and "typo in the key"
        // need very different responses from the operator.
        detail: classification.reason,
      });
    }
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
    ...collectRecoveryReleaseIssues(environment),
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
 *
 * Exact truth table (SKIP = LERNZEIT_SKIP_RELEASE_GATE=1, GATE =
 * LERNZEIT_RELEASE_GATE=1). `__tests__/release-scripts.test.ts` asserts every
 * row of this table.
 *
 *   GATE | EAS_BUILD | EAS_BUILD_PROFILE | SKIP | result   | rule
 *   -----+-----------+-------------------+------+----------+-----
 *    1   |  any      | any               |  1   | ENFORCED |  1
 *    -   |  any      | production        |  1   | ENFORCED |  1
 *    -   |  true     | (empty)           |  1   | ENFORCED |  1
 *    -   |  any      | development       |  1   | skipped  |  2
 *    -   |  any      | preview           |  1   | skipped  |  2
 *    -   |  any      | staging (unknown) |  1   | ENFORCED |  2
 *    -   |  false    | (empty)           |  -   | skipped  |  3
 *    -   |  false    | development       |  -   | skipped  |  4
 *    -   |  false    | preview           |  -   | skipped  |  4
 *    -   |  false    | staging (unknown) |  -   | ENFORCED |  4
 *    -   |  true     | development       |  -   | skipped  |  4
 *    -   |  true     | preview           |  -   | skipped  |  4
 *
 * Two properties matter and are tested individually:
 *   - LERNZEIT_SKIP_RELEASE_GATE can never disable the gate for a build that
 *     identifies itself as production.
 *   - A bare `development`/`preview` profile without EAS_BUILD=true does not
 *     simulate production; only an unknown profile does, because an unknown
 *     profile must block rather than silently release.
 *
 * @param {Record<string, string | undefined>} environment
 */
function isProductionRelease(environment) {
  const profile = environment.EAS_BUILD_PROFILE?.trim() ?? '';
  const isEasBuild = environment.EAS_BUILD === 'true';

  // 1. Any positive production signal wins unconditionally. LERNZEIT_SKIP_RELEASE_GATE
  //    is deliberately evaluated later: a build that identifies itself as
  //    production must never be able to opt out of the gate.
  if (environment.LERNZEIT_RELEASE_GATE === '1') return true;
  if (profile === 'production') return true;
  if (isEasBuild && profile === '') return true;

  // 2. The escape hatch works only in an unambiguous non-production context.
  //    With an unknown or missing profile it does nothing, so a stray
  //    LERNZEIT_SKIP_RELEASE_GATE cannot disable the gate somewhere unexpected.
  if (environment.LERNZEIT_SKIP_RELEASE_GATE === '1') {
    return !NON_PRODUCTION_PROFILES.has(profile);
  }

  // 3. No build context and no flags: an ordinary local development run.
  if (!isEasBuild && profile === '') return false;

  // 4. Any remaining build is gated unless its profile is explicitly known to
  //    be non-production. An unknown profile blocks rather than silently
  //    releasing.
  return !NON_PRODUCTION_PROFILES.has(profile);
}

module.exports = {
  OPERATOR_FIELDS,
  DEVELOPMENT_MARKER_DOMAIN,
  PLACEHOLDER_PATTERNS,
  NON_PRODUCTION_PROFILES,
  ALLOWED_JWT_ROLE,
  FORBIDDEN_JWT_ROLE,
  isPlaceholderValue,
  normalizeHttpsBaseUrl,
  decodeJwtPayload,
  classifySupabasePublicKey,
  isShippableSupabasePublicKey,
  findJwtCandidates,
  classifyEmbeddedJwt,
  resolveOperatorValues,
  collectOperatorReleaseIssues,
  collectSupabaseReleaseIssues,
  collectRecoveryReleaseIssues,
  collectReleaseBlockers,
  formatReleaseBlockerReport,
  isProductionRelease,
  recoveryRedirectUrl,
  passwordRecoveryHttpsUrl,
  passwordRecoverySchemeUrl,
  legalSiteHostFromEnvironment,
  legalSiteHostFromBaseUrl,
};
