import { shareAccountDataExport } from '@/lib/account-data-export';

const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockShare = jest.fn();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    uri: 'file:///cache/lernzeit-datenexport-2026-08-02.json',
    exists: true,
    write: mockWrite,
    delete: mockDelete,
  })),
  Paths: { cache: 'file:///cache' },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

describe('account data export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShare.mockResolvedValue(undefined);
  });

  it('shares readable JSON and removes the plaintext cache copy afterwards', async () => {
    await shareAccountDataExport(
      { schema_version: 1, profile: { username: 'lea' } },
      new Date('2026-08-02T12:00:00.000Z'),
    );

    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('"username": "lea"'));
    expect(mockShare).toHaveBeenCalledWith(
      'file:///cache/lernzeit-datenexport-2026-08-02.json',
      expect.objectContaining({ mimeType: 'application/json' }),
    );
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('also removes the cache copy when the system share sheet fails', async () => {
    mockShare.mockRejectedValueOnce(new Error('share cancelled'));

    await expect(shareAccountDataExport(
      { schema_version: 1 },
      new Date('2026-08-02T12:00:00.000Z'),
    )).rejects.toThrow('share cancelled');
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
