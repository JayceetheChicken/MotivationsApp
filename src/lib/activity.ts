export const ACTIVITY_LEVEL_THRESHOLDS = [0, 15, 30, 60, 120] as const;

export type ActivityLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type ActivityLevelThresholds = readonly [number, number, number, number, number];

export interface ActivityTimerSegmentInput {
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/**
 * Structural input used by the activity helpers. It deliberately accepts both
 * the current session model and completed legacy records without requiring a
 * second persisted model.
 */
export interface ActivitySessionInput {
  readonly id: string;
  readonly userId: string;
  readonly subjectId?: string | null;
  readonly goalId?: string | null;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMinutes?: number;
  readonly durationSeconds?: number;
  readonly source?: string;
  readonly status?: string | null;
  readonly segments?: readonly ActivityTimerSegmentInput[];
  readonly goalTitleSnapshot?: string;
  readonly subjectNameSnapshot?: string;
}

export interface ActivitySubjectInput {
  readonly id: string;
  readonly name: string;
}

export interface ActivityGoalInput {
  readonly id: string;
  readonly title?: string;
}

export interface ActivityBreakdownItem {
  readonly id: string | null;
  readonly label: string;
  readonly minutes: number;
  readonly sessionCount: number;
}

export interface ActivityDayDetail {
  readonly date: Date;
  readonly dateKey: string;
  readonly totalMinutes: number;
  readonly sessionCount: number;
  readonly subjects: readonly ActivityBreakdownItem[];
  readonly goals: readonly ActivityBreakdownItem[];
}

export interface ActivityHeatmapDay extends ActivityDayDetail {
  readonly level: ActivityLevel;
  readonly isInRange: boolean;
  readonly isToday: boolean;
  readonly isFuture: boolean;
}

export interface ActivityHeatmapWeek {
  readonly key: string;
  /** Always Monday through Sunday. */
  readonly days: readonly ActivityHeatmapDay[];
}

export interface ActivityMonthLabel {
  readonly key: string;
  readonly label: string;
  readonly weekIndex: number;
}

export interface ActivityHeatmapData {
  /** First active calendar day: clamped reference date minus 12 months, plus one day. */
  readonly rangeStart: Date;
  /** Last active calendar day; always the local reference day. */
  readonly rangeEnd: Date;
  readonly weeks: readonly ActivityHeatmapWeek[];
  readonly monthLabels: readonly ActivityMonthLabel[];
  readonly thresholds: ActivityLevelThresholds;
}

export interface ActivitySummary {
  readonly todayMinutes: number;
  readonly lastSevenDaysMinutes: number;
  readonly currentMonthMinutes: number;
}

export type ActivityComparisonTrend = 'positive' | 'negative' | 'neutral' | 'new';

export interface ActivityPeriodComparison {
  readonly currentMinutes: number;
  readonly previousMinutes: number;
  /** `null` represents new activity after a zero-minute comparison period. */
  readonly percentChange: number | null;
  readonly trend: ActivityComparisonTrend;
}

export interface ActivitySummaryComparisons {
  readonly today: ActivityPeriodComparison;
  readonly lastSevenDays: ActivityPeriodComparison;
  readonly currentMonth: ActivityPeriodComparison;
}

export interface ActivityOverview {
  readonly summary: ActivitySummary;
  readonly comparisons: ActivitySummaryComparisons;
}

export interface ActivityCalculationOptions {
  readonly userId: string;
  readonly referenceDate?: Date;
}

export interface BuildActivityHeatmapOptions extends ActivityCalculationOptions {
  readonly subjects?: readonly ActivitySubjectInput[];
  readonly goals?: readonly ActivityGoalInput[];
  readonly thresholds?: ActivityLevelThresholds;
  readonly locale?: string;
}

export interface ActivityDateRange {
  readonly start: Date;
  readonly end: Date;
}

export interface ActivityDayAllocation {
  readonly date: Date;
  readonly dateKey: string;
  readonly minutes: number;
}

type MillisecondInterval = {
  start: number;
  end: number;
};

type MutableBreakdown = {
  id: string | null;
  label: string;
  minutes: number;
  sessionIds: Set<string>;
};

type MutableActivityDay = {
  date: Date;
  minutes: number;
  sessionIds: Set<string>;
  subjects: Map<string, MutableBreakdown>;
  goals: Map<string, MutableBreakdown>;
};

const MINUTE_IN_MILLISECONDS = 60_000;

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, numberOfDays: number): Date {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() + numberOfDays);
  return result;
}

