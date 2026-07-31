import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import ProfileScreen from '@/app/profile';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type { AccountStudyUser, StudyData } from '@/types/study';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockUpdateAccountProfile = jest.fn();
const mockReplaceAccountAvatar = jest.fn();
const mockDeleteAccount = jest.fn();

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
const mockedGetPendingResult = jest.mocked(ImagePicker.getPendingResultAsync);
const originalPlatformOS = Platform.OS;

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

function configureAccountStores(profileOverrides: Partial<AccountStudyUser> | null = {}) {
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
    deleteAccount: mockDeleteAccount,
    removeLocalProfile: jest.fn(),
  } as unknown as ReturnType<typeof useAuthStore>);

  mockedUseStudyStore.mockReturnValue({
    data: {
      ...accountData,
      currentUser: profileOverrides === null
        ? null
        : { ...accountProfile, ...profileOverrides },
    },
    privacy: {
      friendComparisonsEnabled: false,
      shareAutomaticMinutes: false,
      shareManualMinutes: false,
      shareGoalProgress: false,
      shareStreak: false,
    },
    socialError: null,
    socialLoading: false,
    updateAccountProfile: mockUpdateAccountProfile,
    replaceAccountAvatar: mockReplaceAccountAvatar,
    syncStatus: { phase: 'idle', pendingMutationCount: 0, lastSyncedAt: null, lastError: null },
  } as unknown as ReturnType<typeof useStudyStore>);
}

