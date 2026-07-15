import type {
  ActiveTimer,
  ActiveTimerSegment,
  TimerSegment,
  TimerStudySession,
} from '@/types/study';

export const MINIMUM_SESSION_SECONDS = 60;
export const UNUSUALLY_LONG_TIMER_HOURS = 8;
export const UNUSUALLY_LONG_TIMER_MILLISECONDS =
  UNUSUALLY_LONG_TIMER_HOURS * 60 * 60 * 1_000;

export type TimerFinishDecision = 'save' | 'confirm_short_session';
export type TimerRecoveryDecision = 'restore' | 'review_unusually_long_session';

function timestamp(value: string): number | null {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

/** Pure elapsed-time calculation shared by store, prompts and timer UI. */
export function getTimerElapsedMilliseconds(
  timer: Pick<ActiveTimer, 'segments'>,
  referenceDate: Date = new Date(),
): number {
  const now = referenceDate.getTime();
  if (!Number.isFinite(now)) return 0;

  return timer.segments.reduce((total, segment) => {
    const start = timestamp(segment.startedAt);
    const end = segment.endedAt === null ? now : timestamp(segment.endedAt);
    if (start === null || end === null || end <= start) return total;
    return total + end - start;
  }, 0);
}

export function getTimerElapsedSeconds(
  timer: Pick<ActiveTimer, 'segments'>,
  referenceDate: Date = new Date(),
): number {
  return Math.floor(getTimerElapsedMilliseconds(timer, referenceDate) / 1_000);
}

export function isShortSessionDuration(durationMilliseconds: number): boolean {
  return (
    !Number.isFinite(durationMilliseconds) ||
    Math.max(0, durationMilliseconds) < MINIMUM_SESSION_SECONDS * 1_000
  );
}

/** Pure numeric variant for tests and UIs that already track elapsed seconds. */
export function getShortSessionDecision(
  durationSeconds: number,
): TimerFinishDecision {
  return !Number.isFinite(durationSeconds) || durationSeconds < MINIMUM_SESSION_SECONDS
    ? 'confirm_short_session'
    : 'save';
}

export function shouldConfirmShortSession(
  timer: Pick<ActiveTimer, 'segments'>,
  referenceDate: Date = new Date(),
): boolean {
  return isShortSessionDuration(getTimerElapsedMilliseconds(timer, referenceDate));
}

export function getTimerFinishDecision(
  timer: Pick<ActiveTimer, 'segments'>,
  referenceDate: Date = new Date(),
): TimerFinishDecision {
  return shouldConfirmShortSession(timer, referenceDate)
    ? 'confirm_short_session'
    : 'save';
}

export function isUnusuallyLongRecoveredTimer(
  timer: Pick<ActiveTimer, 'status' | 'segments'>,
  referenceDate: Date = new Date(),
): boolean {
  return (
    timer.status === 'running' &&
    getTimerElapsedMilliseconds(timer, referenceDate) >=
      UNUSUALLY_LONG_TIMER_MILLISECONDS
  );
}

export const shouldReviewRecoveredTimer = isUnusuallyLongRecoveredTimer;

export function getTimerRecoveryDecision(
  timer: Pick<ActiveTimer, 'status' | 'segments'>,
  referenceDate: Date = new Date(),
): TimerRecoveryDecision {
  return isUnusuallyLongRecoveredTimer(timer, referenceDate)
    ? 'review_unusually_long_session'
    : 'restore';
}

/** Pure numeric recovery variant; the threshold is inclusive. */
export function getRecoveredSessionDecision(
  elapsedMilliseconds: number,
  status: ActiveTimer['status'] = 'running',
): TimerRecoveryDecision {
  return status === 'running' &&
    Number.isFinite(elapsedMilliseconds) &&
    elapsedMilliseconds >= UNUSUALLY_LONG_TIMER_MILLISECONDS
    ? 'review_unusually_long_session'
    : 'restore';
}

/** Returns a paused timer and closes only a valid final open segment. */
export function pauseActiveTimer(
  timer: ActiveTimer,
  referenceDate: Date = new Date(),
): ActiveTimer {
  if (timer.status !== 'running') return timer;
  const endedAt = referenceDate.toISOString();
  const segments = timer.segments.map((segment, index): ActiveTimerSegment =>
    index === timer.segments.length - 1 && segment.endedAt === null
      ? { ...segment, endedAt }
      : segment,
  );

  return { ...timer, status: 'paused', segments, updatedAt: endedAt };
}

/** Returns a running timer with exactly one newly opened segment. */
export function resumeActiveTimer(
  timer: ActiveTimer,
  referenceDate: Date = new Date(),
): ActiveTimer {
  if (timer.status !== 'paused') return timer;
  const startedAt = referenceDate.toISOString();
  return {
    ...timer,
    status: 'running',
    segments: [...timer.segments, { startedAt, endedAt: null }],
    updatedAt: startedAt,
  };
}

export interface BuildTimerSessionOptions {
  id?: string;
  createdAt?: string;
}

/** Converts a paused or running timer to a completed, JSON-safe session. */
export function buildTimerSession(
  timer: ActiveTimer,
  referenceDate: Date = new Date(),
  options: BuildTimerSessionOptions = {},
): TimerStudySession {
  const closed = timer.status === 'running'
    ? pauseActiveTimer(timer, referenceDate)
    : timer;
  const endedAt = referenceDate.toISOString();
  const segments: TimerSegment[] = closed.segments.flatMap((segment) =>
    segment.endedAt === null
      ? []
      : [{ startedAt: segment.startedAt, endedAt: segment.endedAt }],
  );

  return {
    id: options.id ?? timer.id,
    userId: timer.userId,
    subjectId: timer.subjectId,
    source: 'timer',
    startedAt: timer.startedAt,
    endedAt,
    durationMinutes: getTimerElapsedMilliseconds(closed, referenceDate) / 60_000,
    createdAt: options.createdAt ?? endedAt,
    note: timer.note,
    segments,
  };
}
