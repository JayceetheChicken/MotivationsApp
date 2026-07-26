import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type {
  SharedStudySessionParticipantAction,
  StudyRepository,
} from '@/data/repositories/study-repository';
import { StudyRepositoryError } from '@/data/repositories/repository-error';
import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import { StudyStoreProvider, useStudyStore } from '@/state/study-store';
import type {
  AccountStudyUser,
  FriendOverview,
  SharedGoalProgress,
  SharedStudySession,
  StudyChallenge,
  StudyGroup,
  StudySharingPreferences,
} from '@/types/study';

const now = '2026-07-22T10:00:00.000Z';
const ACTION_OUTBOX_KEY = 'lernzeit.shared-session-actions.v1.account-id';
const OTHER_ACCOUNT_ACTION_OUTBOX_KEY = 'lernzeit.shared-session-actions.v1.other-account';
const account: AccountStudyUser = {
  id: 'account-id',
  username: 'lea',
  displayName: 'Lea',
  timeZone: 'Europe/Berlin',
  usernameNeedsReview: false,
  revision: 1,
};
const sharing: StudySharingPreferences = {
  shareTimerStats: false,
  shareManualStats: false,
  shareGoalProgress: false,
  shareStreak: false,
  revision: 1,
  updatedAt: now,
};
const friendOverview: FriendOverview = {
  friend: { id: 'friend-id', username: 'mia', displayName: 'Mia' },
  learningStatus: 'learning_now',
  activeSince: now,
  lastStudyAt: now,
  weekMinutes: 120,
  streakDays: 3,
  sharedGoalIds: ['goal-id'],
  sharedSessionIds: ['shared-session-id'],
  groupIds: ['group-id'],
};
const group: StudyGroup = {
  id: 'group-id',
  creatorId: 'account-id',
  name: 'Prüfungsteam',
  icon: 'people',
  members: [{ userId: 'account-id', user: account, role: 'owner', status: 'accepted' }],
  sharedGoalIds: ['goal-id'],
  sharedSessionIds: ['shared-session-id'],
  createdAt: now,
  updatedAt: now,
};
const sharedSession: SharedStudySession = {
  id: 'shared-session-id',
  creatorId: 'account-id',
  groupId: 'group-id',
  title: 'Mathe-Fokus',
  startsAt: now,
  plannedDurationMinutes: 45,
  status: 'active',
  startedAt: now,
  endedAt: null,
  participants: [{
    userId: 'account-id', user: account, status: 'active', elapsedMinutes: 0, activeSince: now,
  }],
  createdAt: now,
  updatedAt: now,
};
const progress: SharedGoalProgress = {
  goalId: 'goal-id',
  goalType: 'duration',
  mode: 'per_participant',
  sourcePolicy: 'all',
  startsAt: now,
  endsAt: '2026-07-29T10:00:00.000Z',
  revision: 1,
  participants: [],
  team: null,
  overall: {
    contribution: 0, target: 60, progressPercent: 0, remaining: 60, achieved: false, exceededBy: 0,
  },
  calculatedAt: now,
};
const challenge: StudyChallenge = {
  id: 'goal-id',
  creatorId: 'account-id',
  title: 'Teamziel',
  description: '',
  cadence: 'weekly',
  groupId: null,
  target: { type: 'duration', mode: 'per_participant', targetMinutes: 60 },
  sourcePolicy: 'all',
  startsAt: now,
  endsAt: '2026-07-29T10:00:00.000Z',
  status: 'active',
  participants: [{ userId: 'account-id', user: account, status: 'invited' }],
};
const accountSnapshot: StudyStateSnapshot = {
  privacy: {
    friendComparisonsEnabled: false,
    shareAutomaticMinutes: false,
    shareManualMinutes: false,
    shareGoalProgress: false,
    shareStreak: false,
  },
  data: {
    currentUser: account,
    subjects: [],
    sessions: [],
    grades: [],
    goals: [],
    friends: [],
    challenges: [challenge],
    activeTimer: null,
  },
};

const mockUpdateParticipant = jest.fn<
  Promise<SharedStudySession | null>,
  [string, SharedStudySessionParticipantAction]
