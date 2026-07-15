import { fallbackSubjectColor } from '@/data/initial-data';
import type { SessionSource, StudySession, Subject } from '../types/study';

const MINUTE_MS = 60_000;

export interface DateRange {
  start: Date;
  endExclusive: Date;
}

export interface DurationBreakdown {
  totalMinutes: number;
  timerMinutes: number;
  manualMinutes: number;
}

export interface PeriodStats extends DurationBreakdown {
  timerSessionCount: number;
  manualEntryCount: number;
  averageTimerSessionMinutes: number | null;
}

export interface StreakOptions {
  minimumDailyMinutes?: number;
  source?: SessionSource | 'all';
}

export interface StreakResult {
  currentDays: number;
  longestDays: number;
  lastActiveDate: string | null;
}

export interface WeeklyBucket extends PeriodStats {
  key: string;
  label: string;
  start: Date;
  endExclusive: Date;
  isCurrent: boolean;
}

export interface DayBucket extends PeriodStats {
  key: string;
  label: string;
  date: Date;
  isToday: boolean;
  isFuture: boolean;
}

export interface SubjectBreakdown extends DurationBreakdown {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  timerSessionCount: number;
  percentage: number;
}

export type WeekComparisonTrend = 'up' | 'down' | 'same' | 'new_activity';

export interface WeekComparison {
  currentMinutes: number;
  previousMinutes: number;
  differenceMinutes: number;
  percentChange: number | null;
  trend: WeekComparisonTrend;
  currentRange: DateRange;
  previousRange: DateRange;
}

function safeDurationMinutes(session: StudySession): number {
  return Number.isFinite(session.durationMinutes) ? Math.max(0, session.durationMinutes) : 0;
}