export function toLocalDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function mondayOf(date: Date): Date {
  return addLocalDays(date, -((date.getDay() + 6) % 7));
}

function sundayOf(date: Date): Date {
  return addLocalDays(mondayOf(date), 6);
}

function compareLocalDays(left: Date, right: Date): number {
  return toLocalDateKey(left).localeCompare(toLocalDateKey(right));
}

function differenceInCalendarDays(later: Date, earlier: Date): number {
  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterUtc - earlierUtc) / 86_400_000);
}

function subtractMonthsClamped(date: Date, numberOfMonths: number): Date {
  const source = startOfLocalDay(date);
  const targetMonthStart = new Date(source.getFullYear(), source.getMonth() - numberOfMonths, 1);
  const lastTargetDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate();

  return new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(source.getDate(), lastTargetDay),
  );
}

/**
 * Returns exactly the trailing 12 calendar months through the local reference
 * day, inclusive. Example: 14 July 2026 produces 15 July 2025 through
 * 14 July 2026. A leap-day reference clamps to 28 February in a non-leap year
 * before advancing one day.
 */
export function getTwelveMonthActivityRange(referenceDate: Date = new Date()): ActivityDateRange {
  const end = startOfLocalDay(referenceDate);
  const start = addLocalDays(subtractMonthsClamped(end, 12), 1);
  return { start, end };
}

function assertThresholds(thresholds: ActivityLevelThresholds): void {
  if (
    thresholds.some((threshold) => !Number.isFinite(threshold) || threshold < 0) ||
    thresholds.some((threshold, index) => index > 0 && threshold <= thresholds[index - 1])
  ) {
    throw new RangeError('Aktivitätsgrenzen müssen endlich, nicht negativ und aufsteigend sein.');
  }
}

export function getActivityLevel(
  minutes: number,
  thresholds: ActivityLevelThresholds = ACTIVITY_LEVEL_THRESHOLDS,
): ActivityLevel {
  assertThresholds(thresholds);

  if (!Number.isFinite(minutes) || minutes <= thresholds[0]) return 0;
  if (minutes <= thresholds[1]) return 1;
  if (minutes <= thresholds[2]) return 2;
  if (minutes <= thresholds[3]) return 3;
  if (minutes <= thresholds[4]) return 4;
  return 5;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getStoredDurationMilliseconds(session: ActivitySessionInput): number | null {
  if (Number.isFinite(session.durationSeconds)) {
    return Math.max(0, session.durationSeconds ?? 0) * 1_000;
  }

  if (Number.isFinite(session.durationMinutes)) {
    return Math.max(0, session.durationMinutes ?? 0) * MINUTE_IN_MILLISECONDS;
  }

  return null;
}

function isCompletedOrLegacy(session: ActivitySessionInput): boolean {
  return session.status == null || session.status === 'completed';
}

function isValidSessionForUser(
  session: ActivitySessionInput,
  userId: string,
  referenceTimestamp: number,
): boolean {
  const startedAt = parseTimestamp(session.startedAt);
  const endedAt = parseTimestamp(session.endedAt);
  const duration = getStoredDurationMilliseconds(session);

  return Boolean(
    typeof session.id === 'string' &&
      session.id.trim() &&
      userId &&
      session.userId === userId &&
      isCompletedOrLegacy(session) &&
      startedAt !== null &&
      endedAt !== null &&
      startedAt < endedAt &&
      startedAt < referenceTimestamp &&
      duration !== null &&
      duration > 0,
  );
}

/**
 * Filters invalid, unfinished, foreign and future sessions. Repeated IDs are
 * intentionally kept only once so a restored session cannot inflate totals.
 */
export function filterValidActivitySessions(
  sessions: readonly ActivitySessionInput[],
  options: ActivityCalculationOptions,
): ActivitySessionInput[] {
  const referenceDate = options.referenceDate ?? new Date();
  const referenceTimestamp = referenceDate.getTime();
  if (!Number.isFinite(referenceTimestamp)) return [];

  const seenIds = new Set<string>();
  return sessions.filter((session) => {
    if (
      seenIds.has(session.id) ||
      !isValidSessionForUser(session, options.userId, referenceTimestamp)
    ) {
      return false;
    }

    seenIds.add(session.id);
    return true;
  });
}

function mergeIntervals(intervals: readonly MillisecondInterval[]): MillisecondInterval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const merged: MillisecondInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }

  return merged;
}

