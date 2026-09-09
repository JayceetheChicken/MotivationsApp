/**
 * The one place that decides how a password recovery mail gets back into the
 * app, and the only place that may name a recovery URL or the app's URL scheme.
 *
 * Four consumers load this exact file:
 *   - the app bundle, through src/auth/build-configuration.ts (Metro),
 *   - app.config.js, which turns it into the Expo `scheme`, the Android intent
 *     filters and the attestation embedded in the manifest,
 *   - the release gate, the Expo config verifier and the export scanner,
 *   - scripts/verify-native-linking.mjs, which reads the prebuilt
 *     AndroidManifest.xml back.
 *
 * ## The transport is chosen by build profile, never by "is a domain set?"
 *
 * `lernzeit://auth/update-password` is a private URL scheme. Any other installed
 * app may declare the same scheme, and Android will then offer that app when the
 * recovery mail is opened - a complete account takeover with no exploit
 * involved. A verified HTTPS App Link cannot be claimed by a second app, because
 * Android checks `https://<host>/.well-known/assetlinks.json` against the
 * signing certificate before it binds the link.
 *
 * Deriving the transport from "is an operator domain configured?" is *not* the
 * same rule. A development or preview build can legitimately be handed the real
 * operator values, and it would then claim an App Link whose development signing
 * certificate is not listed in the operator's assetlinks.json - an App Link that
 * can never verify, on a build that has no working recovery at all. The profile
 * is therefore the input, and the domain is only a requirement production has:
 *
 *   production  + public domain  → HTTPS App Link
 *   production  + no/private domain → disabled, and the build is aborted
 *   development / preview / local  → private scheme, whatever domain is set
 *   unknown or contradictory profile → disabled, and the build is aborted
 *
 * ## The app scheme follows the same split
 *
 * Expo registers `expo.scheme` as a general incoming deep link, so leaving
 * `lernzeit` in a production manifest would keep `lernzeit://auth/update-password`
 * openable even after the specific recovery intent filter is gone. Production
 * therefore registers no `lernzeit` scheme at all; Expo falls back to the Android
 * package name, which the recovery parser does not accept as a transport.
 * Development and preview keep the scheme, because `npx expo start` and the
 * development client need one.
 */

const publicHost = require('./public-host.cjs');

/** Fixed route of the recovery callback on every transport. */
const RECOVERY_PATH = '/update-password';
const RECOVERY_QUERY = 'type=recovery';

/**
 * The app's private URL scheme. Registered in development and preview builds
 * only - deliberately absent from a production manifest, both as the general
 * Expo scheme and as a recovery transport.
 */
const APP_SCHEME = 'lernzeit';

/** Host segment of the private recovery URL, i.e. `lernzeit://auth/...`. */
const CUSTOM_RECOVERY_HOST = 'auth';
const CUSTOM_RECOVERY_URL = `${APP_SCHEME}://${CUSTOM_RECOVERY_HOST}${RECOVERY_PATH}?${RECOVERY_QUERY}`;

/**
 * Every build profile the app knows.
 *
 * `local` is the honest name for "someone ran `npx expo start` or a unit test":
 * there is no EAS profile, and the build behaves like development.
 * `invalid` is not a profile a build may have - it is what an unknown or
 * contradictory configuration resolves to, so the abort has something to name.
 */
const BUILD_PROFILES = Object.freeze(['production', 'development', 'preview', 'local']);
const NON_PRODUCTION_BUILD_PROFILES = Object.freeze(['development', 'preview', 'local']);
const INVALID_BUILD_PROFILE = 'invalid';

/**
 * Marker of the serialised build configuration that app.config.js embeds into
 * `extra` and that the app reads back at runtime.
 *
 * Deliberately a flat string with no quotes, whitespace or backslashes: it
 * survives JSON escaping unchanged, so the export scanner can locate it with one
 * regex regardless of how the bundler quotes or minifies the manifest.
 */
