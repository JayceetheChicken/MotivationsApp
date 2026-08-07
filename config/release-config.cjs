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
const authBuild = require('./auth-build.cjs');
const publicHost = require('./public-host.cjs');

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
 * True for a syntactically usable unpadded Base64URL segment.
 *
 * A JWT segment is Base64URL without padding, so `=` is rejected outright. A
 * length with remainder 1 modulo 4 cannot be produced by any byte sequence and
 * is therefore structurally impossible, not merely unusual.
 *
 * @param {unknown} segment
 * @returns {boolean}
 */
function isBase64UrlSegment(segment) {
  return typeof segment === 'string'
    && segment.length > 0
    && /^[A-Za-z0-9_-]+$/.test(segment)
    && segment.length % 4 !== 1;
}

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
 * Decodes one Base64URL segment to a JSON object.
 * @param {string} segment
 * @param {string} label
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, reason: string }}
 */
function decodeJsonSegment(segment, label) {
  const bytes = decodeBase64UrlBytes(segment);
  if (!bytes) return { ok: false, reason: `Der JWT-${label} ist kein gültiges Base64URL.` };

  const text = decodeUtf8(bytes);
  if (text === null) return { ok: false, reason: `Der JWT-${label} ist kein gültiges UTF-8.` };

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: `Der JWT-${label} ist kein gültiges JSON.` };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: `Der JWT-${label} ist kein JSON-Objekt.` };
  }
  return { ok: true, value };
}

/**
 * Decodes a JWT without verifying its signature.
 *
 * Signature verification is impossible here (the signing key is server side)
 * and unnecessary for this purpose: the point is to refuse to ship a key whose
 * own claims say it is privileged. What *is* checked is that the token is
 * structurally a JWT in every one of its three segments - header and payload
 * must decode to JSON objects, and the signature must at least be well formed
 * Base64URL. A "token" that fails any of these is not a key, it is noise, and
 * accepting it would mean shipping an unvalidated string as the app's Supabase
 * credential.
 *
 * @param {string} token
 * @returns {{ ok: true, header: Record<string, unknown>, payload: Record<string, unknown> }
 *          | { ok: false, reason: string }}
 */
function decodeJwt(token) {
  const segments = String(token ?? '').split('.');
  if (segments.length !== 3) {
    return { ok: false, reason: `Ein JWT muss genau drei Segmente haben, gefunden: ${segments.length}.` };
  }
  if (segments.some((segment) => segment.length === 0)) {
    return { ok: false, reason: 'Mindestens ein JWT-Segment ist leer.' };
  }
  const invalid = ['Header', 'Payload', 'Signatur'].find(
    (_label, index) => !isBase64UrlSegment(segments[index]),
  );
  if (invalid) {
    return { ok: false, reason: `Das JWT-Segment „${invalid}“ ist kein strukturell gültiges Base64URL.` };
  }

  const header = decodeJsonSegment(segments[0], 'Header');
  if (!header.ok) return header;
  const payload = decodeJsonSegment(segments[1], 'Payload');
  if (!payload.ok) return payload;

  return { ok: true, header: header.value, payload: payload.value };
}

/**
 * Backwards compatible view of {@link decodeJwt} for callers that only need the
 * payload.
 * @param {string} token
 * @returns {{ ok: true, payload: Record<string, unknown> } | { ok: false, reason: string }}
 */
function decodeJwtPayload(token) {
  const decoded = decodeJwt(token);
  return decoded.ok ? { ok: true, payload: decoded.payload } : decoded;
}

/** The only role a key embedded in the app may carry. */
const ALLOWED_JWT_ROLE = 'anon';
const FORBIDDEN_JWT_ROLE = 'service_role';