function getSessionIntervals(session: ActivitySessionInput): MillisecondInterval[] {
  const sessionStart = parseTimestamp(session.startedAt);
  const sessionEnd = parseTimestamp(session.endedAt);
  if (sessionStart === null || sessionEnd === null || sessionStart >= sessionEnd) return [];

  const segmentIntervals = (session.segments ?? []).flatMap((segment) => {
    const segmentStart = parseTimestamp(segment.startedAt);
    const segmentEnd = parseTimestamp(segment.endedAt);
    if (segmentStart === null || segmentEnd === null) return [];

    const start = Math.max(sessionStart, segmentStart);
    const end = Math.min(sessionEnd, segmentEnd);
    return start < end ? [{ start, end }] : [];
  });

  return mergeIntervals(
    segmentIntervals.length > 0
      ? segmentIntervals
      : [{ start: sessionStart, end: sessionEnd }],
  );
}

/**
 * Returns the stored learning minutes that overlap an arbitrary time range.
 * Timer pauses are respected through persisted segments. When stored and
 * elapsed duration differ, the stored duration stays authoritative and is
 * distributed proportionally over those active intervals.
 */
export function getSessionMinutesWithinRange(
  session: ActivitySessionInput,
  rangeStart: Date,
  rangeEndExclusive: Date,
): number {
  const start = rangeStart.getTime();
  const end = rangeEndExclusive.getTime();
  const storedDuration = getStoredDurationMilliseconds(session);
  const intervals = getSessionIntervals(session);
  const intervalDuration = intervals.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    storedDuration === null ||
    storedDuration <= 0 ||
    intervalDuration <= 0
  ) {
    return 0;
  }

  const overlapDuration = intervals.reduce((sum, interval) => {
    const overlapStart = Math.max(interval.start, start);
    const overlapEnd = Math.min(interval.end, end);
    return sum + Math.max(0, overlapEnd - overlapStart);
  }, 0);

  return (overlapDuration * storedDuration) /
    intervalDuration /
    MINUTE_IN_MILLISECONDS;
}

/**
 * Splits one completed session at local midnights. Stored duration remains the
 * source of truth; timer segments distribute it over active intervals and are
 * merged first to prevent overlap from being counted twice. Future portions
 * are clipped at the reference instant.
 */
export function splitSessionAcrossLocalDays(
  session: ActivitySessionInput,
  referenceDate: Date = new Date(),
): ActivityDayAllocation[] {
  const referenceTimestamp = referenceDate.getTime();
  const storedDuration = getStoredDurationMilliseconds(session);
  const intervals = getSessionIntervals(session);
  const intervalDuration = intervals.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );

  if (
    !Number.isFinite(referenceTimestamp) ||
    storedDuration === null ||
    storedDuration <= 0 ||
    intervalDuration <= 0
  ) {
    return [];
  }

  const durationScale = storedDuration / intervalDuration;
  const allocations = new Map<string, { date: Date; milliseconds: number }>();

  for (const interval of intervals) {
    const clippedEnd = Math.min(interval.end, referenceTimestamp);
    if (interval.start >= clippedEnd) continue;

    let cursor = interval.start;
    while (cursor < clippedEnd) {
      const day = startOfLocalDay(new Date(cursor));
      const nextDayTimestamp = addLocalDays(day, 1).getTime();
      const partEnd = Math.min(clippedEnd, nextDayTimestamp);
      const dateKey = toLocalDateKey(day);
      const current = allocations.get(dateKey) ?? { date: day, milliseconds: 0 };
      current.milliseconds += (partEnd - cursor) * durationScale;
      allocations.set(dateKey, current);
      cursor = partEnd;
    }
  }

  return [...allocations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, allocation]) => ({
      date: allocation.date,
      dateKey,
      minutes: allocation.milliseconds / MINUTE_IN_MILLISECONDS,
    }));
}

function cleanLabel(value: string | undefined): string | null {
  const label = value?.trim();
  return label ? label : null;
}

function addBreakdownMinutes(
  map: Map<string, MutableBreakdown>,
  key: string,
  id: string | null,
  label: string,
  minutes: number,
  sessionId: string,
): void {
  const breakdown = map.get(key) ?? {
    id,
    label,
    minutes: 0,
    sessionIds: new Set<string>(),
  };
  breakdown.minutes += minutes;
  breakdown.sessionIds.add(sessionId);
  map.set(key, breakdown);
}

