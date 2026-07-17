import {
  ACTIVITY_LEVEL_THRESHOLDS,
  buildActivityHeatmap,
  calculateActivityChange,
  calculateActivityOverview,
  calculateActivitySummary,
  filterValidActivitySessions,
  findActivityDay,
  getActivityLevel,
  getSessionMinutesWithinRange,
  getTwelveMonthActivityRange,
  splitSessionAcrossLocalDays,
  toLocalDateKey,
  type ActivitySessionInput,
} from '@/lib/activity';

function localIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function makeSession(
  overrides: Partial<ActivitySessionInput> & Pick<ActivitySessionInput, 'id'>,
): ActivitySessionInput {
  return {
    userId: 'user-current',
    subjectId: 'subject-math',
    goalId: null,
    startedAt: localIso(2026, 7, 14, 9),
    endedAt: localIso(2026, 7, 14, 9, 30),
    durationMinutes: 30,
    source: 'timer',
    status: 'completed',
    ...overrides,
  };
}

describe('activity levels', () => {
  it.each([
    [Number.NaN, 0],
    [-1, 0],
    [0, 0],
    [0.1, 1],
    [1, 1],
    [15, 1],
    [15.01, 2],
    [16, 2],
    [30, 2],
    [30.01, 3],
    [31, 3],
    [60, 3],
    [60.01, 4],
    [61, 4],
    [120, 4],
    [120.01, 5],
    [121, 5],
  ] as const)('maps %s minutes to level %s', (minutes, expectedLevel) => {
    expect(getActivityLevel(minutes)).toBe(expectedLevel);
  });

  it('keeps thresholds central and replaceable', () => {
    expect(ACTIVITY_LEVEL_THRESHOLDS).toEqual([0, 15, 30, 60, 120]);
    expect(getActivityLevel(11, [0, 10, 20, 30, 40])).toBe(2);
    expect(() => getActivityLevel(10, [0, 20, 20, 40, 80])).toThrow(RangeError);
  });
});

describe('local calendar allocation', () => {
  it('splits a session exactly at local midnight', () => {
    const referenceDate = new Date(2026, 6, 15, 12);
    const session = makeSession({
      id: 'midnight',
      startedAt: localIso(2026, 7, 14, 23, 30),
      endedAt: localIso(2026, 7, 15, 0, 30),
      durationMinutes: 60,
    });

    expect(splitSessionAcrossLocalDays(session, referenceDate)).toEqual([
      {
        date: new Date(2026, 6, 14),
        dateKey: '2026-07-14',
        minutes: 30,
      },
      {
        date: new Date(2026, 6, 15),
        dateKey: '2026-07-15',
        minutes: 30,
      },
    ]);
  });

  it('merges overlapping timer segments and counts only active minutes', () => {
    const session = makeSession({
      id: 'overlapping-segments',
      startedAt: localIso(2026, 7, 14, 23, 50),
      endedAt: localIso(2026, 7, 15, 0, 20),
      durationMinutes: 30,
      segments: [
        {
          startedAt: localIso(2026, 7, 14, 23, 50),
          endedAt: localIso(2026, 7, 15, 0, 10),
        },
        {
          startedAt: localIso(2026, 7, 15, 0),
          endedAt: localIso(2026, 7, 15, 0, 20),
        },
      ],
    });

    const allocations = splitSessionAcrossLocalDays(session, new Date(2026, 6, 15, 12));
    expect(allocations).toHaveLength(2);
    expect(allocations[0]?.minutes).toBeCloseTo(10);
    expect(allocations[1]?.minutes).toBeCloseTo(20);
    expect(allocations.reduce((sum, allocation) => sum + allocation.minutes, 0)).toBeCloseTo(30);
  });

  it('uses second precision and clips the future part at now', () => {
    const session = makeSession({
      id: 'future-ending',
      startedAt: localIso(2026, 7, 14, 14, 59),
      endedAt: localIso(2026, 7, 14, 15, 1),
      durationMinutes: undefined,
      durationSeconds: 120,
    });

    const allocations = splitSessionAcrossLocalDays(session, new Date(2026, 6, 14, 15));
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.minutes).toBeCloseTo(1);
  });

  it('calculates proportional minutes inside an arbitrary time boundary', () => {
    const session = makeSession({
      id: 'range-overlap',
      startedAt: localIso(2026, 7, 14, 23, 30),
      endedAt: localIso(2026, 7, 15, 0, 30),
      durationMinutes: 60,
    });

    expect(getSessionMinutesWithinRange(
      session,
      new Date(2026, 6, 15, 0),
      new Date(2026, 6, 15, 1),
    )).toBeCloseTo(30);
  });
});

