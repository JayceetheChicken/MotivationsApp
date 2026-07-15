import {
  MINIMUM_SESSION_SECONDS,
  UNUSUALLY_LONG_TIMER_MILLISECONDS,
  buildTimerSession,
  getTimerElapsedMilliseconds,
  getTimerElapsedSeconds,
  getTimerFinishDecision,
  getTimerRecoveryDecision,
  isShortSessionDuration,
  isUnusuallyLongRecoveredTimer,
  pauseActiveTimer,
  resumeActiveTimer,
} from '@/lib/timer';
import type { ActiveTimer } from '@/types/study';

function runningTimer(startedAt = '2026-07-10T08:00:00.000Z'): ActiveTimer {
  return {
    schemaVersion: 1,
    id: 'timer-1',
    userId: 'user-1',
    subjectId: 'math',
    status: 'running',
    startedAt,
    segments: [{ startedAt, endedAt: null }],
    updatedAt: startedAt,
  };
}

describe('study timer state transitions', () => {
  it('calculates elapsed time across paused and currently running segments', () => {
    const timer: ActiveTimer = {
      ...runningTimer(),
      segments: [
        {
          startedAt: '2026-07-10T08:00:00.000Z',
          endedAt: '2026-07-10T08:05:00.000Z',
        },
        { startedAt: '2026-07-10T08:10:00.000Z', endedAt: null },
      ],
    };
    const reference = new Date('2026-07-10T08:12:30.000Z');

    expect(getTimerElapsedMilliseconds(timer, reference)).toBe(7.5 * 60_000);
    expect(getTimerElapsedSeconds(timer, reference)).toBe(450);
  });

  it('pauses and resumes without mutating the persisted timer', () => {
    const original = runningTimer();
    const paused = pauseActiveTimer(
      original,
      new Date('2026-07-10T08:05:00.000Z'),
    );
    const resumed = resumeActiveTimer(
      paused,
      new Date('2026-07-10T08:10:00.000Z'),
    );

    expect(original.status).toBe('running');
    expect(original.segments[0].endedAt).toBeNull();
    expect(paused.status).toBe('paused');
    expect(paused.segments[0].endedAt).toBe('2026-07-10T08:05:00.000Z');
    expect(resumed.status).toBe('running');
    expect(resumed.segments).toHaveLength(2);
    expect(resumed.segments[1]).toEqual({
      startedAt: '2026-07-10T08:10:00.000Z',
      endedAt: null,
    });
    expect(
      getTimerElapsedMilliseconds(
        resumed,
        new Date('2026-07-10T08:12:00.000Z'),
      ),
    ).toBe(7 * 60_000);
  });

  it('builds a completed timer session from all measured segments', () => {
    const firstPause = pauseActiveTimer(
      runningTimer(),
      new Date('2026-07-10T08:05:00.000Z'),
    );
    const resumed = resumeActiveTimer(
      firstPause,
      new Date('2026-07-10T08:10:00.000Z'),
    );
    const completed = buildTimerSession(
      resumed,
      new Date('2026-07-10T08:15:00.000Z'),
      { id: 'session-1' },
    );

    expect(completed.id).toBe('session-1');
    expect(completed.source).toBe('timer');
    expect(completed.durationMinutes).toBe(10);
    expect(completed.segments).toHaveLength(2);
    expect(completed.segments[1].endedAt).toBe('2026-07-10T08:15:00.000Z');
  });
});

describe('timer safeguards', () => {
  it('requires confirmation below 60 seconds but saves at the boundary', () => {
    const timer = runningTimer();

    expect(MINIMUM_SESSION_SECONDS).toBe(60);
    expect(isShortSessionDuration(59_999)).toBe(true);
    expect(isShortSessionDuration(60_000)).toBe(false);
    expect(
      getTimerFinishDecision(
        timer,
        new Date('2026-07-10T08:00:59.999Z'),
      ),
    ).toBe('confirm_short_session');
    expect(
      getTimerFinishDecision(timer, new Date('2026-07-10T08:01:00.000Z')),
    ).toBe('save');
  });

  it('flags a recovered running timer at exactly eight hours', () => {
    const timer = runningTimer();
    const justBefore = new Date(
      new Date(timer.startedAt).getTime() +
        UNUSUALLY_LONG_TIMER_MILLISECONDS -
        1,
    );
    const boundary = new Date(
      new Date(timer.startedAt).getTime() + UNUSUALLY_LONG_TIMER_MILLISECONDS,
    );

    expect(isUnusuallyLongRecoveredTimer(timer, justBefore)).toBe(false);
    expect(isUnusuallyLongRecoveredTimer(timer, boundary)).toBe(true);
    expect(getTimerRecoveryDecision(timer, boundary)).toBe(
      'review_unusually_long_session',
    );

    const paused = pauseActiveTimer(timer, boundary);
    expect(isUnusuallyLongRecoveredTimer(paused, boundary)).toBe(false);
    expect(getTimerRecoveryDecision(paused, boundary)).toBe('restore');
  });
});