>();
const mockUpdatePresence = jest.fn<Promise<void>, [string, string | null]>();
const mockGetSharedStudySessionDetails = jest.fn<
  Promise<SharedStudySession>,
  [string]
>();
const mockRespondSharedGoalInvitation = jest.fn<
  Promise<StudyChallenge | null>,
  [string, boolean]
>();
const mockRespondStudyGroupInvitation = jest.fn<
  Promise<StudyGroup | null>,
  [string, boolean]
>();
const mockRespondSharedStudySessionInvitation = jest.fn<
  Promise<SharedStudySession | null>,
  [string, boolean]
>();
const mockWithdrawFromSharedGoal = jest.fn<Promise<void>, [string]>();
const mockLoadSnapshot = jest.fn<Promise<StudyStateSnapshot | null>, []>();
const mockRepository = {
  mode: 'supabase',
  accountId: 'account-id',
  social: {
    getMyProfile: jest.fn(async () => account),
    getSharingPreferences: jest.fn(async () => sharing),
    listFriendConnections: jest.fn(async () => []),
    listFriendOverviews: jest.fn(async () => [friendOverview]),
    listSharedGoalProgress: jest.fn(async () => [progress]),
    listStudyGroups: jest.fn(async () => [group]),
    listSharedStudySessions: jest.fn(async () => [sharedSession]),
    getSharedStudySessionDetails: (sessionId: string) => (
      mockGetSharedStudySessionDetails(sessionId)
    ),
    respondSharedGoalInvitation: (goalId: string, accept: boolean) => (
      mockRespondSharedGoalInvitation(goalId, accept)
    ),
    respondStudyGroupInvitation: (groupId: string, accept: boolean) => (
      mockRespondStudyGroupInvitation(groupId, accept)
    ),
    respondSharedStudySessionInvitation: (sessionId: string, accept: boolean) => (
      mockRespondSharedStudySessionInvitation(sessionId, accept)
    ),
    withdrawFromSharedGoal: (goalId: string) => mockWithdrawFromSharedGoal(goalId),
    updateSharedStudySessionParticipant: (
      sessionId: string,
      action: SharedStudySessionParticipantAction,
    ) => mockUpdateParticipant(sessionId, action),
    updateLearningPresence: (state: string, activeSince: string | null) => (
      mockUpdatePresence(state, activeSince)
    ),
  },
  imports: {},
  loadSnapshot: () => mockLoadSnapshot(),
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
    phase: 'idle', pendingMutationCount: 0, lastSyncedAt: null, lastError: null,
  })),
  subscribeSyncStatus: jest.fn(() => () => undefined),
  subscribeSharedGoalProgress: jest.fn(),
  dispose: jest.fn(async () => undefined),
} as unknown as StudyRepository;

jest.mock('@/auth/supabase', () => ({ supabase: {} }));
jest.mock('@/data/repositories/supabase-study-repository', () => ({
  createSupabaseStudyRepository: () => mockRepository,
}));
let mockOnline = true;
jest.mock('@/hooks/use-network-status', () => ({ useNetworkStatus: () => mockOnline }));
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

function wrapper({ children }: PropsWithChildren) {
  return (
    <StudyStoreProvider accountUserId="account-id" storageScope="social-store-test">
      {children}
    </StudyStoreProvider>
  );
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
  mockOnline = true;
  mockUpdateParticipant.mockResolvedValue(sharedSession);
  mockUpdatePresence.mockResolvedValue(undefined);
  mockGetSharedStudySessionDetails.mockResolvedValue(sharedSession);
  mockRespondSharedGoalInvitation.mockResolvedValue(null);
  mockRespondStudyGroupInvitation.mockResolvedValue(null);
  mockRespondSharedStudySessionInvitation.mockResolvedValue(null);
  mockWithdrawFromSharedGoal.mockResolvedValue(undefined);
  mockLoadSnapshot.mockResolvedValue(null);
});

