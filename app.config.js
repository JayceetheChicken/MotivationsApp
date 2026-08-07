/**
 * Dynamic Expo configuration.
 *
 * Four jobs:
 *   1. Abort any build whose profile cannot be resolved, and any production
 *      build whose operator, legal or Supabase values are still missing or
 *      placeholders (example.invalid, your-project-id, [KONTAKT], ...). Expo
 *      evaluates this file for every build and export, so throwing here reliably
 *      stops EAS, `expo export` and `expo run:android`.
 *   2. Register exactly the URL scheme the current build profile allows. Expo
 *      turns `expo.scheme` into a *general* incoming deep link, so production
 *      registers none at all - otherwise `lernzeit://auth/update-password` would
 *      still open the app after the specific recovery intent filter was removed.
 *      Without a scheme Expo falls back to the Android package name, which the
 *      recovery parser does not accept as a transport.
 *   3. Register exactly the recovery intent filter the profile allows, while
 *      leaving every unrelated intent filter in app.json untouched. Production
 *      gets the verified HTTPS App Link; development and preview get the private
 *      scheme and no unverifiable App Link.
 *   4. Embed the resolved auth build configuration into `extra`, both as an
 *      object and as a flat attestation string. The app reads it back at
 *      runtime, scripts/check-exported-bundle.mjs proves from the built artefact
 *      which transport is really active, and scripts/verify-native-linking.mjs
 *      proves the same for the generated AndroidManifest.xml.
 *
 * app.json stays the static base; everything dynamic is overlaid here.
 */
const releaseConfig = require('./config/release-config.cjs');
const authBuild = require('./config/auth-build.cjs');

/**
 * Android requires a strictly increasing integer. EAS `appVersionSource:
 * "remote"` with `autoIncrement` owns the value during EAS builds; an explicit
 * ANDROID_VERSION_CODE wins for local/offline builds so a manual AAB can never
 * collide with a previously published one.
 */
function androidVersionCode(environment, fallback) {
  const provided = environment.ANDROID_VERSION_CODE?.trim();
  if (!provided) return fallback;
  const parsed = Number.parseInt(provided, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2_100_000_000) {
    throw new Error(
      `ANDROID_VERSION_CODE muss eine ganze Zahl zwischen 1 und 2100000000 sein, erhalten: "${provided}".`,
    );
  }
  return parsed;
}

/** @param {unknown} filter @returns {Record<string, unknown>[]} */
function filterData(filter) {
  if (!filter || typeof filter !== 'object') return [];
  const data = /** @type {{data?: unknown}} */ (filter).data;
  if (Array.isArray(data)) return data.filter((entry) => entry && typeof entry === 'object');
  return data && typeof data === 'object' ? [data] : [];
}

/**
 * Does this intent filter route a password recovery callback?
 *
 * Both transports count, and both are identified by the *recovery path*, not by
 * their scheme: `lernzeit://auth/update-password` and any HTTPS App Link on
 * `/update-password`. Anything else - a share target, a widget deep link, a
 * future feature's filter - is not ours to touch, on any scheme.
 *
 * Deliberately not "every filter on the private scheme". A production build must
 * not carry one, but silently deleting it here would hide the contradiction
 * between app.json and the profile; scripts/verify-expo-config.mjs and
 * scripts/verify-native-linking.mjs both fail loudly on it instead.
 *
 * @param {unknown} filter
 */
function isRecoveryIntentFilter(filter) {
  return filterData(filter).some((entry) => {
    const scheme = typeof entry.scheme === 'string' ? entry.scheme.toLowerCase() : '';
    const path = typeof entry.path === 'string' ? entry.path : entry.pathPrefix;
    if (path !== authBuild.RECOVERY_PATH) return false;
    return scheme === authBuild.APP_SCHEME || scheme === 'https';
  });
}

