jest.mock('@/auth/build-configuration', () => ({
  AUTH_BUILD_CONFIGURATION: { profile: 'preview', recoveryRedirectUrl: '' }, AUTH_BUILD_IS_CONSISTENT: true,
}));
import { EMAIL_CONFIRMATION_REDIRECT_URL, parseEmailCallback } from '@/auth/email-callback';
import { redirectSystemPath } from '@/app/+native-intent';

it('uses the installed APK callback and strips credentials from Router state', () => {
  expect(EMAIL_CONFIRMATION_REDIRECT_URL).toBe('lernzeit://auth/callback');
  expect(parseEmailCallback('lernzeit://auth/callback?code=valid-code')).toEqual({ code: 'valid-code' });
  expect(redirectSystemPath({ path: 'lernzeit://auth/callback?code=secret', initial: true }))
    .toBe('/auth/callback');
  expect(redirectSystemPath({ path: 'lernzeit://auth/callback#error=otp_expired', initial: false }))
    .toBe('/auth/callback');
  expect(redirectSystemPath({ path: '/profile', initial: false })).toBe('/profile');
});


it.each([
  'https://auth/callback?code=x', 'lernzeit://evil/callback?code=x',
  'lernzeit://auth:123/callback?code=x', 'lernzeit://user@auth/callback?code=x',
  'lernzeit://auth/a/../callback?code=x', 'lernzeit://auth/%63allback?code=x',
  'lernzeit://auth/callback?code=x&code=y', 'lernzeit://auth/callback?code=x&next=/profile',
  'lernzeit://auth/callback?code=x&type=recovery', 'lernzeit://auth/callback?code=x#access_token=y',
  'lernzeit://auth/callback?code=x&sb_flow_id=bad', 'lernzeit://auth/callback?code=%00',
  'lernzeit://auth/callback#access_token=x&refresh_token=y',
])('rejects malformed, substituted and bearer-token callbacks: %s', (url) => {
  expect(parseEmailCallback(url)).toBeNull();
});
