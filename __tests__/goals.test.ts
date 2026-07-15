import {
  createAutomaticGoalTitle,
  evaluateGoal,
  getGoalPeriodRange,
  getGoalTitle,
} from '@/lib/goals';
import type {
  DurationGoal,
  SessionsGoal,
  StudySession,
  Subject,
} from '@/types/study';

const USER_ID = 'user-1';

function durationGoal(overrides: Partial<DurationGoal> = {}): DurationGoal {
  return {
    id: 'goal-duration',
    userId: USER_ID,
    type: 'duration',
    targetMinutes: 120,
    period: 'week',
    sourcePolicy: 'all',
    status: 'active',
    createdAt: '2026-07-01T08:00:00.000Z',
    startsAt: '2026-07-01T08:00:00.000Z',
    ...overrides,
  };
}

function sessionsGoal(overrides: Partial<SessionsGoal> = {}): SessionsGoal {
  return {
    id: 'goal-sessions',
    userId: USER_ID,
    type: 'sessions',
    targetSessions: 2,
    minimumSessionMinutes: 25,
    period: 'week',
    sourcePolicy: 'all',
    status: 'active',
    createdAt: '2026-07-01T08:00:00.000Z',
    startsAt: '2026-07-01T08:00:00.000Z',
    ...overrides,
  };
}

function studySession(
  id: string,
  startedAt: string,
  durationMinutes: number,
  options: { subjectId?: string; source?: 'timer' | 'manual' } = {},
): StudySession {
  const source = options.source ?? 'timer';
  const subjectId = options.subjectId ?? 'math';
  const endedAt = new Date(
    new Date(startedAt).getTime() + durationMinutes * 60_000,
  ).toISOString();
  const base = {
    id,
    userId: USER_ID,
    subjectId,
    startedAt,
    endedAt,
    durationMinutes,
    createdAt: endedAt,
  };

  return source === 'timer'
    ? {
        ...base,
        source,
        segments: [{ startedAt, endedAt }],
      }
    : {
        ...base,
        source,
        enteredAt: endedAt,
      };
}

describe('goal period ranges', () => {
  const reference = new Date(2026, 6, 10, 17, 30);

  it('uses Monday through Sunday for a week', () => {
    const range = getGoalPeriodRange('week', reference);

    expect(range.start.getDay()).toBe(1);
    expect(range.start.getFullYear()).toBe(2026);
    expect(range.start.getMonth()).toBe(6);
    expect(range.start.getDate()).toBe(6);
    expect(range.start.getHours()).toBe(0);
    expect(range.endExclusive.getDate()).toBe(13);
  });

  it('uses calendar month and calendar year boundaries', () => {
    const month = getGoalPeriodRange('month', reference);
    const year = getGoalPeriodRange('year', reference);

    expect([
      month.start.getFullYear(),
      month.start.getMonth(),
      month.start.getDate(),
    ]).toEqual([2026, 6, 1]);
    expect([
      month.endExclusive.getFullYear(),
      month.endExclusive.getMonth(),
      month.endExclusive.getDate(),
    ]).toEqual([2026, 7, 1]);
    expect([
      year.start.getFullYear(),
      year.start.getMonth(),
      year.start.getDate(),
    ]).toEqual([2026, 0, 1]);
    expect([
      year.endExclusive.getFullYear(),
      year.endExclusive.getMonth(),
      year.endExclusive.getDate(),
    ]).toEqual([2027, 0, 1]);
  });
});

