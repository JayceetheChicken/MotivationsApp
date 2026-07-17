/**
 * Races a promise against a timer so a hanging native module or network call
 * can never block its caller indefinitely. Rejects with a timeout error once
 * the deadline passes; the underlying promise keeps running detached.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} hat nach ${timeoutMs} ms nicht geantwortet.`)),
      timeoutMs,
    );

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
