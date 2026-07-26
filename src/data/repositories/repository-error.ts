export type StudyRepositoryErrorCode =
  | 'account_required'
  | 'cancelled'
  | 'conflict'
  | 'forbidden'
  | 'invalid_data'
  | 'network_error'
  | 'not_found'
  | 'offline'
  | 'rate_limited'
  | 'server_error'
  | 'unauthorized'
  | 'unavailable'
  | 'unknown';

export interface StudyRepositoryErrorOptions {
  cause?: unknown;
  details?: Readonly<Record<string, unknown>>;
  retryable?: boolean;
}

export class StudyRepositoryError extends Error {
  readonly code: StudyRepositoryErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(
    code: StudyRepositoryErrorCode,
    message: string,
    options: StudyRepositoryErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'StudyRepositoryError';
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? isRetryableCode(code);
  }
}

function isRetryableCode(code: StudyRepositoryErrorCode): boolean {
  return code === 'network_error'
    || code === 'offline'
    || code === 'rate_limited'
    || code === 'server_error'
    || code === 'unavailable';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudyRepositoryError('cancelled', 'Die Anfrage wurde abgebrochen.', {
      cause: signal.reason,
      retryable: false,
    });
  }
}

export function accountRequired(): StudyRepositoryError {
  return new StudyRepositoryError(
    'account_required',
    'Diese Funktion ist nur mit einem Supabase-Konto verfügbar.',
    { retryable: false },
  );
}

export function asRepositoryError(error: unknown): StudyRepositoryError {
  if (error instanceof StudyRepositoryError) return error;

  if (error instanceof Error && error.name === 'AbortError') {
    return new StudyRepositoryError('cancelled', 'Die Anfrage wurde abgebrochen.', {
      cause: error,
      retryable: false,
    });
  }

  const candidate = error as {
    code?: string;
    message?: string;
    status?: number;
    details?: unknown;
    hint?: unknown;
  } | null;
  const status = candidate?.status;
  const postgresCode = candidate?.code;
  const databaseMessage = candidate?.message ?? '';

  if (/avatar_update_requires_storage/i.test(databaseMessage)) {
    return new StudyRepositoryError(
      'forbidden',
      'Profilbilder können nur über den sicheren Supabase-Upload geändert werden.',
      { cause: error, retryable: false },
    );
  }
  if (/avatar_object_not_found/i.test(databaseMessage)) {
    return new StudyRepositoryError(
      'not_found',
      'Der Profilbild-Upload konnte in Supabase nicht bestätigt werden.',
      { cause: error, retryable: false },
    );
  }
  if (/invalid_avatar_object|invalid_auth_issuer/i.test(databaseMessage)) {
    return new StudyRepositoryError(
      'invalid_data',
      'Das Profilbild wurde wegen eines ungültigen Formats oder Speicherpfads abgelehnt.',
      { cause: error, retryable: false },
    );
  }
  if (/presence_device_limit/i.test(databaseMessage)) {
    return new StudyRepositoryError(
      'rate_limited',
      'Der Onlinestatus ist bereits mit zu vielen Geräten verbunden.',
      { cause: error },
    );
  }

  if (status === 401) return new StudyRepositoryError('unauthorized', 'Die Anmeldung ist abgelaufen.', { cause: error });
  if (status === 403 || postgresCode === '42501') return new StudyRepositoryError('forbidden', 'Für diese Aktion fehlt die Berechtigung.', { cause: error });
  if (status === 404 || (/_not_found$/i.test(databaseMessage) && !/revision_conflict/i.test(databaseMessage))) {
    return new StudyRepositoryError('not_found', 'Der Datensatz wurde nicht gefunden.', { cause: error });
  }
  if (
    status === 409
    || postgresCode === '40001'
    || postgresCode === 'P0002'
    || postgresCode === '23505'
    || /revision_conflict|already_finalized|chunk_conflict|_deleted$|username_taken/i.test(databaseMessage)
  ) {
    return new StudyRepositoryError('conflict', candidate?.message ?? 'Der Datensatz wurde zwischenzeitlich geändert.', {
      cause: error,
      retryable: false,
    });
  }
  if (status === 429 || postgresCode === 'P0003' || /cooldown|rate_limit/i.test(databaseMessage)) {
    return new StudyRepositoryError('rate_limited', candidate?.message ?? 'Bitte warte kurz und versuche es erneut.', { cause: error });
  }
  if (typeof status === 'number' && status >= 500) {
    return new StudyRepositoryError('server_error', candidate?.message ?? 'Der Server konnte die Anfrage nicht verarbeiten.', { cause: error });
  }
  if (postgresCode === '23503' || postgresCode === '23514' || postgresCode === '22023' || postgresCode === '22P02' || postgresCode === 'P0001') {
    return new StudyRepositoryError('invalid_data', candidate?.message ?? 'Die übermittelten Daten sind ungültig.', {
      cause: error,
      retryable: false,
    });
  }

  const message = candidate?.message ?? (error instanceof Error ? error.message : 'Unbekannter Datenfehler.');
  if (/network|fetch|offline|socket/i.test(message)) {
    return new StudyRepositoryError('network_error', 'Die Verbindung zum Server ist fehlgeschlagen.', { cause: error });
  }

  return new StudyRepositoryError('unknown', message, { cause: error, retryable: false });
}
