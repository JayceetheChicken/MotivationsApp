import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { AuthStoreProvider, useAuthStore } from '@/state/auth-store';

const mockGetInitialURL = jest.fn<Promise<string | null>, []>();
const mockGetSession = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockSetSession = jest.fn();
const mockStorageGetItem = jest.fn<Promise<string | null>, [string]>();
const mockStorageSetItem = jest.fn<Promise<void>, [string, string]>();

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
    removeItem: jest.fn(),
    setItem: (key: string, value: string) => mockStorageSetItem(key, value),
  },
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
    },
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
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockStorageGetItem.mockResolvedValue(null);
    mockStorageSetItem.mockResolvedValue();
    mockGetInitialURL.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockExchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: null });
    mockSetSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  afterAll(() => {
    jest.restoreAllMocks();
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
    mockGetInitialURL.mockResolvedValue('lernzeit://update-password?code=recovery-code');
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
});
