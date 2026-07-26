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
  const channel = jest.fn();
  const storageUpload = jest.fn(async (path: string, _body?: unknown, _options?: unknown) => ({ data: { path }, error: null as unknown }));
  const storageGetPublicUrl = jest.fn((path: string) => ({
    data: { publicUrl: `https://cdn.test/avatars/${path}` },
  }));
  const storageFrom = jest.fn(() => ({ upload: storageUpload, getPublicUrl: storageGetPublicUrl }));
  return {
    client: { rpc, removeChannel, channel, storage: { from: storageFrom } } as unknown as SupabaseClient<Database>,
    rpc,
    storageFrom,
    storageUpload,
    storageGetPublicUrl,
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
      data: { friend: rawUser, periods: [], permissions: {} },
      error: null,
    });
    await expect(repository.social.getFriendProfileStats('friend')).resolves.toMatchObject({
      friend: { avatarUrl },
    });

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
        learning_status: 'learned_today', active_since: null, last_study_at: now,
        week_minutes: 90, streak_days: 2, shared_goal_ids: [],
        shared_session_ids: [], shared_group_ids: ['group-id'],
      }] },
      error: null,
    });
    await expect(repository.social.listFriendOverviews()).resolves.toEqual([
      expect.objectContaining({ learningStatus: 'learned_today', groupIds: ['group-id'] }),
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
    await repository.social.updateLearningPresence('learning', now);
    expect(rpc).toHaveBeenLastCalledWith('update_learning_presence', {
      p_state: 'learning', p_active_since: now,
    });
  });

  it('uploads an ArrayBuffer into the caller folder and returns the cache-busted public URL', async () => {
    const { client, storageFrom, storageUpload } = fakeClient();
    const repository = createSupabaseStudyRepository({
      client,
      accountId: 'account-id',
      storage: new MemoryKeyValueStorage(),
    });

    const body = new Uint8Array([1, 2, 3]).buffer;
    const url = await repository.social.uploadAvatar({
      userId: 'account-id',
      body,
      contentType: 'image/jpeg',
      fileExtension: 'jpg',
    });

    expect(storageFrom).toHaveBeenCalledWith('avatars');
    expect(storageUpload).toHaveBeenCalledWith(
      'account-id/avatar.jpg',
      body,
      expect.objectContaining({ contentType: 'image/jpeg', upsert: true }),
    );
    expect(storageUpload.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
    expect(url).toMatch(/^https:\/\/cdn\.test\/avatars\/account-id\/avatar\.jpg\?v=\d+$/);
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
      body: new ArrayBuffer(1),
      contentType: 'image/png',
      fileExtension: 'png',
    })).rejects.toThrow(/Bucket „avatars"/);

    storageUpload.mockResolvedValueOnce({ data: null as never, error: { message: 'new row violates row-level security policy' } });
    await expect(repository.social.uploadAvatar({
      userId: 'account-id',
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
