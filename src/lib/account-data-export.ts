import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { AccountDataExport } from '@/types/study';

function exportFileName(now: Date): string {
  const date = now.toISOString().slice(0, 10);
  return `lernzeit-datenexport-${date}.json`;
}

export async function shareAccountDataExport(
  data: AccountDataExport,
  now = new Date(),
): Promise<void> {
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('Das Teilen von Exportdateien ist auf diesem Gerät nicht verfügbar.');
  }

  const file = new File(Paths.cache, exportFileName(now));
  file.write(`${JSON.stringify(data, null, 2)}\n`);
  try {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Meine Lernzeit-Daten exportieren',
      mimeType: 'application/json',
      UTI: 'public.json',
    });
  } finally {
    // The destination owns its copy after shareAsync resolves. Do not leave a
    // second plaintext account export in the app cache.
    try {
      if (file.exists) file.delete();
    } catch {
      // Cache cleanup is best effort; the operating system also reclaims it.
    }
  }
}
