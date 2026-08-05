import {
  AUTH_BUILD_CONFIGURATION,
  AUTH_BUILD_IS_CONSISTENT,
} from '@/auth/build-configuration';

export type AuthMode = 'none' | 'supabase' | 'local';

export const ROOT_NAVIGATION_ANCHOR = '(tabs)' as const;
export const HOME_NAVIGATION_ANCHOR = '(home)' as const;

/**
 * Callback handed to `supabase.auth.resetPasswordForEmail`.
 *
 * In a production build this is always
 * `https://<operator-domain>/update-password?type=recovery`, a verified Android
 * App Link that no other app can intercept. `lernzeit://auth/update-password`
 * exists only in development and preview builds, where no verified domain is
 * available; the release gate refuses to build production in that state.
 *
 * The value comes from config/auth-build.cjs, the same module app.config.js
 * uses for the intent filters, so the mail, the manifest and the parser below
 * cannot disagree about host or transport.
 */
export const PASSWORD_RECOVERY_REDIRECT_URL: string = AUTH_BUILD_CONFIGURATION.recoveryRedirectUrl;

/** 'https-app-link' in every production build, 'custom-scheme' otherwise. */
export const PASSWORD_RECOVERY_REDIRECT_KIND = AUTH_BUILD_CONFIGURATION.recoveryTransport;

/**
 * The single host that may deliver a recovery callback: the operator domain for
 * an App Link build, `auth` for a private-scheme build.
 */
export const VERIFIED_RECOVERY_HOST: string = AUTH_BUILD_CONFIGURATION.recoveryHost;

/**
 * False when the manifest and the bundle describe different transports. Every
 * recovery entry point then refuses to act; see
 * src/auth/build-configuration.ts.
 */
export const PASSWORD_RECOVERY_AVAILABLE: boolean = AUTH_BUILD_IS_CONSISTENT;

const CUSTOM_RECOVERY_PROTOCOL = 'lernzeit:';
const CUSTOM_RECOVERY_HOST = 'auth';
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
 * Accepts only the one recovery callback this build actually uses.
 *
 * Deliberately *not* "either transport": a production build must reject
 * `lernzeit://auth/update-password` outright. That scheme can be registered by
 * any other installed app, so accepting it would let a second app hand the
 * running Lernzeit app a recovery link of its choosing. A development build in
 * turn has no verified domain, so it must not honour an HTTPS callback either.
 *
 * Normal deep links are ignored even when they carry auth-looking keys.
 */
export function parsePasswordRecoveryUrl(url: string | null): PasswordRecoveryRequest | null {
  if (!url || url.length > 40_000) return null;
  // Manifest and bundle disagree about the transport: accept nothing.
  if (!PASSWORD_RECOVERY_AVAILABLE) return null;

  try {
    const routeText = url.split(/[?#]/, 1)[0];
    // Do not let URL normalization turn encoded dot/slash segments into the
    // allowlisted route after validation.
    if (/%[0-9a-f]{2}|\\/i.test(routeText)) return null;

    const parsedUrl = new URL(url);
    const isCustomRecoveryRoute = AUTH_BUILD_CONFIGURATION.acceptsCustomRecoveryScheme
      && parsedUrl.protocol.toLowerCase() === CUSTOM_RECOVERY_PROTOCOL
      && parsedUrl.hostname.toLowerCase() === CUSTOM_RECOVERY_HOST;
    const isVerifiedRecoveryRoute = AUTH_BUILD_CONFIGURATION.recoveryTransport === 'https-app-link'
      && parsedUrl.protocol.toLowerCase() === 'https:'
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
