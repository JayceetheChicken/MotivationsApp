import {
  getStudyStorageConfiguration,
  getStudyStorageScope,
  HOME_NAVIGATION_ANCHOR,
  isPasswordRecoveryUrl,
  parsePasswordRecoveryUrl,
  PASSWORD_RECOVERY_REDIRECT_KIND,
  PASSWORD_RECOVERY_REDIRECT_URL,
  ROOT_NAVIGATION_ANCHOR,
  VERIFIED_RECOVERY_HOST,
} from '@/auth/navigation';

type NavigationModule = typeof import('@/auth/navigation');

/**
 * Reloads the navigation module with a given operator domain.
 *
 * PASSWORD_RECOVERY_REDIRECT_URL and VERIFIED_RECOVERY_HOST are derived from
 * EXPO_PUBLIC_LEGAL_SITE_URL when the module is first evaluated, exactly as
 * Metro inlines it into the bundle.
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

  it('accepts only the exact PKCE password-recovery callback', () => {
    expect(parsePasswordRecoveryUrl(
      'lernzeit://auth/update-password?code=pkce-code&type=recovery',
    )).toEqual({ kind: 'pkce', code: 'pkce-code' });
    expect(isPasswordRecoveryUrl(
      'lernzeit://auth/update-password?code=pkce-code',
    )).toBe(false);
  });

  it('accepts a complete recovery token pair with strict metadata', () => {
    expect(parsePasswordRecoveryUrl(
      'lernzeit://auth/update-password#access_token=access&refresh_token=refresh&type=recovery&token_type=bearer&expires_in=3600',
    )).toEqual({ kind: 'tokens', accessToken: 'access', refreshToken: 'refresh' });
  });

  it.each([
    ['wrong scheme', 'evil://auth/update-password?code=pkce-code'],
    ['wrong host', 'lernzeit://attacker/update-password?code=pkce-code'],
    ['wrong path', 'lernzeit://auth/other?code=pkce-code'],
    ['code on normal link', 'lernzeit://auth/profile?code=pkce-code'],
    ['tampered fragment', 'lernzeit://auth/update-password#access_token=a&refresh_token=r&type=signup'],
    ['access only', 'lernzeit://auth/update-password#access_token=a&type=recovery'],
    ['refresh only', 'lernzeit://auth/update-password#refresh_token=r&type=recovery'],
    ['foreign HTTPS domain', 'https://example.test/update-password?code=pkce-code'],
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
  ])('rejects %s', (_label, url) => {
    expect(parsePasswordRecoveryUrl(url)).toBeNull();
    expect(isPasswordRecoveryUrl(url)).toBe(false);
  });
});

describe('password recovery redirect', () => {
  it('uses the verified HTTPS App Link when an operator domain is configured', () => {
    withLegalSiteUrl('https://lernzeit.de', (navigation) => {
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

  it('falls back to the private scheme only without a real domain', () => {
    withLegalSiteUrl(undefined, (navigation) => {
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).toBe(
        'lernzeit://auth/update-password?type=recovery',
      );
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_KIND).toBe('custom-scheme');
    });
  });

  it('accepts the HTTPS callback on the configured domain', () => {
    withLegalSiteUrl('https://lernzeit.de', (navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(
        'https://lernzeit.de/update-password?code=pkce-code&type=recovery',
      )).toEqual({ kind: 'pkce', code: 'pkce-code' });
      expect(navigation.parsePasswordRecoveryUrl(
        'https://lernzeit.de/update-password#access_token=access&refresh_token=refresh&type=recovery',
      )).toEqual({ kind: 'tokens', accessToken: 'access', refreshToken: 'refresh' });
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
    [
      'Query-Code und Fragment-Token zugleich',
      'https://lernzeit.de/update-password?code=a&type=recovery#access_token=a&refresh_token=r&type=recovery',
    ],
  ])('still rejects %s on the HTTPS route', (_label, url) => {
    withLegalSiteUrl('https://lernzeit.de', (navigation) => {
      expect(navigation.parsePasswordRecoveryUrl(url)).toBeNull();
      expect(navigation.isPasswordRecoveryUrl(url)).toBe(false);
    });
  });

  it('exposes a redirect that matches the resolved kind', () => {
    expect(PASSWORD_RECOVERY_REDIRECT_URL.startsWith(
      PASSWORD_RECOVERY_REDIRECT_KIND === 'https-app-link' ? 'https://' : 'lernzeit://',
    )).toBe(true);
    expect(PASSWORD_RECOVERY_REDIRECT_URL).toContain('/update-password?type=recovery');
    expect(VERIFIED_RECOVERY_HOST).toMatch(/^[a-z0-9.-]+$/);
  });
});
