/**
 * The dynamic Expo configuration itself.
 *
 * app.config.js is the only place that turns the resolved build profile into a
 * registered URL scheme and into Android intent filters, and it is evaluated by
 * every build, export and prebuild. The properties asserted here are the ones a
 * mistake in that file would ship silently:
 *
 *   - production registers no `lernzeit` scheme, in any form,
 *   - each profile gets exactly one recovery filter and no duplicate,
 *   - intent filters that have nothing to do with recovery survive untouched,
 *   - a profile that cannot be resolved aborts the build instead of guessing.
 */
import { COMPLETE_PRODUCTION_ENVIRONMENT } from './support/production-environment';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const appJson = require('../app.json') as { expo: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const defineConfig = require('../app.config.js') as (input: { config: BaseConfig }) => ResolvedConfig;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authBuild = require('../config/auth-build.cjs');

type IntentFilterData = { scheme?: string; host?: string; path?: string };
type IntentFilter = {
  action?: string;
  autoVerify?: boolean;
  category?: string[];
  data?: IntentFilterData[] | IntentFilterData;
};
type BaseConfig = Record<string, unknown> & {
  scheme?: string | string[];
  android?: { intentFilters?: IntentFilter[]; versionCode?: number };
  extra?: Record<string, unknown>;
};
type ResolvedConfig = BaseConfig & {
  android: { intentFilters: IntentFilter[]; versionCode: number };
  extra: Record<string, unknown>;
};

/**
 * An intent filter that has nothing to do with password recovery. It stands in
 * for anything a future feature might declare in app.json; the recovery logic
 * owns its own filter and nothing else.
 */
const UNRELATED_FILTER: IntentFilter = {
  action: 'VIEW',
  category: ['BROWSABLE', 'DEFAULT'],
  data: [{ scheme: 'https', host: 'share.lernzeit.de', path: '/einladung' }],
};

const PRODUCTION_ENVIRONMENT = COMPLETE_PRODUCTION_ENVIRONMENT;

/** Runs app.config.js with a given environment and app.json base. */
function resolveConfig(
  environment: Record<string, string | undefined>,
  base: BaseConfig = {},
): ResolvedConfig {
  const previous = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EXPO_PUBLIC_') || key.startsWith('LERNZEIT_') || key.startsWith('EAS_')) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, environment);
  try {
    return defineConfig({ config: { ...(appJson.expo as BaseConfig), ...base } });
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

/** Every `data` entry of every intent filter, flattened. */
function allFilterData(filters: IntentFilter[]): IntentFilterData[] {
  return filters.flatMap((filter) => (Array.isArray(filter.data)
    ? filter.data
    : [filter.data ?? {}]));
}

function recoveryFilters(filters: IntentFilter[]): IntentFilter[] {
  return filters.filter((filter) => (Array.isArray(filter.data) ? filter.data : [filter.data ?? {}])
    .some((entry) => entry?.path === '/update-password'));
}

describe('app.json base', () => {
  /**
   * The static base must not declare the scheme: app.json is profile-blind, so
   * a scheme there would reach a production manifest before app.config.js ever
   * had a say.
   */
  it('declares no URL scheme at all', () => {
    expect(appJson.expo.scheme).toBeUndefined();
  });
});

describe('app.config.js in a production build', () => {
  it('registers no lernzeit scheme anywhere in the resolved config', () => {
    const config = resolveConfig(PRODUCTION_ENVIRONMENT);
    expect(config.scheme).toBeUndefined();
    expect('scheme' in config).toBe(false);
    // `slug: "lernzeit"` is the Expo project name and deliberately untouched;
    // what must not appear is the word as a *scheme* or as a URL.
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain('"scheme":"lernzeit"');
    expect(serialized).not.toContain('lernzeit://');
    expect(allFilterData(config.android.intentFilters)
      .some((entry) => entry.scheme === 'lernzeit')).toBe(false);
  });

  it('registers exactly one verified App Link for the recovery path', () => {
    const config = resolveConfig(PRODUCTION_ENVIRONMENT);
    const recovery = recoveryFilters(config.android.intentFilters);
    expect(recovery).toHaveLength(1);
    expect(recovery[0].autoVerify).toBe(true);
    expect(recovery[0].data).toEqual([
      { scheme: 'https', host: 'lernzeit.de', path: '/update-password' },
    ]);
  });

  it('attests the profile in extra, in the object and in the flat string', () => {
    const config = resolveConfig(PRODUCTION_ENVIRONMENT);
    expect(config.extra.buildProfile).toBe('production');
    expect(config.extra.passwordRecoveryRedirectKind).toBe('https-app-link');
    expect(config.extra.authBuildAttestation).toContain(';profile=production;');
    expect(authBuild.parseAuthBuildAttestation(config.extra.authBuildAttestation))
      .toEqual(config.extra.authBuildConfiguration);
  });
});

describe('app.config.js in development and preview builds', () => {
  it.each(['development', 'preview'])('registers the lernzeit scheme for %s', (profile) => {
    const config = resolveConfig({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: profile });
    expect(config.scheme).toBe('lernzeit');
    expect(config.extra.buildProfile).toBe(profile);
  });

  it.each(['development', 'preview'])('registers exactly one private recovery filter for %s', (profile) => {
    const config = resolveConfig({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: profile });
    const recovery = recoveryFilters(config.android.intentFilters);
    expect(recovery).toHaveLength(1);
    expect(recovery[0].autoVerify).toBeUndefined();
    expect(recovery[0].data).toEqual([
      { scheme: 'lernzeit', host: 'auth', path: '/update-password' },
    ]);
  });

  /** A real operator domain must not turn a preview build into an App Link build. */
  it.each(['development', 'preview'])('keeps the private filter for %s even with a real domain', (profile) => {
    const config = resolveConfig({
      EAS_BUILD: 'true',
      EAS_BUILD_PROFILE: profile,
      EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de',
    });
    const recovery = recoveryFilters(config.android.intentFilters);
    expect(recovery).toHaveLength(1);
    expect(recovery[0].autoVerify).toBeUndefined();
    expect(config.extra.passwordRecoveryRedirectKind).toBe('custom-scheme');
  });
});

describe('unrelated intent filters', () => {
  /**
   * The regression this guards: assigning the recovery filter straight to
   * `android.intentFilters` silently deleted every other filter app.json
   * declares now or in future.
   */
  it.each([
    ['production', PRODUCTION_ENVIRONMENT],
    ['development', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development' }],
    ['preview', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'preview' }],
  ])('survive the %s configuration unchanged', (_label, environment) => {
    const config = resolveConfig(environment, {
      android: { ...(appJson.expo.android as object), intentFilters: [UNRELATED_FILTER] },
    });
    expect(config.android.intentFilters).toContainEqual(UNRELATED_FILTER);
    expect(recoveryFilters(config.android.intentFilters)).toHaveLength(1);
    expect(config.android.intentFilters).toHaveLength(2);
  });

  /**
   * A filter on the private scheme that is *not* the recovery route stays, even
   * in production. Silently deleting it would hide the contradiction between
   * app.json and the profile; the Expo config verifier and the native manifest
   * check both fail loudly on it instead.
   */
  it('does not silently strip a non-recovery lernzeit filter from a production build', () => {
    const shareFilter = {
      action: 'VIEW',
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'lernzeit', host: 'auth', path: '/teilen' }],
    };
    const config = resolveConfig(PRODUCTION_ENVIRONMENT, {
      android: { ...(appJson.expo.android as object), intentFilters: [shareFilter] },
    });
    expect(config.android.intentFilters).toContainEqual(shareFilter);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoConfigCheck = require('../scripts/lib/expo-config-check.cjs');
    const { failures } = expoConfigCheck.collectExpoConfigIssues(config, PRODUCTION_ENVIRONMENT);
    expect(failures.join(' ')).toMatch(/keinen Intent-Filter auf dem privaten Scheme/);
  });

  it('keeps a non-recovery lernzeit filter in a development build without complaint', () => {
    const shareFilter = {
      action: 'VIEW',
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'lernzeit', host: 'auth', path: '/teilen' }],
    };
    const environment = { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development' };
    const config = resolveConfig(environment, {
      android: { ...(appJson.expo.android as object), intentFilters: [shareFilter] },
    });
    expect(config.android.intentFilters).toContainEqual(shareFilter);
    expect(recoveryFilters(config.android.intentFilters)).toHaveLength(1);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoConfigCheck = require('../scripts/lib/expo-config-check.cjs');
    expect(expoConfigCheck.collectExpoConfigIssues(config, environment).failures).toEqual([]);
  });

  /** A recovery filter already present in the base is replaced, not duplicated. */
  it.each([
    ['production', PRODUCTION_ENVIRONMENT],
    ['development', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development' }],
  ])('replace a stale recovery filter in the %s base without duplicating it', (_label, environment) => {
    const config = resolveConfig(environment, {
      android: {
        ...(appJson.expo.android as object),
        intentFilters: [
          UNRELATED_FILTER,
          {
            action: 'VIEW',
            category: ['BROWSABLE', 'DEFAULT'],
            data: [{ scheme: 'lernzeit', host: 'auth', path: '/update-password' }],
          },
          {
            action: 'VIEW',
            autoVerify: true,
            category: ['BROWSABLE', 'DEFAULT'],
            data: [{ scheme: 'https', host: 'veraltet.de', path: '/update-password' }],
          },
        ],
      },
    });
    expect(recoveryFilters(config.android.intentFilters)).toHaveLength(1);
    expect(config.android.intentFilters).toContainEqual(UNRELATED_FILTER);
    expect(JSON.stringify(config)).not.toContain('veraltet.de');
  });
});

describe('a build profile that cannot be resolved', () => {
  it.each([
    ['unbekanntes EAS-Profil', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'staging' }],
    ['unbekanntes oeffentliches Profil', { EXPO_PUBLIC_BUILD_PROFILE: 'qa' }],
    [
      'widersprechende Profile',
      { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_BUILD_PROFILE: 'development' },
    ],
  ])('aborts the build for a %s', (_label, environment) => {
    expect(() => resolveConfig(environment)).toThrow(/Buildprofil/);
  });

  it('aborts a production build without operator values', () => {
    expect(() => resolveConfig({ EXPO_PUBLIC_BUILD_PROFILE: 'production' }))
      .toThrow(/EXPO_PUBLIC_OPERATOR_NAME/);
  });
});
