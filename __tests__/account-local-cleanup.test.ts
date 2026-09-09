import {
  accountLocalStorageKeys,
  clearAccountLocalData,
} from '@/auth/account-local-cleanup';

describe('account-local cleanup', () => {
  it('removes every cache, cursor, outbox and import key for only the deleted account', () => {
    const removeItem = jest.fn();
    const keys = accountLocalStorageKeys('account-123');

    expect(clearAccountLocalData({ removeItem }, 'account-123')).toEqual([]);
    expect(removeItem.mock.calls.map(([key]) => key)).toEqual(keys);
    expect(keys).toEqual(expect.arrayContaining([
      'lernzeit.study-state.v2.account-account-123',
      'lernzeit.repository.v1.account-account-123',
      'lernzeit.outbox.v1.account-account-123',
      'lernzeit.sync-cursor.v1.account-account-123',
      'lernzeit.study-import.v2.account-123',
      'lernzeit.shared-session-actions.v1.account-123',
    ]));
    expect(keys.some((key) => key.endsWith('.local'))).toBe(false);
  });

  it('reports failed local removals without skipping the remaining keys', () => {
    const removeItem = jest.fn((key: string) => {
      if (key.includes('outbox')) throw new Error('storage failure');
    });
    const failed = clearAccountLocalData({ removeItem }, 'account-123');

    expect(failed).toEqual(['lernzeit.outbox.v1.account-account-123']);
    expect(removeItem).toHaveBeenCalledTimes(accountLocalStorageKeys('account-123').length);
  });

  it('preserves all keys belonging to another account on the same device', () => {
    const values = new Map<string, string>();
    for (const key of accountLocalStorageKeys('account-a')) values.set(key, 'a');
    for (const key of accountLocalStorageKeys('account-b')) values.set(key, 'b');
    values.set('lernzeit.study-state.v2.local', 'guest');

    clearAccountLocalData({ removeItem: (key) => { values.delete(key); } }, 'account-a');

    expect(accountLocalStorageKeys('account-a').every((key) => !values.has(key))).toBe(true);
    expect(accountLocalStorageKeys('account-b').every((key) => values.get(key) === 'b')).toBe(true);
    expect(values.get('lernzeit.study-state.v2.local')).toBe('guest');
  });
});
