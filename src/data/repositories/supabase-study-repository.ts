import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type { Database, Json } from '@/types/database.generated';
import {
  mapAccountProfile,
  mapFriendOverview,
  mapFriendSearchResult,
  mapFriendshipConnection,
  mapPullStudyChanges,
  mapSharedGoalProgress,
  mapSharedStudySession,
  mapSharingPreferences,
  mapStudyChallenge,
  mapStudyGroup,
} from '@/data/mappers/database-mappers';
import {
  asRepositoryError,
  StudyRepositoryError,
  throwIfAborted,
} from '@/data/repositories/repository-error';
import { LocalStudyRepository } from '@/data/repositories/local-study-repository';
import { avatarObjectPathFromUrl } from '@/lib/avatar-upload';
import type {
  CoreMutation,
  CreateSharedGoalInput,
  CreateSharedStudySessionInput,
  CreateStudyGroupInput,
  ImportChunk,
  ImportCounts,
  ImportRepository,
  LocalImportHandle,
  LocalImportManifest,
  LocalImportReport,
  SharedGoalProgressListener,
  SocialInvalidationKind,
  SocialUpdatesListener,
  SharedStudySessionParticipantAction,
  SocialRepository,
  StudyRepository,
  SyncResult,
  SyncStatus,
  UpdateAccountProfileInput,
  UpdateSharingPreferencesInput,
  UploadAvatarInput,
} from '@/data/repositories/study-repository';
import { PersistentOutbox, type KeyValueStorage } from '@/services/sync/outbox';
import { diffStudySnapshots } from '@/services/sync/sync-engine';
import { createSharedGoalProgressSubscription } from '@/services/realtime/shared-goal-subscription';

type RpcResponse = { data: unknown; error: unknown };
type AbortableRpc = PromiseLike<RpcResponse> & { abortSignal?: (signal: AbortSignal) => AbortableRpc };

const emptyCounts = (): ImportCounts => ({
  subjects: 0,
  goals: 0,
  sessions: 0,
  grades: 0,
  gradeSessionLinks: 0,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rpcRows(value: unknown, ...keys: string[]): readonly unknown[] {
  if (Array.isArray(value)) return value;
  const row = asRecord(value);
  for (const key of keys) {
    if (Array.isArray(row[key])) return row[key] as readonly unknown[];
  }
  return [];
}

function isLifecycleTombstone(
  value: unknown,
  idKeys: readonly string[],
): boolean {
  const row = asRecord(value);
  const status = readString(row, 'status');
  return Boolean(
    status &&
    ['declined', 'left'].includes(status) &&
    idKeys.some((key) => typeof row[key] === 'string'),
  );
}

const SOCIAL_INVALIDATION_KINDS = new Set<SocialInvalidationKind>([
  'presence',
  'profile',
  'friendship',
  'shared_session',
  'shared_session_progress',
  'shared_goal',
  'shared_goal_progress',
  'study_group',
  'social',
]);

const AVATAR_SERVER_PERSISTENCE_ERROR_MESSAGE = 'Das Profilbild konnte serverseitig nicht gespeichert werden.';

function socialInvalidationKind(message: unknown): SocialInvalidationKind {
  const payload = asRecord(asRecord(message).payload);
  const kind = readString(payload, 'kind');
  return kind && SOCIAL_INVALIDATION_KINDS.has(kind as SocialInvalidationKind)
    ? kind as SocialInvalidationKind
    : 'social';
}

const SOCIAL_REALTIME_RETRY_DELAY_MS = 600;
const SOCIAL_REALTIME_UNAVAILABLE_MESSAGE = 'Der Live-Status ist momentan nicht verfügbar. Die Freundesfunktionen können weiterhin verwendet werden.';
type SocialRealtimeCleanup = () => Promise<void>;

const activePrivateRealtimeSubscriptions = new WeakMap<
  object,
  Map<string, SocialRealtimeCleanup>
>();

function activePrivateSubscriptionsFor(client: object): Map<string, SocialRealtimeCleanup> {
  const existing = activePrivateRealtimeSubscriptions.get(client);
  if (existing) return existing;
  const created = new Map<string, SocialRealtimeCleanup>();
  activePrivateRealtimeSubscriptions.set(client, created);
  return created;
}

interface PrivateBroadcastSubscriptionOptions {
  topic: string;
  event: string;
  signal?: AbortSignal;
  onMessage: (message: unknown) => void;
  onError?: (error: Error) => void;
  onReconnected?: () => void;
  onSubscribed?: () => void;
}

function realtimeErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return String(error ?? '');
  const record = error as Record<string, unknown>;
  return [record.code, record.message, record.reason, record.error]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

function isMissingRealtimePartition(error: unknown): boolean {
  return /MissingPartition|expected messages partition/i.test(realtimeErrorText(error));
}

function logSocialRealtimeFailure(topic: string, status: string, error: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[social-realtime] Channel-Verbindung fehlgeschlagen', {
      topic,
      status,
      error,
    });
  }
}

