/**
 * Release checks for a *resolved* Expo configuration.
 *
 * CommonJS so __tests__/release-scripts.test.ts exercises the exact code the CLI
 * (scripts/verify-expo-config.mjs) runs, including the per-profile recovery
 * transport rules. A check that only exists inside a CLI script cannot be tested
 * against a deliberately broken manifest, and an untested gate is a gate that
 * silently stops working.
 */
const releaseConfig = require('../../config/release-config.cjs');

const EXPECTED = {
  androidPackage: 'de.lernzeit.app',
  targetSdkVersion: 36,
  minSdkVersion: 24,
};

/** Placeholder tokens that must not survive into a production manifest. */
const FORBIDDEN_TOKENS = [
  'example.invalid',
  'your-project-id',
  '[NAME/FIRMA]',
  '[KONTAKT]',
  releaseConfig.DEVELOPMENT_MARKER_DOMAIN,
];

/** Secret shapes that must never be inlined into the public manifest. */
const SECRET_PATTERNS = [/service_role/i, /sb_secret_/, /SUPABASE_SERVICE_ROLE/i];

/** @param {Record<string, unknown>} filter */
function filterData(filter) {
  if (!filter || typeof filter !== 'object') return [];
  return Array.isArray(filter.data) ? filter.data : [filter.data ?? {}];
}

/**
 * The intent filter that would route the private URL scheme to the recovery
 * screen, if the manifest declares one.
 * @param {readonly Record<string, unknown>[]} intentFilters
 */
function findPrivateRecoveryFilter(intentFilters) {
  return intentFilters.find((filter) => filterData(filter).some(
    (entry) => entry?.scheme === releaseConfig.APP_SCHEME
      && entry?.path === releaseConfig.RECOVERY_PATH,
  )) ?? null;
}

/**
 * Any intent filter that mentions the private scheme at all, recovery route or
 * not. A production manifest must contain none: the whole point of dropping
 * `expo.scheme` is that `lernzeit://` can no longer reach the app.
 * @param {readonly Record<string, unknown>[]} intentFilters
 */
function findCustomSchemeFilters(intentFilters) {
  return intentFilters.filter((filter) => filterData(filter).some(
    (entry) => entry?.scheme === releaseConfig.APP_SCHEME,
  ));
}

/**
 * Every spelling of the general Expo scheme, which may be a string or an array.
 * @param {unknown} scheme
 * @returns {string[]}
 */
function declaredSchemes(scheme) {
  if (typeof scheme === 'string') return [scheme];
  if (Array.isArray(scheme)) return scheme.filter((entry) => typeof entry === 'string');
  return [];
}

/**
 * Every reason a resolved Expo configuration must not be released.
 *
 * @param {Record<string, unknown>} rawConfig `expo config --json` output, wrapped or not
 * @param {Record<string, string | undefined>} environment
 * @returns {{ failures: string[], notes: string[], summary: Record<string, unknown> }}
 */
