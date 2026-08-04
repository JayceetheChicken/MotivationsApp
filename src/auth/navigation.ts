import { legalSiteHost, PASSWORD_RECOVERY_REDIRECT } from '@/legal/operator';

export type AuthMode = 'none' | 'supabase' | 'local';

export const ROOT_NAVIGATION_ANCHOR = '(tabs)' as const;
export const HOME_NAVIGATION_ANCHOR = '(home)' as const;

/**
 * Callback handed to `supabase.auth.resetPasswordForEmail`.
 *
 * With a configured operator domain this is
 * `https://<domain>/update-password?type=recovery`, a verified Android App Link
 * that no other app can intercept. `lernzeit://auth/update-password?type=recovery`
 * is only used when no real domain exists, which the release gate permits solely
 * for development and preview builds.
 *
 * Both forms are derived in config/release-config.cjs, the same module that
 * app.config.js uses for the App Link intent filter, so the app and the manifest
 * cannot disagree about the host.
 */
export const PASSWORD_RECOVERY_REDIRECT_URL: string = PASSWORD_RECOVERY_REDIRECT.url;

/** 'https-app-link' in every correctly configured production build. */
export const PASSWORD_RECOVERY_REDIRECT_KIND = PASSWORD_RECOVERY_REDIRECT.kind;

/**
 * The single HTTPS host that may deliver a recovery callback. Derived from the
 * operator domain so it can never drift apart from the verified Android App
 * Link declared in app.config.js.
 */
export const VERIFIED_RECOVERY_HOST: string = legalSiteHost();

const RECOVERY_SCHEME = 'lernzeit:';
const RECOVERY_HOST = 'auth';
const RECOVERY_PATH = '/update-password';
const MAX_AUTH_PARAMETER_LENGTH = 16_384;

export type PasswordRecoveryRequest =
  | Readonly<{ kind: 'pkce'; code: string }>
  | Readonly<{ kind: 'tokens'; accessToken: string; refreshToken: string }>;

export function passwordRecoveryRequestFingerprint(request: PasswordRecoveryRequest): string {
  const value = request.kind === 'pkce'
    ? `pkce:${request.code}`
    : `tokens:${request.accessToken}:${request.refreshToken}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${request.kind}:${(hash >>> 0).toString(16).padStart(8, '0')}:${value.length}`;
}

export function hasPasswordRecoveryMaterial(url: string | null): boolean {
  if (!url || url.length > 40_000) return false;
  return /(?:[?#&])(code|access_token|refresh_token|type)=/i.test(url);
}

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

function hasOnlyUniqueParameters(
  parameters: URLSearchParams,
  allowed: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>();
  for (const [key] of parameters) {
    if (!allowed.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function isSafeAuthValue(value: string | null, maxLength = MAX_AUTH_PARAMETER_LENGTH): value is string {
  return Boolean(
    value
    && value.length <= maxLength
    && !/[\u0000-\u0020\u007f]/.test(value),
  );
}

/**
 * Accepts only the one production recovery callback owned by this app. Normal
 * deep links are deliberately ignored even when they carry auth-looking keys.
 */
export function parsePasswordRecoveryUrl(url: string | null): PasswordRecoveryRequest | null {
  if (!url || url.length > 40_000) return null;

  try {
    const routeText = url.split(/[?#]/, 1)[0];
    // Do not let URL normalization turn encoded dot/slash segments into the
    // allowlisted route after validation.
    if (/%[0-9a-f]{2}|\\/i.test(routeText)) return null;

    const parsedUrl = new URL(url);
    const isCustomRecoveryRoute = parsedUrl.protocol.toLowerCase() === RECOVERY_SCHEME
      && parsedUrl.hostname.toLowerCase() === RECOVERY_HOST;
    const isVerifiedRecoveryRoute = parsedUrl.protocol.toLowerCase() === 'https:'
      && parsedUrl.hostname.toLowerCase() === VERIFIED_RECOVERY_HOST;
    if (
      (!isCustomRecoveryRoute && !isVerifiedRecoveryRoute)
      || parsedUrl.port !== ''
      || parsedUrl.pathname !== RECOVERY_PATH
      || parsedUrl.username !== ''
      || parsedUrl.password !== ''
    ) return null;

    const fragment = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
    const query = parsedUrl.searchParams;
    const code = query.get('code');

    if (code !== null) {
      if (parsedUrl.hash) return null;
      if (!hasOnlyUniqueParameters(query, new Set(['code', 'type']))) return null;
      const type = query.get('type');
      if (type !== 'recovery' || !isSafeAuthValue(code, 4096)) return null;
      return { kind: 'pkce', code };
    }

    if (parsedUrl.search) return null;
    if (!hasOnlyUniqueParameters(
      fragment,
      new Set(['access_token', 'refresh_token', 'type', 'token_type', 'expires_in', 'expires_at']),
    )) return null;
    if (fragment.get('type') !== 'recovery') return null;

    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (!isSafeAuthValue(accessToken) || !isSafeAuthValue(refreshToken)) return null;
    const tokenType = fragment.get('token_type');
    if (tokenType !== null && tokenType.toLowerCase() !== 'bearer') return null;
    for (const key of ['expires_in', 'expires_at']) {
      const value = fragment.get(key);
      if (value !== null && (!/^[0-9]{1,12}$/.test(value) || Number(value) <= 0)) return null;
    }

    return { kind: 'tokens', accessToken, refreshToken };
  } catch {
    return null;
  }
}

export function isPasswordRecoveryUrl(url: string | null): boolean {
  return parsePasswordRecoveryUrl(url) !== null;
}
