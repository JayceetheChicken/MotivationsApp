import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.generated';

const DELETE_ACCOUNT_FUNCTION = 'delete-account';

interface DeleteAccountResponse {
  deleted?: boolean;
}

function functionStatus(error: unknown): number | null {
  const context = (error as { context?: { status?: unknown } } | null)?.context;
  return typeof context?.status === 'number' ? context.status : null;
}

export async function requestOnlineAccountDeletion(
  client: SupabaseClient<Database>,
  accessToken: string,
): Promise<void> {
  const token = accessToken.trim();
  if (!token) throw new Error('Für die Kontolöschung fehlt eine gültige Anmeldung.');

  const { data, error } = await client.functions.invoke<DeleteAccountResponse>(
    DELETE_ACCOUNT_FUNCTION,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { confirmation: 'DELETE' },
    },
  );

  if (error) {
    const status = functionStatus(error);
    if (status === 401) {
      throw new Error('Deine Anmeldung ist abgelaufen. Melde dich erneut an und versuche es noch einmal.');
    }
    if (status === 403) {
      throw new Error('Bitte bestätige deine Identität erneut und versuche es noch einmal.');
    }
    throw new Error('Das Online-Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.');
  }
  if (!data?.deleted) {
    throw new Error('Das Online-Konto konnte nicht vollständig gelöscht werden. Bitte versuche es später erneut.');
  }
}