// --- New-format Supabase API keys -------------------------------------------
//
// Supabase issues `sb_publishable_…` for the client and `sb_secret_…` for
// server-side use; the new keys are not JWTs and carry no decodable claims, so
// the prefix *is* the privilege statement.
// https://supabase.com/docs/guides/api/api-keys
//
// The published documentation fixes the two prefixes but not an exact suffix
// length, so none is invented here. What is checked is everything that can be
// checked without guessing: the exact prefix, a suffix built only from
// URL-safe characters (no whitespace, no dot, no control character, nothing
// that would silently break an HTTP header), and a floor that is far below any
// key Supabase actually issues.

const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_';
const SECRET_KEY_PREFIX = 'sb_secret_';
/** Characters Supabase uses for the random part of a new-format key. */
const NEW_KEY_SUFFIX_PATTERN = /^[A-Za-z0-9_-]+$/;
/**
 * Lower bound, not the real length. Issued keys are considerably longer; this
 * only rejects a truncated or hand-typed value that could never be a key.
 */
const MIN_NEW_KEY_SUFFIX_LENGTH = 16;

/**
 * Classifies a `sb_publishable_…` key.
 * @param {string} key
 * @returns {{ valid: boolean, kind: string, reason: string }}
 */
function classifyPublishableKey(key) {
  const suffix = key.slice(PUBLISHABLE_KEY_PREFIX.length);
  if (suffix.length === 0) {
    return { valid: false, kind: 'publishable-empty', reason: 'Der Publishable Key besteht nur aus dem Präfix.' };
  }
  if (!NEW_KEY_SUFFIX_PATTERN.test(suffix)) {
    return {
      valid: false,
      kind: 'publishable-charset',
      reason: 'Der Publishable Key enthält Zeichen, die Supabase nicht vergibt. '
        + 'Erlaubt sind ausschließlich Buchstaben, Ziffern, Bindestrich und Unterstrich - '
        + 'kein Leerzeichen, kein Punkt, kein Steuerzeichen.',
    };
  }
  if (suffix.length < MIN_NEW_KEY_SUFFIX_LENGTH) {
    return {
      valid: false,
      kind: 'publishable-short',
      reason: `Der Publishable Key ist mit ${suffix.length} Zeichen nach dem Präfix zu kurz, `
        + `erwartet werden mindestens ${MIN_NEW_KEY_SUFFIX_LENGTH}. Der Wert ist vermutlich abgeschnitten.`,
    };
  }
  return { valid: true, kind: 'publishable', reason: 'Publishable Key.' };
}

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
  if (key.startsWith(SECRET_KEY_PREFIX)) {
    return {
      valid: false,
      kind: 'secret-key',
      reason: 'Das ist ein Supabase-Secret-Key. Ein Secret- oder service_role-Key darf niemals in die App gelangen.',
    };
  }
  if (key.startsWith(PUBLISHABLE_KEY_PREFIX)) return classifyPublishableKey(key);

  const decoded = decodeJwt(key);
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
 * Build profiles that are known to be non-production. Only these may skip the
 * release gate; anything unknown is treated as production. Taken from
 * config/auth-build.cjs so the gate and the recovery transport cannot disagree
 * about which profiles exist.
 */
const NON_PRODUCTION_PROFILES = new Set(authBuild.NON_PRODUCTION_BUILD_PROFILES);

// --- Password recovery callback --------------------------------------------
//
// The derivation itself lives in config/auth-build.cjs, which the app bundle
// and app.config.js also load. This module only adds the release-gate view of
// it, so the gate can never disagree with the shipped configuration.

const passwordRecoveryHttpsUrl = authBuild.passwordRecoveryHttpsUrl;
const resolveAuthBuildConfiguration = authBuild.resolveAuthBuildConfiguration;

function passwordRecoverySchemeUrl() {
  return authBuild.CUSTOM_RECOVERY_URL;
}

/**
 * The one derivation of the operator host. app.config.js (App Link intent
 * filter), src/legal/operator.ts and the recovery URL all call this, so no
 * caller can build a second, slightly different host.
 *
 * Returns the development marker whenever the configured value is not a public
 * operator domain, so a private, loopback or reserved host can never end up in
 * an intent filter or on a published page.
 *
 * @param {string} baseUrl
 */