describe('StudyStoreProvider social learning infrastructure', () => {
  it('loads all volatile social projections in one refresh', async () => {
    const { result } = await renderHook(() => useStudyStore(), { wrapper });

    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
      expect(result.current.friendOverviews).toEqual([friendOverview]);
      expect(result.current.studyGroups).toEqual([group]);
      expect(result.current.sharedStudySessions).toEqual([sharedSession]);
      expect(result.current.sharedGoalProgressById).toEqual({ 'goal-id': progress });
    });
  });

  it('serializes timer participant actions and publishes privacy-safe presence', async () => {
    let releaseStart!: (value: SharedStudySession | null) => void;
    mockUpdateParticipant.mockImplementation((_sessionId, action) => {
      if (action !== 'start') return Promise.resolve(sharedSession);
      return new Promise((resolve) => {
        releaseStart = resolve;
      });
    });
    const { result } = await renderHook(() => useStudyStore(), { wrapper });
    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
      expect(result.current.sharedStudySessions).toEqual([sharedSession]);
    });

    let subjectId = '';
    await act(() => {
      subjectId = result.current.addSubject('Mathematik').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));

    await act(() => {
      result.current.startTimer({ subjectId, sharedSessionId: 'shared-session-id' });
    });
    await waitFor(() => {
      expect(result.current.data.activeTimer?.status).toBe('running');
      expect(mockUpdateParticipant).toHaveBeenCalledWith('shared-session-id', 'start');
      expect(mockUpdatePresence).toHaveBeenCalledWith(
        'learning',
        result.current.data.activeTimer?.startedAt ?? null,
      );
    });

    await act(() => {
      result.current.pauseTimer();
    });
    await waitFor(() => expect(result.current.data.activeTimer?.status).toBe('paused'));
    expect(mockUpdateParticipant).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseStart(sharedSession);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockUpdateParticipant.mock.calls.map(([, action]) => action)).toEqual(['start', 'pause']);
      expect(mockUpdatePresence).toHaveBeenCalledWith(
        'paused',
        result.current.data.activeTimer?.startedAt ?? null,
      );
    });
  });

  it('persists privacy-minimal timer actions offline and drains them in order on reconnect', async () => {
    mockOnline = false;
    storedValues.set(OTHER_ACCOUNT_ACTION_OUTBOX_KEY, JSON.stringify([
      { sessionId: 'other-session', action: 'finish' },
    ]));
    const hook = await renderHook(() => useStudyStore(), { wrapper });
    const { result } = hook;
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let subjectId = '';
    await act(() => {
      subjectId = result.current.addSubject('Mathematik').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));
    await act(() => {
      result.current.startTimer({ subjectId, sharedSessionId: 'shared-session-id' });
    });
    await waitFor(() => expect(result.current.data.activeTimer?.status).toBe('running'));
    await act(() => {
      result.current.pauseTimer();
    });
    await waitFor(() => expect(result.current.data.activeTimer?.status).toBe('paused'));
    await act(() => {
      result.current.resumeTimer();
    });
    await waitFor(() => expect(result.current.data.activeTimer?.status).toBe('running'));
    await act(() => {
      result.current.finishTimer({ allowShortSession: true });
    });
    await waitFor(() => expect(result.current.data.activeTimer).toBeNull());

    expect(mockUpdateParticipant).not.toHaveBeenCalled();
    const persisted = JSON.parse(storedValues.get(ACTION_OUTBOX_KEY) ?? '[]') as unknown[];
    expect(persisted).toEqual([
      { sessionId: 'shared-session-id', action: 'start' },
      { sessionId: 'shared-session-id', action: 'pause' },
      { sessionId: 'shared-session-id', action: 'resume' },
      { sessionId: 'shared-session-id', action: 'finish' },
    ]);
    expect(persisted.every((entry) => (
      typeof entry === 'object'
      && entry !== null
      && Object.keys(entry).sort().join(',') === 'action,sessionId'
    ))).toBe(true);

    mockOnline = true;
    await hook.rerender(undefined);
    await waitFor(() => {
      expect(mockUpdateParticipant.mock.calls.map(([, action]) => action)).toEqual([
        'start', 'pause', 'resume', 'finish',
      ]);
      expect(storedValues.has(ACTION_OUTBOX_KEY)).toBe(false);
      expect(mockGetSharedStudySessionDetails).toHaveBeenCalledWith('shared-session-id');
    });
    expect(storedValues.get(OTHER_ACCOUNT_ACTION_OUTBOX_KEY)).toBe(
      JSON.stringify([{ sessionId: 'other-session', action: 'finish' }]),
    );
  });

  it('compacts duplicate persisted actions and retries them on the next hydration', async () => {
    storedValues.set(ACTION_OUTBOX_KEY, JSON.stringify([
      { sessionId: 'shared-session-id', action: 'start' },
      { sessionId: 'shared-session-id', action: 'start' },
      { sessionId: 'shared-session-id', action: 'pause' },
      { sessionId: 'shared-session-id', action: 'pause' },
      { sessionId: 'shared-session-id', action: 'resume' },
      { sessionId: 'shared-session-id', action: 'finish' },
      { sessionId: 'shared-session-id', action: 'resume' },
      { sessionId: '', action: 'finish', privateNote: 'must be discarded' },
    ]));
    mockUpdateParticipant.mockRejectedValueOnce(
      new StudyRepositoryError('network_error', 'temporarily offline'),
    );

    const first = await renderHook(() => useStudyStore(), { wrapper });
    await waitFor(() => expect(mockUpdateParticipant).toHaveBeenCalledTimes(1));
    expect(JSON.parse(storedValues.get(ACTION_OUTBOX_KEY) ?? '[]')).toEqual([
      { sessionId: 'shared-session-id', action: 'start' },
      { sessionId: 'shared-session-id', action: 'pause' },
      { sessionId: 'shared-session-id', action: 'resume' },
      { sessionId: 'shared-session-id', action: 'finish' },
    ]);
    await first.unmount();

    mockUpdateParticipant.mockClear();
    const second = await renderHook(() => useStudyStore(), { wrapper });
    await waitFor(() => {
      expect(mockUpdateParticipant.mock.calls.map(([, action]) => action)).toEqual([
        'start', 'pause', 'resume', 'finish',
      ]);
      expect(storedValues.has(ACTION_OUTBOX_KEY)).toBe(false);
    });
    await second.unmount();
  });

  it.each([
    ['declines', async (store: ReturnType<typeof useStudyStore>) => {
      await store.respondSharedGoalInvitation('goal-id', false);
    }],
    ['withdraws from', async (store: ReturnType<typeof useStudyStore>) => {
      await store.withdrawFromSharedGoal('goal-id');
    }],
  ])('removes stale challenge progress when the user %s a goal', async (_label, mutate) => {
    mockLoadSnapshot.mockResolvedValueOnce(accountSnapshot);
    const { result } = await renderHook(() => useStudyStore(), { wrapper });
    await waitFor(() => {
      expect(result.current.data.challenges).toEqual([challenge]);
      expect(result.current.sharedGoalProgressById).toEqual({ 'goal-id': progress });
    });

    await act(async () => {
      await mutate(result.current);
    });

    expect(result.current.data.challenges).toEqual([]);
    expect(result.current.sharedGoalProgressById).toEqual({});
  });

  it('propagates lifecycle RPC failures instead of treating them as tombstones', async () => {
    const { result } = await renderHook(() => useStudyStore(), { wrapper });
    await waitFor(() => expect(result.current.studyGroups).toEqual([group]));

    const cases: readonly [
      string,
      jest.Mock,
      () => Promise<unknown>,
    ][] = [
      [
        'goal response failed',
        mockRespondSharedGoalInvitation,
        () => result.current.respondSharedGoalInvitation('goal-id', false),
      ],
      [
        'group response failed',
        mockRespondStudyGroupInvitation,
        () => result.current.respondStudyGroupInvitation('group-id', false),
      ],
      [
        'session response failed',
        mockRespondSharedStudySessionInvitation,
        () => result.current.respondSharedStudySessionInvitation('shared-session-id', false),
      ],
      [
        'participant update failed',
        mockUpdateParticipant,
        () => result.current.updateSharedStudySessionParticipant('shared-session-id', 'leave'),
      ],
    ];

    for (const [message, mock, respond] of cases) {
      mock.mockRejectedValueOnce(new Error(message));
      let rejection: unknown;
      await act(async () => {
        try {
          await respond();
        } catch (error) {
          rejection = error;
        }
      });
      expect(rejection).toEqual(expect.objectContaining({ message }));
      expect(result.current.socialError).toBe(message);
    }
  });
});
