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
  options: {
    goalId?: string | null;
    subjectId?: string;
    source?: 'timer' | 'manual';
  } = {},
): StudySession {
  const source = options.source ?? 'timer';
  const subjectId = options.subjectId ?? 'math';
  const goalId = options.goalId === null
    ? null
    : options.goalId ?? 'goal-duration';
  const endedAt = new Date(
    new Date(startedAt).getTime() + durationMinutes * 60_000,
  ).toISOString();
  const base = {
    id,
    userId: USER_ID,
    goalId,
    subjectId,
    startedAt,
    endedAt,
    durationMinutes,
    status: 'completed' as const,
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

  it('uses the local calendar-day boundary for a daily goal', () => {
    const range = getGoalPeriodRange('day', reference);

    expect([
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate(),
      range.start.getHours(),
      range.start.getMinutes(),
    ]).toEqual([2026, 6, 10, 0, 0]);
    expect([
      range.endExclusive.getFullYear(),
      range.endExclusive.getMonth(),
      range.endExclusive.getDate(),
      range.endExclusive.getHours(),
      range.endExclusive.getMinutes(),
    ]).toEqual([2026, 6, 11, 0, 0]);
  });

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

  it('uses the configured start and end for a custom goal', () => {
    const range = getGoalPeriodRange('custom', reference, {
      startsAt: '2026-07-03T08:15:00.000Z',
      endsAt: '2026-07-19T18:30:00.000Z',
    });

    expect(range.start.toISOString()).toBe('2026-07-03T08:15:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-07-19T18:30:00.000Z');
  });
});

