import { createSharedGoalProgressSubscription } from '@/services/realtime/shared-goal-subscription';
import type { SharedGoalProgress } from '@/types/study';

const progress: SharedGoalProgress = {
  goalId: 'goal-1',
  goalType: 'duration',
  mode: 'shared',
  sourcePolicy: 'all',
  startsAt: '2026-07-18T00:00:00.000Z',
  endsAt: '2026-07-24T23:59:59.999Z',
  revision: 1,
  participants: [],
  team: {
    contribution: 30,
    target: 120,
    progressPercent: 25,
    remaining: 90,
    achieved: false,
    exceededBy: 0,
  },
  calculatedAt: '2026-07-18T10:00:00.000Z',
};

describe('shared goal realtime subscription', () => {
  it('treats messages as invalidations and removes the transport exactly once', async () => {
    let invalidate: (() => void) | null = null;
    const remove = jest.fn(async () => undefined);
    const fetchProgress = jest.fn(async () => progress);
    const onProgress = jest.fn();

    const cleanup = await createSharedGoalProgressSubscription({
      fetchProgress,
      listener: { onProgress },
      startInvalidationListener: async (listener) => {
        invalidate = listener;
        return remove;
      },
    });

    expect(fetchProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(progress);
    (invalidate as unknown as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchProgress).toHaveBeenCalledTimes(2);

    await cleanup();
    await cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('aborts in-flight fetches and automatically removes transport on parent abort', async () => {
    const controller = new AbortController();
    const remove = jest.fn(async () => undefined);
    let observedSignal: AbortSignal | null = null;
    const cleanup = await createSharedGoalProgressSubscription({
      signal: controller.signal,
      listener: { onProgress: jest.fn() },
      fetchProgress: async (signal) => {
        observedSignal = signal;
        return progress;
      },
      startInvalidationListener: async () => remove,
    });

    controller.abort();
    await Promise.resolve();
    expect((observedSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    await cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
