import type { SharedGoalProgressListener } from '@/data/repositories/study-repository';
import type { SharedGoalProgress } from '@/types/study';
import { asRepositoryError, throwIfAborted } from '@/data/repositories/repository-error';

export type StartInvalidationListener = (
  onInvalidated: () => void,
  onTransportError: (error: unknown) => void,
) => Promise<() => Promise<void>>;

export interface SharedGoalSubscriptionOptions {
  fetchProgress: (signal: AbortSignal) => Promise<SharedGoalProgress>;
  startInvalidationListener: StartInvalidationListener;
  listener: SharedGoalProgressListener;
  signal?: AbortSignal;
}

/**
 * Treats realtime messages only as invalidations. Multiple events are
 * coalesced, and every visible value is fetched again from the secured RPC.
 */
export async function createSharedGoalProgressSubscription(
  options: SharedGoalSubscriptionOptions,
): Promise<() => Promise<void>> {
  throwIfAborted(options.signal);
  const controller = new AbortController();
  let disposed = false;
  let fetching = false;
  let refetchRequested = false;

  const reportError = (error: unknown) => {
    const normalized = asRepositoryError(error);
    if (normalized.code !== 'cancelled') options.listener.onError?.(normalized);
  };

  const refetch = async (): Promise<void> => {
    if (disposed || controller.signal.aborted) return;
    if (fetching) {
      refetchRequested = true;
      return;
    }
    fetching = true;
    try {
      do {
        refetchRequested = false;
        const progress = await options.fetchProgress(controller.signal);
        if (!disposed && !controller.signal.aborted) options.listener.onProgress(progress);
      } while (refetchRequested && !disposed && !controller.signal.aborted);
    } catch (error) {
      reportError(error);
    } finally {
      fetching = false;
    }
  };

  const unsubscribeTransport = await options.startInvalidationListener(
    () => { void refetch(); },
    reportError,
  );
  let transportDisposed = false;
  const stopTransport = async () => {
    if (transportDisposed) return;
    transportDisposed = true;
    await unsubscribeTransport();
  };
  const abortFromParent = () => {
    disposed = true;
    controller.abort(options.signal?.reason);
    void stopTransport();
  };
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  await refetch();

  return async () => {
    if (transportDisposed) return;
    disposed = true;
    options.signal?.removeEventListener('abort', abortFromParent);
    controller.abort();
    await stopTransport();
  };
}
