import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import FriendProfileScreen from '@/app/(tabs)/(friends)/friend/[user-id]';
import FriendsScreen from '@/app/(tabs)/(friends)/friends';
import CreateSharedGoalScreen from '@/app/(tabs)/(friends)/shared-goal/create';
import SharedGoalDetailsScreen from '@/app/(tabs)/(friends)/shared-goal/[goal-id]';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type {
  FriendProfileStatistics,
  FriendStatsPeriod,
  FriendshipConnection,
  SharedGoalProgress,
  StudyChallenge,
  StudyData,
  StudyUser,
} from '@/types/study';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockLocalSearchParams: Record<string, string | readonly string[] | undefined> = {};

const mockRefreshSocial = jest.fn<Promise<void>, []>();
const mockFindFriendByUsername = jest.fn();
const mockSendFriendRequest = jest.fn<Promise<void>, [string]>();
const mockAcceptFriendRequest = jest.fn<Promise<void>, [string]>();
const mockDeclineFriendRequest = jest.fn<Promise<void>, [string]>();
const mockRemoveFriendship = jest.fn<Promise<void>, [string]>();
const mockGetFriendProfileStats = jest.fn();
const mockCreateSharedGoal = jest.fn();
const mockRespondSharedGoalInvitation = jest.fn();
const mockWithdrawFromSharedGoal = jest.fn<Promise<void>, [string]>();
const mockGetSharedGoalDetails = jest.fn();
const mockGetSharedGoalProgress = jest.fn();
const mockSubscribeSharedGoalProgress = jest.fn();
const mockRealtimeCleanup = jest.fn<Promise<void>, []>();
const mockSetFriendComparisonsEnabled = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockLocalSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/state/auth-store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/state/study-store', () => ({
  useStudyStore: jest.fn(),
}));

const mockedUseAuthStore = jest.mocked(useAuthStore);
const mockedUseStudyStore = jest.mocked(useStudyStore);

const currentUser: StudyUser = {
  id: 'account-alice',
  username: 'alice',
  displayName: 'Alice Beispiel',
};

const friendUser: StudyUser = {
  id: 'account-berta',
  username: 'berta',
  displayName: 'Berta Beispiel',
};

const acceptedConnection: FriendshipConnection = {
  id: 'friendship-alice-berta',
  requesterId: currentUser.id,
  addresseeId: friendUser.id,
  status: 'accepted',
  direction: 'outgoing',
  otherUser: friendUser,
  createdAt: '2026-07-01T08:00:00.000Z',
  respondedAt: '2026-07-01T09:00:00.000Z',
};

const teamGoal: StudyChallenge = {
  id: 'goal-team-week',
  creatorId: currentUser.id,
  title: '100 Minuten im Team',
  description: 'Jeder Beitrag zählt zum gemeinsamen Ziel.',
  target: {
    type: 'duration',
    mode: 'shared',
    targetMinutes: 100,
  },
  sourcePolicy: 'all',
  startsAt: '2026-07-13T00:00:00.000Z',
  endsAt: '2026-07-20T00:00:00.000Z',
  status: 'active',
  participants: [
    {
      userId: currentUser.id,
      status: 'accepted',
    },
    {
      userId: friendUser.id,
      status: 'accepted',
    },
  ],
};

const teamProgress: SharedGoalProgress = {
  goalId: teamGoal.id,
  goalType: 'duration',
  mode: 'shared',
  sourcePolicy: 'all',
  startsAt: teamGoal.startsAt,
  endsAt: teamGoal.endsAt,
  revision: 4,
  participants: [
    {
      userId: currentUser.id,
      user: currentUser,
      status: 'accepted',
      contribution: 40,
      contributionMinutes: 40,
      sessionCount: 1,
      target: null,
      progressPercent: null,
      remaining: null,
      achieved: null,
      exceededBy: null,
    },
    {
      userId: friendUser.id,
      user: friendUser,
      status: 'accepted',
      contribution: 30,
      contributionMinutes: 30,
      sessionCount: 1,
      target: null,
      progressPercent: null,
      remaining: null,
      achieved: null,
      exceededBy: null,
    },
  ],
  team: {
    contribution: 70,
    target: 100,
    progressPercent: 70,
    remaining: 30,
    achieved: false,
    exceededBy: 0,
  },
  calculatedAt: '2026-07-18T12:00:00.000Z',
};

