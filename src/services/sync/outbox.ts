import type { CoreMutation, SyncConflict } from '@/data/repositories/study-repository';
import {
  asRepositoryError,
  StudyRepositoryError,
  throwIfAborted,
} from '@/data/repositories/repository-error';

export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export type OutboxMutationState = 'queued' | 'conflict';

export interface OutboxMutation extends CoreMutation {
  state: OutboxMutationState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError: Readonly<{ code: string; message: string }> | null;
}

interface PersistedOutbox {
  version: 1;
  mutations: OutboxMutation[];
}

export interface OutboxFlushResult {
  applied: number;
  pending: number;
  conflicts: readonly SyncConflict[];
}

export type OutboxExecutor = (
  mutation: Readonly<OutboxMutation>,
  signal?: AbortSignal,
) => Promise<unknown>;

function sortedDependencies(mutation: CoreMutation): readonly string[] {
  return [...new Set(mutation.dependsOn ?? [])].sort();
}

function canonicalMutation(mutation: CoreMutation): string {
  return JSON.stringify({
    ...mutation,
    dependsOn: sortedDependencies(mutation),
  });
}

function parseOutbox(value: string | null): PersistedOutbox {
  if (!value) return { version: 1, mutations: [] };

  try {
    const parsed = JSON.parse(value) as Partial<PersistedOutbox>;
    if (parsed.version !== 1 || !Array.isArray(parsed.mutations)) {
      return { version: 1, mutations: [] };
    }

    const mutations = parsed.mutations.filter((entry): entry is OutboxMutation => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<OutboxMutation>;
      return typeof candidate.operationId === 'string'
        && typeof candidate.name === 'string'
        && typeof candidate.entityType === 'string'
        && typeof candidate.entityId === 'string'
        && (candidate.state === 'queued' || candidate.state === 'conflict');
    });

    return { version: 1, mutations };
  } catch {
    return { version: 1, mutations: [] };
  }
}

