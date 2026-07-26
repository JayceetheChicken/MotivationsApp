import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import LocalProfileScreen from '@/app/(auth)/local-profile';
import ProfileScreen from '@/app/profile';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type { StudyData } from '@/types/study';

const mockReplace = jest.fn();
const mockSaveLocalProfile = jest.fn();
const mockReplaceAccountAvatar = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useRouter: () => ({
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getPendingResultAsync: jest.fn(),
}));

jest.mock('@/state/auth-store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/state/study-store', () => ({
  useStudyStore: jest.fn(),
}));

const mockedUseAuthStore = jest.mocked(useAuthStore);
const mockedUseStudyStore = jest.mocked(useStudyStore);
const mockedRequestPermission = jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync);
const mockedLaunchLibrary = jest.mocked(ImagePicker.launchImageLibraryAsync);

const emptyData: StudyData = {
  currentUser: null,
  subjects: [],
  sessions: [],
  grades: [],
  goals: [],
  friends: [],
  challenges: [],
  activeTimer: null,
};

function configureLocalStores(withProfile: boolean) {
  const localProfile = withProfile
    ? {
        schemaVersion: 1 as const,
        displayName: 'Lea Lokal',
        username: 'lea.lokal',
        avatarUri: 'file:///old-avatar.jpg',
        createdAt: '2026-07-20T10:00:00.000Z',
        updatedAt: '2026-07-20T10:00:00.000Z',
      }
    : null;

  mockSaveLocalProfile.mockResolvedValue({
    ok: true,
    message: 'Dein lokales Profil wurde auf diesem Gerät gespeichert.',
  });
  mockedUseAuthStore.mockReturnValue({
    activeMode: withProfile ? 'local' : 'none',
    configuration: { isConfigured: true, mode: 'supabase', message: 'Online.' },
    error: null,
    localProfile,
    notice: null,
    pendingAction: null,
    saveLocalProfile: mockSaveLocalProfile,
    clearFeedback: jest.fn(),
    signOut: jest.fn(),
    removeLocalProfile: jest.fn(),
  } as unknown as ReturnType<typeof useAuthStore>);

  mockedUseStudyStore.mockReturnValue({
    data: withProfile
      ? {
          ...emptyData,
          currentUser: {
            id: 'local-user',
            displayName: 'Lea Lokal',
            username: 'lea.lokal',
            avatarUrl: 'file:///old-avatar.jpg',
          },
        }
      : emptyData,
    clearAllData: jest.fn(),
    socialError: null,
    socialLoading: false,
    syncStatus: { phase: 'idle', pendingMutationCount: 0, lastSyncedAt: null, lastError: null },
    updateAccountProfile: jest.fn(),
    replaceAccountAvatar: mockReplaceAccountAvatar,
  } as unknown as ReturnType<typeof useStudyStore>);
}

function selectLocalImage(uri = 'file:///picked-avatar.jpg') {
  mockedRequestPermission.mockResolvedValue({ granted: true } as never);
  mockedLaunchLibrary.mockResolvedValue({
    canceled: false,
    assets: [{ uri, mimeType: 'image/jpeg', fileName: 'picked-avatar.jpg' }],
  } as never);
}

describe('local profile pictures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReplaceAccountAvatar.mockResolvedValue(null);
  });

  it('selects a picture during local profile creation and persists only its local URI', async () => {
    configureLocalStores(false);
    selectLocalImage();
    const rendered = await render(<LocalProfileScreen />);

    await fireEvent.changeText(rendered.getByLabelText('Anzeigename'), 'Lea Lokal');
    await fireEvent.changeText(rendered.getByLabelText('Benutzername'), 'lea.lokal');
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild auswählen' }));
    await waitFor(() => {
      expect(mockedLaunchLibrary).toHaveBeenCalledTimes(1);
      expect(rendered.getByRole('button', { name: 'Profilbild ändern' })).toBeTruthy();
    });

    await fireEvent.press(rendered.getByRole('button', { name: 'Lokal fortfahren' }));
    await waitFor(() => {
      expect(mockSaveLocalProfile).toHaveBeenCalledWith({
        displayName: 'Lea Lokal',
        username: 'lea.lokal',
        avatarUri: 'file:///picked-avatar.jpg',
      });
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
    expect(mockReplaceAccountAvatar).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('changes an existing local picture immediately without calling Supabase upload', async () => {
    configureLocalStores(true);
    selectLocalImage('content://media/picked-avatar.jpg');
    const rendered = await render(<ProfileScreen />);

    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));
    await waitFor(() => {
      expect(mockSaveLocalProfile).toHaveBeenCalledWith({
        displayName: 'Lea Lokal',
        username: 'lea.lokal',
        avatarUri: 'content://media/picked-avatar.jpg',
      });
    });
    expect(mockReplaceAccountAvatar).not.toHaveBeenCalled();
    expect(rendered.getByText('Dein neues Profilbild wurde lokal gespeichert.')).toBeTruthy();
    await rendered.unmount();
  });

  it('shows a readable picker error and still never uploads in local mode', async () => {
    configureLocalStores(true);
    mockedRequestPermission.mockRejectedValue(new Error('Fotozugriff ist momentan nicht verfügbar.'));
    const rendered = await render(<ProfileScreen />);

    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));
    await waitFor(() => {
      expect(rendered.getByText('Fotozugriff ist momentan nicht verfügbar.')).toBeTruthy();
    });
    expect(mockedLaunchLibrary).not.toHaveBeenCalled();
    expect(mockReplaceAccountAvatar).not.toHaveBeenCalled();
    expect(mockSaveLocalProfile).not.toHaveBeenCalled();
    await rendered.unmount();
  });
});
