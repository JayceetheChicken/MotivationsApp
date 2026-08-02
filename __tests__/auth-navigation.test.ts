import {
  getStudyStorageConfiguration,
  getStudyStorageScope,
  HOME_NAVIGATION_ANCHOR,
  isPasswordRecoveryUrl,
  parsePasswordRecoveryUrl,
  PASSWORD_RECOVERY_REDIRECT_URL,
  ROOT_NAVIGATION_ANCHOR,
} from '@/auth/navigation';

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
    expect(PASSWORD_RECOVERY_REDIRECT_URL).toBe('lernzeit://auth/update-password');
    expect(parsePasswordRecoveryUrl(
      'lernzeit://auth/update-password?code=pkce-code&type=recovery',
    )).toEqual({ kind: 'pkce', code: 'pkce-code' });
    expect(isPasswordRecoveryUrl(
      'lernzeit://auth/update-password?code=pkce-code',
    )).toBe(true);
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
