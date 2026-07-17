import { Dimensions } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import HomeScreen from '@/app/(tabs)/(home)/index';
import ProfileScreen from '@/app/profile';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type { StudyData } from '@/types/study';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignOut = jest.fn();

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

function setGuestStores(isConfigured = true) {
  mockedUseAuthStore.mockReturnValue({
    activeMode: 'none',
    configuration: {
      isConfigured,
      mode: isConfigured ? 'supabase' : 'local-development',
      message: isConfigured
        ? 'Online-Anmeldung verfügbar.'
        : 'EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY fehlen.',
    },
    localProfile: null,
    user: null,
    pendingAction: null,
    signOut: mockSignOut,
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
    expect(mockPush).not.toHaveBeenCalled();
    await fireEvent.press(rendered.getByLabelText('Konto und Einstellungen öffnen'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/profile');
    await rendered.unmount();
  });

  it('offers voluntary account actions without pretending a local profile exists', async () => {
    const rendered = await render(<ProfileScreen />);

    expect(rendered.getByText('Ohne Konto')).toBeTruthy();
    expect(rendered.getByText('Direkt und ohne Anmeldung')).toBeTruthy();
    expect(rendered.getByText('Konto & Synchronisierung')).toBeTruthy();
    expect(rendered.getByRole('button', { name: 'Online-Konto anmelden' })).toBeTruthy();
    expect(rendered.getByRole('button', { name: 'Online-Konto erstellen' })).toBeTruthy();
    expect(rendered.getByRole('button', { name: 'Lokales Profil erstellen' })).toBeTruthy();
    expect(rendered.queryByText('Lokales Profil und Daten löschen')).toBeNull();

    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Konto anmelden' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Konto erstellen' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Lokales Profil erstellen' }));
    expect(mockPush).toHaveBeenNthCalledWith(1, '/login');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/register');
    expect(mockPush).toHaveBeenNthCalledWith(3, '/local-profile');
    await rendered.unmount();
  });

  it('hides unavailable online actions and never exposes technical configuration messages', async () => {
    setGuestStores(false);
    const rendered = await render(<ProfileScreen />);

    expect(rendered.queryByRole('button', { name: 'Online-Konto anmelden' })).toBeNull();
    expect(rendered.queryByRole('button', { name: 'Online-Konto erstellen' })).toBeNull();
    expect(rendered.getByRole('button', { name: 'Lokales Profil erstellen' })).toBeTruthy();
    expect(rendered.queryByText(/EXPO_PUBLIC_/)).toBeNull();
    await rendered.unmount();
  });

  it('returns to guest home after signing out', async () => {
    mockSignOut.mockResolvedValue({ ok: true, message: 'Abgemeldet.' });
    mockedUseAuthStore.mockReturnValue({
      activeMode: 'supabase',
      configuration: {
        isConfigured: true,
        mode: 'supabase',
        message: 'Online-Anmeldung verfügbar.',
      },
      localProfile: null,
      user: {
        id: 'account-123',
        email: 'lea@example.com',
        user_metadata: { display_name: 'Lea', username: 'lea' },
      },
      pendingAction: null,
      signOut: mockSignOut,
      removeLocalProfile: jest.fn(),
    } as unknown as ReturnType<typeof useAuthStore>);

    const rendered = await render(<ProfileScreen />);

    await fireEvent.press(rendered.getByRole('button', { name: 'Abmelden' }));
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
    await rendered.unmount();
  });
});