function legalSiteHostFromBaseUrl(baseUrl) {
  return authBuild.publicHostFromBaseUrl(baseUrl ?? '') ?? DEVELOPMENT_MARKER_DOMAIN;
}

/**
 * Host of the operator domain, or the development marker when none is set.
 * @param {Record<string, string | undefined>} environment
 */
function legalSiteHostFromEnvironment(environment) {
  return legalSiteHostFromBaseUrl(environment.EXPO_PUBLIC_LEGAL_SITE_URL ?? '');
}

/**
 * The redirect handed to Supabase `resetPasswordForEmail`, in the shape the
 * older callers expect.
 * @param {Record<string, string | undefined>} environment
 * @returns {{ url: string, kind: 'https-app-link' | 'custom-scheme' }}
 */
function recoveryRedirectUrl(environment) {
  const configuration = resolveAuthBuildConfiguration(environment);
  return { url: configuration.recoveryRedirectUrl, kind: configuration.recoveryTransport };
}

/**
 * An unknown or self-contradictory build profile is a release blocker of its
 * own. It is checked before everything else because every other rule below is
 * expressed *per profile*: a build that cannot say which profile it is cannot be
 * validated at all, and guessing would mean guessing the recovery transport.
 * @param {Record<string, string | undefined>} environment
 */
function collectBuildProfileIssues(environment) {
  const { issue } = authBuild.resolveBuildProfile(environment);
  if (!issue) return [];
  return [{
    key: 'buildProfile',
    envVar: 'EXPO_PUBLIC_BUILD_PROFILE',
    label: 'Buildprofil',
    reason: 'invalid-format',
    detail: issue,
  }];
}

/**
 * A production build must reach the app through a verified HTTPS App Link.
 * The private scheme can be claimed by any other installed app, so a recovery
 * mail that carries the app's own scheme is a genuine account-takeover risk.
 * This is a release blocker in its own right and not merely a consequence of the
 * missing legal site URL, so the report states the actual danger.
 * @param {Record<string, string | undefined>} environment
 */
function collectRecoveryReleaseIssues(environment) {
  const issues = authBuild.collectProductionAuthBuildIssues(
    resolveAuthBuildConfiguration(environment),
  );
  if (issues.length === 0) return [];
  return [{
    key: 'passwordRecoveryRedirect',
    envVar: 'EXPO_PUBLIC_LEGAL_SITE_URL',
    label: 'Passwort-Recovery-Callback',
    reason: 'missing',
    detail: `${issues.join(' ')} Ohne echte, öffentlich erreichbare Betreiberdomain gibt es keinen `
      + 'verifizierbaren App Link, und der Recovery-Link wäre für jede andere installierte App abfangbar.',
  }];
}

/** @param {string} value */
function isPlaceholderValue(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(candidate));
}

/**
 * Accepts only a clean HTTPS origin with an optional base path on a *public*
 * operator domain. Returns null for anything that must not become a public
 * legal, recovery or Android App Links base - including localhost, private and
 * link-local addresses and reserved test domains, which config/public-host.cjs
 * rejects numerically rather than by string prefix.
 * @param {string} value
 * @returns {string | null}
 */
function normalizeHttpsBaseUrl(value) {
  return authBuild.normalizePublicHttpsBaseUrl(value);
}

/**
 * Why an HTTPS base URL is unusable, in one sentence.
 * @param {string} value
 * @returns {string}
 */