function buildActivityDays(
  sessions: readonly ActivitySessionInput[],
  options: BuildActivityHeatmapOptions,
): Map<string, MutableActivityDay> {
  const referenceDate = options.referenceDate ?? new Date();
  const subjects = new Map((options.subjects ?? []).map((subject) => [subject.id, subject.name]));
  const goals = new Map((options.goals ?? []).map((goal) => [goal.id, goal.title]));
  const activityDays = new Map<string, MutableActivityDay>();

  for (const session of filterValidActivitySessions(sessions, { ...options, referenceDate })) {
    const subjectId = cleanLabel(session.subjectId ?? undefined);
    const subjectLabel =
      cleanLabel(session.subjectNameSnapshot) ??
      (subjectId ? cleanLabel(subjects.get(subjectId)) : null) ??
      (subjectId ? 'Gelöschtes Fach' : 'Unbekanntes Fach');
    const goalId = cleanLabel(session.goalId ?? undefined);
    const goalLabel = goalId
      ? cleanLabel(session.goalTitleSnapshot) ??
        cleanLabel(goals.get(goalId)) ??
        'Gelöschtes Lernziel'
      : 'Freie Session';

    for (const allocation of splitSessionAcrossLocalDays(session, referenceDate)) {
      const day = activityDays.get(allocation.dateKey) ?? {
        date: allocation.date,
        minutes: 0,
        sessionIds: new Set<string>(),
        subjects: new Map<string, MutableBreakdown>(),
        goals: new Map<string, MutableBreakdown>(),
      };
      day.minutes += allocation.minutes;
      day.sessionIds.add(session.id);
      addBreakdownMinutes(
        day.subjects,
        `subject:${subjectId ?? 'unknown'}`,
        subjectId,
        subjectLabel,
        allocation.minutes,
        session.id,
      );
      addBreakdownMinutes(
        day.goals,
        `goal:${goalId ?? 'free'}`,
        goalId,
        goalLabel,
        allocation.minutes,
        session.id,
      );
      activityDays.set(allocation.dateKey, day);
    }
  }

  return activityDays;
}

function toBreakdownItems(map: Map<string, MutableBreakdown>): ActivityBreakdownItem[] {
  return [...map.values()]
    .map((item) => ({
      id: item.id,
      label: item.label,
      minutes: item.minutes,
      sessionCount: item.sessionIds.size,
    }))
    .sort((left, right) => right.minutes - left.minutes || left.label.localeCompare(right.label));
}

function toDayDetail(date: Date, day?: MutableActivityDay): ActivityDayDetail {
  return {
    date,
    dateKey: toLocalDateKey(date),
    totalMinutes: day?.minutes ?? 0,
    sessionCount: day?.sessionIds.size ?? 0,
    subjects: day ? toBreakdownItems(day.subjects) : [],
    goals: day ? toBreakdownItems(day.goals) : [],
  };
}

function sumActivityDays(
  activityDays: Map<string, MutableActivityDay>,
  start: Date,
  endInclusive: Date,
): number {
  let total = 0;
  for (let date = startOfLocalDay(start); compareLocalDays(date, endInclusive) <= 0; date = addLocalDays(date, 1)) {
    total += activityDays.get(toLocalDateKey(date))?.minutes ?? 0;
  }
  return total;
}

export function calculateActivitySummary(
  sessions: readonly ActivitySessionInput[],
  options: ActivityCalculationOptions,
): ActivitySummary {
  return calculateActivityOverview(sessions, options).summary;
}

export function calculateActivityChange(
  currentMinutes: number,
  previousMinutes: number,
): ActivityPeriodComparison {
  const current = Number.isFinite(currentMinutes) ? Math.max(0, currentMinutes) : 0;
  const previous = Number.isFinite(previousMinutes) ? Math.max(0, previousMinutes) : 0;

  if (previous === 0) {
    return {
      currentMinutes: current,
      previousMinutes: previous,
      percentChange: current > 0 ? null : 0,
      trend: current > 0 ? 'new' : 'neutral',
    };
  }

  const percentChange = Math.round(((current - previous) / previous) * 100);
  return {
    currentMinutes: current,
    previousMinutes: previous,
    percentChange,
    trend: percentChange > 0 ? 'positive' : percentChange < 0 ? 'negative' : 'neutral',
  };
}

