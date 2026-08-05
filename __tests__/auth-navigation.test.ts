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

type NavigationModule = typeof import('@/auth/navigation');

/**
 * Reloads the navigation module with a given operator domain.
 *
 * The recovery transport is resolved once when the module is first evaluated,
 * exactly as Metro inlines EXPO_PUBLIC_LEGAL_SITE_URL into the bundle: a domain
 * means the verified App Link, no domain means the private scheme.
 */
function withLegalSiteUrl<T>(value: string | undefined, run: (module: NavigationModule) => T): T {
  const previous = process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
  if (value === undefined) delete process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
  else process.env.EXPO_PUBLIC_LEGAL_SITE_URL = value;

  let result!: T;
  try {
    jest.isolateModules(() => {
      result = run(require('@/auth/navigation') as NavigationModule);
    });
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
    else process.env.EXPO_PUBLIC_LEGAL_SITE_URL = previous;
    jest.resetModules();
  }
  return result;
}

/** A build with a real operator domain, i.e. the production shape. */
const withProductionBuild = <T,>(run: (module: NavigationModule) => T): T =>
  withLegalSiteUrl('https://lernzeit.de', run);

/** A build without an operator domain, i.e. development and preview. */
const withDevelopmentBuild = <T,>(run: (module: NavigationModule) => T): T =>
  withLegalSiteUrl(undefined, run);

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
