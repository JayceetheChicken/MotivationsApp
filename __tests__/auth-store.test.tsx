import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { PASSWORD_RECOVERY_REDIRECT_URL } from '@/auth/navigation';
import { AuthStoreProvider, useAuthStore } from '@/state/auth-store';

import { attestationFor, embeddedAuthBuildAttestation } from './support/auth-build-manifest';

const mockGetInitialURL = jest.fn<Promise<string | null>, []>();
const mockGetSession = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockSetSession = jest.fn();
const mockStorageGetItem = jest.fn<Promise<string | null>, [string]>();
const mockStorageSetItem = jest.fn<Promise<void>, [string, string]>();
const mockStorageRemoveItem = jest.fn<Promise<void>, [string]>();
const mockDeleteRequest = jest.fn<Promise<void>, [unknown, string]>();
const mockClearAccountLocalData = jest.fn<readonly string[], [unknown, string]>();
const mockRemoveAllChannels = jest.fn<Promise<unknown>, []>();
const mockSignOut = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockSignUp = jest.fn();
let mockLinkHandler: ((event: { url: string }) => void) | null = null;

const mockRecoverySession = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'account-123',
    email: 'lea@example.com',
    user_metadata: {},
  },
};

jest.mock('expo-linking', () => ({
  addEventListener: jest.fn((_event: string, handler: (event: { url: string }) => void) => {
    mockLinkHandler = handler;
    return { remove: jest.fn() };
  }),
  createURL: jest.fn((path: string) => `lernzeit://${path}`),
  getInitialURL: () => mockGetInitialURL(),
}));

// The manifest attestation a real build embeds. Left undefined for the local
// development shape most of this file exercises, and set for the one test that
// loads the production shape.
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

jest.mock('@/auth/storage', () => ({
  authStorage: {
    getItem: (key: string) => mockStorageGetItem(key),
    removeItem: (key: string) => mockStorageRemoveItem(key),
    setItem: (key: string, value: string) => mockStorageSetItem(key, value),
  },
}));

jest.mock('@/auth/account-deletion', () => ({
  requestOnlineAccountDeletion: (client: unknown, token: string) => mockDeleteRequest(client, token),
}));

jest.mock('@/auth/account-local-cleanup', () => ({
  clearAccountLocalData: (storage: unknown, accountId: string) => (
    mockClearAccountLocalData(storage, accountId)
  ),
}));

jest.mock('@/auth/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (code: string) => mockExchangeCodeForSession(code),
      getSession: () => mockGetSession(),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      setSession: (tokens: unknown) => mockSetSession(tokens),
      signInWithPassword: (input: unknown) => mockSignInWithPassword(input),
      resetPasswordForEmail: (email: string, options: unknown) => (
        mockResetPasswordForEmail(email, options)
      ),
      signUp: (input: unknown) => mockSignUp(input),
      signOut: (options: unknown) => mockSignOut(options),
    },
    removeAllChannels: () => mockRemoveAllChannels(),
  },
  supabaseConfiguration: {
    isConfigured: true,
    mode: 'supabase',
    message: 'Online-Anmeldung verfügbar.',
  },
}));

function wrapper({ children }: PropsWithChildren) {
  return <AuthStoreProvider>{children}</AuthStoreProvider>;
}

