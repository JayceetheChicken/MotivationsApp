export interface RemovableStorage {
  removeItem: (key: string) => void;
}

function safeAccountId(accountId: string): string {
  return accountId.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function accountLocalStorageKeys(accountId: string): readonly string[] {
  const cleanAccountId = accountId.trim();
  if (!cleanAccountId) return [];
  const scope = `account-${safeAccountId(cleanAccountId)}`;
  return [
    `lernzeit.study-state.v2.${scope}`,
    `lernzeit.repository.v1.${scope}`,
    `lernzeit.outbox.v1.${scope}`,
    `lernzeit.sync-cursor.v1.${scope}`,
    `lernzeit.study-import.v2.${cleanAccountId}`,
    `lernzeit.shared-session-actions.v1.${cleanAccountId}`,
  ];
}

export function clearAccountLocalData(
  storage: RemovableStorage | null | undefined,
  accountId: string,
): readonly string[] {
  if (!storage) return [];
  const failedKeys: string[] = [];
  for (const key of accountLocalStorageKeys(accountId)) {
    try {
      storage.removeItem(key);
    } catch {
      failedKeys.push(key);
    }
  }
  return failedKeys;
}
