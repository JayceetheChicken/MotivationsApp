import { Directory, File, Paths } from 'expo-file-system';

import { shareAccountDataExport } from '@/lib/account-data-export';

const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockList = jest.fn();
const mockIsAvailable = jest.fn();
const mockShare = jest.fn();

jest.mock('expo-file-system', () => {
  class MockFile {
    readonly name: string;
    readonly uri: string;
    exists = true;

    constructor(_parent: unknown, name: string) {
      this.name = name;
      this.uri = `file:///cache/${name}`;
    }

    write(content: string) {
      return mockWrite(content);
    }

    delete() {
      return mockDelete();
    }
  }

  class MockDirectory {
    readonly name: string;

    constructor(_parent: unknown, name = 'cache') {
      this.name = name;
    }

    list() {
      return mockList();
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { cache: 'file:///cache' },
  };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

function cachedFile(name: string, deleteFile = jest.fn()) {
  const file = new File(Paths.cache, name);
  file.delete = deleteFile;
  return file;
}

describe('account data export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockReturnValue([]);
    mockIsAvailable.mockResolvedValue(true);
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

  it('removes a partially written file when write itself fails', async () => {
    mockWrite.mockImplementationOnce(() => { throw new Error('write failed'); });

    await expect(shareAccountDataExport(
      { schema_version: 1 },
      new Date('2026-08-02T12:00:00.000Z'),
    )).rejects.toThrow('write failed');
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('reports a current-file cleanup failure instead of silently succeeding', async () => {
    mockDelete.mockImplementationOnce(() => { throw new Error('delete failed'); });

    await expect(shareAccountDataExport(
      { schema_version: 1 },
      new Date('2026-08-02T12:00:00.000Z'),
    )).rejects.toThrow('konnte nicht sicher aus dem App-Cache entfernt werden');
  });

  it('retries only precisely named stale exports before creating another file', async () => {
    const staleDelete = jest.fn();
    const unrelatedDelete = jest.fn();
    const directoryDelete = jest.fn();
    const stale = cachedFile('lernzeit-datenexport-2026-07-31.json', staleDelete);
    const unrelated = cachedFile('other-export-2026-07-31.json', unrelatedDelete);
    const similarlyNamed = cachedFile('lernzeit-datenexport-2026-07-31.json.bak', unrelatedDelete);
    const directory = new Directory(Paths.cache, 'lernzeit-datenexport-2026-07-30.json');
    directory.delete = directoryDelete;
    mockList.mockReturnValue([stale, unrelated, similarlyNamed, directory]);

    await shareAccountDataExport(
      { schema_version: 1 },
      new Date('2026-08-02T12:00:00.000Z'),
    );

    expect(staleDelete).toHaveBeenCalledTimes(1);
    expect(unrelatedDelete).not.toHaveBeenCalled();
    expect(directoryDelete).not.toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('fails closed before writing a new export when stale cleanup fails', async () => {
    const staleDelete = jest.fn(() => { throw new Error('still locked'); });
    mockList.mockReturnValue([
      cachedFile('lernzeit-datenexport-2026-07-31.json', staleDelete),
    ]);

    await expect(shareAccountDataExport(
      { schema_version: 1 },
      new Date('2026-08-02T12:00:00.000Z'),
    )).rejects.toThrow('konnte nicht sicher aus dem App-Cache entfernt werden');
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('cleans a stale plaintext export even when sharing is unavailable', async () => {
    const staleDelete = jest.fn();
    mockList.mockReturnValue([
      cachedFile('lernzeit-datenexport-2026-07-31.json', staleDelete),
    ]);
    mockIsAvailable.mockResolvedValue(false);

    await expect(shareAccountDataExport(
      { schema_version: 1 },
      new Date('2026-08-02T12:00:00.000Z'),
    )).rejects.toThrow('nicht verfügbar');
    expect(staleDelete).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
