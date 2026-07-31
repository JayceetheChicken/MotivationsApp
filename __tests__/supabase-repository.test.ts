import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseStudyRepository } from '@/data/repositories/supabase-study-repository';
import { MemoryKeyValueStorage } from '@/services/sync/outbox';
import type { Database } from '@/types/database.generated';

const now = '2026-07-18T10:00:00.000Z';

function rawStudyGroup() {
  return {
    group: {
      id: 'group-id', creator_id: 'account-id', name: 'Prüfungsteam', icon: 'people',
      image_url: null, created_at: now, updated_at: now,
    },
    members: [{
      user_id: 'account-id', role: 'creator', status: 'accepted',
      user: { id: 'account-id', username: 'lea', display_name: 'Lea' },
    }],
    shared_goal_ids: [],
    shared_session_ids: ['shared-session-id'],
  };
}

function rawSharedStudySession(status: 'planned' | 'active' | 'completed' | 'cancelled' = 'planned') {
  return {
    session: {
      id: 'shared-session-id', creator_id: 'account-id', group_id: 'group-id',
      title: 'Mathe-Fokus', starts_at: now, planned_duration_seconds: 2700,
      status, actual_started_at: status === 'planned' ? null : now,
      completed_at: status === 'completed' ? now : null,
      cancelled_at: status === 'cancelled' ? now : null,
      created_at: now, updated_at: now,
    },
    participants: [{
      user_id: 'account-id', status: status === 'planned' ? 'joined' : 'finished',
      elapsed_seconds: 0,
      user: { id: 'account-id', username: 'lea', display_name: 'Lea' },
    }],
  };
}

