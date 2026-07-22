import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ProfileScreen from '@/app/profile';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type { AccountStudyUser, StudyData } from '@/types/study';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockUpdateAccountProfile = jest.fn();
const mockUploadAvatar = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
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

const accountProfile: AccountStudyUser = {
  id: 'account-1',
  displayName: 'Lea Lernen',
  username: 'lea.lernen',
  avatarUrl: 'https://example.com/lea.png',
  timeZone: 'Europe/Berlin',
  usernameNeedsReview: false,
  revision: 4,
};

const accountData: StudyData = {
  currentUser: accountProfile,
  subjects: [],
  sessions: [],
  grades: [],
  goals: [],
  friends: [],
  challenges: [],
  activeTimer: null,
};

function configureAccountStores(profileOverrides: Partial<AccountStudyUser> = {}) {
  mockedUseAuthStore.mockReturnValue({
    activeMode: 'supabase',
    configuration: { isConfigured: true, mode: 'supabase', message: 'Online.' },
    error: null,
    localProfile: null,
    notice: null,
    pendingAction: null,
    saveLocalProfile: jest.fn(),
    clearFeedback: jest.fn(),
    signOut: jest.fn(),
    removeLocalProfile: jest.fn(),
  } as unknown as ReturnType<typeof useAuthStore>);

  mockedUseStudyStore.mockReturnValue({
    data: { ...accountData, currentUser: { ...accountProfile, ...profileOverrides } },
    privacy: {
      friendComparisonsEnabled: false,
      shareAutomaticMinutes: false,
      shareManualMinutes: false,
      shareGoalProgress: false,
      shareStreak: false,
    },
    clearAllData: jest.fn(),
    socialError: null,
    socialLoading: false,
    updateAccountProfile: mockUpdateAccountProfile,
    uploadAvatar: mockUploadAvatar,
    syncStatus: { phase: 'idle', pendingMutationCount: 0, lastSyncedAt: null, lastError: null },
  } as unknown as ReturnType<typeof useStudyStore>);
}

describe('online account profile screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureAccountStores();
  });

  it('shows the identity header with a prominent @username', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.getByRole('header', { name: 'Lea Lernen' })).toBeTruthy();
    expect(rendered.getByText('@lea.lernen')).toBeTruthy();
    expect(rendered.getByText('Online-Konto')).toBeTruthy();
    await rendered.unmount();
  });

  it('no longer renders the privacy, source or edit-detour sections', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.queryByText('Privatsphäre')).toBeNull();
    expect(rendered.queryByText('Nachvollziehbare Lernzeit')).toBeNull();
    expect(rendered.queryByRole('button', { name: 'Online-Profil bearbeiten' })).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('edits display name and username directly and saves via the study store', async () => {
    mockUpdateAccountProfile.mockResolvedValue({
      ...accountProfile,
      displayName: 'Lea Neu',
      username: 'lea.neu',
      revision: 5,
    });
    const rendered = await render(<ProfileScreen />);

    await fireEvent.changeText(rendered.getByLabelText('Anzeigename'), 'Lea Neu');
    await fireEvent.changeText(rendered.getByLabelText('Benutzername'), 'LEA.NEU');
    await fireEvent.press(rendered.getByRole('button', { name: 'Profil speichern' }));

    await waitFor(() => {
      expect(mockUpdateAccountProfile).toHaveBeenCalledWith({
        displayName: 'Lea Neu',
        username: 'lea.neu',
        avatarUrl: 'https://example.com/lea.png',
      });
    });
    expect(rendered.getByText('Dein Profil wurde gespeichert.')).toBeTruthy();
    await rendered.unmount();
  });

  it('rejects an invalid username without calling the store', async () => {
    const rendered = await render(<ProfileScreen />);

    await fireEvent.changeText(rendered.getByLabelText('Benutzername'), 'ab');
    await fireEvent.press(rendered.getByRole('button', { name: 'Profil speichern' }));

    expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('uploads a picked image and stores the returned public URL', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true } as never);
    mockedLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg', fileName: 'pic.jpg' }],
    } as never);
    mockUploadAvatar.mockResolvedValue('https://cdn.example.com/avatars/account-1/avatar.jpg?v=42');
    mockUpdateAccountProfile.mockResolvedValue({ ...accountProfile, avatarUrl: 'https://cdn.example.com/avatars/account-1/avatar.jpg?v=42' });

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => {
      expect(mockUploadAvatar).toHaveBeenCalledWith({
        uri: 'file:///tmp/pic.jpg',
        mimeType: 'image/jpeg',
        fileName: 'pic.jpg',
      });
      expect(mockUpdateAccountProfile).toHaveBeenCalledWith(
        expect.objectContaining({ avatarUrl: 'https://cdn.example.com/avatars/account-1/avatar.jpg?v=42' }),
      );
    });
    await rendered.unmount();
  });

  it('shows an understandable error when permission is denied', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: false } as never);

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => {
      expect(rendered.getByText(/Erlaube den Zugriff auf deine Fotos/)).toBeTruthy();
    });
    expect(mockedLaunchLibrary).not.toHaveBeenCalled();
    expect(mockUploadAvatar).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('keeps a rejected storage upload visible and ends the loading state', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true } as never);
    mockedLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg', fileName: 'pic.jpg' }],
    } as never);
    mockUploadAvatar.mockRejectedValue(new Error('Der Upload wurde von Supabase abgelehnt.'));

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => {
      expect(rendered.getByText('Der Upload wurde von Supabase abgelehnt.')).toBeTruthy();
    });
    // Loading state ended: the button returns to its idle label and is pressable again.
    expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
    expect(rendered.getByRole('button', { name: 'Profilbild ändern' })).toBeTruthy();
    expect(rendered.queryByRole('button', { name: 'Bild wird hochgeladen…' })).toBeNull();
    await rendered.unmount();
  });

  it('reports when the uploaded image URL cannot be persisted', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true } as never);
    mockedLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg', fileName: 'pic.jpg' }],
    } as never);
    mockUploadAvatar.mockResolvedValue('https://cdn.example.com/avatars/account-1/avatar.jpg?v=7');
    mockUpdateAccountProfile.mockResolvedValue(null);

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => {
      expect(rendered.getByText(/Profil-URL konnte nicht gespeichert werden/)).toBeTruthy();
    });
    await rendered.unmount();
  });
});
