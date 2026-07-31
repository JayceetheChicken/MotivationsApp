import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type {
  ConfirmedAvatar,
  StudyRepository,
  UpdateAccountProfileInput,
  UploadAvatarInput,
  UploadedAvatar,
} from '@/data/repositories/study-repository';
import { StudyStoreProvider, useStudyStore } from '@/state/study-store';
import type { AccountStudyUser, StudySharingPreferences } from '@/types/study';

const mockGetMyProfile = jest.fn<Promise<AccountStudyUser>, []>();
const mockUpdateMyProfile = jest.fn<Promise<AccountStudyUser>, [UpdateAccountProfileInput]>();
const mockUploadAvatar = jest.fn<Promise<UploadedAvatar>, [UploadAvatarInput]>();
const mockSetMyAvatar = jest.fn<Promise<ConfirmedAvatar>, [string]>();
const mockDeleteAvatarObject = jest.fn<Promise<void>, [string, string]>();
const mockCleanupAvatarObjects = jest.fn<Promise<void>, [string, string, string?]>();
const mockPrepareAvatarUpload = jest.fn();

const sharing: StudySharingPreferences = {
  shareTimerStats: false,
  shareManualStats: false,
  shareGoalProgress: false,
  shareStreak: false,
  revision: 1,
  updatedAt: '2026-07-22T10:00:00.000Z',
};

const mockRepository = {
  mode: 'supabase',
  accountId: 'user-123',
  social: {
    getMyProfile: () => mockGetMyProfile(),
    updateMyProfile: (input: UpdateAccountProfileInput) => mockUpdateMyProfile(input),
    uploadAvatar: (input: UploadAvatarInput) => mockUploadAvatar(input),
    setMyAvatar: (path: string) => mockSetMyAvatar(path),
    deleteAvatarObject: (userId: string, path: string) => mockDeleteAvatarObject(userId, path),
    cleanupAvatarObjects: (userId: string, path: string, previous?: string) => (
      mockCleanupAvatarObjects(userId, path, previous)
    ),
    getSharingPreferences: jest.fn(async () => sharing),
    listFriendConnections: jest.fn(async () => []),
    listFriendOverviews: jest.fn(async () => []),
    listSharedGoalProgress: jest.fn(async () => []),
    listSharedGoals: jest.fn(async () => []),
    listStudyGroups: jest.fn(async () => []),
    listSharedStudySessions: jest.fn(async () => []),
  },
  imports: {},
  loadSnapshot: jest.fn(async () => null),
  saveSnapshot: jest.fn(async () => undefined),
  refresh: jest.fn(async () => null),
  enqueueMutation: jest.fn(async () => undefined),
  sync: jest.fn(async () => ({
    snapshot: null,
    appliedMutationCount: 0,
    pendingMutationCount: 0,
    conflicts: [],
    syncVersion: null,
  })),
  getSyncStatus: jest.fn(() => ({
    phase: 'idle',
    pendingMutationCount: 0,
    lastSyncedAt: null,
    lastError: null,
  })),
  subscribeSyncStatus: jest.fn(() => () => undefined),
  subscribeSharedGoalProgress: jest.fn(),
  subscribeSocialUpdates: jest.fn(),
  dispose: jest.fn(async () => undefined),
} as unknown as StudyRepository;

jest.mock('@/auth/supabase', () => ({ supabase: {} }));
jest.mock('@/data/repositories/supabase-study-repository', () => ({
  createSupabaseStudyRepository: () => mockRepository,
}));
jest.mock('@/hooks/use-network-status', () => ({ useNetworkStatus: () => false }));
jest.mock('@/lib/avatar-upload', () => ({
  avatarObjectPathFromUrl: (url: string | null | undefined, userId: string) => {
    if (!url) return null;
    const marker = '/storage/v1/object/public/avatars/';
    const path = url.split('?', 1)[0].split(marker)[1];
    return path?.startsWith(`${userId}/`) ? path : null;
  },
  avatarUrlReferencesObjectPath: (
    url: string | null | undefined,
    userId: string,
    objectPath: string,
  ) => Boolean(url?.includes(`/avatars/${objectPath}`) && objectPath.startsWith(`${userId}/`)),
  prepareAvatarUpload: (...args: unknown[]) => mockPrepareAvatarUpload(...args),
}));
jest.mock('@/lib/local-storage', () => ({}));

