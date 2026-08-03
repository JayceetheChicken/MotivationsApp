/**
 * Dynamic Expo configuration.
 *
 * Two jobs:
 *   1. Abort any production build whose operator, legal or Supabase values are
 *      still missing or placeholders (example.invalid, your-project-id,
 *      [KONTAKT], ...). Expo evaluates this file for every build and export, so
 *      throwing here reliably stops EAS, `expo export` and `expo run:android`.
 *   2. Derive the verified Android App Links host and the Android versionCode
 *      from the central configuration instead of hardcoding them.
 *
 * app.json stays the static base; everything dynamic is overlaid here.
 */
const releaseConfig = require('./config/release-config.cjs');

const DEVELOPMENT_APP_LINKS_HOST = releaseConfig.DEVELOPMENT_MARKER_DOMAIN;

function appLinksHost(environment) {
  const base = releaseConfig.normalizeHttpsBaseUrl(
    environment.EXPO_PUBLIC_LEGAL_SITE_URL ?? '',
  );
  if (!base) return DEVELOPMENT_APP_LINKS_HOST;
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return DEVELOPMENT_APP_LINKS_HOST;
  }
}

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

module.exports = ({ config }) => {
  const environment = process.env;

  if (releaseConfig.isProductionRelease(environment)) {
    const blockers = releaseConfig.collectReleaseBlockers(environment);
    if (blockers.length > 0) {
      throw new Error(`\n${releaseConfig.formatReleaseBlockerReport(blockers)}\n`);
    }
  }

  const host = appLinksHost(environment);

  return {
    ...config,
    android: {
      ...config.android,
      versionCode: androidVersionCode(environment, config.android?.versionCode ?? 1),
      intentFilters: [
        // Private scheme callback. Always available, also in development builds.
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'lernzeit', host: 'auth', path: '/update-password' }],
        },
        // Verified Android App Link on the operator domain. autoVerify requires
        // https://<host>/.well-known/assetlinks.json to list this package and
        // the Play App Signing certificate fingerprint.
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'https', host, path: '/update-password' }],
        },
      ],
    },
    extra: {
      ...config.extra,
      legalSiteHost: host,
      releaseGateEnforced: releaseConfig.isProductionRelease(environment),
    },
  };
};