describe('AuthStoreProvider startup', () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    jest.clearAllMocks();
    mockLinkHandler = null;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockStorageGetItem.mockResolvedValue(null);
    mockStorageSetItem.mockResolvedValue();
    mockStorageRemoveItem.mockResolvedValue();
    mockDeleteRequest.mockResolvedValue();
    mockClearAccountLocalData.mockReturnValue([]);
    mockRemoveAllChannels.mockResolvedValue([]);
    mockSignOut.mockResolvedValue({ error: null });
    mockSignInWithPassword.mockResolvedValue({
      data: { session: mockRecoverySession },
      error: null,
    });
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { removeItem: jest.fn() },
    });
    mockGetInitialURL.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockExchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: null });
    mockSetSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  afterAll(() => {
    jest.restoreAllMocks();
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('hydrates first start and restart directly as a guest without a profile', async () => {
    const first = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(first.result.current.hydrated).toBe(true));
    expect(first.result.current.activeMode).toBe('none');
    await first.unmount();

    const restarted = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(restarted.result.current.hydrated).toBe(true));
    expect(restarted.result.current.activeMode).toBe('none');
    await restarted.unmount();
  });

  it('processes a genuine password-reset deep link in the background after hydration', async () => {
    mockGetInitialURL.mockResolvedValue('lernzeit://auth/update-password?code=recovery-code&type=recovery');
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: mockRecoverySession },
      error: null,
    });

    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(recovery.result.current.hydrated).toBe(true));
    await waitFor(() => expect(recovery.result.current.passwordRecoveryPending).toBe(true));

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(recovery.result.current.user?.id).toBe('account-123');
    await recovery.unmount();
  });

  it.each([
    'lernzeit://auth/profile?code=ordinary-code',
    'evil://auth/update-password?code=stolen-code',
    'lernzeit://attacker/update-password?code=stolen-code',
    'lernzeit://auth/update-password?code=one&code=two',
  ])('never exchanges a code from an untrusted route: %s', async (url) => {
    mockGetInitialURL.mockResolvedValue(url);
    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(recovery.result.current.hydrated).toBe(true));
    await act(async () => undefined);
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(recovery.result.current.passwordRecoveryPending).toBe(false);
    await recovery.unmount();
  });

  it('sets a session only for a complete, route-bound recovery token pair', async () => {
    mockSetSession.mockResolvedValueOnce({ data: { session: mockRecoverySession }, error: null });
    mockGetInitialURL.mockResolvedValue(
      'lernzeit://auth/update-password#access_token=access&refresh_token=refresh&type=recovery',
    );
    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(recovery.result.current.passwordRecoveryPending).toBe(true));
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'access',
      refresh_token: 'refresh',
    });
    await recovery.unmount();
  });

  it('does not let a recovery link replace an already signed-in account', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockGetInitialURL.mockResolvedValue(
      'lernzeit://auth/update-password?code=attacker-code&type=recovery',
    );

    const account = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(account.result.current.hydrated).toBe(true));
    await waitFor(() => expect(account.result.current.user?.id).toBe('account-123'));

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(account.result.current.error).toMatch(/Melde dich zuerst ab/);
    await account.unmount();
  });

  it('rechecks persisted auth state before handling a recovery link received during runtime', async () => {
    const account = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(account.result.current.hydrated).toBe(true));
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1));

    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    await act(async () => {
      mockLinkHandler?.({
        url: 'lernzeit://auth/update-password?code=runtime-attacker-code&type=recovery',
      });
    });

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(account.result.current.user?.id).toBe('account-123');
    expect(account.result.current.error).toMatch(/Melde dich zuerst ab/);
    await account.unmount();
  });

  it('processes the same recovery link at most once', async () => {
    const link = 'lernzeit://auth/update-password?code=single-use-code&type=recovery';
    mockGetInitialURL.mockResolvedValue(link);
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: mockRecoverySession },
      error: null,
    });

    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(recovery.result.current.passwordRecoveryPending).toBe(true));
    await act(async () => { mockLinkHandler?.({ url: link }); });

    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(recovery.result.current.error).toMatch(/bereits verarbeitet/);
    await recovery.unmount();
  });

  it('hydrates as a guest even when the Supabase session request hangs', async () => {
    let releaseSession: (value: { data: { session: null }; error: null }) => void = () => {};
    mockGetSession.mockReturnValue(new Promise((resolve) => { releaseSession = resolve; }));

    const hung = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(hung.result.current.hydrated).toBe(true));
    expect(hung.result.current.activeMode).toBe('none');
    expect(hung.result.current.session).toBeNull();
    await hung.unmount();

    // Settle the hanging request so its boot timeout timer is cleaned up.
    releaseSession({ data: { session: null }, error: null });
  });

  it('persists an image-picker URI only in the local profile', async () => {
    const local = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(local.result.current.hydrated).toBe(true));

    await act(async () => {
      await local.result.current.saveLocalProfile({
        displayName: 'Lea Lokal',
        username: 'lea.lokal',
        avatarUri: 'content://media/picked-avatar.jpg',
      });
    });

    expect(local.result.current.localProfile?.avatarUri).toBe('content://media/picked-avatar.jpg');
    expect(local.result.current.activeMode).toBe('local');
    expect(mockStorageSetItem).toHaveBeenCalledWith(
      'lernzeit.local-profile.v1',
      expect.stringContaining('content://media/picked-avatar.jpg'),
    );
    await local.unmount();
  });

  it('hydrates as a guest when secure storage is corrupt or unavailable', async () => {
    mockStorageGetItem.mockRejectedValue(new Error('SecureStore ist beschädigt'));

    const corrupt = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(corrupt.result.current.hydrated).toBe(true));
    expect(corrupt.result.current.activeMode).toBe('none');
    expect(corrupt.result.current.localProfile).toBeNull();
    await corrupt.unmount();
  });

  it('deletes an authenticated account, clears local account state and enters guest mode', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    const account = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(account.result.current.activeMode).toBe('supabase'));

    let deletionResult: Awaited<ReturnType<typeof account.result.current.deleteAccount>> | null = null;
    await act(async () => {
      deletionResult = await account.result.current.deleteAccount('correct-password');
    });

    expect(deletionResult).toEqual(expect.objectContaining({ ok: true }));
    expect(mockDeleteRequest).toHaveBeenCalledWith(expect.anything(), 'access');
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'lea@example.com',
      password: 'correct-password',
    });
    expect(mockClearAccountLocalData).toHaveBeenCalledWith(expect.anything(), 'account-123');
    expect(mockStorageRemoveItem).toHaveBeenCalledWith('lernzeit.local-profile.v1');
    expect(mockRemoveAllChannels).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(account.result.current.activeMode).toBe('none');
    expect(account.result.current.user).toBeNull();
    expect(account.result.current.pendingAction).toBeNull();
    await account.unmount();
  });

  it('falls back to a local session wipe when global logout is unavailable', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockSignOut
      .mockResolvedValueOnce({ error: new Error('network unavailable') })
      .mockResolvedValueOnce({ error: null });
    const account = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(account.result.current.activeMode).toBe('supabase'));

    let signOutResult: Awaited<ReturnType<typeof account.result.current.signOut>> | null = null;
    await act(async () => {
      signOutResult = await account.result.current.signOut();
    });

    expect(signOutResult).toEqual(expect.objectContaining({ ok: true }));
    expect(mockSignOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(account.result.current.session).toBeNull();
    await account.unmount();
  });

  it('returns the same non-enumerating reset response when the provider rejects the request', async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({
      error: { code: 'user_not_found', message: 'User not found' },
    });
    const guest = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(guest.result.current.hydrated).toBe(true));

    let resetResult: Awaited<ReturnType<typeof guest.result.current.sendPasswordReset>> | null = null;
    await act(async () => {
      resetResult = await guest.result.current.sendPasswordReset(' Lea@Example.com ');
    });

    expect(resetResult).toEqual({
      ok: true,
      message: 'Falls ein Konto besteht, erhältst du gleich eine E-Mail zum Zurücksetzen.',
    });
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('lea@example.com', {
      redirectTo: PASSWORD_RECOVERY_REDIRECT_URL,
    });
    await guest.unmount();
  });

  // The end-to-end proof that the derived HTTPS App Link really reaches
  // Supabase lives in __tests__/auth-store-recovery.test.tsx, which loads the
  // store with a configured operator domain.
  it('never sends the private scheme in a production build', async () => {
    const previousUrl = process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
    const previousProfile = process.env.EXPO_PUBLIC_BUILD_PROFILE;
    process.env.EXPO_PUBLIC_LEGAL_SITE_URL = 'https://lernzeit.de';
    process.env.EXPO_PUBLIC_BUILD_PROFILE = 'production';
    const previousAttestation = embeddedAuthBuildAttestation.value;
    embeddedAuthBuildAttestation.value = attestationFor(process.env);

    try {
      let navigation!: typeof import('@/auth/navigation');
      jest.isolateModules(() => {
        navigation = require('@/auth/navigation') as typeof import('@/auth/navigation');
      });
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_URL).not.toContain('lernzeit://');
      expect(navigation.PASSWORD_RECOVERY_REDIRECT_KIND).toBe('https-app-link');
      expect(navigation.PASSWORD_RECOVERY_AVAILABLE).toBe(true);
    } finally {
      embeddedAuthBuildAttestation.value = previousAttestation;
      if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_LEGAL_SITE_URL;
      else process.env.EXPO_PUBLIC_LEGAL_SITE_URL = previousUrl;
      if (previousProfile === undefined) delete process.env.EXPO_PUBLIC_BUILD_PROFILE;
      else process.env.EXPO_PUBLIC_BUILD_PROFILE = previousProfile;
      jest.resetModules();
    }
  });

  it('does not disclose an existing account through the sign-up response', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { session: null },
      error: { code: 'user_already_exists', message: 'User already registered' },
    });
    const guest = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(guest.result.current.hydrated).toBe(true));

    let signUpResult: Awaited<ReturnType<typeof guest.result.current.signUp>> | null = null;
    await act(async () => {
      signUpResult = await guest.result.current.signUp({
        displayName: 'Lea Beispiel',
        email: 'lea@example.com',
        password: 'long-password',
        username: 'lea.beispiel',
        communityRulesAccepted: true,
      });
    });

    expect(signUpResult).toEqual({
      ok: true,
      message: 'Falls die Angaben verwendet werden können, erhältst du gleich eine E-Mail zur Bestätigung.',
      sessionCreated: false,
    });
    expect(JSON.stringify(signUpResult)).not.toMatch(/bereits|registriert/i);
    await guest.unmount();
  });

  it('keeps the session and local caches when server-side deletion fails', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockDeleteRequest.mockRejectedValueOnce(
      new Error('Das Online-Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.'),
    );
    const account = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(account.result.current.activeMode).toBe('supabase'));

    let deletionResult: Awaited<ReturnType<typeof account.result.current.deleteAccount>> | null = null;
    await act(async () => {
      deletionResult = await account.result.current.deleteAccount('correct-password');
    });

    expect(deletionResult).toEqual(expect.objectContaining({ ok: false }));
    expect(account.result.current.activeMode).toBe('supabase');
    expect(mockClearAccountLocalData).not.toHaveBeenCalled();
    expect(mockStorageRemoveItem).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    await account.unmount();
  });

  it('does not call the deletion endpoint when password re-authentication fails', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('invalid login credentials'),
    });
    const account = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(account.result.current.activeMode).toBe('supabase'));

    let deletionResult: Awaited<ReturnType<typeof account.result.current.deleteAccount>> | null = null;
    await act(async () => {
      deletionResult = await account.result.current.deleteAccount('wrong-password');
    });

    expect(deletionResult).toEqual(expect.objectContaining({ ok: false }));
    expect(mockDeleteRequest).not.toHaveBeenCalled();
    expect(account.result.current.user?.id).toBe('account-123');
    await account.unmount();
  });

  it('restores the original session if re-authentication returns a different user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        session: {
          ...mockRecoverySession,
          access_token: 'foreign-access',
          refresh_token: 'foreign-refresh',
          user: { ...mockRecoverySession.user, id: 'foreign-account' },
        },
      },
      error: null,
    });
    const account = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(account.result.current.activeMode).toBe('supabase'));

    await act(async () => {
      await account.result.current.deleteAccount('password');
    });

    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' });
    expect(mockDeleteRequest).not.toHaveBeenCalled();
    await account.unmount();
  });

  it('rejects account deletion without an authenticated online account', async () => {
    const guest = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(guest.result.current.hydrated).toBe(true));

    let deletionResult: Awaited<ReturnType<typeof guest.result.current.deleteAccount>> | null = null;
    await act(async () => {
      deletionResult = await guest.result.current.deleteAccount('correct-password');
    });

    expect(deletionResult).toEqual(expect.objectContaining({ ok: false }));
    expect(mockDeleteRequest).not.toHaveBeenCalled();
    expect(guest.result.current.activeMode).toBe('none');
    await guest.unmount();
  });
});
