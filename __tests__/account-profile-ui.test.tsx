import { fireEvent, render, waitFor } from '@testing-library/react-native';

import LocalProfileScreen from '@/app/(auth)/local-profile';
import ProfileScreen from '@/app/profile';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type { AccountStudyUser, StudyData } from '@/types/study';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockUpdateAccountProfile = jest.fn();

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

jest.mock('@/state/auth-store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/state/study-store', () => ({
  useStudyStore: jest.fn(),
}));

const mockedUseAuthStore = jest.mocked(useAuthStore);
const mockedUseStudyStore = jest.mocked(useStudyStore);

const accountProfile: AccountStudyUser = {
  id: 'account-1',
  displayName: 'Lea Lernen',
  username: 'lea.lernen',
  avatarUrl: 'https://example.com/lea.png',
  timeZone: 'Europe/Berlin',
  usernameNeedsReview: true,
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

function configureAccountStores() {
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
    data: accountData,
    privacy: {
      friendComparisonsEnabled: false,
      shareAutomaticMinutes: false,
      shareManualMinutes: false,
      shareGoalProgress: false,
      shareStreak: false,
    },
    setFriendComparisonsEnabled: jest.fn(),
    setPrivacyPreference: jest.fn(),
    clearAllData: jest.fn(),
    socialError: null,
    socialLoading: false,
    updateAccountProfile: mockUpdateAccountProfile,
  } as unknown as ReturnType<typeof useStudyStore>);
}

describe('online account profile UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureAccountStores();
  });

  it('validates HTTPS and saves through the study-store account action', async () => {
    mockUpdateAccountProfile.mockResolvedValue({
      ...accountProfile,
      displayName: 'Lea Neu',
      username: 'lea.neu',
      avatarUrl: 'https://example.com/neu.png',
      usernameNeedsReview: false,
      revision: 5,
    });
    const rendered = await render(<LocalProfileScreen />);

    expect(rendered.getByText('Benutzernamen bestätigen')).toBeTruthy();
    await fireEvent.changeText(rendered.getByLabelText('Anzeigename'), ' Lea Neu ');
    await fireEvent.changeText(rendered.getByLabelText('Benutzername'), 'LEA.NEU');
    await fireEvent.changeText(rendered.getByLabelText('Profilbild-Link'), 'http://example.com/neu.png');
    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Profil speichern' }));

    expect(rendered.getByText(/nur ein sicherer Bildlink mit https:\/\//)).toBeTruthy();
    expect(mockUpdateAccountProfile).not.toHaveBeenCalled();

    await fireEvent.changeText(rendered.getByLabelText('Profilbild-Link'), 'https://example.com/neu.png');
    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Profil speichern' }));

    await waitFor(() => {
      expect(mockUpdateAccountProfile).toHaveBeenCalledWith({
        displayName: 'Lea Neu',
        username: 'lea.neu',
        avatarUrl: 'https://example.com/neu.png',
      });
      expect(mockReplace).toHaveBeenCalledWith('/profile');
    });
    await rendered.unmount();
  });

  it('prompts for username review and links to online profile editing', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.getByText('Benutzername noch nicht bestätigt')).toBeTruthy();
    expect(rendered.queryByRole('button', { name: 'Lokales Profil erstellen' })).toBeNull();
    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Profil bearbeiten' }));
    expect(mockPush).toHaveBeenCalledWith('/local-profile');
    await rendered.unmount();
  });
});
