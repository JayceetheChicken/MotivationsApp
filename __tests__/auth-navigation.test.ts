import {
  getStudyStorageConfiguration,
  getStudyStorageScope,
  HOME_NAVIGATION_ANCHOR,
  isPasswordRecoveryUrl,
  PASSWORD_RECOVERY_REDIRECT_KIND,
  PASSWORD_RECOVERY_REDIRECT_URL,
  ROOT_NAVIGATION_ANCHOR,
  VERIFIED_RECOVERY_HOST,
} from '@/auth/navigation';

import { attestationFor, embeddedAuthBuildAttestation } from './support/auth-build-manifest';

// The runtime reads the attestation back out of the embedded manifest. Under
// Jest there is none, so every build shape below supplies the one app.config.js
// would have written; a production build without it is denied recovery, which
// `reconciling manifest and bundle` in auth-build-configuration.test.ts asserts.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        extra: {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          authBuildAttestation: require('./support/auth-build-manifest')
            .embeddedAuthBuildAttestation.value,
        },
      };
    },
  },
}));

type NavigationModule = typeof import('@/auth/navigation');

/**
 * Reloads the navigation module as a build of `environment` would have produced
 * it: the environment variables Metro inlines, plus the manifest attestation
 * app.config.js derives from exactly the same values.
 *
 * The transport follows the *build profile*, not the presence of a domain - a
 * development build handed the real operator domain still uses the private
 * scheme, because its signing certificate is not in the operator's
 * assetlinks.json.
 */