function socialRealtimeUnavailableError(
  topic: string,
  status: string,
  error: unknown,
): StudyRepositoryError {
  return new StudyRepositoryError('unavailable', SOCIAL_REALTIME_UNAVAILABLE_MESSAGE, {
    cause: error,
    details: {
      topic,
      status,
      missingPartition: isMissingRealtimePartition(error),
    },
  });
}

/**
 * Maps a Supabase Storage error to a user-facing message without leaking
 * secrets or tokens. Distinguishes a missing bucket/policy from a generic
 * rejection so the UI can guide the person accordingly.
 */
function describeAvatarUploadError(error: unknown): StudyRepositoryError {
  const details = asRecord(error);
  const rawMessage = [details.message, details.error, details.code]
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .join(' ');
  const message = rawMessage.toLowerCase();
  const numericStatus = Number(details.statusCode ?? details.status ?? 0);

  if (numericStatus === 404 || message.includes('bucket not found') || message.includes('no such bucket')) {
    return new StudyRepositoryError(
      'not_found',
      'Der Speicher für Profilbilder fehlt (Bucket „avatars"). Bitte richte den öffentlichen Bucket samt Policies ein.',
      { cause: error },
    );
  }

  if (
    numericStatus === 401
    || message.includes('jwt')
    || message.includes('token')
    || message.includes('not authenticated')
  ) {
    return new StudyRepositoryError(
      'unauthorized',
      'Deine Supabase-Anmeldung ist abgelaufen. Melde dich erneut an und versuche den Upload noch einmal.',
      { cause: error },
    );
  }

  if (
    numericStatus === 403
    || message.includes('row-level security')
    || message.includes('policy')
    || message.includes('unauthorized')
    || message.includes('forbidden')
    || message.includes('permission')
  ) {
    return new StudyRepositoryError(
      'forbidden',
      'Für Profilbilder fehlt die Storage-Freigabe (Bucket oder Policy).',
      { cause: error },
    );
  }

  if (
    message.includes('maximum allowed size')
    || message.includes('payload too large')
    || numericStatus === 413
  ) {
    return new StudyRepositoryError(
      'invalid_data',
      'Das ausgewählte Profilbild ist für den Supabase-Upload zu groß.',
      { cause: error },
    );
  }

  if (
    message.includes('mime')
    || message.includes('content type')
    || message.includes('unsupported media')
    || numericStatus === 415
  ) {
    return new StudyRepositoryError(
      'invalid_data',
      'Dieses Bildformat wird vom Supabase-Bucket nicht akzeptiert.',
      { cause: error },
    );
  }

  if (
    message.includes('network')
    || message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('timed out')
  ) {
    return new StudyRepositoryError(
      'network_error',
      'Der Profilbild-Upload konnte Supabase nicht erreichen. Prüfe deine Internetverbindung.',
      { cause: error },
    );
  }

  return new StudyRepositoryError(
    'server_error',
    'Der Upload wurde von Supabase abgelehnt.',
    { cause: error },
  );
}

function describeAvatarPersistenceError(error: unknown): StudyRepositoryError {
  const normalized = asRepositoryError(error);
  if (normalized.code === 'cancelled') return normalized;

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error('[avatar] set_my_avatar fehlgeschlagen', error);
  }

  return new StudyRepositoryError(
    'server_error',
    AVATAR_SERVER_PERSISTENCE_ERROR_MESSAGE,
    { cause: error, retryable: normalized.retryable },
  );
}

function readString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof row[key] === 'string') return row[key] as string;
  }
  return null;
}