function fakeClient() {
  const rpc = jest.fn(async (name: string): Promise<{ data: unknown; error: unknown }> => {
    if (name === 'pull_my_study_changes') {
      return {
        data: {
          sync_version: 7,
          profile: {
            id: 'account-id', username: 'lea', display_name: 'Lea', avatar_url: null,
            time_zone: 'Europe/Berlin', username_needs_review: false, revision: 1,
          },
          privacy: {
            share_timer_stats: false, share_manual_stats: false,
            share_goal_progress: false, share_streak: false, revision: 1, updated_at: now,
          },
          subjects: [], goals: [], sessions: [], grades: [], shared_goals: [],
        },
        error: null,
      };
    }
    if (name === 'get_my_profile') {
      return {
        data: {
          id: 'account-id', username: 'lea', display_name: 'Lea', avatar_url: null,
          time_zone: 'Europe/Berlin', username_needs_review: false, revision: 1,
        },
        error: null,
      };
    }
    if (name === 'create_shared_goal') {
      return {
        data: {
          goal: {
            id: '22222222-2222-4222-8222-222222222222', creator_id: 'account-id',
            title: 'Teamwoche', target_type: 'duration', target_value: 7200,
            source_policy: 'all', starts_at: '2026-07-13T00:00:00.000Z',
            ends_at: '2026-07-20T00:00:00.000Z', status: 'active', revision: 1,
          },
          details: { description: '', mode: 'shared', period: 'week' },
          participants: [{ user_id: 'account-id', status: 'accepted' }],
        },
        error: null,
      };
    }
    if (name === 'stage_local_import_chunk') {
      return { data: { import_id: 'import-id', chunk_index: 2, accepted: true }, error: null };
    }
    if (name === 'get_local_import_status') {
      return {
        data: {
          import_id: 'import-id', status: 'completed',
          result: {
            import_id: 'import-id', status: 'completed',
            inserted: { subjects: 1, goals: 0, sessions: 0, grades: 0 },
            duplicates: { subjects: 0, goals: 0, sessions: 0, grades: 0 },
            conflicts: [],
          },
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const removeChannel = jest.fn(async () => 'ok');
  const channelObject = { on: jest.fn(), subscribe: jest.fn() };
  channelObject.on.mockReturnValue(channelObject);
  const channel = jest.fn(() => channelObject);
  const realtimeSetAuth = jest.fn(async () => undefined);
  const getSession = jest.fn(async () => ({
    data: {
      session: {
        access_token: 'access-token',
        user: { id: 'account-id' },
      },
    },
    error: null,
  }));
  const storageUpload = jest.fn(async (path: string, _body?: unknown, _options?: unknown) => ({ data: { path }, error: null as unknown }));
  const storageGetPublicUrl = jest.fn((path: string) => ({
    data: { publicUrl: `https://cdn.test/avatars/${path}` },
  }));
  const storageList = jest.fn(async () => ({ data: [] as { name: string }[], error: null as unknown }));
  const storageRemove = jest.fn(async () => ({ data: [], error: null as unknown }));
  const storageFrom = jest.fn(() => ({
    upload: storageUpload,
    getPublicUrl: storageGetPublicUrl,
    list: storageList,
    remove: storageRemove,
  }));
  return {
    client: {
      auth: { getSession },
      rpc,
      removeChannel,
      channel,
      realtime: { setAuth: realtimeSetAuth },
      storage: { from: storageFrom },
    } as unknown as SupabaseClient<Database>,
    rpc,
    storageFrom,
    storageUpload,
    storageGetPublicUrl,
    storageList,
    storageRemove,
    channel,
    channelObject,
    removeChannel,
    realtimeSetAuth,
    getSession,
  };
}

describe('SupabaseStudyRepository RPC contract', () => {
  it('pulls the canonical account snapshot with the sync cursor', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    const pulled = await repository.refresh();
    expect(pulled?.data.currentUser).toMatchObject({
      id: 'account-id', displayName: 'Lea', timeZone: 'Europe/Berlin',
    });
    expect(rpc).toHaveBeenCalledWith('pull_my_study_changes', { p_after_sync_version: 0 });
  });

  it('sends the required shared-goal period and canonical target payload', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });
    const challenge = await repository.social.createSharedGoal({
      operationId: '11111111-1111-4111-8111-111111111111',
      inviteeIds: ['33333333-3333-4333-8333-333333333333'],
      goal: {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Teamwoche',
        description: '',
        cadence: 'weekly',
        groupId: 'group-id',
        period: 'week',
        type: 'duration',
        mode: 'shared',
        targetMinutes: 120,
        sourcePolicy: 'all',
        startsAt: '2026-07-13T00:00:00.000Z',
        endsAt: '2026-07-20T00:00:00.000Z',
      },
    });

    expect(challenge.target).toEqual({ type: 'duration', mode: 'shared', targetMinutes: 120 });
    expect(rpc).toHaveBeenCalledWith('create_shared_goal', expect.objectContaining({
      p_goal: expect.objectContaining({
        cadence: 'weekly', group_id: 'group-id', period: 'week', targetMinutes: 120,
      }),
      p_invitee_ids: ['33333333-3333-4333-8333-333333333333'],
      p_operation_id: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('sends null date boundaries for an open-ended shared goal', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    await repository.social.createSharedGoal({
      operationId: '41111111-1111-4111-8111-111111111111',
      inviteeIds: ['33333333-3333-4333-8333-333333333333'],
      goal: {
        id: '42222222-2222-4222-8222-222222222222',
        title: 'Offenes Ziel',
        description: '',
        cadence: 'weekly',
        period: 'custom',
        type: 'duration',
        mode: 'shared',
        targetMinutes: 120,
        sourcePolicy: 'all',
      },
    });

    expect(rpc).toHaveBeenCalledWith('create_shared_goal', expect.objectContaining({
      p_goal: expect.objectContaining({ starts_at: null, ends_at: null }),
    }));
  });

  it('uses entity-keyed import chunks and unwraps finalized status reports', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });
    const handle = await repository.imports.stageChunk('import-id', {
      index: 2,
      entityType: 'subjects',
      hash: 'a'.repeat(64),
      payload: [{ id: 'subject-local', name: 'Mathe' }],
    });
    expect(handle.acceptedChunkIndices).toEqual([2]);
    expect(rpc).toHaveBeenCalledWith('stage_local_import_chunk', expect.objectContaining({
      p_payload: { subjects: [{ id: 'subject-local', name: 'Mathe' }] },
    }));

    const report = await repository.imports.getStatus('import-id');
    expect(report).toMatchObject({
      importId: 'import-id', state: 'completed', imported: { subjects: 1 }, conflicts: [],
    });
  });

  it('preserves public avatar URLs from every social RPC read model', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });
    const avatarUrl = 'https://cdn.test/avatars/friend/avatar.jpg?v=9';
    const rawUser = {
      id: 'friend', username: 'mia', display_name: 'Mia Muster', avatar_url: avatarUrl,
    };

    rpc.mockResolvedValueOnce({ data: { user: rawUser, connection: null }, error: null });
    await expect(repository.social.findProfileByExactUsername('mia')).resolves.toMatchObject({
      user: { avatarUrl },
    });
    expect(rpc).toHaveBeenLastCalledWith('find_profile_by_exact_username', { p_username: 'mia' });

    rpc.mockResolvedValueOnce({
      data: [{
        id: 'friendship-id', requester_id: 'friend', addressee_id: 'account-id',
        status: 'pending', direction: 'incoming', created_at: now, responded_at: null,
        user: rawUser,
      }],
      error: null,
    });
    await expect(repository.social.listFriendConnections()).resolves.toEqual([
      expect.objectContaining({ otherUser: expect.objectContaining({ avatarUrl }) }),
    ]);

    rpc.mockResolvedValueOnce({
      data: {
        goal: {
          id: 'shared-avatar', creator_id: 'account-id', title: 'Avatar-Team',
          target_type: 'duration', target_value: 3600, source_policy: 'all',
          starts_at: '2026-07-01T00:00:00.000Z', ends_at: '2026-08-01T00:00:00.000Z',
          status: 'active', created_at: now,
        },
        details: { description: '', mode: 'shared' },
        participants: [{ user_id: 'friend', status: 'accepted', user: rawUser }],
      },
      error: null,
    });
    await expect(repository.social.getSharedGoalDetails('shared-avatar')).resolves.toMatchObject({
      participants: [{ user: { avatarUrl } }],
    });

    rpc.mockResolvedValueOnce({
      data: {
        goal_id: 'shared-avatar', type: 'duration', mode: 'shared', target: 60,
        participants: [{
          user_id: 'friend', status: 'accepted', contribution: 30, user: rawUser,
        }],
      },
      error: null,
    });
    await expect(repository.social.getSharedGoalProgress('shared-avatar')).resolves.toMatchObject({
      participants: [{ user: { avatarUrl } }],
    });
  });

  it('unwraps all social-hub list projections', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    rpc.mockResolvedValueOnce({
      data: { friends: [{
        friend: { id: 'friend', username: 'mia', display_name: 'Mia' },
        presence_status: 'online', last_active_at: now,
        learning_status: 'learned_today', active_since: null, last_study_at: now,
        week_minutes: 90, streak_days: 2, shared_goal_ids: [],
        shared_session_ids: [], shared_group_ids: ['group-id'],
      }] },
      error: null,
    });
    await expect(repository.social.listFriendOverviews()).resolves.toEqual([
      expect.objectContaining({
        presenceStatus: 'online',
        lastActiveAt: now,
        groupIds: ['group-id'],
      }),
    ]);

    rpc.mockResolvedValueOnce({
      data: { progress: [{
        goal_id: 'goal-id', type: 'duration', mode: 'per_participant', target: 60,
        participants: [{
          user_id: 'account-id', status: 'accepted', contribution: 30,
          user: { id: 'account-id', username: 'lea', display_name: 'Lea' },
        }],
      }] },
      error: null,
    });
    await expect(repository.social.listSharedGoalProgress()).resolves.toEqual([
      expect.objectContaining({ goalId: 'goal-id', overall: expect.objectContaining({ target: 60 }) }),
    ]);

    rpc.mockResolvedValueOnce({ data: { groups: [rawStudyGroup()] }, error: null });
    await expect(repository.social.listStudyGroups()).resolves.toEqual([
      expect.objectContaining({ id: 'group-id' }),
    ]);

    rpc.mockResolvedValueOnce({ data: { sessions: [rawSharedStudySession()] }, error: null });
    await expect(repository.social.listSharedStudySessions()).resolves.toEqual([
      expect.objectContaining({ id: 'shared-session-id', plannedDurationMinutes: 45 }),
    ]);

    expect(rpc.mock.calls.slice(-4).map(([name]) => name)).toEqual([
      'list_friend_overviews',
      'list_shared_goal_progress',
      'list_study_groups',
      'list_shared_study_sessions',
    ]);
  });

  it('uses exact social-hub mutation RPC payloads and maps lifecycle tombstones', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    rpc.mockResolvedValueOnce({ data: { goal_id: 'goal-id', status: 'declined' }, error: null });
    await expect(repository.social.respondSharedGoalInvitation('goal-id', false)).resolves.toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('respond_shared_goal_invitation', {
      p_goal_id: 'goal-id', p_accept: false,
    });

    rpc.mockResolvedValueOnce({ data: rawStudyGroup(), error: null });
    await expect(repository.social.createStudyGroup({
      operationId: 'group-operation-id',
      memberIds: ['friend'],
      group: { id: 'group-id', name: 'Prüfungsteam', icon: 'people', imageUrl: null },
    })).resolves.toMatchObject({ id: 'group-id' });
    expect(rpc).toHaveBeenLastCalledWith('create_study_group', {
      p_group: { id: 'group-id', name: 'Prüfungsteam', icon: 'people', image_url: null },
      p_member_ids: ['friend'],
      p_operation_id: 'group-operation-id',
    });

    rpc.mockResolvedValueOnce({ data: { group_id: 'group-id', status: 'declined' }, error: null });
    await expect(repository.social.respondStudyGroupInvitation('group-id', false)).resolves.toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('respond_study_group_invitation', {
      p_group_id: 'group-id', p_accept: false,
    });

    rpc.mockResolvedValueOnce({ data: rawSharedStudySession(), error: null });
    await expect(repository.social.createSharedStudySession({
      operationId: 'session-operation-id',
      inviteeIds: ['friend'],
      session: {
        id: 'shared-session-id', title: 'Mathe-Fokus', groupId: 'group-id', startsAt: now,
        plannedDurationMinutes: 45, startNow: false,
      },
    })).resolves.toMatchObject({ id: 'shared-session-id' });
    expect(rpc).toHaveBeenLastCalledWith('create_shared_study_session', {
      p_session: {
        id: 'shared-session-id', title: 'Mathe-Fokus', group_id: 'group-id', starts_at: now,
        planned_duration_minutes: 45, start_now: false,
      },
      p_invitee_ids: ['friend'],
      p_operation_id: 'session-operation-id',
    });

    rpc.mockResolvedValueOnce({
      data: { session_id: 'shared-session-id', status: 'left' }, error: null,
    });
    await expect(repository.social.updateSharedStudySessionParticipant(
      'shared-session-id',
      'leave',
    )).resolves.toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('update_shared_study_session_participant', {
      p_session_id: 'shared-session-id', p_action: 'leave',
    });

    rpc.mockResolvedValueOnce({ data: rawSharedStudySession('cancelled'), error: null });
    await expect(repository.social.cancelSharedStudySession('shared-session-id')).resolves.toMatchObject({
      id: 'shared-session-id', status: 'cancelled', endedAt: now,
    });

    rpc.mockResolvedValueOnce({ data: { state: 'learning' }, error: null });
    await repository.social.updateLearningPresence(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'learning',
      now,
    );
    expect(rpc).toHaveBeenLastCalledWith('update_learning_presence', {
      p_device_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      p_state: 'learning', p_active_since: now,
    });
  });

  it('uploads an ArrayBuffer to a unique own profile object without upsert', async () => {
    const { client, storageFrom, storageUpload } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    const body = new Uint8Array([1, 2, 3]).buffer;
    const uploaded = await repository.social.uploadAvatar({
      userId: 'account-id',
      objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body,
      contentType: 'image/jpeg',
      fileExtension: 'jpg',
    });

    expect(storageFrom).toHaveBeenCalledWith('avatars');
    expect(storageUpload).toHaveBeenCalledWith(
      'account-id/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
      body,
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
    expect(storageUpload.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
    expect(uploaded).toEqual({
      objectPath: 'account-id/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    });
  });

  it('persists a verified path and removes stale objects without touching the current avatar', async () => {
    const { client, rpc, storageList, storageRemove } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });
    const keepPath = 'account-id/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
    rpc.mockResolvedValueOnce({
      data: {
        profile: {
          id: 'account-id', username: 'lea', display_name: 'Lea',
          avatar_url: 'https://project.test/storage/v1/object/public/avatars/account-id/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg?v=1',
          time_zone: 'Europe/Berlin', username_needs_review: false, revision: 2,
        },
        object_path: keepPath,
        previous_avatar_url: 'https://project.test/storage/v1/object/public/avatars/account-id/avatar.png?v=old',
      },
      error: null,
    });
    await expect(repository.social.setMyAvatar(keepPath)).resolves.toMatchObject({
      profile: {
        avatarUrl: expect.stringContaining(`${keepPath}?v=1`),
        revision: 2,
      },
      previousAvatarUrl: expect.stringContaining('account-id/avatar.png?v=old'),
    });
    expect(rpc).toHaveBeenLastCalledWith('set_my_avatar', { p_object_path: keepPath });

    rpc.mockResolvedValueOnce({
      data: {
        id: 'account-id', username: 'lea', display_name: 'Lea',
        avatar_url: `https://project.test/storage/v1/object/public/avatars/${keepPath}?v=1`,
        time_zone: 'Europe/Berlin', username_needs_review: false, revision: 2,
      },
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: {
        object_paths: [
          'account-id/avatar.png',
          'account-id/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png',
        ],
      },
      error: null,
    });
    await repository.social.cleanupAvatarObjects(
      'account-id',
      keepPath,
      'https://project.test/storage/v1/object/public/avatars/account-id/avatar.png?v=old',
    );
    expect(storageRemove.mock.calls).toEqual(expect.arrayContaining([
      [['account-id/avatar.png']],
      [['account-id/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png']],
    ]));
    expect(storageRemove).not.toHaveBeenCalledWith([keepPath]);
    expect(storageList).not.toHaveBeenCalled();
  });

  it('does not expose a raw PostgREST schema-cache error when avatar persistence fails', async () => {
    const { client, rpc } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });
    const technicalMessage = 'Could not find the function public.set_my_avatar(p_object_path) in the schema cache';
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: technicalMessage },
    });

    try {
      await expect(repository.social.setMyAvatar(
        'account-id/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
      )).rejects.toMatchObject({
        message: 'Das Profilbild konnte serverseitig nicht gespeichert werden.',
      });
      expect(errorLog).toHaveBeenCalledWith(
        '[avatar] set_my_avatar fehlgeschlagen',
        expect.objectContaining({ message: technicalMessage }),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('subscribes to the authenticated private social inbox and refetches after reconnect', async () => {
    const {
      client,
      channel,
      channelObject,
      realtimeSetAuth,
      removeChannel,
    } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });
    const onInvalidated = jest.fn();
    const cleanup = await repository.subscribeSocialUpdates({ onInvalidated });

    expect(realtimeSetAuth).toHaveBeenCalledTimes(1);
    expect(realtimeSetAuth).toHaveBeenCalledWith('access-token');
    expect(realtimeSetAuth.mock.invocationCallOrder[0]).toBeLessThan(
      channel.mock.invocationCallOrder[0],
    );
    expect(channel).toHaveBeenCalledWith('social:user:account-id', {
      config: { private: true },
    });
    expect(channel).not.toHaveBeenCalledWith('social:user:friend', expect.anything());
    const broadcastHandler = channelObject.on.mock.calls[0]?.[2] as (
      (message: unknown) => void
    ) | undefined;
    broadcastHandler?.({ payload: { kind: 'presence' } });
    expect(onInvalidated).toHaveBeenNthCalledWith(1, 'presence');

    const statusHandler = channelObject.subscribe.mock.calls[0]?.[0] as (
      status: string,
    ) => void;
    statusHandler('SUBSCRIBED');
    statusHandler('SUBSCRIBED');
    expect(onInvalidated).toHaveBeenNthCalledWith(2, 'social');

    await cleanup();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it('reloads auth and replaces a MissingPartition channel exactly once before degrading', async () => {
    jest.useFakeTimers();
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const {
        client,
        channel,
        channelObject,
        getSession,
        realtimeSetAuth,
        removeChannel,
      } = fakeClient();
      const repository = createSupabaseStudyRepository({
        client,
        accountId: 'account-id',
        storage: new MemoryKeyValueStorage(),
      });
      const onError = jest.fn();
      const cleanup = await repository.subscribeSocialUpdates({
        onInvalidated: jest.fn(),
        onError,
      });
      const initialStatus = channelObject.subscribe.mock.calls[0]?.[0] as (
        status: string,
        error?: Error,
      ) => void;

      initialStatus(
        'CHANNEL_ERROR',
        new Error('MissingPartition: Realtime was unable to find the expected messages partition'),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(removeChannel).toHaveBeenCalledTimes(1);
      expect(channel).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(600);
      expect(getSession).toHaveBeenCalledTimes(2);
      expect(realtimeSetAuth).toHaveBeenNthCalledWith(2, 'access-token');
      expect(channel).toHaveBeenCalledTimes(2);

      const retryStatus = channelObject.subscribe.mock.calls[1]?.[0] as (
        status: string,
        error?: Error,
      ) => void;
      retryStatus('CLOSED', new Error('socket closed'));
      await Promise.resolve();
      await Promise.resolve();
      expect(channel).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Der Live-Status ist momentan nicht verfügbar. Die Freundesfunktionen können weiterhin verwendet werden.',
      }));
      expect(onError.mock.calls[0]?.[0].message).not.toMatch(/MissingPartition|socket closed/);

      await cleanup();
    } finally {
      warning.mockRestore();
      jest.useRealTimers();
    }
  });

  it('replaces an existing social topic before a rerender can create a duplicate channel', async () => {
    const { client, channel, removeChannel } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    const firstCleanup = await repository.subscribeSocialUpdates({ onInvalidated: jest.fn() });
    const secondCleanup = await repository.subscribeSocialUpdates({ onInvalidated: jest.fn() });

    expect(channel).toHaveBeenCalledTimes(2);
    expect(removeChannel).toHaveBeenCalledTimes(1);
    await firstCleanup();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    await secondCleanup();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });

  it('authenticates the private shared-goal channel before subscribing', async () => {
    const {
      client,
      rpc,
      channel,
      realtimeSetAuth,
    } = fakeClient();
    rpc.mockResolvedValueOnce({
      data: {
        goal_id: 'goal-id',
        type: 'duration',
        mode: 'per_participant',
        target: 60,
        participants: [],
      },
      error: null,
    });
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    const cleanup = await repository.subscribeSharedGoalProgress('goal-id', {
      onProgress: jest.fn(),
    });

    expect(realtimeSetAuth).toHaveBeenCalledWith('access-token');
    expect(realtimeSetAuth.mock.invocationCallOrder[0]).toBeLessThan(
      channel.mock.invocationCallOrder[0],
    );
    expect(channel).toHaveBeenCalledWith('shared-goal:goal-id', {
      config: { private: true },
    });
    await cleanup();
  });

  it('removes every active private channel when the account repository is disposed on logout', async () => {
    const { client, rpc, removeChannel } = fakeClient();
    rpc.mockResolvedValueOnce({
      data: {
        goal_id: 'goal-id', type: 'duration', mode: 'per_participant', target: 60,
        participants: [],
      },
      error: null,
    });
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });
    await repository.subscribeSocialUpdates({ onInvalidated: jest.fn() });
    await repository.subscribeSharedGoalProgress('goal-id', { onProgress: jest.fn() });

    await repository.dispose();
    expect(removeChannel).toHaveBeenCalledTimes(2);
    await repository.dispose();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });

  it('reports a missing bucket or policy distinctly from a rejected upload', async () => {
    const { client, storageUpload } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    storageUpload.mockResolvedValueOnce({ data: null as never, error: { message: 'Bucket not found' } });
    await expect(repository.social.uploadAvatar({
      userId: 'account-id',
      objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body: new ArrayBuffer(1),
      contentType: 'image/png',
      fileExtension: 'png',
    })).rejects.toThrow(/Bucket „avatars"/);

    storageUpload.mockResolvedValueOnce({ data: null as never, error: { message: 'new row violates row-level security policy' } });
    await expect(repository.social.uploadAvatar({
      userId: 'account-id',
      objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body: new ArrayBuffer(1),
      contentType: 'image/png',
      fileExtension: 'png',
    })).rejects.toThrow(/Storage-Freigabe/);
  });

  it('surfaces concrete size, authentication and network upload errors', async () => {
    const { client, storageUpload } = fakeClient();
    storageUpload.mockResolvedValueOnce({ data: null as never, error: { message: 'exceeded the maximum allowed size' } });
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    const input = {
      userId: 'account-id',
      objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body: new ArrayBuffer(1),
      contentType: 'image/png',
      fileExtension: 'png',
    };

    await expect(repository.social.uploadAvatar(input)).rejects.toThrow(
      'Das ausgewählte Profilbild ist für den Supabase-Upload zu groß.',
    );

    storageUpload.mockResolvedValueOnce({
      data: null as never,
      error: { message: 'Invalid JWT', statusCode: 401 },
    });
    await expect(repository.social.uploadAvatar(input)).rejects.toThrow(
      'Deine Supabase-Anmeldung ist abgelaufen.',
    );

    storageUpload.mockResolvedValueOnce({
      data: null as never,
      error: { message: 'fetch failed: network request failed' },
    });
    await expect(repository.social.uploadAvatar(input)).rejects.toThrow(
      'Der Profilbild-Upload konnte Supabase nicht erreichen.',
    );
  });
});
