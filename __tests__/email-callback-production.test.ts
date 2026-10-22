jest.mock('@/auth/build-configuration', () => ({
  AUTH_BUILD_CONFIGURATION: { profile: 'production', recoveryRedirectUrl: 'https://lernzeit.de/update-password?type=recovery' },
  AUTH_BUILD_IS_CONSISTENT: true,
}));
import { EMAIL_CONFIRMATION_REDIRECT_URL, parseEmailCallback } from '@/auth/email-callback';
import { redirectSystemPath } from '@/app/+native-intent';

it('preserves the verified HTTPS-only production entry point and separates recovery', () => {
  expect(EMAIL_CONFIRMATION_REDIRECT_URL).toBe('https://lernzeit.de/update-password?type=signup');
  expect(parseEmailCallback('lernzeit://auth/callback?code=x')).toBeNull();
  expect(parseEmailCallback('https://lernzeit.de/update-password?type=signup&code=x')).toEqual({ code: 'x' });
  expect(parseEmailCallback('https://lernzeit.de/update-password?type=recovery&code=x')).toBeNull();
  expect(redirectSystemPath({ path: 'https://lernzeit.de/update-password?type=signup&code=x', initial: true }))
    .toBe('/auth/callback');
});
