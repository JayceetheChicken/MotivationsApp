import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createInitialData } from '@/data/initial-data';
import { evaluateGoal, getGoalTitle } from '@/lib/goals';
import {
  StudyStoreProvider,
  defaultPrivacy,
  migratePersistedStudyState,
  useStudyStore,
} from '@/state/study-store';

jest.mock('@/lib/local-storage', () => ({}));

const STORAGE_KEY = 'lernzeit.study-state.v2.local';
const storedValues = new Map<string, string>();

const storageMock = {
  getItem: jest.fn((key: string) => storedValues.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => {
    storedValues.set(key, value);
  }),
  removeItem: jest.fn((key: string) => {
    storedValues.delete(key);
  }),
  clear: jest.fn(() => storedValues.clear()),
  key: jest.fn((index: number) => [...storedValues.keys()][index] ?? null),
  get length() {
    return storedValues.size;
  },
} satisfies Storage;

function wrapper({ children }: PropsWithChildren) {
  return <StudyStoreProvider>{children}</StudyStoreProvider>;
}

async function renderHydratedStore() {
  const hook = await renderHook(() => useStudyStore(), { wrapper });
  await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
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
});

describe('StudyStoreProvider goal lifecycle', () => {
  it('creates an untitled goal, pauses, resumes, archives and deletes it', async () => {
    const { result } = await renderHydratedStore();
    let goalId = '';
    let subjectId = '';

    await act(() => {
      subjectId = result.current.addSubject('Allgemein').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));

    await act(() => {
      const goal = result.current.createGoal({
        title: '   ',
        type: 'duration',
        target: 120,
        subjectId,
        period: 'week',
        sourcePolicy: 'all',
      });
      goalId = goal.id;
      expect(goal.title).toBeUndefined();
      expect(getGoalTitle(goal)).toBe('120 Minuten pro Woche');
    });

    await waitFor(() => {
      expect(result.current.data.goals).toHaveLength(1);
      expect(result.current.data.goals[0]).toMatchObject({
        id: goalId,
        status: 'active',
        type: 'duration',
        targetMinutes: 120,
      });
      expect(result.current.data.goals[0].startsAt).toBeTruthy();
    });

    await act(() => {
      expect(result.current.pauseGoal(goalId)?.status).toBe('paused');
    });
    await waitFor(() => {
      expect(result.current.data.goals[0].status).toBe('paused');
      expect(result.current.data.goals[0].pausedAt).toBeTruthy();
    });

    await act(() => {
      expect(result.current.resumeGoal(goalId)?.status).toBe('active');
    });
    await waitFor(() => {
      expect(result.current.data.goals[0].status).toBe('active');
      expect(result.current.data.goals[0].pausedAt).toBeUndefined();
    });

    await act(() => {
      expect(result.current.archiveGoal(goalId)?.status).toBe('archived');
    });
    await waitFor(() => {
      expect(result.current.data.goals[0].status).toBe('archived');
      expect(result.current.data.goals[0].archivedAt).toBeTruthy();
    });

    await act(() => result.current.deleteGoal(goalId));
    await waitFor(() => expect(result.current.data.goals).toEqual([]));

    expect(storageMock.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.any(String),
    );
  });

  it('persists explicit custom goal boundaries and can clear the end date', async () => {
    const { result } = await renderHydratedStore();
    let goalId = '';
    let startsAt = '';
    let endsAt = '';
    let subjectId = '';

    await act(() => {
      subjectId = result.current.addSubject('Prüfung').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));

    await act(() => {
      const goal = result.current.createGoal({
        title: 'Prüfungsvorbereitung',
        type: 'duration',
        target: 300,
        subjectId,
        sourcePolicy: 'all',
        period: 'custom',
        startsAt: '2026-07-01',
        endsAt: '2026-07-31',
      });
      goalId = goal.id;
      startsAt = goal.startsAt ?? '';
      endsAt = goal.endsAt ?? '';
    });

    expect(Number.isFinite(new Date(startsAt).getTime())).toBe(true);
    expect(Number.isFinite(new Date(endsAt).getTime())).toBe(true);
    expect(new Date(endsAt).getTime()).toBeGreaterThan(new Date(startsAt).getTime());
    await waitFor(() => {
      expect(result.current.data.goals[0]).toMatchObject({
        id: goalId,
        period: 'custom',
        startsAt,
        endsAt,
      });
    });

    await act(() => {
      expect(result.current.updateGoal(goalId, { period: 'day', endsAt: null }))
        .toMatchObject({ period: 'day', endsAt: undefined });
    });
    await waitFor(() => {
      expect(result.current.data.goals[0].period).toBe('day');
      expect(result.current.data.goals[0].endsAt).toBeUndefined();
    });
  });

  it('keeps completed sessions after their goal is deleted', async () => {
    const { result } = await renderHydratedStore();

    let subjectId = '';
    await act(() => {
      subjectId = result.current.addSubject('Deutsch').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));

    let goalId = '';
    await act(() => {
      goalId = result.current.createGoal({
        title: 'Deutsch-Abitur',
        type: 'duration',
        target: 120,
        subjectId,
        sourcePolicy: 'all',
      }).id;
    });
    await waitFor(() => expect(result.current.data.goals).toHaveLength(1));

    await act(() => {
      expect(result.current.addManualEntry({
        goalId,
        durationMinutes: 30,
        studiedOn: '2026-07-10',
      })).toMatchObject({ goalId, subjectId });
    });
    await waitFor(() => expect(result.current.data.sessions).toHaveLength(1));

    await act(() => result.current.deleteGoal(goalId));
    await waitFor(() => expect(result.current.data.goals).toEqual([]));
    expect(result.current.data.sessions).toHaveLength(1);
    expect(result.current.data.sessions[0]).toMatchObject({
      goalId,
      subjectId,
      goalTitleSnapshot: 'Deutsch-Abitur',
      subjectNameSnapshot: 'Deutsch',
    });
  });

  it('stores a goal-bound timer and rejects an inconsistent subject', async () => {
    const { result } = await renderHydratedStore();

    let germanId = '';
    let mathId = '';
    await act(() => {
      germanId = result.current.addSubject('Deutsch').id;
      mathId = result.current.addSubject('Mathematik').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(2));

    let goalId = '';
    await act(() => {
      goalId = result.current.createGoal({
        title: 'Deutsch-Abitur',
        type: 'duration',
        target: 300,
        subjectId: germanId,
        sourcePolicy: 'all',
      }).id;
    });
    await waitFor(() => expect(result.current.data.goals).toHaveLength(1));

    await act(() => {
      expect(result.current.startTimer({ goalId, subjectId: mathId })).toBeNull();
    });
    expect(result.current.data.activeTimer).toBeNull();

    await act(() => {
      expect(result.current.startTimer({
        goalId,
        plannedDurationMinutes: 45,
        note: '  Gedichtanalyse  ',
      })).toMatchObject({
        goalId,
        subjectId: germanId,
        goalTitleSnapshot: 'Deutsch-Abitur',
        subjectNameSnapshot: 'Deutsch',
        plannedDurationMinutes: 45,
        note: 'Gedichtanalyse',
      });
    });
    await waitFor(() => expect(result.current.data.activeTimer).not.toBeNull());

    await act(() => {
      expect(result.current.finishTimer({ allowShortSession: true })).toMatchObject({
        goalId,
        subjectId: germanId,
        status: 'completed',
      });
    });
    await waitFor(() => {
      expect(result.current.data.activeTimer).toBeNull();
      expect(result.current.data.sessions).toHaveLength(1);
    });

    await act(() => {
      expect(result.current.finishTimer({ allowShortSession: true })).toBeNull();
    });
    expect(result.current.data.sessions).toHaveLength(1);
  });

  it('supports manual sessions with and without a goal without mixing subjects', async () => {
    const { result } = await renderHydratedStore();

    let germanId = '';
    let mathId = '';
    await act(() => {
      germanId = result.current.addSubject('Deutsch').id;
      mathId = result.current.addSubject('Mathematik').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(2));

    let goalId = '';
    await act(() => {
      goalId = result.current.createGoal({
        title: 'Deutsch-Referat',
        type: 'duration',
        target: 90,
        subjectId: germanId,
        sourcePolicy: 'all',
      }).id;
    });
    await waitFor(() => expect(result.current.data.goals).toHaveLength(1));

    await act(() => {
      expect(result.current.addManualEntry({
        goalId,
        subjectId: mathId,
        durationMinutes: 20,
        studiedOn: '2026-07-10',
      })).toBeNull();
    });
    expect(result.current.data.sessions).toEqual([]);

    await act(() => {
      expect(result.current.addManualEntry({
        goalId,
        durationMinutes: 30,
        studiedOn: '2026-07-10',
      })).toMatchObject({ goalId, subjectId: germanId, source: 'manual' });
    });
    await waitFor(() => expect(result.current.data.sessions).toHaveLength(1));

    await act(() => {
      expect(result.current.addManualEntry({
        subjectId: mathId,
        durationMinutes: 25,
        studiedOn: '2026-07-11',
      })).toMatchObject({ goalId: null, subjectId: mathId, source: 'manual' });
    });
    await waitFor(() => expect(result.current.data.sessions).toHaveLength(2));
    expect(result.current.data.sessions.map((session) => session.goalId)).toEqual([
      null,
      goalId,
    ]);
  });

  it('keeps session snapshots stable when a linked goal is renamed', async () => {
    const { result } = await renderHydratedStore();
    let subjectId = '';
    let goalId = '';

    await act(() => {
      subjectId = result.current.addSubject('Deutsch').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));

    await act(() => {
      goalId = result.current.createGoal({
        title: 'Alter Zieltitel',
        type: 'duration',
        target: 60,
        subjectId,
        sourcePolicy: 'all',
        startsAt: '2026-07-01',
      }).id;
    });
    await waitFor(() => expect(result.current.data.goals).toHaveLength(1));

    await act(() => {
      result.current.addManualEntry({
        goalId,
        durationMinutes: 30,
        studiedOn: '2026-07-10',
      });
    });
    await waitFor(() => expect(result.current.data.sessions).toHaveLength(1));

    await act(() => {
      expect(result.current.updateGoal(goalId, { title: 'Neuer Zieltitel' })?.title)
        .toBe('Neuer Zieltitel');
    });
    await waitFor(() => expect(result.current.data.goals[0].title).toBe('Neuer Zieltitel'));

    expect(result.current.data.sessions[0]).toMatchObject({
      goalId,
      goalTitleSnapshot: 'Alter Zieltitel',
    });
    expect(evaluateGoal(
      result.current.data.goals[0],
      result.current.data.sessions,
      new Date('2026-07-11T12:00:00.000Z'),
    ).current).toBe(30);
  });

  it('deletes one completed session without affecting its subject', async () => {
    const { result } = await renderHydratedStore();
    let subjectId = '';
    let sessionId = '';

    await act(() => {
      subjectId = result.current.addSubject('Mathematik').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));

    await act(() => {
      sessionId = result.current.addManualEntry({
        subjectId,
        durationMinutes: 25,
        studiedOn: '2026-07-10',
      })?.id ?? '';
    });
    await waitFor(() => expect(result.current.data.sessions).toHaveLength(1));

    await act(() => {
      expect(result.current.deleteSession(sessionId)).toBe(true);
    });
    await waitFor(() => expect(result.current.data.sessions).toEqual([]));
    expect(result.current.data.subjects).toHaveLength(1);
    expect(result.current.deleteSession(sessionId)).toBe(false);
  });
});

describe('persisted goal-bound session migration', () => {
  const baseData = {
    currentUser: null,
    subjects: [{
      id: 'subject-deutsch',
      name: 'Deutsch',
      color: '#a44c32',
      icon: 'book',
    }],
    goals: [],
    friends: [],
    challenges: [],
  };

  it('keeps old sessions unassigned and never reopens an already saved timer', () => {
    const oldSession = {
      id: 'timer-legacy',
      userId: 'local-user',
      subjectId: 'subject-deutsch',
      source: 'timer',
      startedAt: '2026-07-10T08:00:00.000Z',
      endedAt: '2026-07-10T08:30:00.000Z',
      createdAt: '2026-07-10T08:30:00.000Z',
      durationMinutes: 30,
      segments: [{
        startedAt: '2026-07-10T08:00:00.000Z',
        endedAt: '2026-07-10T08:30:00.000Z',
      }],
    };
    const migrated = migratePersistedStudyState({
      schemaVersion: 2,
      privacy: {},
      data: {
        ...baseData,
        sessions: [
          oldSession,
          oldSession,
          { ...oldSession, id: 'discarded-session', status: 'discarded' },
        ],
        activeTimer: {
          schemaVersion: 1,
          id: 'timer-legacy',
          userId: 'local-user',
          subjectId: 'subject-deutsch',
          status: 'paused',
          startedAt: '2026-07-10T08:00:00.000Z',
          updatedAt: '2026-07-10T08:30:00.000Z',
          segments: [{
            startedAt: '2026-07-10T08:00:00.000Z',
            endedAt: '2026-07-10T08:30:00.000Z',
          }],
        },
      },
    });

    expect(migrated?.data.sessions).toHaveLength(1);
    expect(migrated?.data.sessions[0].goalId).toBeUndefined();
    expect(migrated?.data.sessions[0].status).toBe('completed');
    expect(migrated?.data.activeTimer).toBeNull();
  });

  it('restores an unfinished timer with its exact goal binding', () => {
    const migrated = migratePersistedStudyState({
      schemaVersion: 2,
      privacy: {},
      data: {
        ...baseData,
        sessions: [],
        activeTimer: {
          schemaVersion: 1,
          id: 'timer-running',
          userId: 'local-user',
          goalId: 'goal-deutsch',
          subjectId: 'subject-deutsch',
          goalTitleSnapshot: 'Deutsch-Abitur',
          subjectNameSnapshot: 'Deutsch',
          plannedDurationMinutes: 60,
          note: 'Lektüre',
          status: 'running',
          startedAt: '2026-07-10T08:00:00.000Z',
          updatedAt: '2026-07-10T08:00:00.000Z',
          segments: [{
            startedAt: '2026-07-10T08:00:00.000Z',
            endedAt: null,
          }],
        },
      },
    });

    expect(migrated?.data.activeTimer).toMatchObject({
      goalId: 'goal-deutsch',
      subjectId: 'subject-deutsch',
      goalTitleSnapshot: 'Deutsch-Abitur',
      subjectNameSnapshot: 'Deutsch',
      plannedDurationMinutes: 60,
      note: 'Lektüre',
    });
  });

  it('keeps an old unassigned goal and unused subject without guessing a binding', () => {
    const migrated = migratePersistedStudyState({
      schemaVersion: 1,
      privacy: {},
      data: {
        ...baseData,
        sessions: [],
        goals: [{
          id: 'goal-old-unassigned',
          userId: 'local-user',
          title: 'Altes Lernziel',
          type: 'duration',
          targetMinutes: 60,
          period: 'week',
          sourcePolicy: 'all',
          status: 'active',
          createdAt: '2026-07-01T08:00:00.000Z',
        }],
        activeTimer: null,
      },
    });

    expect(migrated?.data.subjects).toHaveLength(1);
    expect(migrated?.data.goals[0]).toMatchObject({
      id: 'goal-old-unassigned',
      subjectId: undefined,
      subjectIds: undefined,
    });
  });
});

describe('StudyStoreProvider data reset', () => {
  it('clears profile, subjects, sessions, goals, timer and privacy preferences', async () => {
    const { result } = await renderHydratedStore();

    await act(() => {
      result.current.updateLocalProfile({
        displayName: 'Ada Lovelace',
        username: 'ada',
      });
    });
    await waitFor(() => expect(result.current.data.currentUser).not.toBeNull());

    let subjectId = '';
    await act(() => {
      subjectId = result.current.addSubject('Mathematik').id;
    });
    await waitFor(() => expect(result.current.data.subjects).toHaveLength(1));

    await act(() => {
      result.current.addManualEntry({
        subjectId,
        durationMinutes: 45,
        studiedOn: '2026-07-10',
      });
    });
    await waitFor(() => expect(result.current.data.sessions).toHaveLength(1));

    await act(() => {
      result.current.createGoal({
        title: 'Drei Mathe-Sessions',
        type: 'sessions',
        target: 3,
        subjectId,
        sourcePolicy: 'timer_only',
        minimumSessionMinutes: 20,
      });
    });
    await waitFor(() => expect(result.current.data.goals).toHaveLength(1));

    await act(() => result.current.startTimer(subjectId));
    await waitFor(() => expect(result.current.data.activeTimer).not.toBeNull());

    await act(() => {
      result.current.setFriendComparisonsEnabled(true);
      result.current.setPrivacyPreference('shareAutomaticMinutes', true);
      result.current.setPrivacyPreference('shareGoalProgress', true);
      result.current.setPrivacyPreference('shareStreak', true);
    });
    await waitFor(() =>
      expect(result.current.privacy).toEqual({
        friendComparisonsEnabled: true,
        shareAutomaticMinutes: true,
        shareGoalProgress: true,
        shareStreak: true,
      }),
    );

    storageMock.removeItem.mockClear();
    await act(() => result.current.clearAllData());

    await waitFor(() => {
      expect(result.current.data).toEqual(createInitialData());
      expect(result.current.privacy).toEqual(defaultPrivacy);
    });
    expect(storageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);

    const persisted = storedValues.get(STORAGE_KEY);
    if (persisted) {
      const parsed = JSON.parse(persisted) as {
        data: unknown;
        privacy: unknown;
      };
      expect(parsed.data).toEqual(createInitialData());
      expect(parsed.privacy).toEqual(defaultPrivacy);
    }
  });
});