function readNumber(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function mapCounts(value: unknown): ImportCounts {
  const row = asRecord(value);
  return {
    subjects: readNumber(row, 'subjects'),
    goals: readNumber(row, 'goals'),
    sessions: readNumber(row, 'sessions'),
    grades: readNumber(row, 'grades'),
    gradeSessionLinks: readNumber(row, 'grade_session_links', 'gradeSessionLinks'),
  };
}

function mapImportHandle(value: unknown): LocalImportHandle {
  const row = asRecord(value);
  const importId = readString(row, 'import_id', 'importId');
  if (!importId) throw new StudyRepositoryError('invalid_data', 'Die Importantwort enthält keine Import-ID.');
  const rawState = readString(row, 'state', 'status');
  const state = rawState === 'completed' || rawState === 'completed_with_conflicts'
    ? rawState
    : 'staging';
  const indices = row.accepted_chunk_indices ?? row.acceptedChunkIndices;
  const acceptedIndex = readNumber(row, 'chunk_index', 'chunkIndex');
  return {
    importId,
    state,
    acceptedChunkIndices: Array.isArray(indices)
      ? indices.filter((entry): entry is number => Number.isInteger(entry))
      : row.accepted === true ? [acceptedIndex] : [],
  };
}

function mapImportReport(value: unknown): LocalImportReport {
  const outer = asRecord(value);
  const row = asRecord(outer.result ?? value);
  const handle = mapImportHandle({ ...outer, ...row });
  const conflicts = Array.isArray(row.conflicts) ? row.conflicts : [];
  return {
    ...handle,
    imported: row.imported || row.inserted ? mapCounts(row.imported ?? row.inserted) : emptyCounts(),
    duplicates: row.duplicates ? mapCounts(row.duplicates) : emptyCounts(),
    conflicts: conflicts.map((entry) => {
      const conflict = asRecord(entry);
      const rawType = readString(conflict, 'entity_type', 'entityType');
      const entityType = rawType === 'subjects' || rawType === 'subject'
        ? 'subjects'
        : rawType === 'goals' || rawType === 'goal'
          ? 'goals'
          : rawType === 'grades' || rawType === 'grade' || rawType === 'grade_session'
            ? 'grades'
            : 'sessions';
      const rawReason = readString(conflict, 'reason');
      const reason = rawReason === 'different_content' || rawReason === 'content_changed'
        ? 'different_content'
        : rawReason === 'invalid_reference' || rawReason?.endsWith('_unmapped')
          ? 'invalid_reference'
          : rawReason === 'deleted_on_server'
            ? 'deleted_on_server'
            : 'invalid_data';
      return {
        entityType,
        localId: readString(conflict, 'local_id', 'localId') ?? '',
        reason,
        message: readString(conflict, 'message') ?? 'Importkonflikt',
        serverId: readString(conflict, 'server_id', 'serverId') ?? undefined,
      };
    }),
  };
}

export interface SupabaseStudyRepositoryOptions {
  client: SupabaseClient<Database>;
  accountId: string;
  storage: KeyValueStorage;
  cacheSnapshotKey?: string;
  cacheStoreSchemaVersion?: number;
}

export class SupabaseStudyRepository implements StudyRepository {
  readonly mode = 'supabase' as const;
  readonly accountId: string;
  readonly social: SocialRepository;
  readonly imports: ImportRepository;

  private readonly client: SupabaseClient<Database>;
  private readonly storage: KeyValueStorage;
  private readonly cache: LocalStudyRepository;
  private readonly outbox: PersistentOutbox;
  private readonly cursorKey: string;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private readonly realtimeCleanups = new Set<() => Promise<void>>();
  private readonly disposeController = new AbortController();
  private lastSnapshot: StudyStateSnapshot | null = null;
  private disposed = false;
  private status: SyncStatus = {
    phase: 'idle',
    pendingMutationCount: 0,
    lastSyncedAt: null,
    lastError: null,
  };

  constructor(options: SupabaseStudyRepositoryOptions) {
    const accountId = options.accountId.trim();
    if (!accountId) throw new Error('SupabaseStudyRepository benötigt eine Konto-ID.');
    this.client = options.client;
    this.accountId = accountId;
    this.storage = options.storage;
    const scope = `account-${accountId}`;
    this.cache = new LocalStudyRepository({
      storage: options.storage,
      storageScope: scope,
      snapshotKey: options.cacheSnapshotKey,
      storeSchemaVersion: options.cacheStoreSchemaVersion,
      externallyPersisted: Boolean(options.cacheSnapshotKey),
    });
    this.outbox = new PersistentOutbox(options.storage, `lernzeit.outbox.v1.${scope}`);
    this.cursorKey = `lernzeit.sync-cursor.v1.${scope}`;
    this.social = this.createSocialRepository();
    this.imports = this.createImportRepository();
  }

  async loadSnapshot(signal?: AbortSignal): Promise<StudyStateSnapshot | null> {
    this.ensureAvailable();
    this.lastSnapshot = await this.cache.loadSnapshot(signal);
    await this.updatePendingCount(signal);
    return this.lastSnapshot;
  }

  async saveSnapshot(snapshot: StudyStateSnapshot, signal?: AbortSignal): Promise<void> {
    this.ensureAvailable();
    throwIfAborted(signal);
    const previous = this.lastSnapshot ?? await this.cache.loadSnapshot(signal);
    const mutations = diffStudySnapshots(previous, snapshot);
    for (const mutation of mutations) await this.outbox.enqueue(mutation, signal);
    await this.cache.saveSnapshot(snapshot, signal);
    this.lastSnapshot = snapshot;
    await this.updatePendingCount(signal);
  }

  async refresh(signal?: AbortSignal): Promise<StudyStateSnapshot | null> {
    this.ensureAvailable();
    throwIfAborted(signal);
    const current = this.lastSnapshot ?? await this.cache.loadSnapshot(signal);
    const cursor = await this.storage.getItem(this.cursorKey);
    const data = await this.rpc('pull_my_study_changes', {
      p_after_sync_version: Number(cursor ?? 0),
    }, signal);
    const mapped = mapPullStudyChanges(data, current);
    await this.cache.saveSnapshot(mapped.snapshot, signal);
    await this.storage.setItem(this.cursorKey, mapped.syncVersion);
    this.lastSnapshot = mapped.snapshot;
    return mapped.snapshot;
  }

  async enqueueMutation(mutation: CoreMutation, signal?: AbortSignal): Promise<void> {
    this.ensureAvailable();
    await this.outbox.enqueue(mutation, signal);
    await this.updatePendingCount(signal);
  }

  async sync(signal?: AbortSignal): Promise<SyncResult> {
    this.ensureAvailable();
    this.updateStatus({ ...this.status, phase: 'syncing', lastError: null });
    try {
      const flushed = await this.outbox.flush((mutation, innerSignal) => this.executeMutation(mutation, innerSignal), signal);
      const snapshot = await this.refresh(signal);
      const cursor = await this.storage.getItem(this.cursorKey);
      const now = new Date().toISOString();
      this.updateStatus({
        phase: flushed.conflicts.length > 0 ? 'conflict' : 'idle',
        pendingMutationCount: flushed.pending,
        lastSyncedAt: now,
        lastError: null,
      });
      return {
        snapshot,
        appliedMutationCount: flushed.applied,
        pendingMutationCount: flushed.pending,
        conflicts: flushed.conflicts,
        syncVersion: cursor,
      };
    } catch (error) {
      const normalized = asRepositoryError(error);
      const pending = await this.outbox.count().catch(() => this.status.pendingMutationCount);
      this.updateStatus({
        ...this.status,
        phase: normalized.code === 'network_error' || normalized.code === 'offline' ? 'offline' : 'error',
        pendingMutationCount: pending,
        lastError: { code: normalized.code, message: normalized.message, retryable: normalized.retryable },
      });
      throw normalized;
    }
  }

  getSyncStatus(): SyncStatus {
    return this.status;
  }

  subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  async subscribeSharedGoalProgress(
    goalId: string,
    listener: SharedGoalProgressListener,
    signal?: AbortSignal,
  ): Promise<() => Promise<void>> {
    this.ensureAvailable();
    throwIfAborted(signal);
    const cleanGoalId = goalId.trim();
    if (!cleanGoalId) throw new StudyRepositoryError('invalid_data', 'Die Ziel-ID fehlt.');

    let cleanup: (() => Promise<void>) | null = null;
    cleanup = await createSharedGoalProgressSubscription({
      signal,
      listener,
      fetchProgress: (fetchSignal) => this.social.getSharedGoalProgress(cleanGoalId, fetchSignal),
      startInvalidationListener: (onInvalidated, onTransportError) => (
        this.subscribePrivateBroadcast({
          topic: `shared-goal:${cleanGoalId}`,
          event: 'progress_invalidated',
          signal,
          onMessage: onInvalidated,
          onReconnected: onInvalidated,
          onError: onTransportError,
        })
      ),
    });
    const trackedCleanup = async () => {
      if (!cleanup) return;
      const active = cleanup;
      cleanup = null;
      this.realtimeCleanups.delete(trackedCleanup);
      await active();
    };
    this.realtimeCleanups.add(trackedCleanup);
    return trackedCleanup;
  }

  async subscribeSocialUpdates(
    listener: SocialUpdatesListener,
    signal?: AbortSignal,
  ): Promise<() => Promise<void>> {
    return this.subscribePrivateBroadcast({
      topic: `social:user:${this.accountId}`,
      event: 'social_invalidated',
      signal,
      onMessage: (message) => listener.onInvalidated(socialInvalidationKind(message)),
      onReconnected: () => listener.onInvalidated('social'),
      onError: listener.onError,
      onSubscribed: listener.onSubscribed,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeController.abort();
    await Promise.all([...this.realtimeCleanups].map((cleanup) => cleanup()));
    this.realtimeCleanups.clear();
    this.listeners.clear();
  }

  private async subscribePrivateBroadcast(
    options: PrivateBroadcastSubscriptionOptions,
  ): Promise<SocialRealtimeCleanup> {
    this.ensureAvailable();
    throwIfAborted(options.signal);
    const { topic } = options;
    const registry = activePrivateSubscriptionsFor(this.client);
    const previousCleanup = registry.get(topic);
    let subscribedOnce = false;
    let disposed = false;
    let activeChannel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveRetryDelay: (() => void) | null = null;
    let cleanupTask: Promise<void> | null = null;

    const removeActiveChannel = async (expected?: RealtimeChannel): Promise<void> => {
      const channel = activeChannel;
      if (!channel || (expected && channel !== expected)) return;
      activeChannel = null;
      try {
        await this.client.removeChannel(channel);
      } catch (error) {
        logSocialRealtimeFailure(topic, 'REMOVE_FAILED', error);
      }
    };

    const cleanup = async (): Promise<void> => {
      if (cleanupTask) return cleanupTask;
      cleanupTask = (async () => {
        disposed = true;
        options.signal?.removeEventListener('abort', abort);
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
          resolveRetryDelay?.();
          resolveRetryDelay = null;
        }
        if (registry.get(topic) === cleanup) registry.delete(topic);
        this.realtimeCleanups.delete(cleanup);
        await removeActiveChannel();
      })();
      return cleanupTask;
    };
    const abort = () => { void cleanup(); };
    options.signal?.addEventListener('abort', abort, { once: true });

    // Register before the first await. Concurrent effect setup disposes the
    // previous owner before either call can create a duplicate topic.
    registry.set(topic, cleanup);
    this.realtimeCleanups.add(cleanup);

    if (previousCleanup && previousCleanup !== cleanup) await previousCleanup();
    if (disposed || options.signal?.aborted || registry.get(topic) !== cleanup) return cleanup;

    const waitBeforeRetry = (): Promise<void> => new Promise((resolve) => {
      resolveRetryDelay = resolve;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        resolveRetryDelay = null;
        resolve();
      }, SOCIAL_REALTIME_RETRY_DELAY_MS);
    });

    const startChannel = async (attempt: 0 | 1): Promise<void> => {
      await this.authenticateRealtime();
      if (disposed || options.signal?.aborted || registry.get(topic) !== cleanup) return;

      let failureHandled = false;
      const channel = this.client
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: options.event }, (message) => {
          if (!disposed && activeChannel === channel) options.onMessage(message);
        });
      activeChannel = channel;
      channel.subscribe((status, error) => {
        if (disposed || activeChannel !== channel) return;
        if (status === 'SUBSCRIBED') {
          options.onSubscribed?.();
          if (subscribedOnce) options.onReconnected?.();
          subscribedOnce = true;
          return;
        }
        if (
          status !== 'CHANNEL_ERROR'
          && status !== 'TIMED_OUT'
          && status !== 'CLOSED'
        ) return;
        if (failureHandled) return;
        failureHandled = true;
        const originalError = error ?? new Error(`Realtime-Status: ${status}`);
        logSocialRealtimeFailure(topic, status, originalError);

        void (async () => {
          await removeActiveChannel(channel);
          if (disposed) return;
          if (attempt === 1) {
            options.onError?.(socialRealtimeUnavailableError(topic, status, originalError));
            return;
          }

          await waitBeforeRetry();
          if (disposed) return;
          try {
            // Reload the session exactly once, forward its current JWT, and
            // only then create the single replacement private channel.
            await startChannel(1);
          } catch (retryError) {
            logSocialRealtimeFailure(topic, 'RETRY_FAILED', retryError);
            if (!disposed) {
              options.onError?.(socialRealtimeUnavailableError(topic, 'RETRY_FAILED', retryError));
            }
          }
        })();
      });
    };

    try {
      await startChannel(0);
    } catch (initialError) {
      logSocialRealtimeFailure(topic, 'AUTH_ERROR', initialError);
      await waitBeforeRetry();
      if (disposed) return cleanup;
      try {
        await startChannel(1);
      } catch (retryError) {
        logSocialRealtimeFailure(topic, 'RETRY_FAILED', retryError);
        await cleanup();
        throw socialRealtimeUnavailableError(topic, 'RETRY_FAILED', retryError);
      }
    }

    return cleanup;
  }

  private async authenticateRealtime(): Promise<void> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      throw new StudyRepositoryError('unauthorized', 'Die Anmeldung ist abgelaufen.', {
        cause: error,
      });
    }
    const session = data.session;
    if (!session?.access_token || session.user.id !== this.accountId) {
      throw new StudyRepositoryError('unauthorized', 'Für den Live-Status fehlt eine gültige Anmeldung.', {
        retryable: false,
      });
    }
    await this.client.realtime.setAuth(session.access_token);
  }

  private createSocialRepository(): SocialRepository {
    return {
      getMyProfile: async (signal) => mapAccountProfile(await this.rpc('get_my_profile', {}, signal)),
      updateMyProfile: async (input: UpdateAccountProfileInput, signal) => mapAccountProfile(await this.rpc('update_my_profile', {
        p_username: input.username.trim().toLowerCase(),
        p_display_name: input.displayName.trim(),
        p_avatar_url: input.avatarUrl,
        p_time_zone: input.timeZone,
        p_expected_revision: input.expectedRevision,
      }, signal)),
      uploadAvatar: async (input: UploadAvatarInput, signal) => {
        throwIfAborted(signal);
        if (input.userId !== this.accountId) {
          throw new StudyRepositoryError('forbidden', 'Profilbilder können nur im eigenen Konto gespeichert werden.');
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.objectId)) {
          throw new StudyRepositoryError('invalid_data', 'Die Profilbild-ID ist ungültig.');
        }
        if (!['jpg', 'png', 'webp'].includes(input.fileExtension)) {
          throw new StudyRepositoryError('invalid_data', 'Dieses Profilbildformat wird nicht unterstützt.');
        }
        const path = `${input.userId}/profile/${input.objectId}.${input.fileExtension}`;
        const { error } = await this.client.storage.from('avatars').upload(path, input.body, {
          cacheControl: '31536000',
          contentType: input.contentType,
          upsert: false,
        });
        if (error) {
          throw describeAvatarUploadError(error);
        }
        throwIfAborted(signal);
        return { objectPath: path };
      },
      setMyAvatar: async (objectPath, signal) => {
        try {
          const result = asRecord(await this.rpc(
            'set_my_avatar',
            { p_object_path: objectPath },
            signal,
          ));
          return {
            profile: mapAccountProfile(result),
            previousAvatarUrl: readString(result, 'previous_avatar_url', 'previousAvatarUrl'),
          };
        } catch (error) {
          throw describeAvatarPersistenceError(error);
        }
      },
      deleteAvatarObject: async (userId, objectPath, signal) => {
        throwIfAborted(signal);
        if (userId !== this.accountId || !objectPath.startsWith(`${userId}/profile/`)) {
          throw new StudyRepositoryError('forbidden', 'Profilbilder können nur im eigenen Konto gelöscht werden.');
        }
        const { error } = await this.client.storage.from('avatars').remove([objectPath]);
        if (error) throw describeAvatarUploadError(error);
        throwIfAborted(signal);
      },
      cleanupAvatarObjects: async (
        userId,
        keepObjectPath,
        previousAvatarUrl,
        signal,
      ) => {
        throwIfAborted(signal);
        if (userId !== this.accountId || !keepObjectPath.startsWith(`${userId}/profile/`)) {
          throw new StudyRepositoryError('forbidden', 'Profilbilder können nur im eigenen Konto bereinigt werden.');
        }
        const profile = mapAccountProfile(await this.rpc('get_my_profile', {}, signal));
        const currentPath = avatarObjectPathFromUrl(profile.avatarUrl, userId);
        const stalePaths = new Set<string>();
        const previousPath = avatarObjectPathFromUrl(previousAvatarUrl, userId);
        if (previousPath && previousPath !== currentPath && previousPath !== keepObjectPath) {
          stalePaths.add(previousPath);
        }

        const serverCandidates = rpcRows(
          await this.rpc('list_my_stale_avatar_objects', {}, signal),
          'object_paths',
        );
        const canonicalPathPattern = new RegExp(
          `^${userId}/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|webp)$`,
          'i',
        );
        const legacyPathPattern = new RegExp(
          `^${userId}/avatar\\.(jpg|jpeg|png|webp)$`,
          'i',
        );
        for (const candidate of serverCandidates) {
          if (typeof candidate !== 'string') continue;
          if (
            (canonicalPathPattern.test(candidate) || legacyPathPattern.test(candidate))
            && candidate !== currentPath
            && candidate !== keepObjectPath
          ) {
            stalePaths.add(candidate);
          }
        }

        const storage = this.client.storage.from('avatars');
        const failures: unknown[] = [];
        for (const stalePath of stalePaths) {
          throwIfAborted(signal);
          const { error } = await storage.remove([stalePath]);
          if (!error) continue;

          // A second device may have made this object current after listing.
          // The Storage policy rejects that race; confirm it before deciding
          // whether this is an actual maintenance failure.
          try {
            const latest = mapAccountProfile(await this.rpc('get_my_profile', {}, signal));
            if (avatarObjectPathFromUrl(latest.avatarUrl, userId) === stalePath) continue;
          } catch {
            // Preserve the original Storage error below.
          }
          failures.push(error);
        }
        if (failures.length > 0) throw describeAvatarUploadError(failures[0]);
        throwIfAborted(signal);
      },
      getSharingPreferences: async (signal) => mapSharingPreferences(await this.rpc('get_my_profile', {}, signal)),
      updateSharingPreferences: async (input: UpdateSharingPreferencesInput, signal) => mapSharingPreferences(await this.rpc('update_privacy_settings', {
        p_share_timer_stats: input.shareTimerStats,
        p_share_manual_stats: input.shareManualStats,
        p_share_goal_progress: input.shareGoalProgress,
        p_share_streak: input.shareStreak,
        p_expected_revision: input.expectedRevision,
      }, signal)),
      findProfileByExactUsername: async (username, signal) => {
        return mapFriendSearchResult(await this.rpc('find_profile_by_exact_username', {
          p_username: username.trim().replace(/^@/, '').toLowerCase(),
        }, signal));
      },
      listFriendConnections: async (signal) => {
        const data = await this.rpc('list_friend_connections', {}, signal);
        const rows = Array.isArray(data) ? data : asRecord(data).connections;
        return (Array.isArray(rows) ? rows : []).map(mapFriendshipConnection);
      },
      sendFriendRequest: async (username, signal) => mapFriendshipConnection(await this.rpc('send_friend_request', {
        p_username: username.trim().replace(/^@/, '').toLowerCase(),
      }, signal)),
      acceptFriendRequest: async (friendshipId, signal) => mapFriendshipConnection(await this.rpc('accept_friend_request', {
        p_friendship_id: friendshipId,
      }, signal)),
      declineFriendRequest: async (friendshipId, signal) => mapFriendshipConnection(await this.rpc('decline_friend_request', {
        p_friendship_id: friendshipId,
      }, signal)),
      removeFriendship: async (friendshipId, signal) => {
        await this.rpc('remove_friendship', { p_friendship_id: friendshipId }, signal);
      },
      getFriendOverview: async (friendId, signal) => mapFriendOverview(await this.rpc('get_friend_overview', {
        p_friend_id: friendId,
      }, signal)),
      listFriendOverviews: async (signal) => rpcRows(
        await this.rpc('list_friend_overviews', {}, signal),
        'friend_overviews',
        'overviews',
        'friends',
      ).map(mapFriendOverview),
      createSharedGoal: async (input: CreateSharedGoalInput, signal) => mapStudyChallenge(await this.rpc('create_shared_goal', {
        p_goal: {
          ...input.goal,
          cadence: input.goal.cadence ?? (input.goal.period === 'day' ? 'daily' : 'weekly'),
          group_id: input.goal.groupId ?? null,
          period: input.goal.period,
          source_policy: input.goal.sourcePolicy,
          starts_at: input.goal.startsAt ?? null,
          ends_at: input.goal.endsAt ?? null,
          target_minutes: input.goal.targetMinutes,
          target_sessions: input.goal.targetSessions,
          minimum_session_minutes: input.goal.minimumSessionMinutes,
        } as unknown as Json,
        p_invitee_ids: [...input.inviteeIds],
        p_operation_id: input.operationId,
      }, signal)),
      respondSharedGoalInvitation: async (goalId, accept, signal) => {
        const result = await this.rpc('respond_shared_goal_invitation', {
          p_goal_id: goalId,
          p_accept: accept,
        }, signal);
        return isLifecycleTombstone(result, ['goal_id', 'goalId'])
          ? null
          : mapStudyChallenge(result);
      },
      withdrawFromSharedGoal: async (goalId, signal) => {
        await this.rpc('withdraw_from_shared_goal', { p_goal_id: goalId }, signal);
      },
      getSharedGoalDetails: async (goalId, signal) => mapStudyChallenge(await this.rpc('get_shared_goal_details', {
        p_goal_id: goalId,
      }, signal)),
      getSharedGoalProgress: async (goalId, signal) => mapSharedGoalProgress(await this.rpc('get_shared_goal_progress', {
        p_goal_id: goalId,
      }, signal)),
      listSharedGoalProgress: async (signal) => rpcRows(
        await this.rpc('list_shared_goal_progress', {}, signal),
        'shared_goal_progress',
        'progress',
        'goals',
      ).map(mapSharedGoalProgress),
      listSharedGoals: async (signal) => rpcRows(
        await this.rpc('list_shared_goals', {}, signal),
        'shared_goals',
        'goals',
      ).map(mapStudyChallenge),
      listStudyGroups: async (signal) => rpcRows(
        await this.rpc('list_study_groups', {}, signal),
        'study_groups',
        'groups',
      ).map(mapStudyGroup),
      getStudyGroupDetails: async (groupId, signal) => mapStudyGroup(await this.rpc('get_study_group_details', {
        p_group_id: groupId,
      }, signal)),
      createStudyGroup: async (input: CreateStudyGroupInput, signal) => mapStudyGroup(await this.rpc('create_study_group', {
        p_group: {
          id: input.group.id,
          name: input.group.name,
          icon: input.group.icon,
          image_url: input.group.imageUrl ?? null,
        } as unknown as Json,
        p_member_ids: [...input.memberIds],
        p_operation_id: input.operationId,
      }, signal)),
      respondStudyGroupInvitation: async (groupId, accept, signal) => {
        const result = await this.rpc('respond_study_group_invitation', {
          p_group_id: groupId,
          p_accept: accept,
        }, signal);
        return isLifecycleTombstone(result, ['group_id', 'groupId']) ? null : mapStudyGroup(result);
      },
      leaveStudyGroup: async (groupId, signal) => {
        await this.rpc('leave_study_group', { p_group_id: groupId }, signal);
      },
      listSharedStudySessions: async (signal) => rpcRows(
        await this.rpc('list_shared_study_sessions', {}, signal),
        'shared_study_sessions',
        'sessions',
      ).map(mapSharedStudySession),
      getSharedStudySessionDetails: async (sessionId, signal) => mapSharedStudySession(await this.rpc('get_shared_study_session_details', {
        p_session_id: sessionId,
      }, signal)),
      createSharedStudySession: async (input: CreateSharedStudySessionInput, signal) => mapSharedStudySession(await this.rpc('create_shared_study_session', {
        p_session: {
          id: input.session.id,
          title: input.session.title,
          group_id: input.session.groupId ?? null,
          starts_at: input.session.startsAt,
          planned_duration_minutes: input.session.plannedDurationMinutes,
          start_now: input.session.startNow,
        } as unknown as Json,
        p_invitee_ids: [...input.inviteeIds],
        p_operation_id: input.operationId,
      }, signal)),
      respondSharedStudySessionInvitation: async (sessionId, accept, signal) => {
        const result = await this.rpc('respond_shared_study_session_invitation', {
          p_session_id: sessionId,
          p_accept: accept,
        }, signal);
        return isLifecycleTombstone(result, ['session_id', 'sessionId'])
          ? null
          : mapSharedStudySession(result);
      },
      updateSharedStudySessionParticipant: async (
        sessionId,
        action: SharedStudySessionParticipantAction,
        signal,
      ) => {
        const result = await this.rpc('update_shared_study_session_participant', {
          p_session_id: sessionId,
          p_action: action,
        }, signal);
        return isLifecycleTombstone(result, ['session_id', 'sessionId'])
          ? null
          : mapSharedStudySession(result);
      },
      cancelSharedStudySession: async (sessionId, signal) => {
        const result = await this.rpc('cancel_shared_study_session', {
          p_session_id: sessionId,
        }, signal);
        return result == null ? null : mapSharedStudySession(result);
      },
      updateLearningPresence: async (deviceId, state, activeSince, signal) => {
        await this.rpc('update_learning_presence', {
          p_device_id: deviceId,
          p_state: state,
          p_active_since: activeSince,
        }, signal);
      },
    };
  }

  private createImportRepository(): ImportRepository {
    return {
      begin: async (manifest: LocalImportManifest, signal) => mapImportHandle(await this.rpc('begin_local_import', {
        p_device_fingerprint: manifest.deviceFingerprint,
        p_payload_hash: manifest.payloadHash,
        p_expected_counts: manifest.counts as unknown as Json,
      }, signal)),
      stageChunk: async (importId: string, chunk: ImportChunk, signal) => mapImportHandle(await this.rpc('stage_local_import_chunk', {
        p_import_id: importId,
        p_chunk_index: chunk.index,
        p_chunk_hash: chunk.hash,
        p_payload: { [chunk.entityType]: chunk.payload } as unknown as Json,
      }, signal)),
      finalize: async (importId: string, signal) => mapImportReport(await this.rpc('finalize_local_import', {
        p_import_id: importId,
      }, signal)),
      getStatus: async (importId: string, signal) => {
        const data = await this.rpc('get_local_import_status', { p_import_id: importId }, signal);
        const handle = mapImportHandle(data);
        return handle.state === 'staging' ? handle : mapImportReport(data);
      },
    };
  }

  private async executeMutation(mutation: CoreMutation, signal?: AbortSignal): Promise<unknown> {
    switch (mutation.name) {
      case 'upsert_subject':
        return this.rpc('upsert_subject', { p_subject: mutation.payload as Json, p_operation_id: mutation.operationId }, signal);
      case 'soft_delete_subject':
        return this.rpc('soft_delete_subject', {
          p_id: mutation.entityId,
          p_expected_revision: mutation.expectedRevision ?? 0,
          p_operation_id: mutation.operationId,
        }, signal);
      case 'upsert_personal_goal':
        return this.rpc('upsert_personal_goal', { p_goal: mutation.payload as Json, p_operation_id: mutation.operationId }, signal);
      case 'soft_delete_personal_goal':
        return this.rpc('soft_delete_personal_goal', {
          p_id: mutation.entityId,
          p_expected_revision: mutation.expectedRevision ?? 0,
          p_operation_id: mutation.operationId,
        }, signal);
      case 'transition_personal_goal':
        return this.rpc('transition_personal_goal', {
          p_goal_id: mutation.entityId,
          p_status: String(mutation.payload.status ?? ''),
          p_at: String(mutation.payload.at ?? new Date().toISOString()),
          p_expected_revision: mutation.expectedRevision ?? 0,
          p_operation_id: mutation.operationId,
        }, signal);
      case 'save_completed_session':
        return this.rpc('save_completed_session', { p_session: mutation.payload as Json, p_operation_id: mutation.operationId }, signal);
      case 'soft_delete_session':
        return this.rpc('soft_delete_session', {
          p_id: mutation.entityId,
          p_expected_revision: mutation.expectedRevision ?? 0,
          p_operation_id: mutation.operationId,
        }, signal);
      case 'upsert_grade':
        return this.rpc('upsert_grade', { p_grade: mutation.payload as Json, p_operation_id: mutation.operationId }, signal);
      case 'soft_delete_grade':
        return this.rpc('soft_delete_grade', {
          p_id: mutation.entityId,
          p_expected_revision: mutation.expectedRevision ?? 0,
          p_operation_id: mutation.operationId,
        }, signal);
    }
  }

  private async rpc(
    functionName: keyof Database['public']['Functions'],
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.ensureAvailable();
    throwIfAborted(signal);
    throwIfAborted(this.disposeController.signal);
    const requestController = new AbortController();
    const abortFromCaller = () => requestController.abort(signal?.reason);
    const abortFromDispose = () => requestController.abort(this.disposeController.signal.reason);
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    this.disposeController.signal.addEventListener('abort', abortFromDispose, { once: true });
    try {
      const rpc = this.client.rpc.bind(this.client) as unknown as (
        name: string,
        values?: Record<string, unknown>,
      ) => AbortableRpc;
      let request = rpc(functionName, args);
      if (typeof request.abortSignal === 'function') request = request.abortSignal(requestController.signal);
      const { data, error } = await request;
      throwIfAborted(requestController.signal);
      if (error) throw asRepositoryError(error);
      return data;
    } catch (error) {
      throw asRepositoryError(error);
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
      this.disposeController.signal.removeEventListener('abort', abortFromDispose);
    }
  }

  private async updatePendingCount(signal?: AbortSignal): Promise<void> {
    const pendingMutationCount = await this.outbox.count(signal);
    this.updateStatus({ ...this.status, pendingMutationCount });
  }

  private updateStatus(status: SyncStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  private ensureAvailable(): void {
    if (this.disposed) throw new StudyRepositoryError('unavailable', 'Das Repository wurde bereits geschlossen.');
  }
}

export function createSupabaseStudyRepository(
  options: SupabaseStudyRepositoryOptions,
): SupabaseStudyRepository {
  return new SupabaseStudyRepository(options);
}
