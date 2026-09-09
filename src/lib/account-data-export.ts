import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { AccountDataExport } from '@/types/study';

const EXPORT_FILE_PATTERN = /^lernzeit-datenexport-\d{4}-\d{2}-\d{2}\.json$/;
const CLEANUP_ERROR_MESSAGE = 'Die temporäre Exportdatei konnte nicht sicher aus dem App-Cache entfernt werden. Bitte versuche den Export erneut.';

class AccountDataExportCleanupError extends Error {
  readonly cleanupCause: unknown;

  constructor(cause: unknown) {
    super(CLEANUP_ERROR_MESSAGE);
    this.name = 'AccountDataExportCleanupError';
    this.cleanupCause = cause;
  }
}

function exportFileName(now: Date): string {
  const date = now.toISOString().slice(0, 10);
  return `lernzeit-datenexport-${date}.json`;
}

/**
 * Retries cleanup from an interrupted/failed previous export. The scope is
 * deliberately limited to this module's exact filename in the cache root;
 * unrelated JSON files and subdirectories are never touched.
 */
export function cleanupStaleAccountDataExports(): void {
  let entries: ReturnType<Directory['list']>;
  try {
    entries = new Directory(Paths.cache).list();
  } catch (error) {
    throw new AccountDataExportCleanupError(error);
  }

  const failures: unknown[] = [];
  for (const entry of entries) {
    if (!(entry instanceof File) || !EXPORT_FILE_PATTERN.test(entry.name)) continue;
    try {
      if (entry.exists) entry.delete();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AccountDataExportCleanupError(failures);
}

export async function shareAccountDataExport(
  data: AccountDataExport,
  now = new Date(),
): Promise<void> {
  // Cleanup must not depend on the platform sharing sheet being available: a
  // crash remnant is plaintext account data even on a device that cannot share.
  cleanupStaleAccountDataExports();

  if (!await Sharing.isAvailableAsync()) {
    throw new Error('Das Teilen von Exportdateien ist auf diesem Gerät nicht verfügbar.');
  }

  const file = new File(Paths.cache, exportFileName(now));
  let operationFailed = false;
  let operationError: unknown;
  try {
    file.write(`${JSON.stringify(data, null, 2)}\n`);
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Meine Lernzeit-Daten exportieren',
      mimeType: 'application/json',
      UTI: 'public.json',
    });
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  // This also covers a partially created file when write() itself throws.
  try {
    if (file.exists) file.delete();
  } catch (error) {
    throw new AccountDataExportCleanupError(
      operationFailed ? [operationError, error] : error,
    );
  }

  if (operationFailed) throw operationError;
}