function sessionStartTime(session: StudySession): number {
  return new Date(session.startedAt).getTime();
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function roundForOutput(value: number): number {
  return Math.round(value * 10) / 10;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/** Returns Monday at 00:00 in the device's local time zone. */
export function startOfWeek(date: Date): Date {
  const result = startOfDay(date);
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

export function currentWeekRange(referenceDate: Date = new Date()): DateRange {
  const start = startOfWeek(referenceDate);
  return { start, endExclusive: addCalendarDays(start, 7) };
}

/** Sessions are attributed to the period in which their local start time lies. */
export function filterSessionsByPeriod(
  sessions: readonly StudySession[],
  start: Date,
  endExclusive: Date,
): StudySession[] {
  const startTime = start.getTime();
  const endTime = endExclusive.getTime();

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return [];
  }

  return sessions.filter((session) => {
    const timestamp = sessionStartTime(session);
    return Number.isFinite(timestamp) && timestamp >= startTime && timestamp < endTime;
  });
}

export function getDurationBreakdown(
  sessions: readonly StudySession[],
): DurationBreakdown {
  let timerMinutes = 0;
  let manualMinutes = 0;

  for (const session of sessions) {
    if (session.source === 'timer') {
      timerMinutes += safeDurationMinutes(session);
    } else {
      manualMinutes += safeDurationMinutes(session);
    }
  }

  return {
    timerMinutes: roundForOutput(timerMinutes),
    manualMinutes: roundForOutput(manualMinutes),
    totalMinutes: roundForOutput(timerMinutes + manualMinutes),
  };
}

export function getPeriodStats(sessions: readonly StudySession[]): PeriodStats {
  const breakdown = getDurationBreakdown(sessions);
  const timerSessions = sessions.filter((session) => session.source === 'timer');
  const timerMinutes = timerSessions.reduce(
    (sum, session) => sum + safeDurationMinutes(session),
    0,
  );

  return {
    ...breakdown,
    timerSessionCount: timerSessions.length,
    manualEntryCount: sessions.length - timerSessions.length,
    averageTimerSessionMinutes:
      timerSessions.length === 0 ? null : roundForOutput(timerMinutes / timerSessions.length),
  };
}

export function getTodayStats(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): PeriodStats {
  const start = startOfDay(referenceDate);
  const endExclusive = addCalendarDays(start, 1);
  return getPeriodStats(filterSessionsByPeriod(sessions, start, endExclusive));
}

export function getWeekStats(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): PeriodStats {
  const { start, endExclusive } = currentWeekRange(referenceDate);
  return getPeriodStats(filterSessionsByPeriod(sessions, start, endExclusive));
}

export function getTodayMinutes(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): number {
  return getTodayStats(sessions, referenceDate).totalMinutes;
}

export function getCurrentWeekMinutes(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): number {
  return getWeekStats(sessions, referenceDate).totalMinutes;
}

export function calculateStreak(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
  options: StreakOptions = {},
): StreakResult {
  const minimumDailyMinutes = Math.max(0, options.minimumDailyMinutes ?? 1);
  const source = options.source ?? 'all';
  const endOfToday = addCalendarDays(startOfDay(referenceDate), 1);
  const durationByDay = new Map<string, number>();

  for (const session of sessions) {
    if (source !== 'all' && session.source !== source) {
      continue;
    }

    const startedAt = new Date(session.startedAt);
    if (
      !Number.isFinite(startedAt.getTime()) ||
      startedAt > referenceDate ||
      startedAt >= endOfToday
    ) {
      continue;
    }

    const key = localDateKey(startedAt);
    durationByDay.set(key, (durationByDay.get(key) ?? 0) + safeDurationMinutes(session));
  }

  const qualifyingKeys = [...durationByDay.entries()]
    .filter(([, minutes]) => minutes >= minimumDailyMinutes)
    .map(([key]) => key)
    .sort();
  const qualifyingSet = new Set(qualifyingKeys);
  const todayKey = localDateKey(referenceDate);
  const yesterday = addCalendarDays(startOfDay(referenceDate), -1);
  let cursor = qualifyingSet.has(todayKey) ? startOfDay(referenceDate) : yesterday;
  let currentDays = 0;

  while (qualifyingSet.has(localDateKey(cursor))) {
    currentDays += 1;
    cursor = addCalendarDays(cursor, -1);
  }

  let longestDays = 0;
  let runningDays = 0;
  let previousDate: Date | null = null;

  for (const key of qualifyingKeys) {
    const date = localDateFromKey(key);
    const isConsecutive =
      previousDate !== null && localDateKey(addCalendarDays(previousDate, 1)) === key;
    runningDays = isConsecutive ? runningDays + 1 : 1;
    longestDays = Math.max(longestDays, runningDays);
    previousDate = date;
  }

  return {
    currentDays,
    longestDays,
    lastActiveDate: qualifyingKeys.at(-1) ?? null,
  };
}

export function getCurrentStreak(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
  options: StreakOptions = {},
): number {
  return calculateStreak(sessions, referenceDate, options).currentDays;
}

export function getWeeklyBuckets(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
  count = 8,
): WeeklyBucket[] {
  const safeCount = Math.max(0, Math.floor(count));
  const currentStart = startOfWeek(referenceDate);
  const formatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' });
  const buckets: WeeklyBucket[] = [];

  for (let index = safeCount - 1; index >= 0; index -= 1) {
    const start = addCalendarDays(currentStart, -index * 7);
    const endExclusive = addCalendarDays(start, 7);
    const endInclusive = addCalendarDays(endExclusive, -1);
    const stats = getPeriodStats(filterSessionsByPeriod(sessions, start, endExclusive));

    buckets.push({
      ...stats,
      key: localDateKey(start),
      label: `${formatter.format(start)}–${formatter.format(endInclusive)}`,
      start,
      endExclusive,
      isCurrent: index === 0,
    });
  }

  return buckets;
}

export function getCurrentWeekDayBuckets(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): DayBucket[] {
  const weekStart = startOfWeek(referenceDate);
  const todayKey = localDateKey(referenceDate);
  const weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

  return weekdayLabels.map((label, index) => {
    const date = addCalendarDays(weekStart, index);
    const nextDate = addCalendarDays(date, 1);

    return {
      ...getPeriodStats(filterSessionsByPeriod(sessions, date, nextDate)),
      key: localDateKey(date),
      label,
      date,
      isToday: localDateKey(date) === todayKey,
      isFuture: date > referenceDate,
    };
  });
}

export function getSubjectBreakdown(
  sessions: readonly StudySession[],
  subjects: readonly Subject[],
  range?: DateRange,
): SubjectBreakdown[] {
  const relevantSessions = range
    ? filterSessionsByPeriod(sessions, range.start, range.endExclusive)
    : [...sessions];
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const sessionsBySubject = new Map<string, StudySession[]>();

  for (const session of relevantSessions) {
    const current = sessionsBySubject.get(session.subjectId) ?? [];
    current.push(session);
    sessionsBySubject.set(session.subjectId, current);
  }

  const totalMinutes = getDurationBreakdown(relevantSessions).totalMinutes;

  return [...sessionsBySubject.entries()]
    .map(([subjectId, subjectSessions]) => {
      const subject = subjectById.get(subjectId);
      const breakdown = getDurationBreakdown(subjectSessions);

      return {
        ...breakdown,
        subjectId,
        subjectName: subject?.name ?? 'Unbekanntes Fach',
        subjectColor: subject?.color ?? fallbackSubjectColor,
        timerSessionCount: subjectSessions.filter((session) => session.source === 'timer').length,
        percentage:
          totalMinutes === 0 ? 0 : roundForOutput((breakdown.totalMinutes / totalMinutes) * 100),
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

/** Compares the elapsed part of this week with the same part of last week. */
export function compareWithPreviousWeek(
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): WeekComparison {
  const currentStart = startOfWeek(referenceDate);
  const currentEnd = new Date(referenceDate);
  const previousStart = addCalendarDays(currentStart, -7);
  const previousEnd = addCalendarDays(currentEnd, -7);
  const currentMinutes = getDurationBreakdown(
    filterSessionsByPeriod(sessions, currentStart, currentEnd),
  ).totalMinutes;
  const previousMinutes = getDurationBreakdown(
    filterSessionsByPeriod(sessions, previousStart, previousEnd),
  ).totalMinutes;
  const differenceMinutes = roundForOutput(currentMinutes - previousMinutes);

  let trend: WeekComparisonTrend;
  let percentChange: number | null;

  if (currentMinutes === previousMinutes) {
    trend = 'same';
    percentChange = 0;
  } else if (previousMinutes === 0) {
    trend = 'new_activity';
    percentChange = null;
  } else {
    trend = differenceMinutes > 0 ? 'up' : 'down';
    percentChange = roundForOutput((differenceMinutes / previousMinutes) * 100);
  }

  return {
    currentMinutes,
    previousMinutes,
    differenceMinutes,
    percentChange,
    trend,
    currentRange: { start: currentStart, endExclusive: currentEnd },
    previousRange: { start: previousStart, endExclusive: previousEnd },
  };
}

export function getActiveTimerElapsedMinutes(
  segments: readonly { startedAt: string; endedAt: string | null }[],
  referenceDate: Date = new Date(),
): number {
  const now = referenceDate.getTime();
  const elapsedMs = segments.reduce((sum, segment) => {
    const start = new Date(segment.startedAt).getTime();
    const end = segment.endedAt === null ? now : new Date(segment.endedAt).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return sum;
    }

    return sum + (end - start);
  }, 0);

  return roundForOutput(elapsedMs / MINUTE_MS);
}