describe('goal evaluation', () => {
  it('counts only sessions inside the period and on or after startsAt', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const goal = durationGoal({ startsAt: '2026-07-08T12:00:00.000Z' });
    const sessions = [
      studySession('monday', '2026-07-06T14:00:00.000Z', 20),
      studySession('before-start', '2026-07-08T11:59:59.000Z', 30),
      studySession('at-start', '2026-07-08T12:00:00.000Z', 40),
      studySession('after-start', '2026-07-09T09:00:00.000Z', 35),
      studySession('future', '2026-07-11T09:00:00.000Z', 90),
      studySession('next-week', '2026-07-13T09:00:00.000Z', 90),
    ];

    const result = evaluateGoal(goal, sessions, reference);

    expect(result.current).toBe(75);
    expect(result.matchingSessions.map((session) => session.id)).toEqual([
      'at-start',
      'after-start',
    ]);
    expect(result.remaining).toBe(45);
    expect(result.progress).toBeCloseTo(0.625);
    expect(result.progressPercent).toBe(62.5);
    expect(result.achieved).toBe(false);
  });

  it('applies subject selection and timer-only source policy together', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const sessions = [
      studySession('math-timer', '2026-07-07T09:00:00.000Z', 45),
      studySession('math-manual', '2026-07-08T09:00:00.000Z', 30, {
        source: 'manual',
      }),
      studySession('english-timer', '2026-07-09T09:00:00.000Z', 60, {
        subjectId: 'english',
      }),
    ];
    const timerOnly = durationGoal({
      subjectIds: ['math'],
      sourcePolicy: 'timer_only',
    });

    expect(evaluateGoal(timerOnly, sessions, reference).current).toBe(45);
    expect(
      evaluateGoal({ ...timerOnly, sourcePolicy: 'all' }, sessions, reference)
        .current,
    ).toBe(75);
  });

  it('counts qualifying sessions rather than minutes for a session goal', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const sessions = [
      studySession('too-short', '2026-07-07T09:00:00.000Z', 24.9),
      studySession('minimum', '2026-07-08T09:00:00.000Z', 25, {
        source: 'manual',
      }),
      studySession('longer', '2026-07-09T09:00:00.000Z', 50),
    ];

    const result = evaluateGoal(sessionsGoal(), sessions, reference);

    expect(result.current).toBe(2);
    expect(result.target).toBe(2);
    expect(result.matchingSessionCount).toBe(2);
    expect(result.progress).toBe(1);
    expect(result.achieved).toBe(true);
  });

  it('stops counting at a paused goal lifecycle timestamp', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const goal = durationGoal({
      status: 'paused',
      pausedAt: '2026-07-09T12:00:00.000Z',
    });
    const sessions = [
      studySession('before-pause', '2026-07-09T11:00:00.000Z', 30),
      studySession('after-pause', '2026-07-09T13:00:00.000Z', 60),
    ];

    const result = evaluateGoal(goal, sessions, reference);

    expect(result.current).toBe(30);
    expect(result.matchingSessions).toHaveLength(1);
    expect(result.countedUntil.toISOString()).toBe('2026-07-09T12:00:00.000Z');
  });

  it('does not count sessions from a completed pause interval after resuming', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const goal = durationGoal({
      pausedIntervals: [{
        startedAt: '2026-07-08T12:00:00.000Z',
        endedAt: '2026-07-09T12:00:00.000Z',
      }],
    });
    const sessions = [
      studySession('before-pause', '2026-07-08T10:00:00.000Z', 20),
      studySession('during-pause', '2026-07-09T10:00:00.000Z', 90),
      studySession('after-resume', '2026-07-09T14:00:00.000Z', 30),
    ];

    const result = evaluateGoal(goal, sessions, reference);

    expect(result.current).toBe(50);
    expect(result.matchingSessions.map((session) => session.id)).toEqual([
      'before-pause',
      'after-resume',
    ]);
  });

  it('keeps historical progress for completed goals after the calendar period changes', () => {
    const goal = durationGoal({
      status: 'completed',
      completedAt: '2026-07-10T16:00:00.000Z',
    });
    const sessions = [studySession('completed-week', '2026-07-09T10:00:00.000Z', 120)];

    const result = evaluateGoal(goal, sessions, new Date('2026-07-20T12:00:00.000Z'));

    expect(result.current).toBe(120);
    expect(result.achieved).toBe(true);
    expect(result.matchingSessions).toHaveLength(1);
  });

  it('generates one canonical title while respecting a custom title', () => {
    const subjects: Subject[] = [
      { id: 'math', name: 'Mathematik', color: '#4F6BED', icon: 'book' },
    ];
    const generatedGoal = durationGoal({ subjectIds: ['math'], title: '   ' });

    expect(createAutomaticGoalTitle(generatedGoal, subjects)).toBe(
      '120 Minuten Mathematik pro Woche',
    );
    expect(getGoalTitle(generatedGoal, subjects)).toBe(
      '120 Minuten Mathematik pro Woche',
    );
    expect(getGoalTitle({ ...generatedGoal, title: 'Prüfung vorbereiten' }, subjects))
      .toBe('Prüfung vorbereiten');
  });
});
