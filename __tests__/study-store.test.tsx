import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createInitialData } from '@/data/initial-data';
import { getGoalTitle } from '@/lib/goals';
import {
  StudyStoreProvider,
  defaultPrivacy,
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

    await act(() => {
      const goal = result.current.createGoal({
        title: '   ',
        type: 'duration',
        target: 120,
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
