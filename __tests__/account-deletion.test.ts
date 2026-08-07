import type { SupabaseClient } from '@supabase/supabase-js';

import { requestOnlineAccountDeletion } from '@/auth/account-deletion';
import type { Database } from '@/types/database.generated';

function clientWithInvoke(invoke: jest.Mock): SupabaseClient<Database> {
  return { functions: { invoke } } as unknown as SupabaseClient<Database>;
}

describe('online account deletion client', () => {
  it('invokes the protected function with the current JWT and explicit confirmation', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { deleted: true }, error: null });
    await expect(requestOnlineAccountDeletion(clientWithInvoke(invoke), 'access-token')).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith('delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer access-token' },
      body: { confirmation: 'DELETE' },
    });
  });

  it('maps invalid JWT and server failures to non-technical messages', async () => {
    const invalidJwt = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Invalid JWT', context: { status: 401 } },
    });
    await expect(requestOnlineAccountDeletion(clientWithInvoke(invalidJwt), 'expired')).rejects.toThrow(
      'Deine Anmeldung ist abgelaufen.',
    );

    const serverFailure = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'relation public.profiles does not exist', context: { status: 500 } },
    });
    await expect(requestOnlineAccountDeletion(clientWithInvoke(serverFailure), 'access')).rejects.toThrow(
      'Das Online-Konto konnte nicht gelöscht werden.',
    );
  });
});
