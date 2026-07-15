import type { StudySession } from '@/types/study';

export type ChartPeriod = 'week' | 'month' | 'year';

export interface ChartPoint {
  key: string;
  label: string;
  dateLabel: string;
  valueMinutes: number | null;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function mondayOf(date: Date): Date {
  const result = startOfDay(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function minutesBetween(
  sessions: readonly StudySession[],
  start: Date,
  endExclusive: Date,
): number {
  const startMs = start.getTime();
  const endMs = endExclusive.getTime();
  return sessions.reduce((total, session) => {
    const timestamp = Date.parse(session.startedAt);
    if (!Number.isFinite(timestamp) || timestamp < startMs || timestamp >= endMs) return total;
    return total + Math.max(0, session.durationMinutes);
  }, 0);
}

function localKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function buildWeekChart(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): ChartPoint[] {
  const start = mondayOf(referenceDate);
  const today = startOfDay(referenceDate);
  const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
  const formatter = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  return labels.map((label, index) => {
    const date = addDays(start, index);
    const isFuture = date > today;
    return {
      key: localKey(date),
      label,
      dateLabel: formatter.format(date),
      valueMinutes: isFuture ? null : minutesBetween(sessions, date, addDays(date, 1)),
    };
  });
}

export function buildMonthChart(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): ChartPoint[] {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const today = startOfDay(referenceDate);
  const monthFormatter = new Intl.DateTimeFormat('de-DE', { month: 'long' });
  const points: ChartPoint[] = [];

  for (let firstDay = 1; firstDay <= lastDay; firstDay += 7) {
    const finalDay = Math.min(firstDay + 6, lastDay);
    const start = new Date(year, month, firstDay);
    const endExclusive = new Date(year, month, finalDay + 1);
    points.push({
      key: `${year}-${month + 1}-${firstDay}`,
      label: firstDay === finalDay ? `${firstDay}.` : `${firstDay}–${finalDay}`,
      dateLabel: `${firstDay}. bis ${finalDay}. ${monthFormatter.format(referenceDate)}`,
      valueMinutes: start > today ? null : minutesBetween(sessions, start, endExclusive),
    });
  }

  return points;
}

export function buildYearChart(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): ChartPoint[] {
  const year = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth();
  const shortFormatter = new Intl.DateTimeFormat('de-DE', { month: 'short' });
  const longFormatter = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

  return Array.from({ length: 12 }, (_, month) => {
    const start = new Date(year, month, 1);
    const endExclusive = new Date(year, month + 1, 1);
    return {
      key: `${year}-${month + 1}`,
      label: shortFormatter.format(start).replace('.', ''),
      dateLabel: longFormatter.format(start),
      valueMinutes: month > currentMonth ? null : minutesBetween(sessions, start, endExclusive),
    };
  });
}

export function buildChartSeries(
  sessions: readonly StudySession[],
  period: ChartPeriod,
  referenceDate: Date = new Date(),
): ChartPoint[] {
  if (period === 'month') return buildMonthChart(sessions, referenceDate);
  if (period === 'year') return buildYearChart(sessions, referenceDate);
  return buildWeekChart(sessions, referenceDate);
}

