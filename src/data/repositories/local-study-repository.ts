import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type {
  ImportRepository,
  SharedGoalProgressListener,
  SocialUpdatesListener,
  SocialRepository,
  StudyRepository,
  SyncResult,
  SyncStatus,
} from '@/data/repositories/study-repository';
import { accountRequired, throwIfAborted } from '@/data/repositories/repository-error';
import { MemoryKeyValueStorage, type KeyValueStorage } from '@/services/sync/outbox';

const memoryFallback = new MemoryKeyValueStorage();
const SNAPSHOT_SCHEMA_VERSION = 1;

interface PersistedRepositorySnapshot {
  version: typeof SNAPSHOT_SCHEMA_VERSION;
  snapshot: StudyStateSnapshot;
  savedAt: string;
}

function defaultStorage(): KeyValueStorage {
  const candidate = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  return candidate ?? memoryFallback;
}

function createAccountRequiredProxy(): SocialRepository & ImportRepository {
  const unavailable = async (): Promise<never> => { throw accountRequired(); };
  return new Proxy({}, {
    get: () => unavailable,
  }) as SocialRepository & ImportRepository;
}

export interface LocalStudyRepositoryOptions {
  storageScope?: string;
  storage?: KeyValueStorage;
  /** Reuse the StudyStore's established versioned snapshot instead of a parallel cache. */
  snapshotKey?: string;
  storeSchemaVersion?: number;
  /** StudyStore already writes this key synchronously after every transition. */
  externallyPersisted?: boolean;
}

export class LocalStudyRepository implements StudyRepository {
  readonly mode = 'local' as const;
  readonly accountId = null;
  readonly social: SocialRepository;
  readonly imports: ImportRepository;

  protected readonly storage: KeyValueStorage;
  protected readonly snapshotKey: string;
  private readonly storeSchemaVersion: number | null;
  private readonly externallyPersisted: boolean;
  private readonly syncListeners = new Set<(status: SyncStatus) => void>();
  private status: SyncStatus = {
    phase: 'idle',
    pendingMutationCount: 0,
    lastSyncedAt: null,
    lastError: null,
  };

  constructor(options: LocalStudyRepositoryOptions = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.snapshotKey = options.snapshotKey
      ?? `lernzeit.repository.v1.${options.storageScope?.trim() || 'local'}`;
    this.storeSchemaVersion = options.storeSchemaVersion ?? null;
    this.externallyPersisted = options.externallyPersisted ?? false;
    const guard = createAccountRequiredProxy();
    this.social = guard;
    this.imports = guard;
  }

  async loadSnapshot(signal?: AbortSignal): Promise<StudyStateSnapshot | null> {
    throwIfAborted(signal);
    const serialized = await this.storage.getItem(this.snapshotKey);
    throwIfAborted(signal);
    if (!serialized) return null;
    try {
      const parsed = JSON.parse(serialized) as Partial<PersistedRepositorySnapshot>;
      if (parsed.version === SNAPSHOT_SCHEMA_VERSION && parsed.snapshot) return parsed.snapshot;
      const storeSnapshot = parsed as unknown as Partial<StudyStateSnapshot> & { schemaVersion?: number };
      return this.storeSchemaVersion !== null
        && storeSnapshot.schemaVersion === this.storeSchemaVersion
        && storeSnapshot.data
        && storeSnapshot.privacy
        ? { data: storeSnapshot.data, privacy: storeSnapshot.privacy }
        : null;
    } catch {
      return null;
    }
  }

  async saveSnapshot(snapshot: StudyStateSnapshot, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.externallyPersisted) return;
    const value: PersistedRepositorySnapshot = {
      version: SNAPSHOT_SCHEMA_VERSION,
      snapshot,
      savedAt: new Date().toISOString(),
    };
    await this.storage.setItem(this.snapshotKey, JSON.stringify(value));
    throwIfAborted(signal);
  }

  refresh(signal?: AbortSignal): Promise<StudyStateSnapshot | null> {
    return this.loadSnapshot(signal);
  }

  async enqueueMutation(_mutation: Parameters<StudyRepository['enqueueMutation']>[0], signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    // Local mutations are already represented by the persisted snapshot.
  }

  async sync(signal?: AbortSignal): Promise<SyncResult> {
    const snapshot = await this.loadSnapshot(signal);
    const now = new Date().toISOString();
    this.updateStatus({ ...this.status, phase: 'idle', lastSyncedAt: now, lastError: null });
    return {
      snapshot,
      appliedMutationCount: 0,
      pendingMutationCount: 0,
      conflicts: [],
      syncVersion: null,
    };
  }

  getSyncStatus(): SyncStatus {
    return this.status;
  }

  subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
    this.syncListeners.add(listener);
    listener(this.status);
    return () => this.syncListeners.delete(listener);
  }

  async subscribeSharedGoalProgress(
    _goalId: string,
    _listener: SharedGoalProgressListener,
    signal?: AbortSignal,
  ): Promise<() => Promise<void>> {
    throwIfAborted(signal);
    throw accountRequired();
  }

  async subscribeSocialUpdates(
    _listener: SocialUpdatesListener,
    signal?: AbortSignal,
  ): Promise<() => Promise<void>> {
    throwIfAborted(signal);
    throw accountRequired();
  }

  async dispose(): Promise<void> {
    this.syncListeners.clear();
  }

  protected updateStatus(status: SyncStatus): void {
    this.status = status;
    this.syncListeners.forEach((listener) => listener(status));
  }
}

export function createLocalStudyRepository(
  options: LocalStudyRepositoryOptions = {},
): LocalStudyRepository {
  return new LocalStudyRepository(options);
}
