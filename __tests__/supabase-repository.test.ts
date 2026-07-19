import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseStudyRepository } from '@/data/repositories/supabase-study-repository';
import { MemoryKeyValueStorage } from '@/services/sync/outbox';
import type { Database } from '@/types/database.generated';

const now = '2026-07-18T10:00:00.000Z';

function fakeClient() {
  const rpc = jest.fn(async (name: string) => {
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
  return {
    client: { rpc, removeChannel, channel } as unknown as SupabaseClient<Database>,
    rpc,
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
      p_goal: expect.objectContaining({ period: 'week', targetMinutes: 120 }),
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
});