function revisionFromResult(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.revision === 'number' && Number.isInteger(row.revision) && row.revision > 0) {
    return row.revision;
  }
  for (const key of ['goal', 'subject', 'session', 'grade', 'result']) {
    const nested = revisionFromResult(row[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function applyPredecessorRevision(mutation: OutboxMutation, revision: number): void {
  mutation.expectedRevision = revision;
  if (
    mutation.name === 'upsert_subject'
    || mutation.name === 'upsert_personal_goal'
    || mutation.name === 'upsert_grade'
  ) {
    mutation.payload = {
      ...mutation.payload,
      expected_revision: revision,
    };
  }
}

export class PersistentOutbox {
  private readonly storage: KeyValueStorage;
  private readonly storageKey: string;
  private flushPromise: Promise<OutboxFlushResult> | null = null;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(storage: KeyValueStorage, storageKey: string) {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  async list(signal?: AbortSignal): Promise<readonly OutboxMutation[]> {
    await this.operationTail;
    throwIfAborted(signal);
    const value = await this.storage.getItem(this.storageKey);
    throwIfAborted(signal);
    return parseOutbox(value).mutations;
  }

  async enqueue(mutation: CoreMutation, signal?: AbortSignal): Promise<void> {
    return this.runExclusive(async () => {
      throwIfAborted(signal);
      const persisted = parseOutbox(await this.storage.getItem(this.storageKey));
      const duplicate = persisted.mutations.find((entry) => entry.operationId === mutation.operationId);

      if (duplicate) {
        const { state: _state, attempts: _attempts, createdAt: _createdAt, updatedAt: _updatedAt, lastError: _lastError, ...core } = duplicate;
        if (canonicalMutation(core) !== canonicalMutation(mutation)) {
          throw new StudyRepositoryError(
            'conflict',
            `Die Operation ${mutation.operationId} existiert bereits mit einem anderen Inhalt.`,
            { retryable: false },
          );
        }
        return;
      }

      const now = new Date().toISOString();
      persisted.mutations.push({
        ...mutation,
        dependsOn: sortedDependencies(mutation),
        state: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      });
      await this.write(persisted, signal);
    });
  }

  async count(signal?: AbortSignal): Promise<number> {
    return (await this.list(signal)).length;
  }

  async remove(operationId: string, signal?: AbortSignal): Promise<void> {
    return this.runExclusive(async () => {
      const persisted = parseOutbox(await this.storage.getItem(this.storageKey));
      persisted.mutations = persisted.mutations.filter((entry) => entry.operationId !== operationId);
      await this.write(persisted, signal);
    });
  }

  async retryConflict(operationId: string, signal?: AbortSignal): Promise<void> {
    return this.runExclusive(async () => {
      const persisted = parseOutbox(await this.storage.getItem(this.storageKey));
      const mutation = persisted.mutations.find((entry) => entry.operationId === operationId);
      if (!mutation) return;
      mutation.state = 'queued';
      mutation.lastError = null;
      mutation.updatedAt = new Date().toISOString();
      await this.write(persisted, signal);
    });
  }

  async clear(signal?: AbortSignal): Promise<void> {
    return this.runExclusive(async () => {
      throwIfAborted(signal);
      await this.storage.removeItem(this.storageKey);
      throwIfAborted(signal);
    });
  }

  flush(executor: OutboxExecutor, signal?: AbortSignal): Promise<OutboxFlushResult> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.runExclusive(() => this.performFlush(executor, signal)).finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async performFlush(
    executor: OutboxExecutor,
    signal?: AbortSignal,
  ): Promise<OutboxFlushResult> {
    const persisted = parseOutbox(await this.storage.getItem(this.storageKey));
    let applied = 0;
    const conflicts: SyncConflict[] = persisted.mutations
      .filter((mutation) => mutation.state === 'conflict')
      .map((mutation) => ({
        operationId: mutation.operationId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        message: mutation.lastError?.message ?? 'Nicht aufgelöster Synchronisationskonflikt.',
        localValue: mutation.payload,
      }));
    const completed = new Set<string>();
    const known = new Set(persisted.mutations.map((entry) => entry.operationId));
    let madeProgress = true;

    while (madeProgress) {
      madeProgress = false;

      for (const mutation of [...persisted.mutations]) {
        throwIfAborted(signal);
        if (mutation.state !== 'queued') continue;
        const dependencies = mutation.dependsOn ?? [];
        const isBlocked = dependencies.some((dependency) => known.has(dependency) && !completed.has(dependency));
        if (isBlocked) continue;

        mutation.attempts += 1;
        mutation.updatedAt = new Date().toISOString();
        await this.write(persisted, signal);

        try {
          const response = await executor(mutation, signal);
          const nextRevision = revisionFromResult(response);
          persisted.mutations = persisted.mutations.filter((entry) => entry.operationId !== mutation.operationId);
          if (nextRevision !== null) {
            for (const queued of persisted.mutations) {
              if (
                queued.state === 'queued'
                && queued.entityType === mutation.entityType
                && queued.entityId === mutation.entityId
              ) {
                applyPredecessorRevision(queued, nextRevision);
              }
            }
          }
          completed.add(mutation.operationId);
          applied += 1;
          madeProgress = true;
          await this.write(persisted, signal);
        } catch (error) {
          const repositoryError = asRepositoryError(error);
          mutation.lastError = { code: repositoryError.code, message: repositoryError.message };
          mutation.updatedAt = new Date().toISOString();

          if (repositoryError.code === 'conflict' || !repositoryError.retryable) {
            mutation.state = 'conflict';
            conflicts.push({
              operationId: mutation.operationId,
              entityType: mutation.entityType,
              entityId: mutation.entityId,
              message: repositoryError.message,
              localValue: mutation.payload,
              serverValue: repositoryError.details?.serverValue,
            });
            madeProgress = true;
            await this.write(persisted, signal);
            continue;
          }

          await this.write(persisted, signal);
          return { applied, pending: persisted.mutations.length, conflicts };
        }
      }
    }

    return { applied, pending: persisted.mutations.length, conflicts };
  }

  private async write(value: PersistedOutbox, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.storage.setItem(this.storageKey, JSON.stringify(value));
    throwIfAborted(signal);
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class MemoryKeyValueStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
