import { getSessionMinutesWithinRange } from '@/lib/activity';
import type {
  GoalPeriod,
  StudyGoal,
  StudySession,
  Subject,
} from '@/types/study';

export interface GoalPeriodRange {
  start: Date;
  endExclusive: Date;
}

export interface GoalEvaluation {
  /** Minutes for duration goals, number of entries for session goals. */
  current: number;
  /** Alias that is convenient for progress components. */
  currentValue: number;
  /** Minutes for duration goals, number of entries for session goals. */
  target: number;
  /** Alias that is convenient for progress components. */
  targetValue: number;
  remaining: number;
  /** A value between zero and one. */
  progress: number;
  progressPercent: number;
  achieved: boolean;
  matchingSessionCount: number;
  matchingSessions: readonly StudySession[];
  periodStart: Date;
  periodEndExclusive: Date;
  countedFrom: Date;
  countedUntil: Date;
}

function periodTitleSuffix(period: GoalPeriod): string {
  switch (period as string) {
    case 'day':
    case 'daily':
      return 'pro Tag';
    case 'week':
      return 'pro Woche';
    case 'month':
      return 'pro Monat';
    case 'year':
      return 'pro Jahr';
    case 'custom':
      return 'im Zeitraum';
    default:
      return 'im Zeitraum';
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function targetForGoal(goal: StudyGoal): number {
  return goal.type === 'duration'
    ? Math.max(0, goal.targetMinutes)
    : Math.max(0, goal.targetSessions);
}

function lifecycleEnd(goal: StudyGoal): Date | null {
  if (goal.status === 'paused') return validDate(goal.pausedAt);
  if (goal.status === 'completed') return validDate(goal.completedAt);
  if (goal.status === 'archived') {
    const lifecycleDates = [goal.pausedAt, goal.completedAt, goal.archivedAt]
      .map(validDate)
      .filter((date): date is Date => date !== null);
    if (lifecycleDates.length === 0) return null;
    return new Date(Math.min(...lifecycleDates.map((date) => date.getTime())));
  }
  return null;
}

function periodReference(goal: StudyGoal, requestedReference: Date): Date {
  if (goal.status === 'completed') {
    return validDate(goal.completedAt) ?? requestedReference;
  }
  if (goal.status === 'archived') {
    return validDate(goal.completedAt)
      ?? validDate(goal.archivedAt)
      ?? validDate(goal.pausedAt)
      ?? requestedReference;
  }
  return requestedReference;
}

/** Returns the canonical subject, or the only legacy subject, without guessing. */
export function getGoalSubjectId(goal: StudyGoal): string | null {
  const canonical = goal.subjectId?.trim();
  if (canonical) return canonical;
  const legacyIds = [...new Set((goal.subjectIds ?? []).map((id) => id.trim()).filter(Boolean))];
  return legacyIds.length === 1 ? legacyIds[0] : null;
}

function subjectLabel(goal: StudyGoal, subjects: readonly Subject[]): string {
  const subjectId = getGoalSubjectId(goal);
  if (!subjectId) return '';
  const subject = subjects.find((entry) => entry.id === subjectId);
  return subject ? ` ${subject.name}` : '';
}

/** Builds the generated part only, independent of a possibly custom title. */
export function createAutomaticGoalTitle(
  goal: StudyGoal,
  subjects: readonly Subject[] = [],
): string {
  const subject = subjectLabel(goal, subjects);
  const period = periodTitleSuffix(goal.period);

  if (goal.type === 'duration') {
    const minutes = Math.max(0, Math.round(goal.targetMinutes));
    return `${minutes} Minuten${subject} ${period}`;
  }

  const sessions = Math.max(0, Math.round(goal.targetSessions));
  const unit = sessions === 1 ? 'Session' : 'Sessions';
  return `${sessions} ${unit}${subject} ${period}`;
}

/** Returns the custom title or the single canonical generated title. */
export function getGoalTitle(
  goal: StudyGoal,
  subjects: readonly Subject[] = [],
): string {
  const customTitle = goal.title?.trim();
  return customTitle || createAutomaticGoalTitle(goal, subjects);
}

/** Alias used by display-focused call sites. */
export const getGoalDisplayTitle = getGoalTitle;

export function getGoalPeriodRange(
  period: GoalPeriod,
  referenceDate: Date = new Date(),
  customRange?: Readonly<{ startsAt?: string; endsAt?: string }>,
): GoalPeriodRange {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);

  if ((period as string) === 'day' || (period as string) === 'daily') {
    return { start, endExclusive: addDays(start, 1) };
  }

  if (period === 'week') {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    return { start, endExclusive: addDays(start, 7) };
  }

  if (period === 'month') {
    start.setDate(1);
    return {
      start,
      endExclusive: new Date(start.getFullYear(), start.getMonth() + 1, 1),
    };
  }

  if (period === 'year') {
    start.setMonth(0, 1);
    return {
      start,
      endExclusive: new Date(start.getFullYear() + 1, 0, 1),
    };
  }

  const customStart = validDate(customRange?.startsAt) ?? start;
  const configuredEnd = validDate(customRange?.endsAt);
  const fallbackEnd = addDays(start, 1);
  const endExclusive = configuredEnd && configuredEnd > customStart
    ? configuredEnd
    : fallbackEnd > customStart
      ? fallbackEnd
      : new Date(customStart.getTime() + 1);

  return { start: customStart, endExclusive };
}

/**
 * Canonical goal calculation used by every screen. A session contributes only
 * when it carries this exact goal ID. Subject equality is deliberately not a
 * fallback: free and legacy sessions must never increase a goal implicitly.
 */
export function evaluateGoal(
  goal: StudyGoal,
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): GoalEvaluation {
  const range = getGoalPeriodRange(
    goal.period,
    periodReference(goal, referenceDate),
    {
      startsAt: goal.startsAt ?? goal.createdAt,
      endsAt: goal.endsAt,
    },
  );
  const configuredStart =
    validDate(goal.startsAt) ?? validDate(goal.createdAt) ?? range.start;
  const countedFrom = new Date(
    Math.max(range.start.getTime(), configuredStart.getTime()),
  );
  const statusEnd = lifecycleEnd(goal);
  const configuredEnd = validDate(goal.endsAt);
  const countedUntilTime = Math.min(
    range.endExclusive.getTime(),
    referenceDate.getTime() + 1,
    statusEnd?.getTime() ?? Number.POSITIVE_INFINITY,
    configuredEnd?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  const countedUntil = new Date(Math.max(countedFrom.getTime(), countedUntilTime));
  const pausedIntervals = (goal.pausedIntervals ?? []).flatMap((interval) => {
    const start = validDate(interval.startedAt);
    const end = validDate(interval.endedAt);
    return start && end && end > start
      ? [{ start: start.getTime(), end: end.getTime() }]
      : [];
  });

  const seenSessionIds = new Set<string>();
  const durationContributions = new Map<string, number>();
  const matchingSessions = sessions.filter((session) => {
    if (!session.id.trim() || seenSessionIds.has(session.id)) return false;
    seenSessionIds.add(session.id);
    if (session.goalId !== goal.id) return false;
    if (session.userId !== goal.userId) return false;
    const sessionStatus = (session as StudySession & { status?: string }).status;
    if (sessionStatus && sessionStatus !== 'completed') return false;
    const startedAt = new Date(session.startedAt).getTime();
    const endedAt = new Date(session.endedAt).getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || startedAt >= endedAt) return false;
    if (goal.sourcePolicy === 'timer_only' && session.source !== 'timer') return false;
    if (!Number.isFinite(session.durationMinutes) || session.durationMinutes < 0) return false;

    if (goal.type === 'sessions') {
      if (startedAt < countedFrom.getTime() || startedAt >= countedUntilTime) return false;
      if (pausedIntervals.some((interval) => startedAt >= interval.start && startedAt < interval.end)) {
        return false;
      }
      return session.durationMinutes >= goal.minimumSessionMinutes;
    }

    let contribution = getSessionMinutesWithinRange(session, countedFrom, countedUntil);
    for (const interval of pausedIntervals) {
      const pauseStart = new Date(Math.max(interval.start, countedFrom.getTime()));
      const pauseEnd = new Date(Math.min(interval.end, countedUntil.getTime()));
      if (pauseStart < pauseEnd) {
        contribution -= getSessionMinutesWithinRange(session, pauseStart, pauseEnd);
      }
    }
    contribution = Math.max(0, contribution);
    if (contribution <= 0) return false;
    durationContributions.set(session.id, contribution);
    return true;
  });

  const current = goal.type === 'duration'
    ? round(
        matchingSessions.reduce(
          (sum, session) => sum + (durationContributions.get(session.id) ?? 0),
          0,
        ),
      )
    : matchingSessions.length;
  const target = targetForGoal(goal);
  const progress = target === 0 ? (current > 0 ? 1 : 0) : Math.min(1, current / target);

  return {
    current,
    currentValue: current,
    target,
    targetValue: target,
    remaining: round(Math.max(0, target - current)),
    progress,
    progressPercent: round(progress * 100),
    achieved: target > 0 && current >= target,
    matchingSessionCount: matchingSessions.length,
    matchingSessions,
    periodStart: range.start,
    periodEndExclusive: range.endExclusive,
    countedFrom,
    countedUntil,
  };
}

/** Alias retained for call sites that describe the result as progress. */
export const getGoalProgress = evaluateGoal;
