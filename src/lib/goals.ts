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

const periodLabels: Record<GoalPeriod, string> = {
  week: 'Woche',
  month: 'Monat',
  year: 'Jahr',
};

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

function subjectLabel(goal: StudyGoal, subjects: readonly Subject[]): string {
  if (goal.subjectIds?.length !== 1) return '';
  const subject = subjects.find((entry) => entry.id === goal.subjectIds?.[0]);
  return subject ? ` ${subject.name}` : '';
}

/** Builds the generated part only, independent of a possibly custom title. */
export function createAutomaticGoalTitle(
  goal: StudyGoal,
  subjects: readonly Subject[] = [],
): string {
  const subject = subjectLabel(goal, subjects);
  const period = periodLabels[goal.period];

  if (goal.type === 'duration') {
    const minutes = Math.max(0, Math.round(goal.targetMinutes));
    return `${minutes} Minuten${subject} pro ${period}`;
  }

  const sessions = Math.max(0, Math.round(goal.targetSessions));
  const unit = sessions === 1 ? 'Session' : 'Sessions';
  return `${sessions} ${unit}${subject} pro ${period}`;
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
): GoalPeriodRange {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);

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

  start.setMonth(0, 1);
  return {
    start,
    endExclusive: new Date(start.getFullYear() + 1, 0, 1),
  };
}

/**
 * Canonical goal calculation used by every screen. Sessions must match the
 * calendar period, explicit goal start, selected subjects and source policy.
 */
export function evaluateGoal(
  goal: StudyGoal,
  sessions: readonly StudySession[],
  referenceDate: Date = new Date(),
): GoalEvaluation {
  const range = getGoalPeriodRange(goal.period, periodReference(goal, referenceDate));
  const configuredStart =
    validDate(goal.startsAt) ?? validDate(goal.createdAt) ?? range.start;
  const countedFrom = new Date(
    Math.max(range.start.getTime(), configuredStart.getTime()),
  );
  const statusEnd = lifecycleEnd(goal);
  const countedUntilTime = Math.min(
    range.endExclusive.getTime(),
    referenceDate.getTime() + 1,
    statusEnd?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  const countedUntil = new Date(Math.max(countedFrom.getTime(), countedUntilTime));
  const subjectIds = goal.subjectIds ? new Set(goal.subjectIds) : null;
  const pausedIntervals = (goal.pausedIntervals ?? []).flatMap((interval) => {
    const start = validDate(interval.startedAt);
    const end = validDate(interval.endedAt);
    return start && end && end > start
      ? [{ start: start.getTime(), end: end.getTime() }]
      : [];
  });

  const matchingSessions = sessions.filter((session) => {
    const startedAt = new Date(session.startedAt).getTime();
    if (!Number.isFinite(startedAt)) return false;
    if (startedAt < countedFrom.getTime() || startedAt >= countedUntilTime) return false;
    if (pausedIntervals.some((interval) => startedAt >= interval.start && startedAt < interval.end)) {
      return false;
    }
    if (subjectIds && !subjectIds.has(session.subjectId)) return false;
    if (goal.sourcePolicy === 'timer_only' && session.source !== 'timer') return false;
    if (!Number.isFinite(session.durationMinutes) || session.durationMinutes < 0) return false;
    return goal.type === 'duration' || session.durationMinutes >= goal.minimumSessionMinutes;
  });

  const current = goal.type === 'duration'
    ? round(
        matchingSessions.reduce(
          (sum, session) => sum + Math.max(0, session.durationMinutes),
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
