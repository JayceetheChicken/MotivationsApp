/**
 * The one place that decides how a password recovery mail gets back into the
 * app, and the only place that may name a recovery URL.
 *
 * Three consumers load this exact file:
 *   - the app bundle, through src/auth/build-configuration.ts (Metro),
 *   - app.config.js, which turns it into Android intent filters and the
 *     attestation embedded in the manifest,
 *   - the release gate, the Expo config verifier and the export scanner.
 *
 * ## Why the transport is split by build profile
 *
 * `lernzeit://auth/update-password` is a private URL scheme. Any other installed
 * app may declare the same scheme, and Android will then offer that app when the
 * recovery mail is opened - a complete account takeover with no exploit
 * involved. A verified HTTPS App Link cannot be claimed by a second app, because
 * Android checks `https://<host>/.well-known/assetlinks.json` against the
 * signing certificate before it binds the link.
 *
 * Therefore:
 *   - production  → HTTPS App Link only. No private recovery intent filter, and
 *                   the parser rejects every `lernzeit://` recovery URL.
 *   - development
 *     and preview → private scheme only, because no verified domain exists.
 *
 * The single input is the operator domain. A build that has a real public
 * operator domain uses the App Link; a build that has none cannot, and
 * `collectRecoveryReleaseIssues` in config/release-config.cjs turns exactly that
 * situation into a release blocker, so an artefact using the private scheme can
 * only ever be a development or preview build.
 *
 * ## Why the app scheme itself stays
 *
 * `app.json` keeps `"scheme": "lernzeit"`. Expo Router and the development
 * client need a scheme to open the app at all, and removing it would break
 * `npx expo start`, dev-client deep links and `expo-web-browser` return URLs.
 * What production does *not* keep is the recovery route on that scheme: the
 * intent filter for `lernzeit://auth/update-password` is gone and the parser
 * refuses it. The general app scheme and the password recovery transport are
 * two separate things and are configured separately.
 */

const publicHost = require('./public-host.cjs');

/** Fixed route of the recovery callback on every transport. */
const RECOVERY_PATH = '/update-password';
const RECOVERY_QUERY = 'type=recovery';

/**
 * The app's general URL scheme (app.json `scheme`). Used for development
 * clients and ordinary deep links - deliberately *not* used as a production
 * recovery transport.
 */
const APP_SCHEME = 'lernzeit';

/** Host segment of the private recovery URL, i.e. `lernzeit://auth/...`. */
const CUSTOM_RECOVERY_HOST = 'auth';
const CUSTOM_RECOVERY_URL = `${APP_SCHEME}://${CUSTOM_RECOVERY_HOST}${RECOVERY_PATH}?${RECOVERY_QUERY}`;

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

/**
 * Accepts only a clean HTTPS origin with an optional base path *on a public
 * operator domain*. Returns null for anything that must not become a public
 * legal, recovery or Android App Links base.
 *
 * @param {string} value
 * @returns {string | null}
 */
function normalizePublicHttpsBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
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
  if (!publicHost.isPublicOperatorHost(parsed.hostname)) return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
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
  return new URL(base).hostname.toLowerCase();
}

/**
 * The verified HTTPS App Link callback, or null when no usable operator domain
 * is configured.
 * @param {Record<string, string | undefined>} environment
 * @returns {string | null}
 */
function passwordRecoveryHttpsUrl(environment) {
  const host = publicHostFromBaseUrl(environment.EXPO_PUBLIC_LEGAL_SITE_URL ?? '');
  if (!host) return null;
  // Always the bare origin plus the fixed path: the parser accepts nothing else.
  return `https://${host}${RECOVERY_PATH}?${RECOVERY_QUERY}`;
}

/**
 * @typedef {Readonly<{
 *   recoveryTransport: 'https-app-link' | 'custom-scheme',
 *   recoveryRedirectUrl: string,
 *   recoveryHost: string,
 *   androidAppLinkHost: string | null,
 *   acceptsCustomRecoveryScheme: boolean,
 *   registersCustomRecoverySchemeFilter: boolean,
 * }>} AuthBuildConfiguration
 */

/**
 * The complete recovery contract of the current build.
 *
 * Everything downstream - `resetPasswordForEmail({ redirectTo })`, the Android
 * intent filters and `parsePasswordRecoveryUrl` - reads these fields. They can
 * therefore never describe three different transports.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {AuthBuildConfiguration}
 */