const storedValues = new Map<string, string>();
const storageMock = {
  getItem: jest.fn((key: string) => storedValues.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => storedValues.set(key, value)),
  removeItem: jest.fn((key: string) => storedValues.delete(key)),
  clear: jest.fn(() => storedValues.clear()),
  key: jest.fn((index: number) => [...storedValues.keys()][index] ?? null),
  get length() {
    return storedValues.size;
  },
} satisfies Storage;

let serverProfile: AccountStudyUser;

function wrapper({ children }: PropsWithChildren) {
  return (
    <StudyStoreProvider
      accountAccessToken="access-token"
      accountUserId="user-123"
      storageScope="account-user-123">
      {children}
    </StudyStoreProvider>
  );
}

async function renderAccountStore() {
  const hook = await renderHook(() => useStudyStore(), { wrapper });
  await waitFor(() => {
    expect(hook.result.current.hydrated).toBe(true);
    expect(hook.result.current.data.currentUser?.id).toBe('user-123');
  });
  return hook;
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storageMock,
  });
});

beforeEach(() => {
  storedValues.clear();
  jest.clearAllMocks();
  serverProfile = {
    id: 'user-123',
    username: 'lea',
    displayName: 'Lea',
    avatarUrl: 'https://example.test/old.jpg',
    timeZone: 'Europe/Berlin',
    usernameNeedsReview: false,
    revision: 1,
  };
  mockGetMyProfile.mockImplementation(async () => serverProfile);
  mockUpdateMyProfile.mockImplementation(async (input) => {
    serverProfile = {
      ...serverProfile,
      username: input.username,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? undefined,
      timeZone: input.timeZone,
      revision: input.expectedRevision + 1,
    };
    return serverProfile;
  });
  mockPrepareAvatarUpload.mockResolvedValue({
    body: new ArrayBuffer(4),
    contentType: 'image/jpeg',
    fileExtension: 'jpg',
  });
  mockUploadAvatar.mockResolvedValue({
    objectPath: 'user-123/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
  });
  mockSetMyAvatar.mockImplementation(async () => {
    const previousAvatarUrl = serverProfile.avatarUrl ?? null;
    serverProfile = {
      ...serverProfile,
      avatarUrl: 'https://example.test/storage/v1/object/public/avatars/user-123/profile/new.jpg?v=1',
      revision: serverProfile.revision + 1,
    };
    return { profile: serverProfile, previousAvatarUrl };
  });
  mockDeleteAvatarObject.mockResolvedValue();
  mockCleanupAvatarObjects.mockResolvedValue();
});