function withBuild<T>(
  environment: Readonly<Record<string, string | undefined>>,
  run: (module: NavigationModule) => T,
): T {
  const keys = ['EXPO_PUBLIC_BUILD_PROFILE', 'EXPO_PUBLIC_LEGAL_SITE_URL'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    const value = environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const previousAttestation = embeddedAuthBuildAttestation.value;
  embeddedAuthBuildAttestation.value = attestationFor(environment);

  let result!: T;
  try {
    jest.isolateModules(() => {
      result = run(require('@/auth/navigation') as NavigationModule);
    });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    embeddedAuthBuildAttestation.value = previousAttestation;
    jest.resetModules();
  }
  return result;
}

/** Reloads the module with a given operator domain in a production build. */
const withLegalSiteUrl = <T,>(value: string | undefined, run: (module: NavigationModule) => T): T =>
  withBuild({ EXPO_PUBLIC_BUILD_PROFILE: 'production', EXPO_PUBLIC_LEGAL_SITE_URL: value }, run);

/** A production build with a real operator domain. */
const withProductionBuild = <T,>(run: (module: NavigationModule) => T): T =>
  withLegalSiteUrl('https://lernzeit.de', run);

/** A development build, whether or not a domain happens to be configured. */
const withDevelopmentBuild = <T,>(run: (module: NavigationModule) => T): T =>
  withBuild({ EXPO_PUBLIC_BUILD_PROFILE: 'development' }, run);

describe('optional authentication navigation', () => {
  it('keeps guest and local-profile learning data in the same local workspace', () => {
    expect(getStudyStorageScope('none')).toBe('local');
    expect(getStudyStorageScope('local')).toBe('local');
  });

  it('isolates an online account from device-only learning data', () => {
    expect(getStudyStorageScope('supabase', 'user-123')).toBe('account-user-123');
    expect(getStudyStorageConfiguration('supabase', 'user-123')).toEqual({
      storageScope: 'account-user-123',
      importStorageScope: 'local',
      accountUserId: 'user-123',
    });
  });

  it('never configures a data import for guest startup', () => {
    expect(getStudyStorageConfiguration('none')).toEqual({ storageScope: 'local' });
    expect(getStudyStorageConfiguration('local')).toEqual({ storageScope: 'local' });
  });

  it('anchors the root route directly to the home tab', () => {
    expect(ROOT_NAVIGATION_ANCHOR).toBe('(tabs)');
    expect(HOME_NAVIGATION_ANCHOR).toBe('(home)');
  });
});

// --- Production: HTTPS App Link only ----------------------------------------

describe('production recovery transport', () => {
  it('sends the reset mail to the verified HTTPS App Link', () => {
    withProductionBuild((navigation) => {
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).toBe(
        'https://lernzeit.de/update-password?type=recovery',
      );
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_KIND).toBe('https-app-link');
      expect(navigation.VERIFIED_RECOVERY_HOST).toBe('lernzeit.de');
    });
  });

  it('keeps the fixed recovery path when the legal base URL carries a path', () => {
    withLegalSiteUrl('https://lernzeit.de/rechtliches', (navigation) => {
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).toBe(
        'https://lernzeit.de/update-password?type=recovery',
      );
    });
  });

  it('accepts the HTTPS callback on the configured domain', () => {
    withProductionBuild((navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(
        'https://lernzeit.de/update-password?code=pkce-code&type=recovery',
      )).toEqual({ kind: 'pkce', code: 'pkce-code' });
      expect(navigation.parsePasswordRecoveryUrl(
        'https://lernzeit.de/update-password#access_token=access&refresh_token=refresh&type=recovery',
      )).toEqual({ kind: 'tokens', accessToken: 'access', refreshToken: 'refresh' });
    });
  });

  /**
   * The decisive production property. Any other installed app may register the
   * private scheme, so a production build that still honoured it could be handed
   * a recovery link of a third party's choosing.
   */
  it.each([
    ['PKCE-Code', 'lernzeit://auth/update-password?code=pkce-code&type=recovery'],
    [
      'Token-Paar',
      'lernzeit://auth/update-password#access_token=a&refresh_token=r&type=recovery',
    ],
  ])('rejects the custom-scheme recovery link (%s)', (_label, url) => {
    withProductionBuild((navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(url)).toBeNull();
      expect(navigation.isPasswordRecoveryUrl(url)).toBe(false);
    });
  });

  it('does not accept the custom scheme as a transport at all', () => {
    withProductionBuild((navigation) => {
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).not.toContain('lernzeit://');
    });
  });

  it.each([
    ['fremde Domain', 'https://evil.test/update-password?code=pkce-code&type=recovery'],
    ['Subdomain-Suffix', 'https://lernzeit.de.evil.test/update-password?code=c&type=recovery'],
    ['HTTP statt HTTPS', 'http://lernzeit.de/update-password?code=c&type=recovery'],
    ['Port', 'https://lernzeit.de:8443/update-password?code=c&type=recovery'],
    ['Zugangsdaten', 'https://user:pw@lernzeit.de/update-password?code=c&type=recovery'],
    ['falscher Pfad', 'https://lernzeit.de/reset?code=c&type=recovery'],
    ['kodierter Slash', 'https://lernzeit.de/update-password%2f..%2fprofile?code=c&type=recovery'],
    ['Backslash', 'https://lernzeit.de/update-password\\..\\profile?code=c&type=recovery'],
    ['doppelter Parameter', 'https://lernzeit.de/update-password?code=a&code=b&type=recovery'],
    ['unbekannter Parameter', 'https://lernzeit.de/update-password?code=a&type=recovery&next=x'],
    ['falscher type', 'https://lernzeit.de/update-password?code=a&type=signup'],
    ['Token-Paar ohne type', 'https://lernzeit.de/update-password#access_token=a&refresh_token=r'],
    ['nur Access-Token', 'https://lernzeit.de/update-password#access_token=a&type=recovery'],
    ['nur Refresh-Token', 'https://lernzeit.de/update-password#refresh_token=r&type=recovery'],
    ['doppeltes Token', 'https://lernzeit.de/update-password#access_token=a&access_token=b&refresh_token=r&type=recovery'],
    ['ungueltiger token_type', 'https://lernzeit.de/update-password#access_token=a&refresh_token=r&type=recovery&token_type=mac'],
    [
      'Query-Code und Fragment-Token zugleich',
      'https://lernzeit.de/update-password?code=a&type=recovery#access_token=a&refresh_token=r&type=recovery',
    ],
  ])('still rejects %s on the HTTPS route', (_label, url) => {
    withProductionBuild((navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(url)).toBeNull();
      expect(navigation.isPasswordRecoveryUrl(url)).toBe(false);
    });
  });
});