/**
 * Calculates the current dashboard periods and their preceding local calendar
 * periods in one pass over the stored sessions.
 */
export function calculateActivityOverview(
  sessions: readonly ActivitySessionInput[],
  options: ActivityCalculationOptions,
): ActivityOverview {
  const referenceDate = options.referenceDate ?? new Date();
  const today = startOfLocalDay(referenceDate);
  const activityDays = buildActivityDays(sessions, { ...options, referenceDate });
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonthEnd = addLocalDays(currentMonthStart, -1);
  const summary: ActivitySummary = {
    todayMinutes: activityDays.get(toLocalDateKey(today))?.minutes ?? 0,
    lastSevenDaysMinutes: sumActivityDays(activityDays, addLocalDays(today, -6), today),
    currentMonthMinutes: sumActivityDays(activityDays, currentMonthStart, today),
  };

  return {
    summary,
    comparisons: {
      today: calculateActivityChange(
        summary.todayMinutes,
        activityDays.get(toLocalDateKey(addLocalDays(today, -1)))?.minutes ?? 0,
      ),
      lastSevenDays: calculateActivityChange(
        summary.lastSevenDaysMinutes,
        sumActivityDays(activityDays, addLocalDays(today, -13), addLocalDays(today, -7)),
      ),
      currentMonth: calculateActivityChange(
        summary.currentMonthMinutes,
        sumActivityDays(activityDays, previousMonthStart, previousMonthEnd),
      ),
    },
  };
}

function buildMonthLabels(
  rangeStart: Date,
  rangeEnd: Date,
  gridStart: Date,
  locale: string,
): ActivityMonthLabel[] {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short' });
  const labels: ActivityMonthLabel[] = [];
  let month = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);

  while (compareLocalDays(month, rangeEnd) <= 0) {
    const visibleMonthStart = compareLocalDays(month, rangeStart) < 0 ? rangeStart : month;
    labels.push({
      key: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
      label: formatter.format(month).replace('.', ''),
      weekIndex: Math.floor(differenceInCalendarDays(visibleMonthStart, gridStart) / 7),
    });
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  }

  return labels;
}

export function buildActivityHeatmap(
  sessions: readonly ActivitySessionInput[],
  options: BuildActivityHeatmapOptions,
): ActivityHeatmapData {
  const referenceDate = options.referenceDate ?? new Date();
  const today = startOfLocalDay(referenceDate);
  const thresholds = options.thresholds ?? ACTIVITY_LEVEL_THRESHOLDS;
  assertThresholds(thresholds);

  const range = getTwelveMonthActivityRange(referenceDate);
  const gridStart = mondayOf(range.start);
  const gridEnd = sundayOf(range.end);
  const activityDays = buildActivityDays(sessions, { ...options, referenceDate });
  const weeks: ActivityHeatmapWeek[] = [];

  for (let weekStart = gridStart; compareLocalDays(weekStart, gridEnd) <= 0; weekStart = addLocalDays(weekStart, 7)) {
    const days = Array.from({ length: 7 }, (_, dayIndex): ActivityHeatmapDay => {
      const date = addLocalDays(weekStart, dayIndex);
      const dateKey = toLocalDateKey(date);
      const isInRange = compareLocalDays(date, range.start) >= 0 && compareLocalDays(date, range.end) <= 0;
      const detail = toDayDetail(date, isInRange ? activityDays.get(dateKey) : undefined);

      return {
        ...detail,
        level: isInRange ? getActivityLevel(detail.totalMinutes, thresholds) : 0,
        isInRange,
        isToday: compareLocalDays(date, today) === 0,
        isFuture: compareLocalDays(date, today) > 0,
      };
    });

    weeks.push({ key: toLocalDateKey(weekStart), days });
  }

  return {
    rangeStart: range.start,
    rangeEnd: range.end,
    weeks,
    monthLabels: buildMonthLabels(range.start, range.end, gridStart, options.locale ?? 'de-DE'),
    thresholds,
  };
}

export function findActivityDay(
  heatmap: ActivityHeatmapData,
  dateKey: string,
): ActivityHeatmapDay | null {
  for (const week of heatmap.weeks) {
    const day = week.days.find((candidate) => candidate.dateKey === dateKey);
    if (day?.isInRange) return day;
  }
  return null;
}
