import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { AuthStoreProvider, useAuthStore } from '@/state/auth-store';

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
const mockResetPasswordForEmail = jest.fn();
const mockSignUp = jest.fn();

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
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  createURL: jest.fn((path: string) => `lernzeit://${path}`),
  getInitialURL: () => mockGetInitialURL(),
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
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockStorageGetItem.mockResolvedValue(null);
    mockStorageSetItem.mockResolvedValue();
    mockStorageRemoveItem.mockResolvedValue();
    mockDeleteRequest.mockResolvedValue();
    mockClearAccountLocalData.mockReturnValue([]);
    mockRemoveAllChannels.mockResolvedValue([]);
    mockSignOut.mockResolvedValue({ error: null });
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
    mockGetInitialURL.mockResolvedValue('lernzeit://auth/update-password?code=recovery-code');
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
      deletionResult = await account.result.current.deleteAccount();
    });

    expect(deletionResult).toEqual(expect.objectContaining({ ok: true }));
    expect(mockDeleteRequest).toHaveBeenCalledWith(expect.anything(), 'access');
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
      redirectTo: 'lernzeit://auth/update-password',
    });
    await guest.unmount();
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
      deletionResult = await account.result.current.deleteAccount();
    });

    expect(deletionResult).toEqual(expect.objectContaining({ ok: false }));
    expect(account.result.current.activeMode).toBe('supabase');
    expect(mockClearAccountLocalData).not.toHaveBeenCalled();
    expect(mockStorageRemoveItem).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    await account.unmount();
  });

  it('rejects account deletion without an authenticated online account', async () => {
    const guest = await renderHook(() => useAuthStore(), { wrapper });
    await waitFor(() => expect(guest.result.current.hydrated).toBe(true));

    let deletionResult: Awaited<ReturnType<typeof guest.result.current.deleteAccount>> | null = null;
    await act(async () => {
      deletionResult = await guest.result.current.deleteAccount();
    });

    expect(deletionResult).toEqual(expect.objectContaining({ ok: false }));
    expect(mockDeleteRequest).not.toHaveBeenCalled();
    expect(guest.result.current.activeMode).toBe('none');
    await guest.unmount();
  });
});
