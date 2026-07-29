import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Dimensions } from 'react-native';

import FriendProfileScreen from '@/app/(tabs)/(friends)/friend/[user-id]';
import FriendsScreen from '@/app/(tabs)/(friends)/friends';
import CreateStudyGroupScreen from '@/app/(tabs)/(friends)/group/create';
import StudyGroupDetailsScreen from '@/app/(tabs)/(friends)/group/[group-id]';
import CreateSharedGoalScreen from '@/app/(tabs)/(friends)/shared-goal/create';
import SharedGoalDetailsScreen from '@/app/(tabs)/(friends)/shared-goal/[goal-id]';
import CreateSharedStudySessionScreen from '@/app/(tabs)/(friends)/shared-session/create';
import SharedStudySessionDetailsScreen, {
  participantElapsedMinutes,
  selectLatestSharedStudySession,
} from '@/app/(tabs)/(friends)/shared-session/[session-id]';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import type {
  FriendOverview,
  FriendSearchResult,
  FriendshipConnection,
  SharedGoalProgress,
  SharedStudySession,
  StudyChallenge,
  StudyData,
  StudyGroup,
  StudyUser,
} from '@/types/study';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockLocalSearchParams: Record<string, string | readonly string[] | undefined> = {};

const mockRefreshSocial = jest.fn<Promise<void>, []>();
const mockFindFriendByUsername = jest.fn<Promise<FriendSearchResult | null>, [string]>();
const mockSendFriendRequest = jest.fn<Promise<void>, [string]>();
const mockAcceptFriendRequest = jest.fn<Promise<void>, [string]>();
const mockDeclineFriendRequest = jest.fn<Promise<void>, [string]>();
const mockRemoveFriendship = jest.fn<Promise<void>, [string]>();
const mockGetFriendOverview = jest.fn();
const mockCreateSharedGoal = jest.fn();
const mockRespondSharedGoalInvitation = jest.fn();
const mockWithdrawFromSharedGoal = jest.fn<Promise<void>, [string]>();
const mockGetSharedGoalDetails = jest.fn();
const mockGetSharedGoalProgress = jest.fn();
const mockSubscribeSharedGoalProgress = jest.fn();
const mockRealtimeCleanup = jest.fn<Promise<void>, []>();
const mockCreateStudyGroup = jest.fn();
const mockGetStudyGroupDetails = jest.fn();
const mockRespondStudyGroupInvitation = jest.fn();
const mockLeaveStudyGroup = jest.fn();
const mockCreateSharedStudySession = jest.fn();
const mockGetSharedStudySessionDetails = jest.fn();
const mockRespondSharedStudySessionInvitation = jest.fn();
const mockUpdateSharedStudySessionParticipant = jest.fn();
const mockCancelSharedStudySession = jest.fn();
const mockSetFriendComparisonsEnabled = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useFocusEffect: jest.fn(),
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

function containsImageUri(node: unknown, uri: string | undefined): boolean {
  if (!uri || !node || typeof node !== 'object') return false;
  const candidate = node as {
    props?: { source?: { uri?: string } | readonly { uri?: string }[] };
    children?: readonly unknown[];
  };
  const source = candidate.props?.source;
  return (Array.isArray(source)
    ? source.some((entry) => entry.uri === uri)
    : (source as { uri?: string } | undefined)?.uri === uri) ||
    candidate.children?.some((child) => containsImageUri(child, uri)) === true;
}

const currentUser: StudyUser = {
  id: 'account-alice',
  username: 'alice',
  displayName: 'Alice Beispiel',
};