/**
 * The Android intent filter that belongs to the resolved recovery transport, or
 * none at all when recovery is disabled.
 *
 * Exactly one is produced. Registering both would put the private scheme back
 * into a production build, and any other installed app may claim that scheme and
 * receive the recovery link.
 *
 * @param {ReturnType<typeof authBuild.resolveAuthBuildConfiguration>} auth
 */
function recoveryIntentFilters(auth) {
  if (auth.recoveryTransport === 'https-app-link') {
    // Verified Android App Link. autoVerify requires
    // https://<host>/.well-known/assetlinks.json to list this package and the
    // Play App Signing certificate fingerprint.
    return [{
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'https', host: auth.androidAppLinkHost, path: authBuild.RECOVERY_PATH }],
    }];
  }
  if (auth.recoveryTransport === 'custom-scheme') {
    // Development and preview only: no verifiable App Link exists for a build
    // whose signing certificate is not in the operator's assetlinks.json.
    return [{
      action: 'VIEW',
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{
        scheme: authBuild.APP_SCHEME,
        host: authBuild.CUSTOM_RECOVERY_HOST,
        path: authBuild.RECOVERY_PATH,
      }],
    }];
  }
  return [];
}

/**
 * Replaces the recovery intent filters and keeps everything else.
 *
 * Assigning `recoveryIntentFilters(auth)` straight to `android.intentFilters`
 * would silently delete any unrelated filter app.json declares now or later. The
 * recovery filter is the only one this file owns.
 *
 * @param {unknown} existing
 * @param {ReturnType<typeof authBuild.resolveAuthBuildConfiguration>} auth
 */
function mergeIntentFilters(existing, auth) {
  const kept = (Array.isArray(existing) ? existing : []).filter(
    (filter) => !isRecoveryIntentFilter(filter),
  );
  return [...kept, ...recoveryIntentFilters(auth)];
}

module.exports = ({ config }) => {
  const environment = process.env;

  // An unknown or self-contradictory build profile stops every build, not just
  // production: the profile is what decides the recovery transport and the URL
  // scheme, so guessing it would mean guessing both.
  const profile = authBuild.resolveBuildProfile(environment);
  if (profile.issue) {
    throw new Error(`\nDas Buildprofil ist nicht aufloesbar.\n${profile.issue}\n`);
  }

  if (releaseConfig.isProductionRelease(environment)) {
    const blockers = releaseConfig.collectReleaseBlockers(environment);
    if (blockers.length > 0) {
      throw new Error(`\n${releaseConfig.formatReleaseBlockerReport(blockers)}\n`);
    }
  }

  // The single derivation. The scheme, the intent filter, resetPasswordForEmail
  // and parsePasswordRecoveryUrl all read this same object, so they cannot name
  // different transports.
  const auth = authBuild.resolveAuthBuildConfiguration(environment);
  const host = releaseConfig.legalSiteHostFromEnvironment(environment);

  const resolved = {
    ...config,
    android: {
      ...config.android,
      versionCode: androidVersionCode(environment, config.android?.versionCode ?? 1),
      intentFilters: mergeIntentFilters(config.android?.intentFilters, auth),
    },
    extra: {
      ...config.extra,
      buildProfile: auth.profile,
      legalSiteHost: host,
      passwordRecoveryRedirect: auth.recoveryRedirectUrl,
      passwordRecoveryRedirectKind: auth.recoveryTransport,
      authBuildConfiguration: auth,
      // Flat, quote-free serialisation. The runtime parses it back and the
      // export scanner locates it with a single regex, independent of how the
      // bundler quotes or minifies the embedded manifest.
      authBuildAttestation: authBuild.serializeAuthBuildConfiguration(auth),
      releaseGateEnforced: releaseConfig.isProductionRelease(environment),
    },
  };

  // Production must not carry the scheme in *any* form, so the key is removed
  // rather than set to undefined: a serialised `"scheme": null` would still be a
  // value the next tool has to interpret.
  if (authBuild.registersAppScheme(auth.profile)) resolved.scheme = authBuild.APP_SCHEME;
  else delete resolved.scheme;

  return resolved;
};
