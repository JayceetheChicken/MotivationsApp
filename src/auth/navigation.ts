export type AuthMode = 'none' | 'supabase' | 'local';

export function getStudyStorageScope(
  activeMode: AuthMode,
  accountUserId?: string,
): string {
  return activeMode === 'supabase' && accountUserId
    ? `account-${accountUserId}`
    : 'local';
}

export interface StudyStorageConfiguration {
  storageScope: string;
  importStorageScope?: string;
  accountUserId?: string;
}

export function getStudyStorageConfiguration(
  activeMode: AuthMode,
  accountUserId?: string,
): StudyStorageConfiguration {
  const cleanAccountUserId = accountUserId?.trim();
  if (activeMode !== 'supabase' || !cleanAccountUserId) {
    return { storageScope: 'local' };
  }

  return {
    storageScope: getStudyStorageScope(activeMode, cleanAccountUserId),
    importStorageScope: 'local',
    accountUserId: cleanAccountUserId,
  };
}

export function getRequiredAuthRoute({
  onPasswordUpdateRoute,
  passwordRecoveryPending,
  ready,
}: {
  onPasswordUpdateRoute: boolean;
  passwordRecoveryPending: boolean;
  ready: boolean;
}): '/update-password' | null {
  if (!ready) return null;
  return passwordRecoveryPending && !onPasswordUpdateRoute
    ? '/update-password'
    : null;
}