const friendUser: StudyUser = {
  id: 'account-berta',
  username: 'berta',
  displayName: 'Berta Beispiel',
  avatarUrl: 'https://cdn.example.com/avatars/account-berta/avatar.jpg?v=11',
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

const incomingRequest: FriendshipConnection = {
  id: 'friendship-berta-alice',
  requesterId: friendUser.id,
  addresseeId: currentUser.id,
  status: 'pending',
  direction: 'incoming',
  otherUser: friendUser,
  createdAt: '2026-07-22T08:00:00.000Z',
  respondedAt: null,
};

const teamGoal: StudyChallenge = {
  id: 'goal-team-week',
  creatorId: currentUser.id,
  title: '100 Minuten im Team',
  description: 'Jeder Beitrag zählt zum gemeinsamen Ziel.',
  cadence: 'weekly',
  groupId: 'group-analysis',
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
  overall: {
    contribution: 70,
    target: 100,
    progressPercent: 70,
    remaining: 30,
    achieved: false,
    exceededBy: 0,
  },
  calculatedAt: '2026-07-18T12:00:00.000Z',
};

const studyGroup: StudyGroup = {
  id: 'group-analysis',
  creatorId: currentUser.id,
  name: 'Analysis Crew',
  icon: '📚',
  members: [
    {
      userId: currentUser.id,
      user: currentUser,
      role: 'owner',
      status: 'accepted',
    },
    {
      userId: friendUser.id,
      user: friendUser,
      role: 'member',
      status: 'accepted',
    },
  ],
  sharedGoalIds: [teamGoal.id],
  sharedSessionIds: ['shared-session-focus'],
  createdAt: '2026-07-18T09:00:00.000Z',
  updatedAt: '2026-07-18T09:00:00.000Z',
};

const sharedStudySession: SharedStudySession = {
  id: 'shared-session-focus',
  creatorId: currentUser.id,
  groupId: studyGroup.id,
  title: 'Gemeinsamer Fokus',
  startsAt: '2030-03-10T16:30:00.000Z',
  plannedDurationMinutes: 60,
  status: 'planned',
  startedAt: null,
  endedAt: null,
  participants: [
    {
      userId: currentUser.id,
      user: currentUser,
      status: 'joined',
      elapsedMinutes: 0,
    },
    {
      userId: friendUser.id,
      user: friendUser,
      status: 'invited',
      elapsedMinutes: 0,
    },
  ],
  createdAt: '2026-07-18T09:30:00.000Z',
  updatedAt: '2026-07-18T09:30:00.000Z',
  calculatedAt: '2026-07-18T09:30:00.000Z',
};

const friendOverview: FriendOverview = {
  friend: friendUser,
  presenceStatus: 'learning',
  lastActiveAt: '2026-07-22T08:59:00.000Z',
  presenceExpiresAt: '2030-07-22T09:02:00.000Z',
  onlineExpiresAt: '2030-07-22T09:02:00.000Z',
  sharedGoalIds: [teamGoal.id],
  sharedSessionIds: [sharedStudySession.id],
  groupIds: [studyGroup.id],
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
    socialRealtimeUnavailable: false,
    friendConnections: [],
    friendOverviews: [],
    studyGroups: [],
    sharedStudySessions: [],
    sharedGoalProgressById: {},
    refreshSocial: mockRefreshSocial,
    findFriendByUsername: mockFindFriendByUsername,
    sendFriendRequest: mockSendFriendRequest,
    acceptFriendRequest: mockAcceptFriendRequest,
    declineFriendRequest: mockDeclineFriendRequest,
    removeFriendship: mockRemoveFriendship,
    getFriendOverview: mockGetFriendOverview,
    createSharedGoal: mockCreateSharedGoal,
    respondSharedGoalInvitation: mockRespondSharedGoalInvitation,
    withdrawFromSharedGoal: mockWithdrawFromSharedGoal,
    getSharedGoalDetails: mockGetSharedGoalDetails,
    getSharedGoalProgress: mockGetSharedGoalProgress,
    subscribeSharedGoalProgress: mockSubscribeSharedGoalProgress,
    createStudyGroup: mockCreateStudyGroup,
    getStudyGroupDetails: mockGetStudyGroupDetails,
    respondStudyGroupInvitation: mockRespondStudyGroupInvitation,
    leaveStudyGroup: mockLeaveStudyGroup,
    createSharedStudySession: mockCreateSharedStudySession,
    getSharedStudySessionDetails: mockGetSharedStudySessionDetails,
    respondSharedStudySessionInvitation: mockRespondSharedStudySessionInvitation,
    updateSharedStudySessionParticipant: mockUpdateSharedStudySessionParticipant,
    cancelSharedStudySession: mockCancelSharedStudySession,
    setFriendComparisonsEnabled: mockSetFriendComparisonsEnabled,
    ...overrides,
  } as unknown as ReturnType<typeof useStudyStore>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalSearchParams = {};
  setWindowWidth(390);
  setAuthMode('supabase');

  mockRefreshSocial.mockResolvedValue(undefined);
  mockFindFriendByUsername.mockResolvedValue(null);
  mockSendFriendRequest.mockResolvedValue(undefined);
  mockAcceptFriendRequest.mockResolvedValue(undefined);
  mockDeclineFriendRequest.mockResolvedValue(undefined);
  mockRemoveFriendship.mockResolvedValue(undefined);
  mockWithdrawFromSharedGoal.mockResolvedValue(undefined);
  mockGetFriendOverview.mockResolvedValue(null);
  mockRealtimeCleanup.mockResolvedValue(undefined);
  mockSubscribeSharedGoalProgress.mockResolvedValue(mockRealtimeCleanup);
  mockGetSharedGoalDetails.mockResolvedValue(null);
  mockGetSharedGoalProgress.mockResolvedValue(null);
  mockCreateStudyGroup.mockResolvedValue(null);
  mockGetStudyGroupDetails.mockResolvedValue(null);
  mockRespondStudyGroupInvitation.mockResolvedValue(null);
  mockLeaveStudyGroup.mockResolvedValue(undefined);
  mockCreateSharedStudySession.mockResolvedValue(null);
  mockGetSharedStudySessionDetails.mockResolvedValue(null);
  mockRespondSharedStudySessionInvitation.mockResolvedValue(null);
  mockUpdateSharedStudySessionParticipant.mockResolvedValue(null);
  mockCancelSharedStudySession.mockResolvedValue(null);
  setStudyStore();
});

