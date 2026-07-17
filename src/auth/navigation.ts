export type AuthMode = 'none' | 'supabase' | 'local';

export function getStudyStorageScope(
  activeMode: AuthMode,
  accountUserId?: string,
): string {
  return activeMode === 'supabase' && accountUserId
    ? `account-${accountUserId}`
    : 'local';
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