function collectExpoConfigIssues(rawConfig, environment) {
  const config = rawConfig?.expo ?? rawConfig ?? {};
  const android = config.android ?? {};
  const failures = [];
  const notes = [];

  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  check(
    android.package === EXPECTED.androidPackage,
    `Android-Paketname ist "${android.package}", erwartet "${EXPECTED.androidPackage}".`,
  );
  check(
    Number.isInteger(android.versionCode) && android.versionCode >= 1,
    `Android versionCode fehlt oder ist ungueltig: ${JSON.stringify(android.versionCode)}.`,
  );
  check(
    typeof config.version === 'string' && /^\d+\.\d+\.\d+$/.test(config.version),
    `App-Version muss dem Schema x.y.z folgen, gefunden: ${JSON.stringify(config.version)}.`,
  );
  check(
    android.allowBackup === false,
    'android.allowBackup muss false sein, damit Kontodaten nicht in Cloud-Backups landen.',
  );
  const buildProperties = (config.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );
  const androidBuildProperties = buildProperties?.[1]?.android ?? {};
  check(
    androidBuildProperties.targetSdkVersion === EXPECTED.targetSdkVersion,
    `targetSdkVersion muss ${EXPECTED.targetSdkVersion} sein, gefunden: ${androidBuildProperties.targetSdkVersion}.`,
  );
  check(
    androidBuildProperties.compileSdkVersion === EXPECTED.targetSdkVersion,
    `compileSdkVersion muss ${EXPECTED.targetSdkVersion} sein, gefunden: ${androidBuildProperties.compileSdkVersion}.`,
  );
  check(
    Number.isInteger(androidBuildProperties.minSdkVersion)
      && androidBuildProperties.minSdkVersion >= EXPECTED.minSdkVersion,
    `minSdkVersion muss mindestens ${EXPECTED.minSdkVersion} sein, gefunden: ${androidBuildProperties.minSdkVersion}.`,
  );
  check(androidBuildProperties.usesCleartextTraffic === false, 'usesCleartextTraffic muss false sein.');

  // --- Recovery transport and app scheme, strictly per build profile ---------
  //
  // Manifest, runtime parser and resetPasswordForEmail must name the same
  // transport. This asserts the manifest half against the same central
  // derivation app.config.js and the app itself use.
  const profile = releaseConfig.resolveBuildProfile(environment);
  if (profile.issue) failures.push(profile.issue);
  const auth = releaseConfig.resolveAuthBuildConfiguration(environment);
  const intentFilters = Array.isArray(android.intentFilters) ? android.intentFilters : [];
  const appLink = intentFilters.find((filter) => filter?.autoVerify === true) ?? null;
  const appLinkHost = appLink ? (filterData(appLink)[0]?.host ?? null) : null;
  const privateRecoveryFilter = findPrivateRecoveryFilter(intentFilters);
  const schemes = declaredSchemes(config.scheme);
  const declaresAppScheme = schemes.includes(releaseConfig.APP_SCHEME);

  // The general Expo scheme. Expo registers it as an ordinary incoming deep
  // link, so leaving it in a production manifest would keep
  // `lernzeit://auth/update-password` able to open the app even after the
  // specific recovery intent filter was removed. Development and preview need
  // it for `npx expo start` and the development client.
  if (releaseConfig.registersAppScheme(auth.profile)) {
    check(
      declaresAppScheme,
      `Im Profil "${auth.profile}" fehlt das allgemeine App-Scheme "${releaseConfig.APP_SCHEME}".`,
    );
  } else {
    check(
      !declaresAppScheme,
      `Ein Production-Build darf das Scheme "${releaseConfig.APP_SCHEME}" nicht registrieren; `
      + `gefunden: ${JSON.stringify(config.scheme)}. Expo macht daraus einen allgemeinen `
      + 'eingehenden Deep Link, ueber den der Recovery-Link die App weiterhin oeffnen koennte.',
    );
    const customSchemeFilters = findCustomSchemeFilters(intentFilters);
    check(
      customSchemeFilters.length === 0,
      'Ein Production-Build darf keinen Intent-Filter auf dem privaten Scheme registrieren, gefunden: '
      + `${JSON.stringify(customSchemeFilters.map((filter) => filterData(filter)))}.`,
    );
  }

  if (auth.recoveryTransport === 'https-app-link') {
    check(Boolean(appLink), 'Es ist kein verifizierter Android App Link (autoVerify) konfiguriert.');
    check(
      appLinkHost === auth.androidAppLinkHost,
      `Der App-Links-Host ist "${appLinkHost}", erwartet "${auth.androidAppLinkHost}".`,
    );
    // The decisive production check. Any other installed app may claim
    // "lernzeit://", so a registered private recovery route is an account
    // takeover path, not a convenience fallback.
    check(
      !privateRecoveryFilter,
      'Ein Production-Build darf keinen privaten Recovery-Intent-Filter registrieren, gefunden: '
      + `${JSON.stringify(privateRecoveryFilter?.data)}.`,
    );
    if (!appLinkHost) {
      failures.push('Der App-Links-Host konnte nicht aus der aufgeloesten Config gelesen werden.');
    } else if (releaseConfig.isPlaceholderValue(appLinkHost)) {
      failures.push(`Der App-Links-Host "${appLinkHost}" ist noch ein Platzhalter.`);
    } else if (!releaseConfig.isPublicOperatorHost(appLinkHost)) {
      failures.push(
        `Der App-Links-Host "${appLinkHost}" ist keine oeffentlich nutzbare Betreiberdomain: `
        + `${releaseConfig.publicOperatorHostIssue(appLinkHost)}`,
      );
    } else {
      notes.push(`App-Links-Host: ${appLinkHost}`);
    }
  } else if (auth.recoveryTransport === 'custom-scheme') {
    // Development, preview and local: the signing certificate is not in the
    // operator's assetlinks.json, so the private scheme is the only transport
    // that can work - and nothing may claim to be a verified App Link.
    check(
      Boolean(privateRecoveryFilter),
      `Im Profil "${auth.profile}" fehlt der private Recovery-Deep-Link `
      + `${releaseConfig.APP_SCHEME}://auth${releaseConfig.RECOVERY_PATH}.`,
    );
    check(
      !appLink,
      'Ohne verifizierbare Betreiberdomain darf kein autoVerify-App-Link konfiguriert sein; '
      + 'er koennte nie verifiziert werden.',
    );
    // The shared definition of a correct non-production build, so this verifier
    // cannot drift away from the export scanner or the runtime.
    for (const issue of releaseConfig.collectDevelopmentAuthBuildIssues(auth)) failures.push(issue);
    notes.push(`Recovery-Transport: ${auth.recoveryTransport} (${auth.recoveryRedirectUrl})`);
  } else {
    failures.push(
      `Der Recovery-Transport ist "${auth.recoveryTransport}". Diese Konfiguration hat keinen `
      + 'gueltigen Transport und darf nicht gebaut werden.',
    );
  }

  // The manifest must carry the attestation the app reads back at runtime.
  const attestation = config.extra?.authBuildAttestation;
  const attested = typeof attestation === 'string'
    ? releaseConfig.parseAuthBuildAttestation(attestation)
    : null;
  check(Boolean(attested), 'In extra.authBuildAttestation steht keine lesbare Auth-Build-Attestierung.');
  if (attested) {
    check(
      attested.profile === auth.profile
      && attested.recoveryTransport === auth.recoveryTransport
      && attested.recoveryRedirectUrl === auth.recoveryRedirectUrl
      && attested.recoveryHost === auth.recoveryHost
      && attested.androidAppLinkHost === auth.androidAppLinkHost
      && attested.acceptsCustomRecoveryScheme === auth.acceptsCustomRecoveryScheme
      && attested.registersCustomRecoverySchemeFilter === auth.registersCustomRecoverySchemeFilter,
      `Die Attestierung "${attestation}" passt nicht zur aufgeloesten Konfiguration ${JSON.stringify(auth)}.`,
    );
    check(
      attested.androidAppLinkHost === appLinkHost,
      `Die Attestierung nennt den App-Link-Host "${attested.androidAppLinkHost}", das Manifest "${appLinkHost}".`,
    );
    // Manifest, bundle and runtime must attest the same profile.
    check(
      attested.profile === auth.profile && config.extra?.buildProfile === auth.profile,
      `Das Manifest nennt das Buildprofil "${config.extra?.buildProfile}", die Attestierung `
      + `"${attested.profile}" und die aufgeloeste Konfiguration "${auth.profile}".`,
    );
  }

  const serialized = JSON.stringify(config);
  // Placeholders are only a release blocker for a production manifest; a
  // development manifest is *supposed* to carry the marker domain.
  if (releaseConfig.isProductionRelease(environment)) {
    for (const token of FORBIDDEN_TOKENS) {
      if (serialized.includes(token)) {
        failures.push(`Die aufgeloeste Expo-Config enthaelt den Platzhalter "${token}".`);
      }
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      failures.push(`Die aufgeloeste Expo-Config enthaelt ein Secret-Muster: ${pattern}.`);
    }
  }

  return {
    failures,
    notes,
    summary: {
      buildProfile: auth.profile,
      appScheme: config.scheme ?? null,
      androidPackage: android.package,
      version: config.version,
      versionCode: android.versionCode,
      targetSdkVersion: androidBuildProperties.targetSdkVersion,
      minSdkVersion: androidBuildProperties.minSdkVersion,
      recoveryTransport: auth.recoveryTransport,
      recoveryRedirectUrl: auth.recoveryRedirectUrl,
      appLinkHost,
      hasPrivateRecoveryFilter: Boolean(privateRecoveryFilter),
    },
  };
}

module.exports = {
  EXPECTED,
  FORBIDDEN_TOKENS,
  filterData,
  findPrivateRecoveryFilter,
  findCustomSchemeFilters,
  declaredSchemes,
  collectExpoConfigIssues,
};