describe('online account profile screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    mockedRequestPermission.mockReset();
    mockedLaunchLibrary.mockReset();
    mockedGetPendingResult.mockReset();
    mockReplaceAccountAvatar.mockReset();
    mockUpdateAccountProfile.mockReset();
    mockDeleteAccount.mockReset();
    mockDeleteAccount.mockResolvedValue({
      ok: true,
      message: 'Dein Online-Konto wurde dauerhaft gelöscht.',
    });
    mockedGetPendingResult.mockResolvedValue(null);
    configureAccountStores();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOS });
  });

  it('shows the identity header with a prominent @username', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.getByRole('header', { name: 'Lea Lernen' })).toBeTruthy();
    expect(rendered.getByText('@lea.lernen')).toBeTruthy();
    expect(rendered.getByText('Online-Konto')).toBeTruthy();
    await rendered.unmount();
  });

  it('removes local-data controls while keeping sign-out available', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.queryByText('Konto & lokale Daten')).toBeNull();
    expect(rendered.queryByRole('button', { name: 'Gerätecache neu laden' })).toBeNull();
    expect(rendered.queryByRole('button', { name: 'Alle lokalen Lerndaten löschen' })).toBeNull();
    expect(rendered.queryByRole('button', { name: 'Lokales Profil und Daten löschen' })).toBeNull();
    expect(rendered.getByRole('button', { name: 'Abmelden' })).toBeTruthy();
    expect(rendered.getByRole('button', { name: 'Konto löschen' })).toBeTruthy();
    await rendered.unmount();
  });

  it('requires a two-step typed confirmation before deleting the online account', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.queryByLabelText('LÖSCHEN zur Bestätigung eingeben')).toBeNull();
    await fireEvent.press(rendered.getByRole('button', { name: 'Konto löschen' }));

    const finalButton = rendered.getByRole('button', { name: 'Konto dauerhaft löschen' });
    expect(finalButton.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(rendered.getByText(/Profilbild, synchronisierte Lernzeiten/)).toBeTruthy();

    await fireEvent.changeText(
      rendered.getByLabelText('LÖSCHEN zur Bestätigung eingeben'),
      'löschen',
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Konto dauerhaft löschen' }));

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/');
    await rendered.unmount();
  });

  it('keeps the confirmation open and shows a friendly deletion error', async () => {
    mockDeleteAccount.mockResolvedValueOnce({
      ok: false,
      message: 'Das Online-Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.',
    });
    const rendered = await render(<ProfileScreen />);

    await fireEvent.press(rendered.getByRole('button', { name: 'Konto löschen' }));
    await fireEvent.changeText(
      rendered.getByLabelText('LÖSCHEN zur Bestätigung eingeben'),
      'LÖSCHEN',
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Konto dauerhaft löschen' }));

    expect(await rendered.findByRole('alert')).toHaveTextContent(
      'Das Online-Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.',
    );
    expect(mockReplace).not.toHaveBeenCalled();
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
    mockReplaceAccountAvatar.mockResolvedValue({
      ...accountProfile,
      avatarUrl: 'https://cdn.example.com/avatars/account-1/profile/avatar.jpg?v=42',
    });

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => {
      expect(mockedLaunchLibrary).toHaveBeenCalledWith({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      expect(mockReplaceAccountAvatar).toHaveBeenCalledWith({
        uri: 'file:///tmp/pic.jpg',
        mimeType: 'image/jpeg',
        fileName: 'pic.jpg',
        fileSize: undefined,
      });
      expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
      expect(rendered.getByText('Dein neues Profilbild wurde gespeichert.')).toBeTruthy();
    });
    await rendered.unmount();
  });

  it('shows a concrete error when opening the image picker fails', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true } as never);
    mockedLaunchLibrary.mockRejectedValue(new Error('Die Android-Galerie konnte nicht geöffnet werden.'));

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => {
      expect(rendered.getByText('Die Android-Galerie konnte nicht geöffnet werden.')).toBeTruthy();
    });
    expect(mockReplaceAccountAvatar).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('opens the Android system picker without requesting broad photo permission', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    mockedLaunchLibrary.mockResolvedValue({ canceled: true, assets: null } as never);

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => expect(mockedLaunchLibrary).toHaveBeenCalledTimes(1));
    expect(mockedRequestPermission).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('recovers an Android picker result only after the online profile is ready', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    mockedGetPendingResult.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'content://media/recovered.jpg', mimeType: 'image/jpeg', fileName: 'recovered.jpg' }],
    } as never);
    mockReplaceAccountAvatar.mockResolvedValue({
      ...accountProfile,
      avatarUrl: 'https://cdn.example.com/avatars/account-1/profile/avatar.jpg?v=84',
    });
    configureAccountStores(null);

    const rendered = await render(<ProfileScreen />);
    expect(mockedGetPendingResult).not.toHaveBeenCalled();

    configureAccountStores();
    await rendered.rerender(<ProfileScreen />);

    await waitFor(() => {
      expect(mockedGetPendingResult).toHaveBeenCalledTimes(1);
      expect(mockReplaceAccountAvatar).toHaveBeenCalledWith(expect.objectContaining({
        uri: 'content://media/recovered.jpg',
      }));
      expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
      expect(rendered.getByText('Dein neues Profilbild wurde gespeichert.')).toBeTruthy();
    });
    await rendered.unmount();
  });

  it('guards against two quick taps starting duplicate uploads', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true } as never);
    mockedLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg', fileName: 'pic.jpg' }],
    } as never);
    let resolveUpload!: (profile: AccountStudyUser) => void;
    mockReplaceAccountAvatar.mockReturnValue(new Promise<AccountStudyUser>((resolve) => {
      resolveUpload = resolve;
    }));

    const rendered = await render(<ProfileScreen />);
    const button = rendered.getByRole('button', { name: 'Profilbild ändern' });
    await fireEvent.press(button);
    await fireEvent.press(button);

    await waitFor(() => expect(mockReplaceAccountAvatar).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveUpload({
        ...accountProfile,
        avatarUrl: 'https://cdn.example.com/avatars/account-1/profile/avatar.jpg?v=99',
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
      expect(rendered.getByText('Dein neues Profilbild wurde gespeichert.')).toBeTruthy();
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
    expect(mockReplaceAccountAvatar).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('keeps a rejected storage upload visible and ends the loading state', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true } as never);
    mockedLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg', fileName: 'pic.jpg' }],
    } as never);
    mockReplaceAccountAvatar.mockRejectedValue(new Error('Der Upload wurde von Supabase abgelehnt.'));

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
    mockReplaceAccountAvatar.mockRejectedValue(
      new Error('Die Profil-URL konnte wegen eines Revisionskonflikts nicht gespeichert werden.'),
    );

    const rendered = await render(<ProfileScreen />);
    await fireEvent.press(rendered.getByRole('button', { name: 'Profilbild ändern' }));

    await waitFor(() => {
      expect(rendered.getByText('Die Profil-URL konnte wegen eines Revisionskonflikts nicht gespeichert werden.')).toBeTruthy();
    });
    await rendered.unmount();
  });
});
