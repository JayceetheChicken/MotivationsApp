import { isEmailCallbackRoute } from '@/auth/email-callback';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // AuthStore owns the original Linking event and code exchange. Never put
  // codes, provider errors or bearer fragments into Router's navigation state.
  return isEmailCallbackRoute(path) ? '/auth/callback' : path;
}
