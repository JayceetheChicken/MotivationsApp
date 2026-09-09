/**
 * Production builds intentionally emit no client diagnostics. Development
 * messages are fixed strings: callers cannot attach URLs, tokens, account
 * identifiers, study content, or raw backend error objects.
 */
function developmentLoggingEnabled(includeTests = false): boolean {
  return typeof __DEV__ !== 'undefined'
    && __DEV__
    && (includeTests || process.env.NODE_ENV !== 'test');
}

export function safeDebug(message: string): void {
  if (developmentLoggingEnabled()) console.debug(message);
}

export function safeWarning(message: string): void {
  if (developmentLoggingEnabled(true)) console.warn(message);
}
