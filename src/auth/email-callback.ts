import { AUTH_BUILD_CONFIGURATION, AUTH_BUILD_IS_CONSISTENT } from '@/auth/build-configuration';

// Production retains PR #5's verified HTTPS-only native entry point. The
// shareable preview APK uses the explicitly registered lernzeit callback.
export const EMAIL_CONFIRMATION_REDIRECT_URL = AUTH_BUILD_CONFIGURATION.profile === 'production'
  ? AUTH_BUILD_CONFIGURATION.recoveryRedirectUrl.replace('type=recovery', 'type=signup')
  : 'lernzeit://auth/callback';

export function isEmailCallbackRoute(value: string | null): boolean {
  if (!value || value.length > 40_000 || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value) || !AUTH_BUILD_IS_CONSISTENT) return false;
  try {
    if (/%[0-9a-f]{2}|\\|\/\.{1,2}(?:\/|$)/i.test(value.split(/[?#]/, 1)[0])) return false;
    const url = new URL(value);
    const expected = new URL(EMAIL_CONFIRMATION_REDIRECT_URL);
    return url.protocol === expected.protocol && url.hostname === expected.hostname
      && url.pathname === expected.pathname && !url.port && !url.username && !url.password
      && (AUTH_BUILD_CONFIGURATION.profile !== 'production' || url.searchParams.get('type') === 'signup');
  } catch { return false; }
}

export function parseEmailCallback(value: string | null): { code: string; flowId?: string } | null {
  if (!isEmailCallbackRoute(value)) return null;
  const url = new URL(value!);
  // Never import bearer tokens from an arbitrary deep link (login CSRF).
  if (url.hash) return null;
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!['code', 'sb_flow_id', 'type'].includes(key) || seen.has(key)) return null;
    seen.add(key);
  }
  const code = url.searchParams.get('code');
  const flowId = url.searchParams.get('sb_flow_id');
  const type = url.searchParams.get('type');
  if (!code || code.length > 4096 || /[\u0000-\u0020\u007f]/.test(code)
    || (type !== null && type !== 'signup')
    || (flowId !== null && !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId))) return null;
  return { code, ...(flowId ? { flowId } : {}) };
}
