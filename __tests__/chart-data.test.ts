import {
  buildChartSeries,
  buildMonthChart,
  buildWeekChart,
  buildYearChart,
} from '@/lib/chart-data';
import type { StudySession } from '@/types/study';

function timerSession(
  id: string,
  date: Date,
  durationMinutes: number,
): StudySession {
  const startedAt = date.toISOString();
  const endedAt = new Date(date.getTime() + durationMinutes * 60_000).toISOString();
  return {
    id,
    userId: 'user-1',
    subjectId: 'math',
    source: 'timer',
    startedAt,
    endedAt,
    durationMinutes,
    createdAt: endedAt,
    segments: [{ startedAt, endedAt }],
  };
}

describe('chart data', () => {
  it('builds a seven-day week with empty past values and null future values', () => {
    const reference = new Date(2026, 6, 8, 12);
    const points = buildWeekChart([], reference);

    expect(points).toHaveLength(7);
    expect(points.map((point) => point.label)).toEqual([
      'Mo',
      'Di',
      'Mi',
      'Do',
      'Fr',
      'Sa',
      'So',
    ]);
    expect(points.map((point) => point.valueMinutes)).toEqual([
      0,
      0,
      0,
      null,
      null,
      null,
      null,
    ]);
  });

  it('places real sessions on their week days and ignores a future day', () => {
    const reference = new Date(2026, 6, 8, 12);
    const sessions = [
      timerSession('tuesday', new Date(2026, 6, 7, 10), 35),
      timerSession('wednesday', new Date(2026, 6, 8, 9), 25),
      timerSession('future-friday', new Date(2026, 6, 10, 9), 90),
    ];

    const points = buildWeekChart(sessions, reference);

    expect(points.map((point) => point.valueMinutes)).toEqual([
      0,
      35,
      25,
      null,
      null,
      null,
      null,
    ]);
  });

  it('groups a month into seven-day ranges and leaves later ranges null', () => {
    const reference = new Date(2026, 6, 10, 12);
    const sessions = [
      timerSession('first-range', new Date(2026, 6, 3, 10), 20),
      timerSession('current-range', new Date(2026, 6, 9, 10), 45),
    ];

    const points = buildMonthChart(sessions, reference);

    expect(points).toHaveLength(5);
    expect(points.map((point) => point.label)).toEqual([
      '1–7',
      '8–14',
      '15–21',
      '22–28',
      '29–31',
    ]);
    expect(points.map((point) => point.valueMinutes)).toEqual([
      20,
      45,
      null,
      null,
      null,
    ]);
  });

  it('builds all twelve months and marks months after the reference as future', () => {
    const reference = new Date(2026, 6, 10, 12);
    const sessions = [
      timerSession('january', new Date(2026, 0, 12, 10), 30),
      timerSession('july', new Date(2026, 6, 8, 10), 50),
    ];

    const points = buildYearChart(sessions, reference);

    expect(points).toHaveLength(12);
    expect(points[0].valueMinutes).toBe(30);
    expect(points[6].valueMinutes).toBe(50);
    expect(points.slice(7).every((point) => point.valueMinutes === null)).toBe(
      true,
    );
  });

  it.each(['week', 'month', 'year'] as const)(
    'dispatches the %s series through the shared builder',
    (period) => {
      const reference = new Date(2026, 6, 10, 12);
      const expected =
        period === 'week'
          ? buildWeekChart([], reference)
          : period === 'month'
            ? buildMonthChart([], reference)
            : buildYearChart([], reference);

      expect(buildChartSeries([], period, reference)).toEqual(expected);
    },
  );
});