describe('goal evaluation', () => {
  it('counts only sessions inside the period and on or after startsAt', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const goal = durationGoal({ startsAt: '2026-07-08T12:00:00.000Z' });
    const sessions = [
      studySession('monday', '2026-07-06T14:00:00.000Z', 20),
      studySession('before-start', '2026-07-08T11:00:00.000Z', 30),
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

  it('applies exact goal selection and timer-only source policy together', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const sessions = [
      studySession('math-timer', '2026-07-07T09:00:00.000Z', 45),
      studySession('math-manual', '2026-07-08T09:00:00.000Z', 30, {
        source: 'manual',
      }),
      studySession('english-timer', '2026-07-09T09:00:00.000Z', 60, {
        goalId: 'another-goal',
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

  it('keeps two goals for the same subject strictly separated', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const firstGoal = durationGoal({ id: 'math-analysis' });
    const secondGoal = durationGoal({ id: 'math-statistics' });
    const sessions = [
      studySession('analysis', '2026-07-08T09:00:00.000Z', 35, {
        goalId: 'math-analysis',
      }),
      studySession('statistics', '2026-07-09T09:00:00.000Z', 55, {
        goalId: 'math-statistics',
      }),
    ];

    expect(evaluateGoal(firstGoal, sessions, reference).current).toBe(35);
    expect(evaluateGoal(secondGoal, sessions, reference).current).toBe(55);
  });

  it('never assigns free or legacy sessions to a goal implicitly', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const freeSession = studySession(
      'free',
      '2026-07-08T09:00:00.000Z',
      40,
      { goalId: null },
    );
    const legacySession = {
      ...studySession('legacy', '2026-07-09T09:00:00.000Z', 50),
      goalId: undefined,
    };

    const result = evaluateGoal(
      durationGoal(),
      [freeSession, legacySession],
      reference,
    );

    expect(result.current).toBe(0);
    expect(result.matchingSessions).toHaveLength(0);
  });

  it('counts a manually entered session only for its selected goal', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const matchingManualSession = studySession(
      'manual-matching',
      '2026-07-09T09:00:00.000Z',
      45,
      { goalId: 'goal-duration', source: 'manual' },
    );
    const freeManualSession = studySession(
      'manual-free',
      '2026-07-09T11:00:00.000Z',
      25,
      { goalId: null, source: 'manual' },
    );

    expect(
      evaluateGoal(
        durationGoal(),
        [matchingManualSession, freeManualSession],
        reference,
      ).current,
    ).toBe(45);
  });

  it('keeps the exact value above target while capping visual progress at 100 percent', () => {
    const result = evaluateGoal(
      durationGoal({ targetMinutes: 60 }),
      [studySession('over-target', '2026-07-09T09:00:00.000Z', 85)],
      new Date('2026-07-10T16:00:00.000Z'),
    );

    expect(result.current).toBe(85);
    expect(result.target).toBe(60);
    expect(result.remaining).toBe(0);
    expect(result.progress).toBe(1);
    expect(result.progressPercent).toBe(100);
    expect(result.achieved).toBe(true);
  });

  it('counts only the current local day for a daily goal', () => {
    const reference = new Date(2026, 6, 10, 16, 0);
    const currentDay = new Date(2026, 6, 10, 9, 0).toISOString();
    const previousDay = new Date(2026, 6, 9, 22, 0).toISOString();
    const result = evaluateGoal(
      durationGoal({
        period: 'day',
        startsAt: new Date(2026, 6, 1).toISOString(),
      }),
      [
        studySession('previous-day', previousDay, 50),
        studySession('current-day', currentDay, 25),
      ],
      reference,
    );

    expect(result.current).toBe(25);
    expect(result.matchingSessions.map((session) => session.id)).toEqual([
      'current-day',
    ]);
  });

  it('counts only the duration portion inside a daily goal boundary', () => {
    const reference = new Date(2026, 6, 10, 16, 0);
    const result = evaluateGoal(
      durationGoal({
        period: 'day',
        startsAt: new Date(2026, 6, 1).toISOString(),
      }),
      [studySession(
        'crossing-midnight',
        new Date(2026, 6, 9, 23, 30).toISOString(),
        60,
      )],
      reference,
    );

    expect(result.current).toBe(30);
    expect(result.matchingSessions).toHaveLength(1);
  });

  it('ignores foreign, invalid and duplicate sessions for goal progress', () => {
    const matching = studySession('unique', '2026-07-09T09:00:00.000Z', 30);
    const foreign = {
      ...studySession('foreign', '2026-07-09T10:00:00.000Z', 60),
      userId: 'other-user',
    };
    const invalid = {
      ...studySession('invalid', '2026-07-09T11:00:00.000Z', 45),
      endedAt: '2026-07-09T11:00:00.000Z',
    };
    const result = evaluateGoal(
      durationGoal(),
      [matching, { ...matching }, foreign, invalid],
      new Date('2026-07-10T16:00:00.000Z'),
    );

    expect(result.current).toBe(30);
    expect(result.matchingSessions.map((session) => session.id)).toEqual(['unique']);
  });

  it('respects the exact end timestamp of a custom goal', () => {
    const result = evaluateGoal(
      durationGoal({
        period: 'custom',
        startsAt: '2026-07-08T08:00:00.000Z',
        endsAt: '2026-07-10T08:00:00.000Z',
      }),
      [
        studySession('at-start', '2026-07-08T08:00:00.000Z', 20),
        studySession('before-end', '2026-07-10T07:29:59.000Z', 30),
        studySession('at-end', '2026-07-10T08:00:00.000Z', 40),
      ],
      new Date('2026-07-12T12:00:00.000Z'),
    );

    expect(result.current).toBe(50);
    expect(result.matchingSessions.map((session) => session.id)).toEqual([
      'at-start',
      'before-end',
    ]);
  });

  it('uses an optional end date to bound a recurring goal', () => {
    const result = evaluateGoal(
      durationGoal({
        period: 'month',
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-10T08:00:00.000Z',
      }),
      [
        studySession('before-end', '2026-07-10T07:29:59.000Z', 30),
        studySession('at-end', '2026-07-10T08:00:00.000Z', 40),
        studySession('after-end', '2026-07-11T08:00:00.000Z', 50),
      ],
      new Date('2026-07-20T12:00:00.000Z'),
    );

    expect(result.current).toBe(30);
    expect(result.matchingSessions.map((session) => session.id)).toEqual([
      'before-end',
    ]);
  });

  it('counts qualifying sessions rather than minutes for a session goal', () => {
    const reference = new Date('2026-07-10T16:00:00.000Z');
    const sessions = [
      studySession('too-short', '2026-07-07T09:00:00.000Z', 24.9, {
        goalId: 'goal-sessions',
      }),
      studySession('minimum', '2026-07-08T09:00:00.000Z', 25, {
        goalId: 'goal-sessions',
        source: 'manual',
      }),
      studySession('longer', '2026-07-09T09:00:00.000Z', 50, {
        goalId: 'goal-sessions',
      }),
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
      { id: 'math', name: 'Mathematik', color: '#C45D35', icon: 'book' },
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
    expect(createAutomaticGoalTitle(durationGoal({ subjectIds: undefined }), subjects))
      .toBe('120 Minuten pro Woche');
  });
});