const emptyData: StudyData = {
  currentUser,
  subjects: [],
  sessions: [],
  grades: [],
  goals: [],
  friends: [],
  challenges: [],
  activeTimer: null,
};

function setWindowWidth(width: number) {
  const dimensions = {
    width,
    height: width >= 900 ? 1366 : 844,
    scale: 1,
    fontScale: 1,
  };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

function setAuthMode(mode: 'none' | 'supabase') {
  mockedUseAuthStore.mockReturnValue({
    activeMode: mode,
    loading: false,
    configuration: {
      isConfigured: true,
      mode: 'supabase',
      message: 'Online-Anmeldung verfügbar.',
    },
    localProfile: null,
    user: mode === 'supabase'
      ? {
          id: currentUser.id,
          email: 'alice@example.com',
          user_metadata: { display_name: currentUser.displayName, username: currentUser.username },
        }
      : null,
    pendingAction: null,
  } as unknown as ReturnType<typeof useAuthStore>);
}

function setStudyStore(overrides: Record<string, unknown> = {}) {
  mockedUseStudyStore.mockReturnValue({
    data: emptyData,
    privacy: {
      friendComparisonsEnabled: true,
      shareAutomaticMinutes: false,
      shareManualMinutes: false,
      shareGoalProgress: false,
      shareStreak: false,
    },
    socialLoading: false,
    socialError: null,
    friendConnections: [],
    refreshSocial: mockRefreshSocial,
    findFriendByUsername: mockFindFriendByUsername,
    sendFriendRequest: mockSendFriendRequest,
    acceptFriendRequest: mockAcceptFriendRequest,
    declineFriendRequest: mockDeclineFriendRequest,
    removeFriendship: mockRemoveFriendship,
    getFriendProfileStats: mockGetFriendProfileStats,
    createSharedGoal: mockCreateSharedGoal,
    respondSharedGoalInvitation: mockRespondSharedGoalInvitation,
    withdrawFromSharedGoal: mockWithdrawFromSharedGoal,
    getSharedGoalDetails: mockGetSharedGoalDetails,
    getSharedGoalProgress: mockGetSharedGoalProgress,
    subscribeSharedGoalProgress: mockSubscribeSharedGoalProgress,
    setFriendComparisonsEnabled: mockSetFriendComparisonsEnabled,
    ...overrides,
  } as unknown as ReturnType<typeof useStudyStore>);
}

function makePeriod(period: FriendStatsPeriod, index: number) {
  return {
    period,
    startsAt: `2026-07-${String(18 - index).padStart(2, '0')}T00:00:00.000Z`,
    endsAt: `2026-07-${String(19 - index).padStart(2, '0')}T00:00:00.000Z`,
    timerMinutes: 30 + index,
    timerSessionCount: 1,
    manualMinutes: null,
    manualSessionCount: null,
    totalMinutes: null,
    totalSessionCount: null,
  };
}

function makeFriendStatistics(): FriendProfileStatistics {
  return {
    friend: {
      ...friendUser,
      timeZone: 'Europe/Berlin',
      usernameNeedsReview: false,
      revision: 2,
    },
    periods: {
      today: makePeriod('today', 0),
      yesterday: makePeriod('yesterday', 1),
      this_week: makePeriod('this_week', 2),
      last_week: makePeriod('last_week', 3),
      this_month: makePeriod('this_month', 4),
      last_month: makePeriod('last_month', 5),
    },
    streakDays: null,
    goals: null,
    visibility: {
      timer: true,
      manual: false,
      goals: false,
      streak: false,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalSearchParams = {};
  setWindowWidth(390);
  setAuthMode('supabase');

  mockRefreshSocial.mockResolvedValue(undefined);
  mockSendFriendRequest.mockResolvedValue(undefined);
  mockAcceptFriendRequest.mockResolvedValue(undefined);
  mockDeclineFriendRequest.mockResolvedValue(undefined);
  mockRemoveFriendship.mockResolvedValue(undefined);
  mockWithdrawFromSharedGoal.mockResolvedValue(undefined);
  mockRealtimeCleanup.mockResolvedValue(undefined);
  mockSubscribeSharedGoalProgress.mockResolvedValue(mockRealtimeCleanup);
  mockGetSharedGoalDetails.mockResolvedValue(null);
  mockGetSharedGoalProgress.mockResolvedValue(null);
  setStudyStore();
});

describe('Social routes', () => {
  it('gates the friends route in guest mode and keeps both account entry points working', async () => {
    setAuthMode('none');
    const rendered = await render(<FriendsScreen />);

    expect(rendered.getByText('Online-Konto erforderlich')).toBeTruthy();
    expect(rendered.queryByLabelText('Eindeutigen Benutzernamen suchen')).toBeNull();

    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Konto anmelden' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Konto erstellen' }));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/login');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/register');
    expect(mockRefreshSocial).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('normalizes an exact username search and sends a request through the store facade', async () => {
    mockFindFriendByUsername
      .mockResolvedValueOnce({ user: friendUser, connection: null })
      .mockResolvedValueOnce({
        user: friendUser,
        connection: {
          id: acceptedConnection.id,
          status: 'pending',
          direction: 'outgoing',
        },
      });
    const rendered = await render(<FriendsScreen />);

    await fireEvent.changeText(
      rendered.getByLabelText('Eindeutigen Benutzernamen suchen'),
      '@BeRtA',
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Suchen' }));

    await waitFor(() => {
      expect(mockFindFriendByUsername).toHaveBeenCalledWith('berta');
      expect(rendered.getByText('@berta · Noch nicht verbunden')).toBeTruthy();
    });

    await fireEvent.press(rendered.getByRole('button', { name: 'Anfragen' }));

    await waitFor(() => {
      expect(mockSendFriendRequest).toHaveBeenCalledWith('berta');
      expect(mockFindFriendByUsername).toHaveBeenNthCalledWith(2, 'berta');
      expect(rendered.getByText('@berta · Anfrage gesendet')).toBeTruthy();
    });
    await rendered.unmount();
  });

  it('shows six friend periods and never turns redacted manual/total values into zero', async () => {
    setWindowWidth(1024);
    mockLocalSearchParams = { 'user-id': friendUser.id };
    mockGetFriendProfileStats.mockResolvedValue(makeFriendStatistics());
    setStudyStore({ friendConnections: [acceptedConnection] });

    const rendered = await render(<FriendProfileScreen />);

    await waitFor(() => {
      expect(rendered.getByText('@berta')).toBeTruthy();
      expect(rendered.getAllByLabelText('Manuell: nicht freigegeben')).toHaveLength(6);
      expect(rendered.getAllByLabelText('Gesamt: nicht freigegeben')).toHaveLength(6);
    });

    for (const label of [
      'Heute',
      'Gestern',
      'Diese Woche',
      'Letzte Woche',
      'Dieser Monat',
      'Letzter Monat',
    ]) {
      expect(rendered.getByLabelText(label)).toBeTruthy();
    }
    expect(StyleSheet.flatten(rendered.getByLabelText('Heute').props.style).flexBasis).toBe('31%');
    expect(rendered.queryByLabelText(/Manuell: 0/)).toBeNull();
    expect(rendered.queryByLabelText(/Gesamt: 0/)).toBeNull();
    expect(mockGetFriendProfileStats).toHaveBeenCalledWith(friendUser.id);
    await rendered.unmount();
  });

  it.each([
    ['Smartphone', 390, 'Täglich', 'day', undefined],
    ['Tablet', 1024, 'Monatlich', 'month', 'row'],
  ] as const)(
    'requires a period without exposing date inputs on %s at %ipx',
    async (_device, width, periodLabel, expectedPeriod, expectedDirection) => {
      setWindowWidth(width);
      mockCreateSharedGoal.mockResolvedValue(teamGoal);
      setStudyStore({ friendConnections: [acceptedConnection] });
      const rendered = await render(<CreateSharedGoalScreen />);

      const periodControl = rendered.getByLabelText('Zeitraum des gemeinsamen Lernziels');
      expect(periodControl).toBeTruthy();
      expect(rendered.getByRole('tab', { name: 'Wöchentlich' }).props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      );
      expect(StyleSheet.flatten(rendered.getByTestId('shared-goal-form-layout').props.style).flexDirection)
        .toBe(expectedDirection);

      expect(rendered.queryByLabelText(/startdatum|enddatum|beginn des zeitraums|ende des zeitraums/i))
        .toBeNull();
      expect(rendered.queryByDisplayValue(/^\d{4}-\d{2}-\d{2}$/)).toBeNull();
      expect(rendered.queryByPlaceholderText(/TT|JJJJ|Startdatum|Enddatum/i)).toBeNull();

      await fireEvent.press(rendered.getByRole('tab', { name: periodLabel }));
      await fireEvent.changeText(
        rendered.getByLabelText('Titel des gemeinsamen Lernziels'),
        teamGoal.title,
      );
      await fireEvent.changeText(rendered.getByLabelText('Zielwert in Stunden'), '2');
      await fireEvent.press(rendered.getByRole('checkbox', { name: 'Berta Beispiel einladen' }));
      await fireEvent.press(rendered.getByRole('button', { name: 'Ziel erstellen und einladen' }));

      await waitFor(() => expect(mockCreateSharedGoal).toHaveBeenCalledTimes(1));
      expect(mockCreateSharedGoal.mock.calls[0][0]).toEqual(expect.objectContaining({
        inviteeIds: [friendUser.id],
        goal: expect.objectContaining({
          period: expectedPeriod,
          targetMinutes: 120,
        }),
      }));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(tabs)/(friends)/shared-goal/[goal-id]',
        params: { 'goal-id': teamGoal.id },
      });
      await rendered.unmount();
    },
  );

  it('renders team facts once, binds both session actions and cleans up its live subscription', async () => {
    mockLocalSearchParams = { 'goal-id': teamGoal.id };
    mockGetSharedGoalDetails.mockResolvedValue(teamGoal);
    mockGetSharedGoalProgress.mockResolvedValue(teamProgress);
    setStudyStore({
      data: { ...emptyData, challenges: [teamGoal] },
      friendConnections: [acceptedConnection],
    });

    const rendered = await render(<SharedGoalDetailsScreen />);

    await waitFor(() => {
      expect(mockGetSharedGoalProgress).toHaveBeenCalledWith(teamGoal.id);
      expect(rendered.getAllByText('Gemeinsamer Teamfortschritt')).toHaveLength(1);
      expect(rendered.getAllByText('70 %').length).toBeGreaterThanOrEqual(1);
    });
    expect(rendered.getAllByText('Fortschritt')).toHaveLength(1);
    expect(rendered.getAllByText('Noch fehlend')).toHaveLength(1);
    expect(rendered.getAllByText('Über Ziel')).toHaveLength(1);
    expect(rendered.getByLabelText(/Alice Beispiel, Nimmt teil, Beitrag/)).toBeTruthy();
    expect(rendered.getByLabelText(/Berta Beispiel, Nimmt teil, Beitrag/)).toBeTruthy();

    mockPush.mockClear();
    await fireEvent.press(rendered.getByRole('button', { name: 'Timer starten' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Manuell eintragen' }));
    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/session',
      params: { goalId: teamGoal.id },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/manual-entry',
      params: { goalId: teamGoal.id },
    });

    await waitFor(() => expect(mockSubscribeSharedGoalProgress).toHaveBeenCalledTimes(1));
    const subscriptionSignal = mockSubscribeSharedGoalProgress.mock.calls[0][2] as AbortSignal;
    expect(subscriptionSignal.aborted).toBe(false);

    await rendered.unmount();
    expect(subscriptionSignal.aborted).toBe(true);
    await waitFor(() => expect(mockRealtimeCleanup).toHaveBeenCalledTimes(1));
  });
});