describe('activity summary', () => {
  const referenceDate = new Date(2026, 6, 14, 15);
  const todaySession = makeSession({ id: 'today', durationMinutes: 30 });

  const sessions: ActivitySessionInput[] = [
    todaySession,
    { ...todaySession }, // duplicate restore with the same persisted ID
    makeSession({
      id: 'six-days-ago',
      startedAt: localIso(2026, 7, 8, 10),
      endedAt: localIso(2026, 7, 8, 10, 45),
      durationMinutes: 45,
    }),
    makeSession({
      id: 'seven-days-ago',
      startedAt: localIso(2026, 7, 7, 10),
      endedAt: localIso(2026, 7, 7, 10, 20),
      durationMinutes: 20,
    }),
    makeSession({
      id: 'first-of-month',
      startedAt: localIso(2026, 7, 1, 8),
      endedAt: localIso(2026, 7, 1, 8, 40),
      durationMinutes: 40,
      status: undefined,
    }),
    makeSession({
      id: 'previous-month',
      startedAt: localIso(2026, 6, 30, 8),
      endedAt: localIso(2026, 6, 30, 8, 35),
      durationMinutes: 35,
    }),
    makeSession({ id: 'discarded', status: 'discarded', durationMinutes: 200 }),
    makeSession({ id: 'running', status: 'running', durationMinutes: 200 }),
    makeSession({ id: 'foreign', userId: 'user-other', durationMinutes: 200 }),
    makeSession({
      id: 'future',
      startedAt: localIso(2026, 7, 14, 16),
      endedAt: localIso(2026, 7, 14, 17),
      durationMinutes: 60,
    }),
  ];

  it('uses today 00:00-now, six preceding calendar days and the current month', () => {
    expect(
      calculateActivitySummary(sessions, { userId: 'user-current', referenceDate }),
    ).toEqual({
      todayMinutes: 30,
      lastSevenDaysMinutes: 75,
      currentMonthMinutes: 135,
    });
  });

  it('keeps only completed/legacy records of the current user and de-duplicates IDs', () => {
    expect(
      filterValidActivitySessions(sessions, { userId: 'user-current', referenceDate }).map(
        (session) => session.id,
      ),
    ).toEqual(['today', 'six-days-ago', 'seven-days-ago', 'first-of-month', 'previous-month']);
  });

  it('does not double-count a midnight session and limits this month to its first day', () => {
    const midnightSession = makeSession({
      id: 'month-midnight',
      startedAt: localIso(2026, 6, 30, 23, 30),
      endedAt: localIso(2026, 7, 1, 0, 30),
      durationMinutes: 60,
    });

    expect(
      calculateActivitySummary([midnightSession], {
        userId: 'user-current',
        referenceDate: new Date(2026, 6, 1, 12),
      }),
    ).toEqual({
      todayMinutes: 30,
      lastSevenDaysMinutes: 60,
      currentMonthMinutes: 30,
    });
  });

  it('compares local calendar periods with yesterday, the preceding seven days and last month', () => {
    const overview = calculateActivityOverview([
      makeSession({ id: 'comparison-today', durationMinutes: 60 }),
      makeSession({
        id: 'comparison-yesterday',
        startedAt: localIso(2026, 7, 13, 10),
        endedAt: localIso(2026, 7, 13, 10, 30),
        durationMinutes: 50,
      }),
      makeSession({
        id: 'comparison-previous-seven',
        startedAt: localIso(2026, 7, 7, 10),
        endedAt: localIso(2026, 7, 7, 10, 30),
        durationMinutes: 100,
      }),
      makeSession({
        id: 'comparison-last-month',
        startedAt: localIso(2026, 6, 15, 10),
        endedAt: localIso(2026, 6, 15, 10, 30),
        durationMinutes: 300,
      }),
    ], { userId: 'user-current', referenceDate });

    expect(overview.summary).toEqual({
      todayMinutes: 60,
      lastSevenDaysMinutes: 110,
      currentMonthMinutes: 210,
    });
    expect(overview.comparisons).toEqual({
      today: {
        currentMinutes: 60,
        previousMinutes: 50,
        percentChange: 20,
        trend: 'positive',
      },
      lastSevenDays: {
        currentMinutes: 110,
        previousMinutes: 100,
        percentChange: 10,
        trend: 'positive',
      },
      currentMonth: {
        currentMinutes: 210,
        previousMinutes: 300,
        percentChange: -30,
        trend: 'negative',
      },
    });
  });

  it('uses New for activity after zero and keeps unchanged zero neutral', () => {
    expect(calculateActivityChange(45, 0)).toEqual({
      currentMinutes: 45,
      previousMinutes: 0,
      percentChange: null,
      trend: 'new',
    });
    expect(calculateActivityChange(0, 0)).toEqual({
      currentMinutes: 0,
      previousMinutes: 0,
      percentChange: 0,
      trend: 'neutral',
    });
  });
});