function httpsBaseUrlIssueDetail(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    return 'Keine gültige URL.';
  }
  if (parsed.protocol !== 'https:') return 'Nur https:// ist zulässig.';
  if (parsed.username || parsed.password) return 'Zugangsdaten sind in einer öffentlichen Basis-URL nicht zulässig.';
  if (parsed.port) return 'Ein abweichender Port ist nicht zulässig.';
  if (parsed.search || parsed.hash) return 'Query- und Fragmentanteile sind nicht zulässig.';
  return publicHost.publicOperatorHostIssue(parsed.hostname)
    ?? 'Keine saubere HTTPS-Basis-URL ohne Zugangsdaten, Port, Query oder Fragment.';
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
        : { ...base, detail: httpsBaseUrlIssueDetail(value) };
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
      detail: `„${url}“ ist keine echte HTTPS-Projekt-URL. ${httpsBaseUrlIssueDetail(url)}`,
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
    ...collectBuildProfileIssues(environment),
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
 * EXPO_PUBLIC_BUILD_PROFILE joins the table as a second spelling of the profile:
 * it is the variable Metro can inline, so it is the one the built artefact
 * carries. EAS_BUILD_PROFILE still wins when both are set, and
 * config/auth-build.cjs refuses to resolve a build in which the two disagree -
 * which this function reports as "gated" so a contradictory build blocks.
 *
 * @param {Record<string, string | undefined>} environment
 */
function isProductionRelease(environment) {
  // An unknown or self-contradictory profile must never resolve to "skip".
  if (authBuild.resolveBuildProfile(environment).issue) return true;

  const profile = environment.EAS_BUILD_PROFILE?.trim()
    || environment.EXPO_PUBLIC_BUILD_PROFILE?.trim()
    || '';
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
  PUBLISHABLE_KEY_PREFIX,
  SECRET_KEY_PREFIX,
  MIN_NEW_KEY_SUFFIX_LENGTH,
  isPlaceholderValue,
  normalizeHttpsBaseUrl,
  httpsBaseUrlIssueDetail,
  isBase64UrlSegment,
  decodeJwt,
  decodeJwtPayload,
  classifySupabasePublicKey,
  isShippableSupabasePublicKey,
  findJwtCandidates,
  classifyEmbeddedJwt,
  resolveOperatorValues,
  collectOperatorReleaseIssues,
  collectSupabaseReleaseIssues,
  collectRecoveryReleaseIssues,
  collectBuildProfileIssues,
  collectReleaseBlockers,
  formatReleaseBlockerReport,
  isProductionRelease,
  recoveryRedirectUrl,
  passwordRecoveryHttpsUrl,
  passwordRecoverySchemeUrl,
  legalSiteHostFromEnvironment,
  legalSiteHostFromBaseUrl,
  // Auth build configuration and public-host classification, re-exported so the
  // scripts have a single module to require.
  resolveAuthBuildConfiguration,
  resolveBuildProfile: authBuild.resolveBuildProfile,
  buildProfile: authBuild.buildProfile,
  registersAppScheme: authBuild.registersAppScheme,
  collectProductionAuthBuildIssues: authBuild.collectProductionAuthBuildIssues,
  collectDevelopmentAuthBuildIssues: authBuild.collectDevelopmentAuthBuildIssues,
  collectAuthBuildIssues: authBuild.collectAuthBuildIssues,
  serializeAuthBuildConfiguration: authBuild.serializeAuthBuildConfiguration,
  parseAuthBuildAttestation: authBuild.parseAuthBuildAttestation,
  findAuthBuildAttestations: authBuild.findAuthBuildAttestations,
  findRecoveryCallbackUrls: authBuild.findRecoveryCallbackUrls,
  AUTH_BUILD_ATTESTATION_PREFIX: authBuild.AUTH_BUILD_ATTESTATION_PREFIX,
  BUILD_PROFILES: authBuild.BUILD_PROFILES,
  NON_PRODUCTION_BUILD_PROFILES: authBuild.NON_PRODUCTION_BUILD_PROFILES,
  APP_SCHEME: authBuild.APP_SCHEME,
  RECOVERY_PATH: authBuild.RECOVERY_PATH,
  CUSTOM_RECOVERY_HOST: authBuild.CUSTOM_RECOVERY_HOST,
  CUSTOM_RECOVERY_URL: authBuild.CUSTOM_RECOVERY_URL,
  classifyPublicHost: publicHost.classifyPublicHost,
  isPublicOperatorHost: publicHost.isPublicOperatorHost,
  publicOperatorHostIssue: publicHost.publicOperatorHostIssue,
};
