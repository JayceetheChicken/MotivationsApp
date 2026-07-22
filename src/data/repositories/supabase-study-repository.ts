import type { SupabaseClient } from '@supabase/supabase-js';

import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type { Database, Json } from '@/types/database.generated';
import {
  mapAccountProfile,
  mapFriendProfileStatistics,
  mapFriendSearchResult,
  mapFriendshipConnection,
  mapPullStudyChanges,
  mapSharedGoalProgress,
  mapSharingPreferences,
  mapStudyChallenge,
} from '@/data/mappers/database-mappers';
import {
  asRepositoryError,
  StudyRepositoryError,
  throwIfAborted,
} from '@/data/repositories/repository-error';
import { LocalStudyRepository } from '@/data/repositories/local-study-repository';
import type {
  CoreMutation,
  CreateSharedGoalInput,
  ImportChunk,
  ImportCounts,
  ImportRepository,
  LocalImportHandle,
  LocalImportManifest,
  LocalImportReport,
  SharedGoalProgressListener,
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
      startInvalidationListener: async (onInvalidated, onTransportError) => {
        let subscribedOnce = false;
        const channel = this.client
          .channel(`shared-goal:${cleanGoalId}`, { config: { private: true } })
          .on('broadcast', { event: 'progress_invalidated' }, () => onInvalidated());
        channel.subscribe((status, error) => {
          if (status === 'SUBSCRIBED') {
            // A second SUBSCRIBED status follows a transport reconnect. The
            // invalidation payload is intentionally not replayed, so refetch.
            if (subscribedOnce) onInvalidated();
            subscribedOnce = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            onTransportError(error ?? new Error(`Realtime-Status: ${status}`));
          }
        });
        return async () => { await this.client.removeChannel(channel); };
      },
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

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeController.abort();
    await Promise.all([...this.realtimeCleanups].map((cleanup) => cleanup()));
    this.realtimeCleanups.clear();
    this.listeners.clear();
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
        const path = `${input.userId}/avatar.${input.fileExtension}`;
        const { error } = await this.client.storage.from('avatars').upload(path, input.body, {
          contentType: input.contentType,
          upsert: true,
        });
        if (error) {
          throw describeAvatarUploadError(error);
        }
        throwIfAborted(signal);
        const { data } = this.client.storage.from('avatars').getPublicUrl(path);
        // The upsert path stays constant, so append a cache-buster to force
        // clients (and friend views) to fetch the freshly uploaded image.
        return `${data.publicUrl}?v=${Date.now()}`;
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
      getFriendProfileStats: async (friendId, signal) => mapFriendProfileStatistics(await this.rpc('get_friend_profile_stats', {
        p_friend_id: friendId,
      }, signal)),
      createSharedGoal: async (input: CreateSharedGoalInput, signal) => mapStudyChallenge(await this.rpc('create_shared_goal', {
        p_goal: {
          ...input.goal,
          period: input.goal.period,
          source_policy: input.goal.sourcePolicy,
          starts_at: input.goal.startsAt,
          ends_at: input.goal.endsAt,
          target_minutes: input.goal.targetMinutes,
          target_sessions: input.goal.targetSessions,
          minimum_session_minutes: input.goal.minimumSessionMinutes,
        } as unknown as Json,
        p_invitee_ids: [...input.inviteeIds],
        p_operation_id: input.operationId,
      }, signal)),
      respondSharedGoalInvitation: async (goalId, accept, signal) => mapStudyChallenge(await this.rpc('respond_shared_goal_invitation', {
        p_goal_id: goalId,
        p_accept: accept,
      }, signal)),
      withdrawFromSharedGoal: async (goalId, signal) => {
        await this.rpc('withdraw_from_shared_goal', { p_goal_id: goalId }, signal);
      },
      getSharedGoalDetails: async (goalId, signal) => mapStudyChallenge(await this.rpc('get_shared_goal_details', {
        p_goal_id: goalId,
      }, signal)),
      getSharedGoalProgress: async (goalId, signal) => mapSharedGoalProgress(await this.rpc('get_shared_goal_progress', {
        p_goal_id: goalId,
      }, signal)),
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
