import {
  mergeLocalStudyStateIntoAccount,
  type StudyStateSnapshot,
} from '@/lib/study-state-transfer';

const now = '2026-07-17T10:00:00.000Z';

function localState(): StudyStateSnapshot {
  return {
    privacy: {
      friendComparisonsEnabled: true,
      shareAutomaticMinutes: false,
      shareManualMinutes: false,
      shareGoalProgress: true,
      shareStreak: false,
    },
    data: {
      currentUser: {
        id: 'local-user',
        displayName: 'Lokale Lea',
        username: 'lokale.lea',
      },
      subjects: [{ id: 'subject-math', name: 'Mathematik', color: '#B44D2B', icon: 'book' }],
      sessions: [{
        id: 'session-local',
        userId: 'local-user',
        goalId: 'goal-local',
        subjectId: 'subject-math',
        source: 'manual',
        status: 'completed',
        startedAt: now,
        endedAt: '2026-07-17T11:00:00.000Z',
        enteredAt: now,
        createdAt: now,
        durationMinutes: 60,
      }],
      grades: [{
        id: 'grade-local',
        userId: 'local-user',
        subjectId: 'subject-math',
        assessmentType: 'exam',
        title: 'Analysis',
        points: 11,
        additionalStudyMinutes: 30,
        sessionIds: ['session-local'],
        createdAt: now,
        updatedAt: now,
      }],
      goals: [{
        id: 'goal-local',
        userId: 'local-user',
        title: 'Mathe-Woche',
        period: 'week',
        sourcePolicy: 'all',
        subjectId: 'subject-math',
        status: 'active',
        createdAt: now,
        startsAt: now,
        type: 'duration',
        targetMinutes: 120,
      }],
      friends: [{
        id: 'friend-local',
        user: { id: 'friend-1', displayName: 'Mia', username: 'mia' },
        status: 'accepted',
        canSeeMyStats: true,
        canSeeTheirStats: true,
      }],
      challenges: [],
      activeTimer: {
        schemaVersion: 1,
        id: 'timer-local',
        userId: 'local-user',
        goalId: 'goal-local',
        subjectId: 'subject-math',
        status: 'paused',
        startedAt: now,
        segments: [{ startedAt: now, endedAt: now }],
        updatedAt: now,
      },
    },
  };
}

describe('local study-state account transfer', () => {
  it('preserves personal data and references while rebinding ownership', () => {
    const merged = mergeLocalStudyStateIntoAccount(null, localState(), 'account-123');

    expect(merged.data.currentUser?.id).toBe('account-123');
    expect(merged.data.sessions[0]).toMatchObject({
      id: 'session-local',
      userId: 'account-123',
      goalId: 'goal-local',
      subjectId: 'subject-math',
    });
    expect(merged.data.grades[0]).toMatchObject({
      userId: 'account-123',
      sessionIds: ['session-local'],
    });
    expect(merged.data.goals[0]).toMatchObject({ userId: 'account-123' });
    expect(merged.data.activeTimer).toMatchObject({ userId: 'account-123' });
    expect(merged.privacy).toEqual(localState().privacy);
    expect(merged.data.friends).toEqual([]);
  });

  it('merges with an existing account idempotently and keeps account collisions', () => {
    const account = localState();
    account.data = {
      ...account.data,
      currentUser: { id: 'account-123', displayName: 'Cloud Lea', username: 'cloud.lea' },
      subjects: [{ id: 'subject-math', name: 'Mathe LK', color: '#747644', icon: 'book' }],
      sessions: [{
        ...account.data.sessions[0],
        id: 'session-cloud',
        userId: 'account-123',
      }],
      grades: [],
      goals: [],
      activeTimer: null,
    };
    account.privacy = {
      friendComparisonsEnabled: false,
      shareAutomaticMinutes: false,
      shareManualMinutes: false,
      shareGoalProgress: false,
      shareStreak: false,
    };

    const first = mergeLocalStudyStateIntoAccount(account, localState(), 'account-123');
    const second = mergeLocalStudyStateIntoAccount(first, localState(), 'account-123');
    const updatedLocal = localState();
    updatedLocal.data = {
      ...updatedLocal.data,
      subjects: [...updatedLocal.data.subjects, {
        id: 'subject-physics',
        name: 'Physik',
        color: '#2C7974',
        icon: 'book',
      }],
      sessions: [...updatedLocal.data.sessions, {
        ...updatedLocal.data.sessions[0],
        id: 'session-later',
        goalId: null,
        subjectId: 'subject-physics',
      }],
      grades: [...updatedLocal.data.grades, {
        ...updatedLocal.data.grades[0],
        id: 'grade-later',
        subjectId: 'subject-physics',
        sessionIds: ['session-later'],
      }],
    };
    const reconnected = mergeLocalStudyStateIntoAccount(
      second,
      updatedLocal,
      'account-123',
    );

    expect(reconnected.data.subjects).toEqual([
      expect.objectContaining({ id: 'subject-math', name: 'Mathe LK' }),
      expect.objectContaining({ id: 'subject-physics', name: 'Physik' }),
    ]);
    expect(reconnected.data.sessions.map((session) => session.id).sort()).toEqual([
      'session-cloud',
      'session-later',
      'session-local',
    ]);
    expect(reconnected.data.sessions.filter((session) => session.id === 'session-local')).toHaveLength(1);
    expect(reconnected.data.grades.map((grade) => grade.id).sort()).toEqual([
      'grade-later',
      'grade-local',
    ]);
    expect(reconnected.data.goals).toHaveLength(1);
    expect(reconnected.privacy).toEqual(account.privacy);
  });
});