// --- Development and preview: private scheme only ---------------------------

describe('development and preview recovery transport', () => {
  it('uses the private scheme when no operator domain exists', () => {
    withDevelopmentBuild((navigation) => {
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).toBe(
        'lernzeit://auth/update-password?type=recovery',
      );
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_KIND).toBe('custom-scheme');
      expect(navigation.VERIFIED_RECOVERY_HOST).toBe('auth');
    });
  });

  it('accepts the exact PKCE callback on the private scheme', () => {
    withDevelopmentBuild((navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(
        'lernzeit://auth/update-password?code=pkce-code&type=recovery',
      )).toEqual({ kind: 'pkce', code: 'pkce-code' });
      expect(navigation.parsePasswordRecoveryUrl(
        'lernzeit://auth/update-password#access_token=access&refresh_token=refresh&type=recovery&token_type=bearer&expires_in=3600',
      )).toEqual({ kind: 'tokens', accessToken: 'access', refreshToken: 'refresh' });
    });
  });

  /** No verified domain exists here, so an HTTPS callback cannot be trusted. */
  it('rejects an HTTPS recovery link without a verified domain', () => {
    withDevelopmentBuild((navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(
        'https://lernzeit.de/update-password?code=c&type=recovery',
      )).toBeNull();
      expect(navigation.parsePasswordRecoveryUrl(
        'https://lernzeit.invalid/update-password?code=c&type=recovery',
      )).toBeNull();
    });
  });

  it.each([
    ['wrong scheme', 'evil://auth/update-password?code=pkce-code'],
    ['wrong host', 'lernzeit://attacker/update-password?code=pkce-code'],
    ['wrong path', 'lernzeit://auth/other?code=pkce-code'],
    ['code on normal link', 'lernzeit://auth/profile?code=pkce-code'],
    ['tampered fragment', 'lernzeit://auth/update-password#access_token=a&refresh_token=r&type=signup'],
    ['access only', 'lernzeit://auth/update-password#access_token=a&type=recovery'],
    ['refresh only', 'lernzeit://auth/update-password#refresh_token=r&type=recovery'],
    ['embedded credentials', 'lernzeit://user:password@auth/update-password?code=pkce-code'],
    ['encoded traversal', 'lernzeit://auth/%2e%2e/update-password?code=pkce-code'],
    ['encoded slash', 'lernzeit://auth/update-password%2f..%2fprofile?code=pkce-code'],
    ['duplicate code', 'lernzeit://auth/update-password?code=one&code=two'],
    ['conflicting locations', 'lernzeit://auth/update-password?code=one#access_token=a&refresh_token=r&type=recovery'],
    ['recovery type on wrong route', 'lernzeit://auth/profile?type=recovery&code=pkce-code'],
    ['unknown auth parameter', 'lernzeit://auth/update-password?code=one&next=https%3A%2F%2Fevil.test'],
    ['token pair without recovery type', 'lernzeit://auth/update-password#access_token=a&refresh_token=r'],
    ['duplicate token', 'lernzeit://auth/update-password#access_token=a&access_token=b&refresh_token=r&type=recovery'],
    ['invalid token type', 'lernzeit://auth/update-password#access_token=a&refresh_token=r&type=recovery&token_type=mac'],
    ['missing recovery type', 'lernzeit://auth/update-password?code=pkce-code'],
  ])('rejects %s', (_label, url) => {
    withDevelopmentBuild((navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(url)).toBeNull();
      expect(navigation.isPasswordRecoveryUrl(url)).toBe(false);
    });
  });
});

// --- The transport follows the profile, never the domain --------------------

