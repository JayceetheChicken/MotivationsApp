import { Dimensions } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import HomeScreen from '@/app/(tabs)/(home)/index';
import ConnectAccountScreen from '@/app/(auth)/connect-account';
import ProfileScreen from '@/app/profile';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type { StudyData } from '@/types/study';

const mockPush = jest.fn();
const mockReplace = jest.fn();

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

jest.mock('@/hooks/use-current-date', () => ({
  useCurrentDate: () => new Date(2026, 6, 17, 12, 0, 0),
}));

jest.mock('@/hooks/use-timer-elapsed', () => ({
  useTimerElapsed: () => 0,
}));

jest.mock('@/state/auth-store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/state/study-store', () => ({
  useStudyStore: jest.fn(),
}));

const mockedUseAuthStore = jest.mocked(useAuthStore);
const mockedUseStudyStore = jest.mocked(useStudyStore);

function setPhoneViewport() {
  const dimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

const guestData: StudyData = {
  currentUser: null,
  subjects: [],
  sessions: [{
    id: 'guest-session',
    userId: 'local-user',
    goalId: null,
    subjectId: 'math',
    subjectNameSnapshot: 'Mathematik',
    source: 'manual',
    status: 'completed',
    startedAt: new Date(2026, 6, 17, 9, 0, 0).toISOString(),
    endedAt: new Date(2026, 6, 17, 9, 30, 0).toISOString(),
    enteredAt: new Date(2026, 6, 17, 10, 0, 0).toISOString(),
    createdAt: new Date(2026, 6, 17, 10, 0, 0).toISOString(),
    durationMinutes: 30,
  }],
  grades: [],
  goals: [],
  friends: [],
  challenges: [],
  activeTimer: null,
};

function setGuestStores() {
  mockedUseAuthStore.mockReturnValue({
    activeMode: 'none',
    configuration: {
      isConfigured: true,
      mode: 'supabase',
      message: 'Supabase-Authentifizierung ist konfiguriert.',
    },
    localProfile: null,
    user: null,
    pendingAction: null,
    signOut: jest.fn(),
    removeLocalProfile: jest.fn(),
  } as unknown as ReturnType<typeof useAuthStore>);
  mockedUseStudyStore.mockReturnValue({
    data: guestData,
    privacy: {
      friendComparisonsEnabled: false,
      shareAutomaticMinutes: false,
      shareGoalProgress: false,
      shareStreak: false,
    },
    setFriendComparisonsEnabled: jest.fn(),
    setPrivacyPreference: jest.fn(),
    clearAllData: jest.fn(),
  } as unknown as ReturnType<typeof useStudyStore>);
}

describe('guest mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPhoneViewport();
    setGuestStores();
  });

  it('shows guest learning time and keeps account settings reachable from home', async () => {
    const rendered = await render(<HomeScreen />);

    expect(rendered.getByLabelText('Heute: 30 Minuten')).toBeTruthy();
    await fireEvent.press(rendered.getByLabelText('Konto und Einstellungen öffnen'));
    expect(mockPush).toHaveBeenCalledWith('/profile');
    await rendered.unmount();
  });

  it('offers voluntary account actions without pretending a local profile exists', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.getByText('Ohne Konto')).toBeTruthy();
    expect(rendered.getByText('Direkt und ohne Anmeldung')).toBeTruthy();
    expect(rendered.getByRole('button', { name: 'Konto verbinden' })).toBeTruthy();
    expect(rendered.queryByText('Lokales Profil und Daten löschen')).toBeNull();

    await fireEvent.press(rendered.getByRole('button', { name: 'Konto verbinden' }));
    expect(mockPush).toHaveBeenCalledWith('/connect-account');
    await rendered.unmount();
  });

  it('keeps local and cloud account choices voluntary behind the connection screen', async () => {
    const rendered = await render(<ConnectAccountScreen />);

    expect(rendered.getByText('Deine Daten bleiben erhalten')).toBeTruthy();
    expect(rendered.getByText('Mit Cloud-Konto anmelden')).toBeTruthy();
    expect(rendered.getByText('Cloud-Konto erstellen')).toBeTruthy();
    expect(rendered.getByText('Lokales Profil erstellen')).toBeTruthy();

    await fireEvent.press(rendered.getByText('Mit Cloud-Konto anmelden'));
    expect(mockPush).toHaveBeenCalledWith('/login');
    await rendered.unmount();
  });
});