describe('Social routes', () => {
  it('requires an online account before exposing friend data', async () => {
    setAuthMode('none');
    const rendered = await render(<FriendsScreen />);

    expect(rendered.getByText('Online-Konto erforderlich')).toBeTruthy();
    expect(rendered.queryByLabelText('Eindeutigen Benutzernamen suchen')).toBeNull();
    expect(mockRefreshSocial).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it('searches by exact username and sends a friend request', async () => {
    mockFindFriendByUsername
      .mockResolvedValueOnce({ user: friendUser, connection: null })
      .mockResolvedValueOnce({
        user: friendUser,
        connection: { id: incomingRequest.id, status: 'pending', direction: 'outgoing' },
      });
    const rendered = await render(<FriendsScreen />);

    await fireEvent.changeText(
      rendered.getByLabelText('Eindeutigen Benutzernamen suchen'),
      '@BeRtA',
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Suchen' }));

    await waitFor(() => {
      expect(mockFindFriendByUsername).toHaveBeenCalledWith('berta');
      expect(rendered.getByText('Berta Beispiel')).toBeTruthy();
      expect(rendered.getByText(/Noch nicht verbunden/)).toBeTruthy();
    });
    await fireEvent.press(rendered.getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(() => {
      expect(mockSendFriendRequest).toHaveBeenCalledWith(friendUser.username);
      expect(mockFindFriendByUsername).toHaveBeenLastCalledWith(friendUser.username);
      expect(rendered.getByText(/Anfrage gesendet/)).toBeTruthy();
    });
    await rendered.unmount();
  });

  it('keeps friend search usable while realtime is degraded and never renders raw backend errors', async () => {
    setStudyStore({
      socialRealtimeUnavailable: true,
      socialError: 'MissingPartition: Realtime was unable to find the expected messages partition',
    });
    mockFindFriendByUsername.mockResolvedValueOnce({ user: friendUser, connection: null });
    const rendered = await render(<FriendsScreen />);

    expect(rendered.getByTestId('social-realtime-unavailable')).toHaveTextContent(
      'Der Live-Status ist momentan nicht verfügbar. Die Freundesfunktionen können weiterhin verwendet werden.',
    );
    expect(rendered.queryByText(/MissingPartition|expected messages partition/i)).toBeNull();

    await fireEvent.changeText(
      rendered.getByLabelText('Eindeutigen Benutzernamen suchen'),
      'berta',
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Suchen' }));
    await waitFor(() => {
      expect(mockFindFriendByUsername).toHaveBeenCalledWith('berta');
      expect(rendered.getByText('Berta Beispiel')).toBeTruthy();
    });
    await rendered.unmount();
  });

  it('does not apply a stale request error to a newer search query', async () => {
    let rejectRequest!: (reason?: unknown) => void;
    mockFindFriendByUsername.mockResolvedValueOnce({ user: friendUser, connection: null });
    mockSendFriendRequest.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectRequest = reject;
    }));
    const rendered = await render(<FriendsScreen />);

    await fireEvent.changeText(
      rendered.getByLabelText('Eindeutigen Benutzernamen suchen'),
      'berta',
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Suchen' }));
    await waitFor(() => expect(rendered.getByRole('button', { name: 'Hinzufügen' })).toBeTruthy());
    await fireEvent.press(rendered.getByRole('button', { name: 'Hinzufügen' }));
    await fireEvent.changeText(
      rendered.getByLabelText('Eindeutigen Benutzernamen suchen'),
      'carla',
    );

    await act(async () => {
      rejectRequest(new Error('Veralteter Anfragefehler'));
      await Promise.resolve();
    });

    expect(rendered.getByDisplayValue('carla')).toBeTruthy();
    expect(rendered.queryByText('Veralteter Anfragefehler')).toBeNull();
    await rendered.unmount();
  });

  it('handles incoming requests, removals, presence, shared sessions and shared progress', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    setStudyStore({
      data: {
        ...emptyData,
        challenges: [teamGoal],
        goals: [{
          id: 'private-goal',
          userId: currentUser.id,
          title: 'Unsichtbares privates Lernziel',
          type: 'duration',
          targetMinutes: 240,
          period: 'weekly',
          sourcePolicy: 'all',
          status: 'active',
          createdAt: '2026-07-22T08:00:00.000Z',
        }],
      },
      friendConnections: [acceptedConnection, incomingRequest],
      friendOverviews: [friendOverview],
      sharedStudySessions: [sharedStudySession],
      sharedGoalProgressById: { [teamGoal.id]: teamProgress },
    });
    const rendered = await render(<FriendsScreen />);

    await waitFor(() => {
      expect(rendered.getByTestId(`friend-request-${incomingRequest.id}`)).toBeTruthy();
      expect(rendered.getByTestId(`friend-presence-${friendUser.id}`)).toBeTruthy();
      expect(rendered.getByText('Lernt gerade')).toBeTruthy();
      expect(rendered.getByText(/Zuletzt aktiv/)).toBeTruthy();
      expect(rendered.getByText('Gemeinsamer Fortschritt')).toBeTruthy();
      expect(rendered.getByText('Dein Beitrag')).toBeTruthy();
      expect(rendered.getByText('40 Min.')).toBeTruthy();
      expect(rendered.getByTestId(`planned-session-${sharedStudySession.id}`)).toBeTruthy();
    });
    expect(rendered.queryByText('Unsichtbares privates Lernziel')).toBeNull();
    expect(rendered.queryByText('3 Std. 5 Min.')).toBeNull();
    expect(rendered.queryByText('6 Tage')).toBeNull();

    await fireEvent.press(rendered.getByRole('button', {
      name: 'Anfrage von Berta Beispiel annehmen',
    }));
    await waitFor(() => expect(mockAcceptFriendRequest).toHaveBeenCalledWith(incomingRequest.id));
    await fireEvent.press(rendered.getByRole('button', {
      name: 'Anfrage von Berta Beispiel ablehnen',
    }));
    await waitFor(() => expect(mockDeclineFriendRequest).toHaveBeenCalledWith(incomingRequest.id));

    await fireEvent.press(rendered.getByRole('button', { name: 'Gemeinsame Session erstellen' }));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/(friends)/shared-session/create');

    await fireEvent.press(rendered.getByRole('button', { name: 'Gemeinsames Ziel erstellen' }));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/(friends)/shared-goal/create');

    await fireEvent.press(rendered.getByRole('button', {
      name: 'Freundschaft mit Berta Beispiel entfernen',
    }));
    expect(alertSpy).toHaveBeenCalledWith(
      'Freund entfernen?',
      expect.any(String),
      expect.any(Array),
    );
    const removalButtons = alertSpy.mock.calls[0]?.[2];
    const confirmButton = removalButtons?.find((button) => button.style === 'destructive');
    await act(async () => {
      confirmButton?.onPress?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRemoveFriendship).toHaveBeenCalledWith(acceptedConnection.id));

    alertSpy.mockRestore();
    await rendered.unmount();
  });

  it('orders friends by learning, online and offline presence', async () => {
    const onlineUser: StudyUser = {
      id: 'account-carla',
      username: 'carla',
      displayName: 'Carla Beispiel',
    };
    const offlineUser: StudyUser = {
      id: 'account-dora',
      username: 'dora',
      displayName: 'Dora Beispiel',
    };
    const connectionFor = (user: StudyUser): FriendshipConnection => ({
      id: `friendship-${user.id}`,
      requesterId: currentUser.id,
      addresseeId: user.id,
      status: 'accepted',
      direction: 'outgoing',
      otherUser: user,
      createdAt: '2026-07-01T08:00:00.000Z',
      respondedAt: '2026-07-01T09:00:00.000Z',
    });
    const overviewFor = (
      user: StudyUser,
      presenceStatus: FriendOverview['presenceStatus'],
      lastActiveAt: string | null,
    ): FriendOverview => ({
      friend: user,
      presenceStatus,
      lastActiveAt,
      presenceExpiresAt: presenceStatus === 'offline' ? null : '2030-07-22T09:02:00.000Z',
      onlineExpiresAt: presenceStatus === 'offline' ? null : '2030-07-22T09:02:00.000Z',
      sharedGoalIds: [],
      sharedSessionIds: [],
      groupIds: [],
    });
    setStudyStore({
      friendConnections: [
        connectionFor(offlineUser),
        acceptedConnection,
        connectionFor(onlineUser),
      ],
      friendOverviews: [
        overviewFor(offlineUser, 'offline', '2026-07-20T08:00:00.000Z'),
        friendOverview,
        overviewFor(onlineUser, 'online', '2026-07-22T08:58:00.000Z'),
      ],
    });
    const rendered = await render(<FriendsScreen />);

    expect(rendered.getAllByTestId(/^friend-presence-/).map((row) => row.props.testID)).toEqual([
      `friend-presence-${friendUser.id}`,
      `friend-presence-${onlineUser.id}`,
      `friend-presence-${offlineUser.id}`,
    ]);
    expect(rendered.getByText('Lernt gerade')).toBeTruthy();
    expect(rendered.getByText('Online')).toBeTruthy();
    expect(rendered.getByText('Offline')).toBeTruthy();
    await rendered.unmount();
  });

  it('keeps a shared-goal invitation visible before progress is authorized', async () => {
    const invitation: StudyChallenge = {
      ...teamGoal,
      id: 'goal-invitation',
      creatorId: friendUser.id,
      title: 'Einladung zum Wochenziel',
      participants: [{ userId: currentUser.id, status: 'invited' }],
    };
    setStudyStore({
      data: { ...emptyData, challenges: [invitation] },
      friendConnections: [acceptedConnection],
      friendOverviews: [friendOverview],
      sharedGoalProgressById: {},
    });

    const rendered = await render(<FriendsScreen />);
    const card = rendered.getByTestId('shared-goal-summary-goal-invitation');
    expect(rendered.getByText('Einladung zum Wochenziel')).toBeTruthy();
    await fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)/(friends)/shared-goal/[goal-id]',
      params: { 'goal-id': 'goal-invitation' },
    });
    await rendered.unmount();
  });

  it('shows only the compact privacy-safe friend overview and common social content', async () => {
    mockLocalSearchParams = { 'user-id': friendUser.id };
    mockGetFriendOverview.mockResolvedValue(friendOverview);
    setStudyStore({
      data: { ...emptyData, challenges: [teamGoal] },
      friendConnections: [acceptedConnection],
      studyGroups: [studyGroup],
      sharedStudySessions: [sharedStudySession],
      sharedGoalProgressById: { [teamGoal.id]: teamProgress },
    });

    const rendered = await render(<FriendProfileScreen />);

    await waitFor(() => {
      expect(mockGetFriendOverview).toHaveBeenCalledWith(friendUser.id);
      expect(rendered.getByTestId(`friend-presence-${friendUser.id}`)).toBeTruthy();
      expect(rendered.getByText('Lernt gerade')).toBeTruthy();
      expect(rendered.getByText(/Zuletzt aktiv/)).toBeTruthy();
      expect(rendered.getByTestId(`shared-goal-summary-${teamGoal.id}`)).toBeTruthy();
      expect(rendered.getByTestId(`planned-session-${sharedStudySession.id}`)).toBeTruthy();
      expect(rendered.getByTestId(`study-group-${studyGroup.id}`)).toBeTruthy();
    });
    expect(containsImageUri(
      rendered.getByLabelText('Profilbild von Berta Beispiel'),
      friendUser.avatarUrl,
    )).toBe(true);
    expect(rendered.queryByText('3 Std. 5 Min.')).toBeNull();
    expect(rendered.queryByText('6 Tage')).toBeNull();

    for (const privateLabel of [
      /^Timer$/,
      /^Manuell$/,
      /^9 Sessions$/,
      /^Private Ziele$/,
      /^Privates Mathe-Abi-Ziel$/,
      /^Fach$/,
      /^Analysis$/,
      /^Notizen$/,
      /^Kapitel 4 Notizen$/,
    ]) {
      expect(rendered.queryByText(privateLabel)).toBeNull();
    }
    await rendered.unmount();
  });

  it('removes a loaded friend overview immediately when the friendship disappears', async () => {
    mockLocalSearchParams = { 'user-id': friendUser.id };
    mockGetFriendOverview.mockResolvedValue(friendOverview);
    setStudyStore({
      friendConnections: [acceptedConnection],
      friendOverviews: [friendOverview],
    });
    const rendered = await render(<FriendProfileScreen />);

    await waitFor(() => {
      expect(rendered.getByTestId(`friend-presence-${friendUser.id}`)).toBeTruthy();
    });

    setStudyStore({ friendConnections: [], friendOverviews: [] });
    await rendered.rerender(<FriendProfileScreen />);

    await waitFor(() => {
      expect(rendered.getByText('Profil nicht verfügbar')).toBeTruthy();
      expect(rendered.queryByTestId(`friend-presence-${friendUser.id}`)).toBeNull();
    });
    await rendered.unmount();
  });

  it.each([
    ['daily', 'Täglich', null],
    ['weekly', 'Wöchentlich', studyGroup.id],
  ] as const)(
    'creates a %s shared goal with explicit dates and optional group scope',
    async (cadence, cadenceLabel, groupId) => {
      const startsOn = '2030-01-10';
      const endsOn = '2030-02-10';
      mockLocalSearchParams = groupId ? { groupId } : {};
      mockCreateSharedGoal.mockResolvedValue(teamGoal);
      setStudyStore({
        data: emptyData,
        friendConnections: [acceptedConnection],
        studyGroups: groupId ? [studyGroup] : [],
      });
      const rendered = await render(<CreateSharedGoalScreen />);

      expect(rendered.getByLabelText('Rhythmus des gemeinsamen Lernziels')).toBeTruthy();
      expect(rendered.getByLabelText('Startdatum des gemeinsamen Lernziels')).toBeTruthy();
      expect(rendered.getByLabelText('Enddatum des gemeinsamen Lernziels')).toBeTruthy();

      await fireEvent.press(rendered.getByRole('tab', { name: cadenceLabel }));
      await fireEvent.changeText(
        rendered.getByLabelText('Titel des gemeinsamen Lernziels'),
        teamGoal.title,
      );
      await fireEvent.changeText(rendered.getByLabelText('Zielwert in Stunden'), '2');
      await fireEvent.changeText(
        rendered.getByLabelText('Startdatum des gemeinsamen Lernziels'),
        startsOn,
      );
      await fireEvent.changeText(
        rendered.getByLabelText('Enddatum des gemeinsamen Lernziels'),
        endsOn,
      );
      if (!groupId) {
        await fireEvent.press(rendered.getByRole('checkbox', { name: 'Berta Beispiel einladen' }));
      } else {
        await waitFor(() => {
          expect(rendered.getByRole('checkbox', { name: 'Berta Beispiel einladen' }).props.accessibilityState)
            .toEqual(expect.objectContaining({ checked: true }));
        });
      }
      await fireEvent.press(rendered.getByRole('button', { name: 'Ziel erstellen und einladen' }));

      await waitFor(() => expect(mockCreateSharedGoal).toHaveBeenCalledTimes(1));
      expect(mockCreateSharedGoal.mock.calls[0][0]).toEqual(expect.objectContaining({
        inviteeIds: [friendUser.id],
        goal: expect.objectContaining({
          cadence,
          groupId,
          period: 'custom',
          targetMinutes: 120,
          startsAt: new Date(`${startsOn}T00:00:00.000`).toISOString(),
          endsAt: new Date(`${endsOn}T23:59:59.999`).toISOString(),
        }),
      }));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(tabs)/(friends)/shared-goal/[goal-id]',
        params: { 'goal-id': teamGoal.id },
      });
      await rendered.unmount();
    },
  );

  it('creates a study group with selected accepted friends', async () => {
    mockCreateStudyGroup.mockResolvedValue(studyGroup);
    setStudyStore({ friendConnections: [acceptedConnection] });
    const rendered = await render(<CreateStudyGroupScreen />);

    await fireEvent.changeText(rendered.getByLabelText('Name der Lerngruppe'), studyGroup.name);
    await fireEvent.press(
      rendered.getByRole('checkbox', { name: 'Berta Beispiel in die Gruppe einladen' }),
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Gruppe erstellen und einladen' }));

    await waitFor(() => expect(mockCreateStudyGroup).toHaveBeenCalledTimes(1));
    expect(mockCreateStudyGroup.mock.calls[0][0]).toEqual(expect.objectContaining({
      memberIds: [friendUser.id],
      group: expect.objectContaining({
        name: studyGroup.name,
        imageUrl: null,
      }),
    }));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/(friends)/group/[group-id]',
      params: { 'group-id': studyGroup.id },
    });
    await rendered.unmount();
  });

  it('loads a study-group invitation and unlocks group actions after acceptance', async () => {
    const invitedGroup: StudyGroup = {
      ...studyGroup,
      creatorId: friendUser.id,
      members: [
        { userId: friendUser.id, user: friendUser, role: 'owner', status: 'accepted' },
        { userId: currentUser.id, user: currentUser, role: 'member', status: 'invited' },
      ],
    };
    const acceptedGroup: StudyGroup = {
      ...invitedGroup,
      members: invitedGroup.members.map((member) => member.userId === currentUser.id
        ? { ...member, status: 'accepted' as const }
        : member),
    };
    mockLocalSearchParams = { 'group-id': studyGroup.id };
    mockGetStudyGroupDetails.mockResolvedValue(invitedGroup);
    mockRespondStudyGroupInvitation.mockResolvedValue(acceptedGroup);
    setStudyStore({ studyGroups: [invitedGroup] });

    const rendered = await render(<StudyGroupDetailsScreen />);

    await waitFor(() => {
      expect(mockGetStudyGroupDetails).toHaveBeenCalledWith(studyGroup.id);
      expect(rendered.getByText('Einladung zur Lerngruppe')).toBeTruthy();
    });
    await fireEvent.press(rendered.getByRole('button', { name: 'Einladung annehmen' }));

    await waitFor(() => {
      expect(mockRespondStudyGroupInvitation).toHaveBeenCalledWith(studyGroup.id, true);
      expect(rendered.getByRole('button', { name: 'Gemeinsames Ziel' })).toBeTruthy();
      expect(rendered.getByRole('button', { name: 'Session planen' })).toBeTruthy();
    });
    await rendered.unmount();
  });

  it('plans a group study session with members, date, time, and duration', async () => {
    mockLocalSearchParams = { groupId: studyGroup.id };
    mockCreateSharedStudySession.mockResolvedValue(sharedStudySession);
    setStudyStore({
      studyGroups: [studyGroup],
      friendConnections: [acceptedConnection],
    });
    const rendered = await render(<CreateSharedStudySessionScreen />);

    await waitFor(() => {
      expect(rendered.getByDisplayValue(`${studyGroup.name}: Lernsession`)).toBeTruthy();
      expect(rendered.getByRole('checkbox', { name: 'Berta Beispiel zur Session einladen' }).props.accessibilityState)
        .toEqual(expect.objectContaining({ checked: true }));
    });
    await fireEvent.press(rendered.getByRole('tab', { name: 'Planen' }));
    await fireEvent.changeText(
      rendered.getByLabelText('Datum der gemeinsamen Lern-Session'),
      '2030-03-10',
    );
    await fireEvent.changeText(
      rendered.getByLabelText('Uhrzeit der gemeinsamen Lern-Session'),
      '16:30',
    );
    await fireEvent.press(rendered.getByRole('radio', { name: '60 Minuten' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Session planen und einladen' }));

    await waitFor(() => expect(mockCreateSharedStudySession).toHaveBeenCalledTimes(1));
    expect(mockCreateSharedStudySession.mock.calls[0][0]).toEqual(expect.objectContaining({
      inviteeIds: [friendUser.id],
      session: expect.objectContaining({
        title: `${studyGroup.name}: Lernsession`,
        groupId: studyGroup.id,
        startsAt: new Date('2030-03-10T16:30:00').toISOString(),
        plannedDurationMinutes: 60,
        startNow: false,
      }),
    }));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/(friends)/shared-session/[session-id]',
      params: { 'session-id': sharedStudySession.id },
    });
    await rendered.unmount();
  });

  it('starts a shared session with multiple selected friends', async () => {
    const carla: StudyUser = {
      id: 'account-carla-session',
      username: 'carla_session',
      displayName: 'Carla Beispiel',
    };
    const carlaConnection: FriendshipConnection = {
      id: 'friendship-alice-carla',
      requesterId: currentUser.id,
      addresseeId: carla.id,
      status: 'accepted',
      direction: 'outgoing',
      otherUser: carla,
      createdAt: '2026-07-01T08:00:00.000Z',
      respondedAt: '2026-07-01T09:00:00.000Z',
    };
    mockCreateSharedStudySession.mockResolvedValue(sharedStudySession);
    setStudyStore({ friendConnections: [acceptedConnection, carlaConnection] });
    const rendered = await render(<CreateSharedStudySessionScreen />);

    await fireEvent.press(
      rendered.getByRole('checkbox', { name: 'Berta Beispiel zur Session einladen' }),
    );
    await fireEvent.press(
      rendered.getByRole('checkbox', { name: 'Carla Beispiel zur Session einladen' }),
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Session starten und einladen' }));

    await waitFor(() => expect(mockCreateSharedStudySession).toHaveBeenCalledTimes(1));
    expect(mockCreateSharedStudySession.mock.calls[0][0]).toEqual(expect.objectContaining({
      inviteeIds: [friendUser.id, carla.id],
      session: expect.objectContaining({ startNow: true }),
    }));
    await rendered.unmount();
  });

  it('loads a shared-session invitation and exposes private-timer entry after joining', async () => {
    const invitedSession: SharedStudySession = {
      ...sharedStudySession,
      creatorId: friendUser.id,
      participants: [
        { userId: friendUser.id, user: friendUser, status: 'joined', elapsedMinutes: 30 },
        { userId: currentUser.id, user: currentUser, status: 'invited', elapsedMinutes: 0 },
      ],
    };
    const joinedSession: SharedStudySession = {
      ...invitedSession,
      participants: invitedSession.participants.map((participant) => participant.userId === currentUser.id
        ? { ...participant, status: 'joined' as const }
        : participant),
    };
    mockLocalSearchParams = { 'session-id': sharedStudySession.id };
    mockGetSharedStudySessionDetails.mockResolvedValue(invitedSession);
    mockRespondSharedStudySessionInvitation.mockResolvedValue(joinedSession);
    setStudyStore({ sharedStudySessions: [invitedSession] });

    const rendered = await render(<SharedStudySessionDetailsScreen />);

    await waitFor(() => {
      expect(mockGetSharedStudySessionDetails).toHaveBeenCalledWith(sharedStudySession.id);
      expect(rendered.getByText('Einladung zur Lern-Session')).toBeTruthy();
      expect(rendered.getByText('50 %')).toBeTruthy();
      expect(rendered.queryByText('25 %')).toBeNull();
    });
    await fireEvent.press(rendered.getByRole('button', { name: 'Teilnehmen' }));

    await waitFor(() => {
      expect(mockRespondSharedStudySessionInvitation)
        .toHaveBeenCalledWith(sharedStudySession.id, true);
      expect(rendered.getByText('Dein Lernstatus')).toBeTruthy();
      expect(rendered.getByRole('button', { name: 'Lernen starten' })).toBeTruthy();
    });
    await rendered.unmount();
  });

  it('removes stale shared-session details when realtime access disappears', async () => {
    mockLocalSearchParams = { 'session-id': sharedStudySession.id };
    mockGetSharedStudySessionDetails.mockResolvedValue(sharedStudySession);
    setStudyStore({ sharedStudySessions: [sharedStudySession] });
    const rendered = await render(<SharedStudySessionDetailsScreen />);

    await waitFor(() => {
      expect(rendered.getByText(sharedStudySession.title)).toBeTruthy();
    });

    setStudyStore({ sharedStudySessions: [] });
    await rendered.rerender(<SharedStudySessionDetailsScreen />);

    await waitFor(() => {
      expect(rendered.getByText('Session nicht verfügbar')).toBeTruthy();
      expect(rendered.queryByText(sharedStudySession.title)).toBeNull();
    });
    await rendered.unmount();
  });

  it('continues an active server duration from calculatedAt without double counting activeSince', () => {
    const participant = {
      userId: currentUser.id,
      user: currentUser,
      status: 'active' as const,
      elapsedMinutes: 10,
      activeSince: '2026-07-22T09:50:00.000Z',
    };

    expect(participantElapsedMinutes(
      participant,
      '2026-07-22T09:59:00.000Z',
      Date.parse('2026-07-22T10:00:00.000Z'),
    )).toBe(11);
  });

  it('prefers a newer participant projection even when the session row was not updated', () => {
    const loadedSession: SharedStudySession = {
      ...sharedStudySession,
      participants: sharedStudySession.participants.map((participant) => ({ ...participant })),
      calculatedAt: '2026-07-22T09:59:00.000Z',
    };
    const realtimeSession: SharedStudySession = {
      ...loadedSession,
      participants: loadedSession.participants.map((participant) =>
        participant.userId === friendUser.id
          ? { ...participant, status: 'joined' as const, elapsedMinutes: 12 }
          : participant),
      calculatedAt: '2026-07-22T10:00:00.000Z',
    };

    expect(selectLatestSharedStudySession(loadedSession, realtimeSession)).toBe(realtimeSession);
  });

  it('ignores a detail request that finishes after a participant mutation', async () => {
    mockLocalSearchParams = { 'session-id': sharedStudySession.id };
    const releaseOlderLoads: ((session: SharedStudySession) => void)[] = [];
    mockGetSharedStudySessionDetails.mockImplementation(() => new Promise((resolve) => {
      releaseOlderLoads.push(resolve);
    }));
    const activeSession: SharedStudySession = {
      ...sharedStudySession,
      status: 'active',
      participants: sharedStudySession.participants.map((participant) => (
        participant.userId === currentUser.id
          ? { ...participant, status: 'active' as const, activeSince: '2026-07-22T10:00:00.000Z' }
          : participant
      )),
      calculatedAt: '2026-07-22T10:00:00.000Z',
      receivedAt: '2026-07-22T10:00:00.000Z',
    };
    const pausedSession: SharedStudySession = {
      ...activeSession,
      participants: activeSession.participants.map((participant) => (
        participant.userId === currentUser.id
          ? { ...participant, status: 'paused' as const, activeSince: undefined }
          : participant
      )),
      calculatedAt: '2026-07-22T10:01:00.000Z',
      receivedAt: '2026-07-22T10:01:00.000Z',
    };
    mockUpdateSharedStudySessionParticipant.mockResolvedValueOnce(pausedSession);
    setStudyStore({ sharedStudySessions: [activeSession] });
    const rendered = await render(<SharedStudySessionDetailsScreen />);
    await waitFor(() => expect(releaseOlderLoads.length).toBeGreaterThan(0));

    await fireEvent.press(rendered.getByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(rendered.getByRole('button', { name: 'Fortsetzen' })).toBeTruthy();
    });

    await act(async () => {
      releaseOlderLoads.forEach((release) => release(sharedStudySession));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(rendered.getByRole('button', { name: 'Fortsetzen' })).toBeTruthy();
      expect(rendered.queryByRole('button', { name: 'Lernen starten' })).toBeNull();
    });
    await rendered.unmount();
  });

  it('uses participant avatars from shared-goal details before progress is available', async () => {
    const invitedGoal: StudyChallenge = {
      ...teamGoal,
      participants: [
        { userId: currentUser.id, user: currentUser, status: 'invited' },
        { userId: friendUser.id, user: friendUser, status: 'accepted' },
      ],
    };
    mockLocalSearchParams = { 'goal-id': invitedGoal.id };
    mockGetSharedGoalDetails.mockResolvedValue(invitedGoal);
    setStudyStore({ data: { ...emptyData, challenges: [] }, friendConnections: [] });

    const rendered = await render(<SharedGoalDetailsScreen />);

    await waitFor(() => {
      expect(rendered.getByLabelText(/Berta Beispiel, Nimmt teil, Beitrag/)).toBeTruthy();
    });
    expect(containsImageUri(
      rendered.getByLabelText('Profil von Berta Beispiel öffnen'),
      friendUser.avatarUrl,
    )).toBe(true);
    expect(mockGetSharedGoalProgress).not.toHaveBeenCalled();
    await rendered.unmount();
  });

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
    expect(containsImageUri(
      rendered.getByLabelText('Profil von Berta Beispiel öffnen'),
      friendUser.avatarUrl,
    )).toBe(true);

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