describe('recovery transport per build profile', () => {
  /**
   * The distinction this whole split exists for. A development or preview build
   * can be handed the real operator values, and deriving the transport from
   * "is a domain configured?" would make it claim an App Link whose development
   * signing certificate is not listed in the operator's assetlinks.json.
   */
  it.each(['development', 'preview'])(
    'keeps the private scheme in a %s build that has a real operator domain',
    (profile) => {
      withBuild(
        { EXPO_PUBLIC_BUILD_PROFILE: profile, EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de' },
        (navigation) => {
          expect(navigation.PASSWORD_RECOVERY_REDIRECT_KIND).toBe('custom-scheme');
          expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).toBe(
            'lernzeit://auth/update-password?type=recovery',
          );
          expect(navigation.parsePasswordRecoveryUrl(
            'https://lernzeit.de/update-password?code=c&type=recovery',
          )).toBeNull();
        },
      );
    },
  );

  it.each(['development', 'preview'])('uses the private scheme in a %s build without a domain', (profile) => {
    withBuild({ EXPO_PUBLIC_BUILD_PROFILE: profile }, (navigation) => {
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_KIND).toBe('custom-scheme');
      expect(navigation.PASSWORD_RECOVERY_AVAILABLE).toBe(true);
    });
  });

  /**
   * Without `expo.scheme` Expo falls back to the Android package name as the
   * app's general scheme. That is acceptable only because the parser does not
   * treat it as a recovery transport.
   */
  it('never accepts the Android package scheme as a recovery transport', () => {
    for (const build of [withProductionBuild, withDevelopmentBuild]) {
      build((navigation) => {
        expect(navigation.parsePasswordRecoveryUrl(
          'de.lernzeit.app://auth/update-password?code=c&type=recovery',
        )).toBeNull();
        expect(navigation.parsePasswordRecoveryUrl(
          'de.lernzeit.app://update-password?code=c&type=recovery',
        )).toBeNull();
      });
    }
  });

  /** A production build with no manifest attestation must not send anything. */
  it('disables recovery in a production build whose manifest is not attested', () => {
    const previousProfile = process.env.EXPO_PUBLIC_BUILD_PROFILE;
    const previousUrl = process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
    const previousAttestation = embeddedAuthBuildAttestation.value;
    process.env.EXPO_PUBLIC_BUILD_PROFILE = 'production';
    process.env.EXPO_PUBLIC_LEGAL_SITE_URL = 'https://lernzeit.de';
    embeddedAuthBuildAttestation.value = undefined;

    try {
      jest.isolateModules(() => {
        const navigation = require('@/auth/navigation') as NavigationModule;
        expect(navigation.PASSWORD_RECOVERY_AVAILABLE).toBe(false);
        expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).toBe('');
        expect(navigation.parsePasswordRecoveryUrl(
          'https://lernzeit.de/update-password?code=c&type=recovery',
        )).toBeNull();
      });
    } finally {
      if (previousProfile === undefined) delete process.env.EXPO_PUBLIC_BUILD_PROFILE;
      else process.env.EXPO_PUBLIC_BUILD_PROFILE = previousProfile;
      if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
      else process.env.EXPO_PUBLIC_LEGAL_SITE_URL = previousUrl;
      embeddedAuthBuildAttestation.value = previousAttestation;
      jest.resetModules();
    }
  });
});

describe('recovery transport of the test build', () => {
  it('exposes a redirect that matches the resolved transport', () => {
    expect(PASSWORD_RECOVERY_REDIRECT_URL.startsWith(
      PASSWORD_RECOVERY_REDIRECT_KIND === 'https-app-link' ? 'https://' : 'lernzeit://',
    )).toBe(true);
    expect(PASSWORD_RECOVERY_REDIRECT_URL).toContain('/update-password?type=recovery');
    expect(VERIFIED_RECOVERY_HOST).toMatch(/^[a-z0-9.-]+$/);
  });

  it('never treats an unrelated deep link as recovery material', () => {
    expect(isPasswordRecoveryUrl('lernzeit://auth/profile')).toBe(false);
    expect(isPasswordRecoveryUrl(null)).toBe(false);
  });
});
