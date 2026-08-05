/**
 * Dynamic Expo configuration.
 *
 * Three jobs:
 *   1. Abort any production build whose operator, legal or Supabase values are
 *      still missing or placeholders (example.invalid, your-project-id,
 *      [KONTAKT], ...). Expo evaluates this file for every build and export, so
 *      throwing here reliably stops EAS, `expo export` and `expo run:android`.
 *   2. Register exactly the recovery transport the current build profile allows.
 *      A production build gets the verified HTTPS App Link and *no*
 *      `lernzeit://auth/update-password` intent filter; a development or preview
 *      build gets the private scheme and no unverifiable App Link.
 *   3. Embed the resolved auth build configuration into `extra`, both as an
 *      object and as a flat attestation string. The app reads it back at
 *      runtime and scripts/check-exported-bundle.mjs proves from the built
 *      artefact which transport is really active.
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

/**
 * The Android intent filters that belong to the resolved recovery transport.
 *
 * Exactly one of the two is produced. Registering both would put the private
 * scheme back into a production build, and any other installed app may claim
 * that scheme and receive the recovery link.
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
  // Development and preview only: no operator domain exists, so no App Link can
  // be verified. The release gate refuses to build production in this state.
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

module.exports = ({ config }) => {
  const environment = process.env;

  if (releaseConfig.isProductionRelease(environment)) {
    const blockers = releaseConfig.collectReleaseBlockers(environment);
    if (blockers.length > 0) {
      throw new Error(`\n${releaseConfig.formatReleaseBlockerReport(blockers)}\n`);
    }
  }

  // The single derivation. The intent filter, resetPasswordForEmail and
  // parsePasswordRecoveryUrl all read this same object, so they cannot name
  // different hosts or different transports.
  const auth = authBuild.resolveAuthBuildConfiguration(environment);
  const host = releaseConfig.legalSiteHostFromEnvironment(environment);

  return {
    ...config,
    android: {
      ...config.android,
      versionCode: androidVersionCode(environment, config.android?.versionCode ?? 1),
      intentFilters: recoveryIntentFilters(auth),
    },
    extra: {
      ...config.extra,
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
};
