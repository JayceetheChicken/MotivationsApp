import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  PASSWORD_RECOVERY_REDIRECT_URL,
  passwordRecoveryRequestFingerprint,
} from '@/auth/navigation';
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
const mockUpdateUser = jest.fn();
const mockCleanupStaleExports = jest.fn();
let mockOnlineBackendRequired = false;
jest.mock('@/auth/backend-policy', () => ({
  get ONLINE_BACKEND_REQUIRED() { return mockOnlineBackendRequired; },
}));
let mockLinkHandler: ((event: { url: string }) => void) | null = null;
let mockAuthStateHandler: ((event: string, session: typeof mockRecoverySession | null) => void) | null = null;

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

jest.mock('@/lib/account-data-export', () => ({
  cleanupStaleAccountDataExports: () => mockCleanupStaleExports(),
}));

jest.mock('@/auth/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (code: string, options?: unknown) => options
        ? mockExchangeCodeForSession(code, options) : mockExchangeCodeForSession(code),
      getSession: () => mockGetSession(),
      onAuthStateChange: jest.fn((handler: typeof mockAuthStateHandler) => {
        mockAuthStateHandler = handler;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      setSession: (tokens: unknown) => mockSetSession(tokens),
      signInWithPassword: (input: unknown) => mockSignInWithPassword(input),
      resetPasswordForEmail: (email: string, options: unknown) => (
        mockResetPasswordForEmail(email, options)
      ),
      signUp: (input: unknown) => mockSignUp(input),
      signOut: (options: unknown) => mockSignOut(options),
      updateUser: (input: unknown) => mockUpdateUser(input),
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
    mockOnlineBackendRequired = false;
    jest.clearAllMocks();
    mockLinkHandler = null;
    mockAuthStateHandler = null;
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
    mockUpdateUser.mockResolvedValue({ data: { user: mockRecoverySession.user }, error: null });
    mockCleanupStaleExports.mockReturnValue(undefined);
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
    expect(mockCleanupStaleExports).toHaveBeenCalledTimes(2);
    await restarted.unmount();
  });

  it('sends the explicit app callback during signup', async () => {
    const app = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(app.result.current.hydrated).toBe(true));
    await act(async () => { await app.result.current.signUp({
      email: 'lea@example.com', password: 'a-long-password', displayName: 'Lea',
      username: 'lea', communityRulesAccepted: true,
    }); });
    expect(mockSignUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ emailRedirectTo: 'lernzeit://auth/callback' }),
    }));
    expect(app.result.current.session).toBeNull();
    await app.unmount();
  });

  it.each(['cold', 'warm'])('creates one session from a %s email callback and preserves PKCE flow ID', async (start) => {
    const url = 'lernzeit://auth/callback?code=confirmation-code&sb_flow_id=abcdefgh1234';
    mockOnlineBackendRequired = true;
    if (start === 'cold') mockGetInitialURL.mockResolvedValue(url);
    mockExchangeCodeForSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    const app = await renderHook(() => useAuthStore(), { wrapper });
    if (start === 'warm') {
      await waitFor(() => expect(app.result.current.hydrated).toBe(true));
      await act(async () => { mockLinkHandler?.({ url }); });
    }
    await waitFor(() => expect(app.result.current.user?.id).toBe('account-123'));
    await act(async () => { mockLinkHandler?.({ url }); });
    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('confirmation-code', { flowId: 'abcdefgh1234' });
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(app.result.current.passwordRecoveryPending).toBe(false);
    expect(app.result.current.emailCallbackPending).toBe(false);
    await app.unmount();
  });

  it('never switches an existing account from a confirmation link', async () => {
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockGetInitialURL.mockResolvedValue('lernzeit://auth/callback?code=another-account');
    const app = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(app.result.current.notice).toMatch(/bereits angemeldet/));
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(app.result.current.user?.id).toBe('account-123');
    await app.unmount();
  });

  it.each([
    'lernzeit://auth/callback#error=access_denied&error_code=otp_expired',
    'lernzeit://auth/callback#access_token=injected&refresh_token=injected',
    'lernzeit://auth/callback?code=expired',
  ])('offers password login after failed/legacy confirmation without importing tokens: %s', async (url) => {
    mockGetInitialURL.mockResolvedValue(url);
    mockExchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
    const app = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(app.result.current.error).toMatch(/Passwort/));
    expect(app.result.current.session).toBeNull();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(app.result.current.emailCallbackPending).toBe(false);
    await app.unmount();
  });

  it('online builds wait for session restoration and reject local profile creation', async () => {
    mockOnlineBackendRequired = true;
    let restoreSession!: (value: unknown) => void;
    mockGetSession.mockImplementation(() => new Promise((resolve) => { restoreSession = resolve; }));
    const hook = await renderHook(() => useAuthStore(), { wrapper });
    expect(hook.result.current.hydrated).toBe(false);
    expect(mockStorageGetItem).not.toHaveBeenCalledWith('lernzeit.local-profile.v1');
    await act(async () => restoreSession({ data: { session: mockRecoverySession }, error: null }));
    await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
    expect(hook.result.current.activeMode).toBe('supabase');
    const result = await hook.result.current.saveLocalProfile({ displayName: 'Local', username: 'local_user' });
    expect(result.ok).toBe(false);
    expect(mockStorageSetItem).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it('continues startup when a stale export cannot be removed yet', async () => {
    mockCleanupStaleExports.mockImplementationOnce(() => {
      throw new Error('cache locked');
    });

    const result = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(result.result.current.hydrated).toBe(true));
    expect(result.result.current.activeMode).toBe('none');
    await result.unmount();
  });

  it('processes a genuine password-reset deep link in the background after hydration', async () => {
    const link = 'lernzeit://auth/update-password?code=recovery-code&type=recovery';
    mockGetInitialURL.mockResolvedValue(link);
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: mockRecoverySession },
      error: null,
    });

    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(recovery.result.current.hydrated).toBe(true));
    await waitFor(() => expect(recovery.result.current.passwordRecoveryPending).toBe(true));

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(recovery.result.current.user?.id).toBe('account-123');
    expect(mockStorageSetItem).toHaveBeenCalledWith(
      'lernzeit.password-recovery-capability.v1',
      expect.stringContaining(passwordRecoveryRequestFingerprint({
        kind: 'pkce',
        code: 'recovery-code',
      })),
    );
    await recovery.unmount();
  });

  it('restores a live user-bound recovery capability after an app restart', async () => {
    const link = 'lernzeit://auth/update-password?code=restart-code&type=recovery';
    const now = Math.floor(Date.now() / 1000);
    const capability = {
      schemaVersion: 1,
      userId: mockRecoverySession.user.id,
      linkFingerprint: passwordRecoveryRequestFingerprint({ kind: 'pkce', code: 'restart-code' }),
      createdAtEpochSeconds: now,
      expiresAtEpochSeconds: now + 600,
    };
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockGetInitialURL.mockResolvedValue(link);
    mockStorageGetItem.mockImplementation(async (key) => (
      key === 'lernzeit.password-recovery-capability.v1'
        ? JSON.stringify(capability)
        : null
    ));

    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(recovery.result.current.passwordRecoveryPending).toBe(true));

    expect(recovery.result.current.user?.id).toBe('account-123');
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(recovery.result.current.error).toBeNull();
    await recovery.unmount();
  });

  it('does not expose or resurrect a recovery capability while its storage write is pending', async () => {
    const link = 'lernzeit://auth/update-password?code=deferred-code&type=recovery';
    let resolveStorageWrite: () => void = () => undefined;
    mockGetInitialURL.mockResolvedValue(link);
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: mockRecoverySession },
      error: null,
    });
    mockStorageSetItem.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveStorageWrite = resolve;
    }));

    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(mockStorageSetItem).toHaveBeenCalledTimes(1));
    expect(recovery.result.current.passwordRecoveryPending).toBe(false);

    await act(async () => {
      mockAuthStateHandler?.('SIGNED_OUT', null);
      await Promise.resolve();
    });
    await act(async () => {
      resolveStorageWrite();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(recovery.result.current.passwordRecoveryPending).toBe(false);
    expect(mockStorageRemoveItem).toHaveBeenCalledWith(
      'lernzeit.password-recovery-capability.v1',
    );
    await recovery.unmount();
  });

  it('expires a restored recovery capability while mounted and rejects its replay', async () => {
    jest.useFakeTimers();
    const nowMs = Date.UTC(2026, 7, 9, 12, 0, 0);
    jest.setSystemTime(nowMs);
    const link = 'lernzeit://auth/update-password?code=expiring-code&type=recovery';
    const now = Math.floor(nowMs / 1000);
    const capability = {
      schemaVersion: 1,
      userId: mockRecoverySession.user.id,
      linkFingerprint: passwordRecoveryRequestFingerprint({ kind: 'pkce', code: 'expiring-code' }),
      createdAtEpochSeconds: now,
      expiresAtEpochSeconds: now + 60,
    };
    mockGetSession.mockResolvedValue({ data: { session: mockRecoverySession }, error: null });
    mockGetInitialURL.mockResolvedValue(link);
    mockStorageGetItem.mockImplementation(async (key) => (
      key === 'lernzeit.password-recovery-capability.v1'
        ? JSON.stringify(capability)
        : null
    ));

    try {
      const recovery = await renderHook(() => useAuthStore(), { wrapper });
      await waitFor(() => expect(recovery.result.current.passwordRecoveryPending).toBe(true));

      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(recovery.result.current.passwordRecoveryPending).toBe(false);
      expect(mockStorageRemoveItem).toHaveBeenCalledWith(
        'lernzeit.password-recovery-capability.v1',
      );

      await act(async () => { mockLinkHandler?.({ url: link }); });
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(recovery.result.current.error).toMatch(/abgelaufen/);
      expect(recovery.result.current.passwordRecoveryPending).toBe(false);
      await recovery.unmount();
    } finally {
      jest.useRealTimers();
    }
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

  it('rejects implicit recovery bearer tokens without installing a session', async () => {
    mockGetInitialURL.mockResolvedValue(
      'lernzeit://auth/update-password#access_token=access&refresh_token=refresh&type=recovery',
    );
    const recovery = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(recovery.result.current.hydrated).toBe(true));
    await waitFor(() => expect(recovery.result.current.error).toMatch(/ungültig oder abgelaufen/));
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(recovery.result.current.passwordRecoveryPending).toBe(false);
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
    expect(recovery.result.current.error).toBeNull();
    expect(recovery.result.current.passwordRecoveryPending).toBe(true);
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

  it.each([
    { displayName: 'Lea\u202eAdmin', username: 'lea', avatarUri: undefined },
    { displayName: 'Lea Lokal', username: 'LEA', avatarUri: undefined },
    {
      displayName: 'Lea Lokal',
      username: 'lea',
      avatarUri: 'https://user:password@example.org/avatar.jpg#fragment',
    },
  ])('rejects a persisted local profile that bypasses current input validation %#', async (fields) => {
    mockStorageGetItem.mockResolvedValue(JSON.stringify({
      schemaVersion: 1,
      ...fields,
      createdAt: '2026-08-09T10:00:00.000Z',
      updatedAt: '2026-08-09T10:00:00.000Z',
    }));

    const result = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(result.result.current.hydrated).toBe(true));
    expect(result.result.current.localProfile).toBeNull();
    expect(result.result.current.activeMode).toBe('none');
    await result.unmount();
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
    // Pin both halves: a contradicting ambient EAS_BUILD_PROFILE (the APK
    // workflow exports "preview") would make the profile unresolvable.
    const previousEasProfile = process.env.EAS_BUILD_PROFILE;
    process.env.EXPO_PUBLIC_LEGAL_SITE_URL = 'https://lernzeit.de';
    process.env.EXPO_PUBLIC_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PROFILE = 'production';
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
      if (previousEasProfile === undefined) delete process.env.EAS_BUILD_PROFILE;
      else process.env.EAS_BUILD_PROFILE = previousEasProfile;
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
