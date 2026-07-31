import {
  executeDeleteAccount,
  type DeleteAccountAdmin,
} from '../supabase/functions/_shared/delete-account';

function fakeAdmin(overrides: Partial<DeleteAccountAdmin> = {}) {
  const admin: DeleteAccountAdmin = {
    getUserId: jest.fn().mockResolvedValue('account-123'),
    listAvatarObjectPaths: jest.fn().mockResolvedValue(['account-123/profile/avatar.jpg']),
    removeAvatarObjects: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return admin;
}

const validRequest = {
  authorization: 'Bearer valid-jwt',
  confirmation: 'DELETE',
} as const;

describe('delete-account Edge Function core', () => {
  it('deletes avatar objects before the authenticated auth user', async () => {
    const callOrder: string[] = [];
    const admin = fakeAdmin({
      removeAvatarObjects: jest.fn(async () => { callOrder.push('storage'); }),
      deleteUser: jest.fn(async () => { callOrder.push('auth'); }),
    });

    await expect(executeDeleteAccount(validRequest, admin)).resolves.toEqual({
      status: 200,
      body: { deleted: true },
    });
    expect(admin.getUserId).toHaveBeenCalledWith('valid-jwt');
    expect(admin.removeAvatarObjects).toHaveBeenCalledWith(['account-123/profile/avatar.jpg']);
    expect(callOrder).toEqual(['storage', 'auth']);
  });

  it('rejects an unauthenticated request', async () => {
    const admin = fakeAdmin();
    const result = await executeDeleteAccount({ authorization: null, confirmation: 'DELETE' }, admin);
    expect(result.status).toBe(401);
    expect(admin.getUserId).not.toHaveBeenCalled();
  });

  it('rejects an invalid JWT', async () => {
    const admin = fakeAdmin({ getUserId: jest.fn().mockRejectedValue(new Error('invalid JWT')) });
    const result = await executeDeleteAccount(validRequest, admin);
    expect(result.status).toBe(401);
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('is repeatable when partially missing data has already been cleaned up', async () => {
    const admin = fakeAdmin({ listAvatarObjectPaths: jest.fn().mockResolvedValue([]) });
    const first = await executeDeleteAccount(validRequest, admin);
    const second = await executeDeleteAccount(validRequest, admin);

    expect(first.body).toEqual({ deleted: true });
    expect(second.body).toEqual({ deleted: true });
    expect(admin.removeAvatarObjects).not.toHaveBeenCalled();
    expect(admin.deleteUser).toHaveBeenCalledTimes(2);
  });

  it('does not delete the auth user after a storage cleanup failure', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const admin = fakeAdmin({
      removeAvatarObjects: jest.fn().mockRejectedValue(new Error('storage unavailable')),
    });
    const result = await executeDeleteAccount(validRequest, admin);

    expect(result).toEqual({
      status: 500,
      body: { error: 'Das Konto konnte nicht vollständig gelöscht werden.' },
    });
    expect(admin.deleteUser).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