const AUTH_BUILD_ATTESTATION_PREFIX = 'lernzeit.auth-build/v1';
const AUTH_BUILD_ATTESTATION_PATTERN = /lernzeit\.auth-build\/v1(?:;[a-zA-Z]+=[^;"'\\\s]*)+;end/g;

/** Exactly the fields an attestation may carry - no more, no fewer. */
const ATTESTATION_FIELDS = Object.freeze([
  'profile',
  'transport',
  'host',
  'appLinkHost',
  'customScheme',
  'schemeFilter',
  'url',
]);

// --- Build profile -----------------------------------------------------------

/**
 * @typedef {'production' | 'development' | 'preview' | 'local'} BuildProfile
 * @typedef {{ profile: BuildProfile | 'invalid', source: string, issue: string | null }} ResolvedBuildProfile
 */

/**
 * The build profile of the current invocation.
 *
 * `EXPO_PUBLIC_BUILD_PROFILE` is the authoritative input because it is the only
 * one Metro can inline into the JavaScript bundle - `EAS_BUILD_PROFILE` exists
 * on the build machine but never inside the artefact, so the running app could
 * not otherwise tell which profile produced it. The profile is not a secret; it
 * describes the build, not the operator.
 *
 * Both variables are read so a mismatch is caught rather than silently resolved
 * in favour of one of them: an EAS `production` build whose public profile still
 * says `development` would ship a private-scheme recovery transport under a
 * production signing key.
 *
 * Never throws - callers that must abort inspect `issue`. Throwing here would
 * take down the app at module load in the one case (a tampered bundle) where a
 * clean, closed failure matters most.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {ResolvedBuildProfile}
 */
function resolveBuildProfile(environment) {
  const env = environment ?? {};
  const publicProfile = String(env.EXPO_PUBLIC_BUILD_PROFILE ?? '').trim();
  const easProfile = String(env.EAS_BUILD_PROFILE ?? '').trim();

  const unknown = [
    ['EXPO_PUBLIC_BUILD_PROFILE', publicProfile],
    ['EAS_BUILD_PROFILE', easProfile],
  ].filter(([, value]) => value && !BUILD_PROFILES.includes(value));

  if (unknown.length > 0) {
    return {
      profile: INVALID_BUILD_PROFILE,
      source: 'unknown-profile',
      issue: `${unknown.map(([name, value]) => `${name}="${value}"`).join(' und ')} `
        + `${unknown.length > 1 ? 'sind keine bekannten Buildprofile' : 'ist kein bekanntes Buildprofil'}. `
        + `Erlaubt sind: ${BUILD_PROFILES.join(', ')}.`,
    };
  }

  if (publicProfile && easProfile && publicProfile !== easProfile) {
    return {
      profile: INVALID_BUILD_PROFILE,
      source: 'conflicting-profile',
      issue: `EXPO_PUBLIC_BUILD_PROFILE="${publicProfile}" und EAS_BUILD_PROFILE="${easProfile}" `
        + 'widersprechen sich. Das eingebettete Profil und das Buildprofil muessen identisch sein, '
        + 'sonst beschreibt das Bundle ein anderes Profil als der Build.',
    };
  }

  if (publicProfile) return { profile: publicProfile, source: 'EXPO_PUBLIC_BUILD_PROFILE', issue: null };
  if (easProfile) return { profile: easProfile, source: 'EAS_BUILD_PROFILE', issue: null };

  // No profile was declared. A build that identifies itself as a release through
  // the gate flags is production; everything else is an ordinary local start.
  if (env.LERNZEIT_RELEASE_GATE === '1') {
    return { profile: 'production', source: 'LERNZEIT_RELEASE_GATE', issue: null };
  }
  if (env.EAS_BUILD === 'true') {
    return { profile: 'production', source: 'EAS_BUILD', issue: null };
  }
  return { profile: 'local', source: 'default', issue: null };
}

/** @param {Record<string, string | undefined>} environment */
function buildProfile(environment) {
  return resolveBuildProfile(environment).profile;
}

// --- Operator domain ---------------------------------------------------------

/**
 * The authority part of an `https://` URL, taken from the raw string *before*
 * any URL parser sees it.
 *
 * Node's `new URL()` performs IDNA and rewrites every legal IPv4 spelling; the
 * React Native URL polyfill does neither. Reading the host out of the parsed URL
 * would therefore classify `https://bücher.de` and `https://2130706433`
 * differently in CI than in the app. The raw authority is the only value that is
 * identical everywhere.
 *
 * @param {string} value
 * @returns {string | null}
 */
function rawAuthority(value) {
  const match = /^https:\/\/([^/?#]*)/i.exec(String(value ?? '').trim());
  return match ? match[1] : null;
}

/**
 * Accepts only a clean HTTPS origin with an optional base path *on a public
 * operator domain*. Returns null for anything that must not become a public
 * legal, recovery or Android App Links base.
 *
 * The returned origin is rebuilt from {@link publicHost.canonicalHost}, not from
 * `parsed.origin`: a trailing dot (`https://lernzeit.de.`) is a distinct host in
 * DNS, survives `new URL()` untouched and would produce an App Link host that no
 * assetlinks.json matches.
 *
 * @param {string} value
 * @returns {string | null}
 */
function normalizePublicHttpsBaseUrl(value) {
  const text = String(value ?? '').trim();

  // Refuse non-ASCII before any parser can apply IDNA. The operator has to
  // configure the punycode ("xn--…") form, which is unambiguous in Node, in
  // Hermes and in the React Native polyfill alike.
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(text)) return null;

  const authority = rawAuthority(text);
  if (authority === null) return null;
  // Credentials and ports are rejected below as well, but the raw authority must
  // not be handed to canonicalHost with them still attached.
  if (authority.includes('@')) return null;
  const host = publicHost.canonicalHost(authority);
  if (!host || !publicHost.isPublicOperatorHost(host)) return null;

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.port
  ) return null;

  // The parser rewrote the host - `2130706433` became `127.0.0.1`, `0x7f.1`
  // became `127.0.0.1`, a Unicode label became punycode. A value whose meaning
  // depends on which URL implementation reads it must never be released, even
  // when both readings would happen to be rejected here.
  if (publicHost.canonicalHost(parsed.hostname) !== host) return null;

  return `https://${host}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Host of the operator domain, or null when none is configured or the
 * configured one is not publicly usable.
 * @param {string} baseUrl
 * @returns {string | null}
 */
function publicHostFromBaseUrl(baseUrl) {
  const base = normalizePublicHttpsBaseUrl(baseUrl);
  if (!base) return null;
  // Read back from the canonical host this module produced, never through a
  // second URL parse.
  return base.slice('https://'.length).split('/')[0];
}

/**
 * The verified HTTPS App Link callback, or null when no usable operator domain
 * is configured.
 * @param {Record<string, string | undefined>} environment
 * @returns {string | null}
 */
function passwordRecoveryHttpsUrl(environment) {
  const host = publicHostFromBaseUrl((environment ?? {}).EXPO_PUBLIC_LEGAL_SITE_URL ?? '');
  if (!host) return null;
  // Always the bare origin plus the fixed path: the parser accepts nothing else.
  return `https://${host}${RECOVERY_PATH}?${RECOVERY_QUERY}`;
}

// --- The resolved build configuration ----------------------------------------

/**
 * @typedef {Readonly<{
 *   profile: BuildProfile | 'invalid',
 *   recoveryTransport: 'https-app-link' | 'custom-scheme' | 'disabled',
 *   recoveryRedirectUrl: string,
 *   recoveryHost: string,
 *   androidAppLinkHost: string | null,
 *   acceptsCustomRecoveryScheme: boolean,
 *   registersCustomRecoverySchemeFilter: boolean,
 * }>} AuthBuildConfiguration
 */

/**
 * A configuration with no recovery transport at all.
 *
 * Used instead of flipping individual flags: "recovery is off" is one state, and
 * a caller that forgets to read one boolean should get an empty URL rather than
 * a plausible-looking one.
 *
 * @param {BuildProfile | 'invalid'} profile
 * @returns {AuthBuildConfiguration}
 */
function disabledAuthBuildConfiguration(profile) {
  return Object.freeze({
    profile,
    recoveryTransport: 'disabled',
    recoveryRedirectUrl: '',
    recoveryHost: '',
    androidAppLinkHost: null,
    acceptsCustomRecoveryScheme: false,
    registersCustomRecoverySchemeFilter: false,
  });
}

/**
 * The complete recovery contract of the current build.
 *
 * Everything downstream - `resetPasswordForEmail({ redirectTo })`, the Expo
 * scheme, the Android intent filters and `parsePasswordRecoveryUrl` - reads
 * these fields. They can therefore never describe three different transports.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {AuthBuildConfiguration}
 */
function resolveAuthBuildConfiguration(environment) {
  const env = environment ?? {};
  const { profile, issue } = resolveBuildProfile(env);
  if (issue) return disabledAuthBuildConfiguration(INVALID_BUILD_PROFILE);

  if (profile === 'production') {
    const host = publicHostFromBaseUrl(env.EXPO_PUBLIC_LEGAL_SITE_URL ?? '');
    // No verifiable App Link is possible. Production has no second option, so
    // the configuration is disabled and the release gate aborts the build.
    if (!host) return disabledAuthBuildConfiguration('production');
    return Object.freeze({
      profile,
      recoveryTransport: 'https-app-link',
      recoveryRedirectUrl: `https://${host}${RECOVERY_PATH}?${RECOVERY_QUERY}`,
      recoveryHost: host,
      androidAppLinkHost: host,
      acceptsCustomRecoveryScheme: false,
      registersCustomRecoverySchemeFilter: false,
    });
  }

  // Development, preview and local. Deliberately independent of the configured
  // domain: a development build handed the real operator domain would otherwise
  // claim an App Link its signing certificate cannot verify.
  return Object.freeze({
    profile,
    recoveryTransport: 'custom-scheme',
    recoveryRedirectUrl: CUSTOM_RECOVERY_URL,
    recoveryHost: CUSTOM_RECOVERY_HOST,
    androidAppLinkHost: null,
    acceptsCustomRecoveryScheme: true,
    registersCustomRecoverySchemeFilter: true,
  });
}

/**
 * Whether this profile registers the private `lernzeit` URL scheme at all.
 *
 * Production does not: Expo turns `expo.scheme` into a general incoming deep
 * link, so keeping it would leave `lernzeit://auth/update-password` able to open
 * the app even with the specific recovery intent filter removed.
 *
 * @param {BuildProfile | 'invalid'} profile
 */
function registersAppScheme(profile) {
  return NON_PRODUCTION_BUILD_PROFILES.includes(profile);
}

// --- Per-profile validation --------------------------------------------------

/**
 * Every reason why a configuration must not be shipped as production.
 *
 * Used by the release gate, by scripts/verify-expo-config.mjs, by the export
 * scanner and by scripts/verify-native-linking.mjs, so all of them agree on what
 * "production ready" means.
 *
 * @param {AuthBuildConfiguration} configuration
 * @returns {string[]}
 */
function collectProductionAuthBuildIssues(configuration) {
  const issues = [];
  if (!configuration || typeof configuration !== 'object') {
    return ['Es gibt keine aufgeloeste Auth-Build-Konfiguration.'];
  }
  if (configuration.profile !== 'production') {
    issues.push(
      `Das attestierte Buildprofil ist "${configuration.profile}", erwartet "production". `
      + 'Ein Artefakt darf nicht unter einem anderen Profil ausgeliefert werden, als es gebaut wurde.',
    );
  }
  if (configuration.recoveryTransport !== 'https-app-link') {
    issues.push(
      `Der aktive Recovery-Transport ist "${configuration.recoveryTransport}" `
      + `(${configuration.recoveryRedirectUrl || 'keine URL'}). Ein Production-Build muss "https-app-link" `
      + `verwenden, weil jede andere installierte App ${CUSTOM_RECOVERY_URL} beanspruchen kann.`,
    );
  }
  if (configuration.acceptsCustomRecoveryScheme !== false) {
    issues.push('Der Parser wuerde in diesem Build weiterhin Custom-Scheme-Recovery-Links akzeptieren.');
  }
  if (configuration.registersCustomRecoverySchemeFilter !== false) {
    issues.push(`Das Manifest wuerde weiterhin einen ${APP_SCHEME}://-Recovery-Intent-Filter registrieren.`);
  }
  if (typeof configuration.recoveryHost !== 'string' || !publicHost.isPublicOperatorHost(configuration.recoveryHost)) {
    issues.push(`Der Recovery-Host "${configuration.recoveryHost}" ist keine oeffentlich nutzbare Betreiberdomain.`);
  } else if (configuration.recoveryRedirectUrl
    !== `https://${configuration.recoveryHost}${RECOVERY_PATH}?${RECOVERY_QUERY}`) {
    issues.push(
      `Die Recovery-URL "${configuration.recoveryRedirectUrl}" passt nicht zum Recovery-Host `
      + `"${configuration.recoveryHost}".`,
    );
  }
  if (configuration.androidAppLinkHost !== configuration.recoveryHost) {
    issues.push(
      `Der Android-App-Link-Host "${configuration.androidAppLinkHost}" weicht vom Recovery-Host `
      + `"${configuration.recoveryHost}" ab.`,
    );
  }
  return issues;
}

/**
 * The development/preview counterpart of {@link collectProductionAuthBuildIssues}.
 *
 * Exists for the same reason: the bundle scanner, the attestation reconciliation,
 * the Expo config verifier, the native manifest check and the unit tests must
 * all apply one definition of "a correct non-production build", not five
 * hand-written variants that drift apart.
 *
 * @param {AuthBuildConfiguration} configuration
 * @returns {string[]}
 */
function collectDevelopmentAuthBuildIssues(configuration) {
  const issues = [];
  if (!configuration || typeof configuration !== 'object') {
    return ['Es gibt keine aufgeloeste Auth-Build-Konfiguration.'];
  }
  if (!NON_PRODUCTION_BUILD_PROFILES.includes(configuration.profile)) {
    issues.push(
      `Das attestierte Buildprofil ist "${configuration.profile}", erwartet eines von `
      + `${NON_PRODUCTION_BUILD_PROFILES.join(', ')}.`,
    );
  }
  if (configuration.recoveryTransport !== 'custom-scheme') {
    issues.push(
      `Der Recovery-Transport ist "${configuration.recoveryTransport}", erwartet "custom-scheme" `
      + 'fuer einen Development-, Preview- oder lokalen Build.',
    );
  }
  if (configuration.recoveryRedirectUrl !== CUSTOM_RECOVERY_URL) {
    issues.push(
      `Die Recovery-URL ist "${configuration.recoveryRedirectUrl}", erwartet "${CUSTOM_RECOVERY_URL}".`,
    );
  }
  if (configuration.recoveryHost !== CUSTOM_RECOVERY_HOST) {
    issues.push(`Der Recovery-Host ist "${configuration.recoveryHost}", erwartet "${CUSTOM_RECOVERY_HOST}".`);
  }
  if (configuration.androidAppLinkHost !== null) {
    issues.push(
      'Ohne verifizierbare Betreiberdomain darf kein App-Link-Host attestiert sein, gefunden: '
      + `"${configuration.androidAppLinkHost}".`,
    );
  }
  if (configuration.acceptsCustomRecoveryScheme !== true) {
    issues.push('Ein Development-/Preview-Build muss Custom-Scheme-Recovery-Links akzeptieren.');
  }
  if (configuration.registersCustomRecoverySchemeFilter !== true) {
    issues.push(`Ein Development-/Preview-Build muss den privaten ${APP_SCHEME}://-Recovery-Filter registrieren.`);
  }
  return issues;
}

/**
 * The rules for whichever profile the configuration claims. A configuration with
 * no usable profile is rejected outright rather than silently checked against
 * the development rules.
 *
 * @param {AuthBuildConfiguration} configuration
 * @returns {string[]}
 */
function collectAuthBuildIssues(configuration) {
  if (!configuration || typeof configuration !== 'object') {
    return ['Es gibt keine aufgeloeste Auth-Build-Konfiguration.'];
  }
  if (configuration.profile === 'production') return collectProductionAuthBuildIssues(configuration);
  if (NON_PRODUCTION_BUILD_PROFILES.includes(configuration.profile)) {
    return collectDevelopmentAuthBuildIssues(configuration);
  }
  return [`Das Buildprofil "${configuration.profile}" ist unbekannt; die Konfiguration ist nicht pruefbar.`];
}

// --- Attestation -------------------------------------------------------------

/**
 * Flat, quote-free serialisation of the build configuration.
 * @param {AuthBuildConfiguration} configuration
 * @returns {string}
 */
function serializeAuthBuildConfiguration(configuration) {
  return [
    AUTH_BUILD_ATTESTATION_PREFIX,
    `profile=${configuration.profile}`,
    `transport=${configuration.recoveryTransport}`,
    `host=${configuration.recoveryHost || 'none'}`,
    `appLinkHost=${configuration.androidAppLinkHost ?? 'none'}`,
    `customScheme=${configuration.acceptsCustomRecoveryScheme ? 'on' : 'off'}`,
    `schemeFilter=${configuration.registersCustomRecoverySchemeFilter ? 'on' : 'off'}`,
    `url=${configuration.recoveryRedirectUrl || 'none'}`,
    'end',
  ].join(';');
}

/**
 * Reverses {@link serializeAuthBuildConfiguration}, and refuses anything that is
 * not exactly the shape this module writes.
 *
 * Strictness is the point. The attestation is what a production build is trusted
 * on, so every degree of freedom a lenient parser leaves open - an unknown extra
 * field, a duplicate that silently wins, a transport that disagrees with its own
 * URL - is a way to hand the runtime a configuration no build ever produced.
 *
 * @param {string} attestation
 * @returns {AuthBuildConfiguration | null}
 */
function parseAuthBuildAttestation(attestation) {
  const text = String(attestation ?? '');
  if (!text.startsWith(`${AUTH_BUILD_ATTESTATION_PREFIX};`) || !text.endsWith(';end')) return null;
  // A second marker or a second terminator means two attestations were spliced
  // together; there is then no single statement to trust.
  if (text.indexOf(AUTH_BUILD_ATTESTATION_PREFIX, 1) !== -1) return null;

  const body = text.slice(AUTH_BUILD_ATTESTATION_PREFIX.length + 1, -';end'.length);
  if (!body) return null;

  /** @type {Record<string, string>} */
  const fields = {};
  for (const entry of body.split(';')) {
    const separator = entry.indexOf('=');
    // No `=` at all also catches a stray `end`, i.e. a duplicated terminator.
    if (separator <= 0) return null;
    const key = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    // Duplicate, unknown and empty are all rejected: a lenient parser would let
    // the last duplicate win, which is a way to overwrite an attested value.
    if (Object.prototype.hasOwnProperty.call(fields, key)) return null;
    if (!ATTESTATION_FIELDS.includes(key)) return null;
    if (!value) return null;
    fields[key] = value;
  }
  if (ATTESTATION_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(fields, field))) return null;

  const { profile, transport, host, appLinkHost, customScheme, schemeFilter, url } = fields;
  if (!BUILD_PROFILES.includes(profile)) return null;
  if (transport !== 'https-app-link' && transport !== 'custom-scheme') return null;
  if (customScheme !== 'on' && customScheme !== 'off') return null;
  if (schemeFilter !== 'on' && schemeFilter !== 'off') return null;

  // Internal coherence. Each transport has exactly one legal shape, so a
  // configuration that claims one transport while carrying the other's URL,
  // flags or App Link host is rejected rather than half-honoured.
  if (transport === 'https-app-link') {
    if (customScheme !== 'off' || schemeFilter !== 'off') return null;
    if (appLinkHost !== host) return null;
    if (url !== `https://${host}${RECOVERY_PATH}?${RECOVERY_QUERY}`) return null;
  } else {
    if (customScheme !== 'on' || schemeFilter !== 'on') return null;
    if (appLinkHost !== 'none') return null;
    if (host !== CUSTOM_RECOVERY_HOST) return null;
    if (url !== CUSTOM_RECOVERY_URL) return null;
  }

  return Object.freeze({
    profile,
    recoveryTransport: transport,
    recoveryRedirectUrl: url,
    recoveryHost: host,
    androidAppLinkHost: appLinkHost === 'none' ? null : appLinkHost,
    acceptsCustomRecoveryScheme: customScheme === 'on',
    registersCustomRecoverySchemeFilter: schemeFilter === 'on',
  });
}

/**
 * Every attestation embedded in a built artefact, de-duplicated.
 *
 * A fresh regex per call: a shared /g regex would carry lastIndex between scans.
 * @param {string} text
 * @returns {string[]}
 */
function findAuthBuildAttestations(text) {
  const pattern = new RegExp(AUTH_BUILD_ATTESTATION_PATTERN.source, 'g');
  return [...new Set(String(text ?? '').match(pattern) ?? [])];
}

/**
 * Every recovery callback URL that appears literally in a built artefact,
 * whatever transport it belongs to. Used by the export scanner to prove that no
 * *second* recovery domain was compiled in.
 * @param {string} text
 * @returns {string[]}
 */
function findRecoveryCallbackUrls(text) {
  const pattern = new RegExp(
    `(?:https|${APP_SCHEME})://[a-z0-9.:\\[\\]-]+${RECOVERY_PATH}\\?${RECOVERY_QUERY}`,
    'gi',
  );
  return [...new Set((String(text ?? '').match(pattern) ?? []).map((url) => url.toLowerCase()))];
}

module.exports = {
  APP_SCHEME,
  RECOVERY_PATH,
  RECOVERY_QUERY,
  CUSTOM_RECOVERY_HOST,
  CUSTOM_RECOVERY_URL,
  AUTH_BUILD_ATTESTATION_PREFIX,
  ATTESTATION_FIELDS,
  BUILD_PROFILES,
  NON_PRODUCTION_BUILD_PROFILES,
  INVALID_BUILD_PROFILE,
  resolveBuildProfile,
  buildProfile,
  registersAppScheme,
  normalizePublicHttpsBaseUrl,
  publicHostFromBaseUrl,
  passwordRecoveryHttpsUrl,
  resolveAuthBuildConfiguration,
  disabledAuthBuildConfiguration,
  collectProductionAuthBuildIssues,
  collectDevelopmentAuthBuildIssues,
  collectAuthBuildIssues,
  serializeAuthBuildConfiguration,
  parseAuthBuildAttestation,
  findAuthBuildAttestations,
  findRecoveryCallbackUrls,
};