describe('StudyStoreProvider account avatars', () => {
  it('uses the latest profile revision from stateRef and updates currentUser before resolving', async () => {
    const { result } = await renderAccountStore();
    const updateFromEarlierRender = result.current.updateAccountProfile;

    serverProfile = {
      ...serverProfile,
      displayName: 'Lea vom Server',
      revision: 7,
    };
    await act(async () => {
      await result.current.refreshSocial();
    });
    expect((result.current.data.currentUser as AccountStudyUser).revision).toBe(7);

    let updated: AccountStudyUser | null = null;
    await act(async () => {
      updated = await updateFromEarlierRender({
        username: 'lea',
        displayName: 'Lea vom Server',
      });
    });

    expect(mockUpdateMyProfile).toHaveBeenLastCalledWith(expect.objectContaining({
      avatarUrl: 'https://example.test/old.jpg',
      expectedRevision: 7,
    }));
    expect(updated).toEqual(expect.objectContaining({
      avatarUrl: 'https://example.test/old.jpg',
    }));
    expect(result.current.data.currentUser).toMatchObject({
      avatarUrl: 'https://example.test/old.jpg',
      revision: 8,
    });
  });

  it('keeps technical profile-save errors out of the UI', async () => {
    const { result } = await renderAccountStore();
    mockUpdateMyProfile.mockRejectedValueOnce(
      new Error('avatar_url konnte nicht gespeichert werden.'),
    );

    let rejection: Error | null = null;
    await act(async () => {
      try {
        await result.current.updateAccountProfile({
          username: 'lea',
          displayName: 'Lea',
        });
      } catch (error) {
        rejection = error as Error;
      }
    });

    expect(rejection).toEqual(expect.objectContaining({
      message: 'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.',
    }));
    expect(result.current.socialError).toBe(
      'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.',
    );
    expect(result.current.socialError).not.toContain('avatar_url');
  });

  it('propagates avatar upload policy errors instead of returning null', async () => {
    const { result } = await renderAccountStore();
    mockUploadAvatar.mockRejectedValueOnce({
      status: 403,
      message: 'new row violates row-level security policy',
    });

    let rejection: Error | null = null;
    await act(async () => {
      try {
        await result.current.replaceAccountAvatar({
          uri: 'content://media/external/images/42',
          mimeType: 'image/jpeg',
          fileName: 'avatar.jpg',
        });
      } catch (error) {
        rejection = error as Error;
      }
    });

    expect(mockUploadAvatar).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-123',
      objectId: expect.any(String),
      contentType: 'image/jpeg',
      fileExtension: 'jpg',
    }));
    expect(rejection).toEqual(expect.objectContaining({
      message: 'Für diese Aktion fehlt die Berechtigung.',
    }));
    expect(result.current.socialError).toBe('Für diese Aktion fehlt die Berechtigung.');
  });

  it('persists the Storage object, updates the profile and cleans old objects', async () => {
    const { result } = await renderAccountStore();

    let updated: AccountStudyUser | null = null;
    await act(async () => {
      updated = await result.current.replaceAccountAvatar({
        uri: 'file:///avatar.jpg',
        mimeType: 'image/jpeg',
        fileName: 'avatar.jpg',
        fileSize: 4,
      });
    });

    expect(mockSetMyAvatar).toHaveBeenCalledWith(
      'user-123/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    );
    expect(mockCleanupAvatarObjects).toHaveBeenCalledWith(
      'user-123',
      'user-123/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
      'https://example.test/old.jpg',
    );
    expect(updated).toEqual(expect.objectContaining({
      avatarUrl: expect.stringContaining('/avatars/user-123/profile/new.jpg?v=1'),
    }));
  });

  it('removes a newly uploaded object when profile persistence fails', async () => {
    const { result } = await renderAccountStore();
    mockSetMyAvatar.mockRejectedValueOnce(new Error('avatar_object_not_found'));

    await act(async () => {
      await expect(result.current.replaceAccountAvatar({
        uri: 'file:///avatar.jpg',
        mimeType: 'image/jpeg',
      })).rejects.toThrow('Der Profilbild-Upload konnte in Supabase nicht bestätigt werden.');
    });

    expect(mockDeleteAvatarObject).toHaveBeenCalledWith(
      'user-123',
      'user-123/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    );
  });

  it('reconciles a committed avatar when the RPC response is lost', async () => {
    const { result } = await renderAccountStore();
    const uploadedPath = 'user-123/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
    mockSetMyAvatar.mockImplementationOnce(async () => {
      serverProfile = {
        ...serverProfile,
        avatarUrl: `https://example.test/storage/v1/object/public/avatars/${uploadedPath}?v=server`,
        revision: serverProfile.revision + 1,
      };
      throw new Error('Failed to fetch');
    });

    let updated: AccountStudyUser | null = null;
    await act(async () => {
      updated = await result.current.replaceAccountAvatar({
        uri: 'file:///avatar.jpg',
        mimeType: 'image/jpeg',
      });
    });

    expect(updated).toEqual(expect.objectContaining({
      avatarUrl: expect.stringContaining(`${uploadedPath}?v=server`),
    }));
    expect(mockDeleteAvatarObject).not.toHaveBeenCalled();
  });

  it('keeps an ambiguously committed upload when reconciliation is offline', async () => {
    const { result } = await renderAccountStore();
    mockSetMyAvatar.mockRejectedValueOnce(new Error('Failed to fetch'));
    mockGetMyProfile.mockRejectedValueOnce(new Error('Failed to fetch'));

    await act(async () => {
      await expect(result.current.replaceAccountAvatar({
        uri: 'file:///avatar.jpg',
        mimeType: 'image/jpeg',
      })).rejects.toThrow();
    });

    expect(mockDeleteAvatarObject).not.toHaveBeenCalled();
  });

  it('keeps the automatic cleanup warning visible after refreshing the new profile', async () => {
    const { result } = await renderAccountStore();
    mockCleanupAvatarObjects.mockRejectedValueOnce(new Error('Storage unavailable'));

    await act(async () => {
      await result.current.replaceAccountAvatar({
        uri: 'file:///avatar.jpg',
        mimeType: 'image/jpeg',
      });
    });

    expect(result.current.socialError).toContain('automatisch erneut bereinigt');
  });
});
