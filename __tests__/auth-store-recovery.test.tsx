/**
 * End-to-end proof that a build with a real operator domain hands Supabase the
 * verified HTTPS App Link instead of the private `lernzeit://` scheme.
 *
 * PASSWORD_RECOVERY_REDIRECT_URL is derived from EXPO_PUBLIC_LEGAL_SITE_URL
 * when @/legal/operator is first evaluated, exactly as Metro inlines it into
 * the bundle. The store is therefore loaded with `require` *after* the
 * environment variable is set - `import` declarations are hoisted and would
 * evaluate the module too early. This needs its own file so the module graph is
 * fresh; jest.isolateModules would hand the store a second React instance.
 */
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockResetPasswordForEmail = jest.fn();
const mockStorageGetItem = jest.fn<Promise<string | null>, [string]>();
const mockStorageSetItem = jest.fn<Promise<void>, [string, string]>();
const mockStorageRemoveItem = jest.fn<Promise<void>, [string]>();

jest.mock('expo-linking', () => ({
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  createURL: jest.fn((path: string) => `lernzeit://${path}`),
  getInitialURL: jest.fn(async () => null),
}));

jest.mock('@/auth/storage', () => ({
  authStorage: {
    getItem: (key: string) => mockStorageGetItem(key),
    removeItem: (key: string) => mockStorageRemoveItem(key),
    setItem: (key: string, value: string) => mockStorageSetItem(key, value),
  },
}));

jest.mock('@/auth/account-deletion', () => ({
  requestOnlineAccountDeletion: jest.fn(async () => undefined),
}));

jest.mock('@/auth/account-local-cleanup', () => ({
  clearAccountLocalData: jest.fn(() => []),
}));

jest.mock('@/auth/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: jest.fn(async () => ({ data: { session: null }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      setSession: jest.fn(async () => ({ data: { session: null }, error: null })),
      resetPasswordForEmail: (email: string, options: unknown) => (
        mockResetPasswordForEmail(email, options)
      ),
      signOut: jest.fn(async () => ({ error: null })),
    },
    removeAllChannels: jest.fn(async () => []),
  },
  supabaseConfiguration: {
    isConfigured: true,
    mode: 'supabase',
    message: 'Online-Anmeldung verfügbar.',
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        extra: {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          authBuildAttestation: require('./support/auth-build-manifest')
            .embeddedAuthBuildAttestation.value,
        },
      };
    },
  },
}));

const OPERATOR_DOMAIN = 'https://lernzeit.de';
const EXPECTED_REDIRECT = 'https://lernzeit.de/update-password?type=recovery';

// A production build: the profile decides the transport, and the manifest
// attestation has to agree with the bundle before recovery is enabled at all.
process.env.EXPO_PUBLIC_BUILD_PROFILE = 'production';
process.env.EXPO_PUBLIC_LEGAL_SITE_URL = OPERATOR_DOMAIN;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const manifest = require('./support/auth-build-manifest') as typeof import('./support/auth-build-manifest');
manifest.embeddedAuthBuildAttestation.value = manifest.attestationFor(process.env);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const navigation = require('@/auth/navigation') as typeof import('@/auth/navigation');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthStoreProvider, useAuthStore } = require('@/state/auth-store') as typeof import('@/state/auth-store');

function wrapper({ children }: PropsWithChildren) {
  return <AuthStoreProvider>{children}</AuthStoreProvider>;
}

describe('password recovery with a configured operator domain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockStorageGetItem.mockResolvedValue(null);
    mockStorageSetItem.mockResolvedValue();
    mockStorageRemoveItem.mockResolvedValue();
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
  });

  afterAll(() => {
    jest.restoreAllMocks();
    delete process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
    delete process.env.EXPO_PUBLIC_BUILD_PROFILE;
  });

  it('derives the verified HTTPS App Link', () => {
    expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).toBe(EXPECTED_REDIRECT);
    expect(navigation.PASSWORD_RECOVERY_REDIRECT_KIND).toBe('https-app-link');
    expect(navigation.VERIFIED_RECOVERY_HOST).toBe('lernzeit.de');
    expect(navigation.PASSWORD_RECOVERY_AVAILABLE).toBe(true);
  });

  it('hands exactly that URL to resetPasswordForEmail', async () => {
    const store = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(store.result.current.hydrated).toBe(true));

    await act(async () => {
      await store.result.current.sendPasswordReset(' Lea@Example.com ');
    });

    expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('lea@example.com', {
      redirectTo: EXPECTED_REDIRECT,
    });

    const [, options] = mockResetPasswordForEmail.mock.calls[0] as [string, { redirectTo: string }];
    expect(options.redirectTo.startsWith('https://')).toBe(true);
    expect(options.redirectTo).not.toContain('lernzeit://');
    await store.unmount();
  });

  it('accepts the callback that Supabase will send back', () => {
    expect(navigation.parsePasswordRecoveryUrl(
      `${EXPECTED_REDIRECT.replace('?type=recovery', '')}?code=pkce-code&type=recovery`,
    )).toEqual({ kind: 'pkce', code: 'pkce-code' });
  });

  it('rejects the same callback shape on any other domain', () => {
    expect(navigation.parsePasswordRecoveryUrl(
      'https://evil.test/update-password?code=pkce-code&type=recovery',
    )).toBeNull();
  });
});
