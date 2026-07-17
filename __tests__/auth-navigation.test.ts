import {
  getStudyStorageConfiguration,
  getStudyStorageScope,
  HOME_NAVIGATION_ANCHOR,
  isPasswordRecoveryUrl,
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

  it('recognizes only credential-bearing password recovery deep links', () => {
    expect(isPasswordRecoveryUrl('lernzeit://update-password?code=pkce-code')).toBe(true);
    expect(isPasswordRecoveryUrl('https://lernzeit.app/update-password?code=pkce-code')).toBe(true);
    expect(isPasswordRecoveryUrl('https://lernzeit.app/#type=recovery&access_token=access&refresh_token=refresh')).toBe(true);
    expect(isPasswordRecoveryUrl('lernzeit://update-password')).toBe(false);
    expect(isPasswordRecoveryUrl('https://lernzeit.app/?code=ordinary-login')).toBe(false);
    expect(isPasswordRecoveryUrl(null)).toBe(false);
  });
});
