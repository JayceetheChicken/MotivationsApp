export type AuthMode = 'none' | 'supabase' | 'local';

export const ROOT_NAVIGATION_ANCHOR = '(tabs)' as const;
export const HOME_NAVIGATION_ANCHOR = '(home)' as const;

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

export function getStartupRoute({
  hasResolvedRoute,
  onHomeRoute,
  onPasswordUpdateRoute,
  passwordRecoveryPending,
  ready,
}: {
  hasResolvedRoute: boolean;
  onHomeRoute: boolean;
  onPasswordUpdateRoute: boolean;
  passwordRecoveryPending: boolean;
  ready: boolean;
}): '/' | '/update-password' | null {
  if (!ready || !hasResolvedRoute) return null;
  if (passwordRecoveryPending) {
    return onPasswordUpdateRoute ? null : '/update-password';
  }
  return onHomeRoute ? null : '/';
}

export function isPasswordRecoveryUrl(url: string | null): boolean {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url);
    const fragment = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
    const route = `${parsedUrl.hostname}${parsedUrl.pathname}`.toLowerCase();
    const hasRecoveryTarget = route.includes('update-password')
      || parsedUrl.searchParams.get('type') === 'recovery'
      || fragment.get('type') === 'recovery';
    const hasCode = Boolean(parsedUrl.searchParams.get('code'));
    const hasTokenPair = Boolean(
      fragment.get('access_token') && fragment.get('refresh_token'),
    );

    return hasRecoveryTarget && (hasCode || hasTokenPair);
  } catch {
    return false;
  }
}