describe('twelve-month heatmap', () => {
  it('uses the trailing twelve months through today, inclusive', () => {
    const range = getTwelveMonthActivityRange(new Date(2026, 6, 14, 18));
    expect(range.start).toEqual(new Date(2025, 6, 15));
    expect(range.end).toEqual(new Date(2026, 6, 14));

    const inclusiveCalendarDays =
      Math.round(
        (Date.UTC(2026, 6, 14) - Date.UTC(2025, 6, 15)) / 86_400_000,
      ) + 1;
    expect(inclusiveCalendarDays).toBe(365);
  });

  it('clamps leap-day subtraction before advancing the start by one day', () => {
    const range = getTwelveMonthActivityRange(new Date(2024, 1, 29, 12));
    expect(range.start).toEqual(new Date(2023, 2, 1));
    expect(range.end).toEqual(new Date(2024, 1, 29));
  });

  it('builds Monday-Sunday columns and keeps visual padding inactive', () => {
    const referenceDate = new Date(2026, 6, 14, 15); // Tuesday
    const heatmap = buildActivityHeatmap([], { userId: 'user-current', referenceDate });

    expect(heatmap.weeks[0]?.days.map((day) => day.date.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(heatmap.weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(findActivityDay(heatmap, '2025-07-15')?.isInRange).toBe(true);

    const inactivePastPadding = heatmap.weeks[0]?.days.filter(
      (day) => day.dateKey < '2025-07-15',
    );
    expect(inactivePastPadding?.every((day) => !day.isInRange && day.level === 0)).toBe(true);

    const lastWeek = heatmap.weeks.at(-1);
    const futurePadding = lastWeek?.days.filter((day) => day.dateKey > '2026-07-14');
    expect(futurePadding?.length).toBeGreaterThan(0);
    expect(futurePadding?.every((day) => !day.isInRange && day.isFuture && day.level === 0)).toBe(
      true,
    );
    expect(heatmap.monthLabels.length).toBeGreaterThanOrEqual(12);
  });

  it('creates higher levels for longer study days', () => {
    const referenceDate = new Date(2026, 6, 14, 15);
    const durations = [0, 10, 20, 45, 90, 150] as const;
    const sessions = durations.slice(1).map((duration, index) =>
      makeSession({
        id: `level-${index + 1}`,
        startedAt: localIso(2026, 7, 9 + index, 9),
        endedAt: localIso(2026, 7, 9 + index, 9, duration),
        durationMinutes: duration,
      }),
    );
    const heatmap = buildActivityHeatmap(sessions, { userId: 'user-current', referenceDate });
    const levels = durations.map((_, index) =>
      findActivityDay(heatmap, toLocalDateKey(new Date(2026, 6, 8 + index)))?.level,
    );

    expect(levels).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('provides selected-day totals, unique sessions and snapshot-based fallbacks', () => {
    const referenceDate = new Date(2026, 6, 14, 15);
    const sessions = [
      makeSession({
        id: 'snapshot-session',
        goalId: 'goal-deleted',
        subjectId: 'subject-deleted',
        goalTitleSnapshot: 'Deutsch-Abitur',
        subjectNameSnapshot: 'Deutsch',
        durationMinutes: 30,
      }),
      makeSession({
        id: 'free-session',
        goalId: null,
        subjectId: 'subject-missing',
        startedAt: localIso(2026, 7, 14, 10),
        endedAt: localIso(2026, 7, 14, 10, 20),
        durationMinutes: 20,
      }),
    ];
    const heatmap = buildActivityHeatmap(sessions, { userId: 'user-current', referenceDate });
    const day = findActivityDay(heatmap, '2026-07-14');

    expect(day).not.toBeNull();
    expect(day?.totalMinutes).toBe(50);
    expect(day?.sessionCount).toBe(2);
    expect(day?.goals).toEqual([
      { id: 'goal-deleted', label: 'Deutsch-Abitur', minutes: 30, sessionCount: 1 },
      { id: null, label: 'Freie Session', minutes: 20, sessionCount: 1 },
    ]);
    expect(day?.subjects).toEqual([
      { id: 'subject-deleted', label: 'Deutsch', minutes: 30, sessionCount: 1 },
      { id: 'subject-missing', label: 'Gelöschtes Fach', minutes: 20, sessionCount: 1 },
    ]);
  });
});
