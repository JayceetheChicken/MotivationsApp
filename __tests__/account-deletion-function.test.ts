import {
  deleteAvatarTree,
  executeDeleteAccount,
  type DeleteAccountAdmin,
  isExplicitUserNotFoundError,
  isValidAccountDeletionFence,
  recentPasswordAuthenticationTimestamp,
} from '../supabase/functions/_shared/delete-account';

function fakeAdmin(overrides: Partial<DeleteAccountAdmin> = {}) {
  const admin: DeleteAccountAdmin = {
    getAuthenticatedUser: jest.fn().mockResolvedValue({
      userId: 'account-123',
      passwordAuthenticatedAtEpochSeconds: 1_000,
    }),
    beginAccountDeletion: jest.fn().mockResolvedValue(undefined),
    deleteAvatarObjects: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return admin;
}

const validRequest = {
  authorization: 'Bearer valid-jwt',
  confirmation: 'DELETE',
  nowEpochSeconds: 1_100,
} as const;

describe('delete-account Edge Function core', () => {
  it('suppresses only an explicit Auth user_not_found code, never a generic HTTP 404', () => {
    expect(isExplicitUserNotFoundError({ code: 'user_not_found', status: 404 })).toBe(true);
    expect(isExplicitUserNotFoundError({ status: 404, message: 'Gateway route not found' })).toBe(false);
    expect(isExplicitUserNotFoundError(new Error('User not found'))).toBe(false);
  });

  it('accepts only the complete account-deletion fence response for the same user', () => {
    const response = {
      prepared: true,
      trigger_managed: true,
      storage_fenced: true,
      user_id: 'account-123',
      started_at: '2026-08-09T12:00:00.000Z',
    };

    expect(isValidAccountDeletionFence(response, 'account-123')).toBe(true);
    expect(isValidAccountDeletionFence({ ...response, storage_fenced: false }, 'account-123')).toBe(false);
    expect(isValidAccountDeletionFence({ ...response, user_id: 'other-account' }, 'account-123')).toBe(false);
    expect(isValidAccountDeletionFence({ ...response, started_at: 'not-a-date' }, 'account-123')).toBe(false);
  });

  it('sets the persistent fence before deleting Storage and then the auth user', async () => {
    const callOrder: string[] = [];
    const admin = fakeAdmin({
      beginAccountDeletion: jest.fn(async () => { callOrder.push('begin'); }),
      deleteAvatarObjects: jest.fn(async () => { callOrder.push('storage'); }),
      deleteUser: jest.fn(async () => { callOrder.push('auth'); }),
    });

    await expect(executeDeleteAccount(validRequest, admin)).resolves.toEqual({
      status: 200,
      body: { deleted: true },
    });
    expect(admin.getAuthenticatedUser).toHaveBeenCalledWith('valid-jwt');
    expect(admin.beginAccountDeletion).toHaveBeenCalledWith('account-123');
    expect(admin.deleteAvatarObjects).toHaveBeenCalledWith('account-123');
    expect(callOrder).toEqual(['begin', 'storage', 'auth']);
  });

  it('makes no Storage or Auth mutation when the deletion fence cannot be set', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const admin = fakeAdmin({
      beginAccountDeletion: jest.fn().mockRejectedValue(new Error('RPC unavailable')),
    });

    const result = await executeDeleteAccount(validRequest, admin);

    expect(result.status).toBe(500);
    expect(admin.deleteAvatarObjects).not.toHaveBeenCalled();
    expect(admin.deleteUser).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('rejects an unauthenticated request', async () => {
    const admin = fakeAdmin();
    const result = await executeDeleteAccount({ authorization: null, confirmation: 'DELETE' }, admin);
    expect(result.status).toBe(401);
    expect(admin.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid JWT', async () => {
    const admin = fakeAdmin({ getAuthenticatedUser: jest.fn().mockRejectedValue(new Error('invalid JWT')) });
    const result = await executeDeleteAccount(validRequest, admin);
    expect(result.status).toBe(401);
    expect(admin.beginAccountDeletion).not.toHaveBeenCalled();
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('requires a recent password-authentication timestamp', async () => {
    const admin = fakeAdmin();
    const result = await executeDeleteAccount({ ...validRequest, nowEpochSeconds: 1_301 }, admin);

    expect(result.status).toBe(403);
    expect(admin.beginAccountDeletion).not.toHaveBeenCalled();
    expect(admin.deleteAvatarObjects).not.toHaveBeenCalled();
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('rejects replay after the Auth user has been deleted', async () => {
    const getAuthenticatedUser = jest.fn()
      .mockResolvedValueOnce({
        userId: 'account-123',
        passwordAuthenticatedAtEpochSeconds: 1_000,
      })
      .mockRejectedValueOnce(new Error('User not found'));
    const admin = fakeAdmin({ getAuthenticatedUser });
    const first = await executeDeleteAccount(validRequest, admin);
    const second = await executeDeleteAccount(validRequest, admin);

    expect(first.body).toEqual({ deleted: true });
    expect(second.status).toBe(401);
    expect(admin.beginAccountDeletion).toHaveBeenCalledTimes(1);
    expect(admin.deleteAvatarObjects).toHaveBeenCalledTimes(1);
    expect(admin.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('does not delete the auth user after a storage cleanup failure', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const admin = fakeAdmin({
      deleteAvatarObjects: jest.fn().mockRejectedValue(new Error('storage unavailable')),
    });
    const result = await executeDeleteAccount(validRequest, admin);

    expect(result).toEqual({
      status: 500,
      body: { error: 'Das Konto konnte nicht vollständig gelöscht werden.' },
    });
    expect(admin.beginAccountDeletion).toHaveBeenCalledWith('account-123');
    expect(admin.deleteUser).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('does not report success for a generic Auth API 404', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const admin = fakeAdmin({
      deleteUser: jest.fn().mockRejectedValue({
        status: 404,
        message: 'Gateway route not found',
      }),
    });

    const result = await executeDeleteAccount(validRequest, admin);

    expect(result.status).toBe(500);
    expect(result.body.deleted).not.toBe(true);
    expect(admin.beginAccountDeletion).toHaveBeenCalledWith('account-123');
    expect(admin.deleteAvatarObjects).toHaveBeenCalledWith('account-123');
    errorLog.mockRestore();
  });

  it('requires a password AMR claim bound to the verified user', () => {
    expect(recentPasswordAuthenticationTimestamp({
      sub: 'account-123',
      amr: [
        { method: 'password', timestamp: 900 },
        { method: 'token_refresh', timestamp: 1_100 },
      ],
    }, 'account-123')).toBe(900);

    expect(() => recentPasswordAuthenticationTimestamp({
      sub: 'account-123',
      iat: 1_100,
      amr: [{ method: 'token_refresh', timestamp: 1_100 }],
    }, 'account-123')).toThrow(/password/i);
    expect(() => recentPasswordAuthenticationTimestamp({
      sub: 'other-account',
      amr: [{ method: 'password', timestamp: 1_100 }],
    }, 'account-123')).toThrow(/password/i);
  });

  it('streams large avatar folders in bounded deletion batches', async () => {
    const remaining = Array.from({ length: 10_001 }, (_, index) => ({
      id: String(index),
      name: `avatar-${index}.jpg`,
    }));
    const removed: string[][] = [];
    const storage = {
      listFolderPage: jest.fn(async (folder: string, offset: number) => {
        if (folder === 'account-123') {
          return offset === 0 ? [{ name: 'profile' }] : [];
        }
        return remaining.slice(offset, offset + 100);
      }),
      removeObjects: jest.fn(async (paths: readonly string[]) => {
        removed.push([...paths]);
        remaining.splice(0, paths.length);
      }),
    };

    await expect(deleteAvatarTree('account-123', storage)).rejects.toThrow(/budget/i);
    expect(remaining).toHaveLength(1);
    expect(removed).toHaveLength(100);
    await expect(deleteAvatarTree('account-123', storage)).resolves.toBeUndefined();
    expect(remaining).toHaveLength(0);
  });

  it('cleans a bounded folder frontier before asking for a retry', async () => {
    const remaining = new Set(Array.from(
      { length: 150 },
      (_, index) => `account-123/folder-${String(index).padStart(3, '0')}/avatar.jpg`,
    ));
    const removed: string[] = [];
    const storage = {
      listFolderPage: jest.fn(async (folder: string, offset: number) => {
        if (folder === 'account-123') {
          const childNames = [...new Set([...remaining].map((path) => path.split('/')[1]))].sort();
          return childNames.slice(offset, offset + 100).map((name) => ({ name }));
        }
        const prefix = `${folder}/`;
        return [...remaining]
          .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
          .slice(offset, offset + 100)
          .map((path) => ({ id: path, name: path.slice(prefix.length) }));
      }),
      removeObjects: jest.fn(async (paths: readonly string[]) => {
        for (const path of paths) {
          remaining.delete(path);
          removed.push(path);
        }
      }),
    };

    await expect(deleteAvatarTree('account-123', storage)).rejects.toThrow(/folder.*budget/i);
    expect(removed).toHaveLength(100);
    expect(remaining.size).toBe(50);

    await expect(deleteAvatarTree('account-123', storage)).resolves.toBeUndefined();
    expect(removed).toHaveLength(150);
    expect(remaining.size).toBe(0);
  });

  it('traverses legacy avatar trees deeper than 100 folders', async () => {
    const depth = 150;
    let objectPresent = true;
    const storage = {
      listFolderPage: jest.fn(async (folder: string, offset: number) => {
        if (offset > 0) return [];
        const level = folder.split('/').length - 1;
        if (level < depth) return [{ name: `level-${level}` }];
        return objectPresent ? [{ id: 'avatar-object', name: 'avatar.jpg' }] : [];
      }),
      removeObjects: jest.fn(async () => {
        objectPresent = false;
      }),
    };

    await expect(deleteAvatarTree('account-123', storage)).resolves.toBeUndefined();
    expect(objectPresent).toBe(false);
    expect(storage.removeObjects).toHaveBeenCalledTimes(1);
  });
});