function resolveAuthBuildConfiguration(environment) {
  const httpsUrl = passwordRecoveryHttpsUrl(environment ?? {});
  if (httpsUrl) {
    const host = new URL(httpsUrl).hostname;
    return Object.freeze({
      recoveryTransport: 'https-app-link',
      recoveryRedirectUrl: httpsUrl,
      recoveryHost: host,
      androidAppLinkHost: host,
      acceptsCustomRecoveryScheme: false,
      registersCustomRecoverySchemeFilter: false,
    });
  }
  return Object.freeze({
    recoveryTransport: 'custom-scheme',
    recoveryRedirectUrl: CUSTOM_RECOVERY_URL,
    recoveryHost: CUSTOM_RECOVERY_HOST,
    androidAppLinkHost: null,
    acceptsCustomRecoveryScheme: true,
    registersCustomRecoverySchemeFilter: true,
  });
}

/**
 * Every reason why a configuration must not be shipped as production.
 *
 * Used by the release gate, by scripts/verify-expo-config.mjs and by the export
 * scanner, so all three agree on what "production ready" means.
 *
 * @param {AuthBuildConfiguration} configuration
 * @returns {string[]}
 */
function collectProductionAuthBuildIssues(configuration) {
  const issues = [];
  if (!configuration || typeof configuration !== 'object') {
    return ['Es gibt keine aufgeloeste Auth-Build-Konfiguration.'];
  }
  if (configuration.recoveryTransport !== 'https-app-link') {
    issues.push(
      `Der aktive Recovery-Transport ist "${configuration.recoveryTransport}" `
      + `(${configuration.recoveryRedirectUrl}). Ein Production-Build muss "https-app-link" `
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
 * Flat, quote-free serialisation of the build configuration.
 * @param {AuthBuildConfiguration} configuration
 * @returns {string}
 */
function serializeAuthBuildConfiguration(configuration) {
  return [
    AUTH_BUILD_ATTESTATION_PREFIX,
    `transport=${configuration.recoveryTransport}`,
    `host=${configuration.recoveryHost}`,
    `appLinkHost=${configuration.androidAppLinkHost ?? 'none'}`,
    `customScheme=${configuration.acceptsCustomRecoveryScheme ? 'on' : 'off'}`,
    `schemeFilter=${configuration.registersCustomRecoverySchemeFilter ? 'on' : 'off'}`,
    `url=${configuration.recoveryRedirectUrl}`,
    'end',
  ].join(';');
}

/**
 * Reverses {@link serializeAuthBuildConfiguration}.
 * @param {string} attestation
 * @returns {AuthBuildConfiguration | null}
 */
function parseAuthBuildAttestation(attestation) {
  const text = String(attestation ?? '');
  if (!text.startsWith(`${AUTH_BUILD_ATTESTATION_PREFIX};`) || !text.endsWith(';end')) return null;

  /** @type {Record<string, string>} */
  const fields = {};
  for (const entry of text.slice(AUTH_BUILD_ATTESTATION_PREFIX.length + 1, -';end'.length).split(';')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) return null;
    fields[entry.slice(0, separator)] = entry.slice(separator + 1);
  }

  const transport = fields.transport;
  if (transport !== 'https-app-link' && transport !== 'custom-scheme') return null;
  if (!fields.host || !fields.url) return null;
  if (fields.customScheme !== 'on' && fields.customScheme !== 'off') return null;
  if (fields.schemeFilter !== 'on' && fields.schemeFilter !== 'off') return null;

  return Object.freeze({
    recoveryTransport: transport,
    recoveryRedirectUrl: fields.url,
    recoveryHost: fields.host,
    androidAppLinkHost: fields.appLinkHost === 'none' ? null : fields.appLinkHost,
    acceptsCustomRecoveryScheme: fields.customScheme === 'on',
    registersCustomRecoverySchemeFilter: fields.schemeFilter === 'on',
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
  normalizePublicHttpsBaseUrl,
  publicHostFromBaseUrl,
  passwordRecoveryHttpsUrl,
  resolveAuthBuildConfiguration,
  collectProductionAuthBuildIssues,
  serializeAuthBuildConfiguration,
  parseAuthBuildAttestation,
  findAuthBuildAttestations,
  findRecoveryCallbackUrls,
};
