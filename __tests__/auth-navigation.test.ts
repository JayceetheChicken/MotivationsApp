import {
  getRequiredAuthRoute,
  getStudyStorageConfiguration,
  getStudyStorageScope,
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

  it('never configures a data import or login requirement for guest startup', () => {
    expect(getStudyStorageConfiguration('none')).toEqual({ storageScope: 'local' });
    expect(getStudyStorageConfiguration('local')).toEqual({ storageScope: 'local' });
    expect(getRequiredAuthRoute({
      onPasswordUpdateRoute: false,
      passwordRecoveryPending: false,
      ready: false,
    })).toBeNull();
  });

  it('does not require a login route after hydration', () => {
    expect(getRequiredAuthRoute({
      onPasswordUpdateRoute: false,
      passwordRecoveryPending: false,
      ready: true,
    })).toBeNull();
  });

  it('preserves the password-recovery redirect', () => {
    expect(getRequiredAuthRoute({
      onPasswordUpdateRoute: false,
      passwordRecoveryPending: true,
      ready: true,
    })).toBe('/update-password');
    expect(getRequiredAuthRoute({
      onPasswordUpdateRoute: true,
      passwordRecoveryPending: true,
      ready: true,
    })).toBeNull();
  });
});
