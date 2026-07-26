import { createLocalStudyRepository } from '@/data/repositories/local-study-repository';
import { StudyRepositoryError } from '@/data/repositories/repository-error';
import type { CoreMutation } from '@/data/repositories/study-repository';
import {
  mapFriendOverview,
  mapFriendProfileStatistics,
  mapFriendSearchResult,
  mapFriendshipConnection,
  mapPullStudyChanges,
  mapSharedGoalProgress,
  mapSharedStudySession,
  mapStudySessionProjection,
  mapStudyChallenge,
  mapStudyGroup,
  toSessionPayload,
} from '@/data/mappers/database-mappers';
import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import { createLocalImportManifest, sha256Hex } from '@/services/sync/import-coordinator';
import { MemoryKeyValueStorage, PersistentOutbox } from '@/services/sync/outbox';
import { diffStudySnapshots } from '@/services/sync/sync-engine';

const now = '2026-07-18T10:00:00.000Z';

function snapshot(): StudyStateSnapshot {
  return {
    privacy: {
      friendComparisonsEnabled: false,
      shareAutomaticMinutes: false,
      shareManualMinutes: false,
      shareGoalProgress: false,
      shareStreak: false,
    },
    data: {
      currentUser: { id: 'local-user', username: 'lea', displayName: 'Lea' },
      subjects: [{ id: 'subject-local', name: 'Mathematik', color: '#fff', icon: 'book' }],
      goals: [{
        id: 'goal-local',
        userId: 'local-user',
        title: 'Mathe',
        type: 'duration',
        targetMinutes: 120,
        period: 'week',
        sourcePolicy: 'all',
        subjectId: 'subject-local',
        status: 'active',
        createdAt: now,
        startsAt: now,
      }],
      sessions: [{
        id: 'session-local',
        userId: 'local-user',
        subjectId: 'subject-local',
        goalId: 'goal-local',
        source: 'manual',
        startedAt: now,
        endedAt: '2026-07-18T10:30:00.000Z',
        enteredAt: now,
        durationMinutes: 30,
        note: 'Bestehende Notiz',
        createdAt: now,
      }],
      grades: [{
        id: 'grade-local',
        userId: 'local-user',
        subjectId: 'subject-local',
        assessmentType: 'exam',
        points: 12,
        additionalStudyMinutes: 15,
        sessionIds: ['session-local'],
        createdAt: now,
        updatedAt: now,
      }],
      friends: [{
        id: 'local-friend',
        user: { id: 'other', username: 'other', displayName: 'Other' },
        status: 'accepted',
        canSeeMyStats: true,
        canSeeTheirStats: true,
      }],
      challenges: [],
      activeTimer: null,
    },
  };
}

function mutation(overrides: Partial<CoreMutation> = {}): CoreMutation {
  return {
    operationId: '11111111-1111-4111-8111-111111111111',
    name: 'upsert_subject',
    entityType: 'subject',
    entityId: 'subject-1',
    payload: { id: 'subject-1' },
    ...overrides,
  };
}

describe('repository domain infrastructure', () => {
  it('persists local snapshots and blocks every social action for guests', async () => {
    const storage = new MemoryKeyValueStorage();
    const first = createLocalStudyRepository({ storage, storageScope: 'guest-test' });
    await first.saveSnapshot(snapshot());

    const second = createLocalStudyRepository({ storage, storageScope: 'guest-test' });
    expect(await second.loadSnapshot()).toEqual(snapshot());

    await expect(second.social.findProfileByExactUsername('lea')).rejects.toMatchObject({
      code: 'account_required',
    });
    await expect(second.imports.getStatus('import-id')).rejects.toMatchObject({
      code: 'account_required',
    });
    await expect(second.subscribeSharedGoalProgress('goal-id', { onProgress: jest.fn() })).rejects.toMatchObject({
      code: 'account_required',
    });
  });

  it('deduplicates outbox operations and honors dependencies even when queued out of order', async () => {
    const storage = new MemoryKeyValueStorage();
    const outbox = new PersistentOutbox(storage, 'outbox');
    const subject = mutation();
    const session = mutation({
      operationId: '22222222-2222-4222-8222-222222222222',
      name: 'save_completed_session',
      entityType: 'session',
      entityId: 'session-1',
      payload: { id: 'session-1' },
      dependsOn: [subject.operationId],
    });
    await outbox.enqueue(session);
    await outbox.enqueue(subject);
    await outbox.enqueue(subject);
    expect(await outbox.count()).toBe(2);

    const executionOrder: string[] = [];
    const result = await outbox.flush(async (entry) => {
      executionOrder.push(entry.operationId);
    });

    expect(executionOrder).toEqual([subject.operationId, session.operationId]);
    expect(result).toMatchObject({ applied: 2, pending: 0, conflicts: [] });
  });

  it('serializes concurrent outbox writes without losing mutations', async () => {
    const outbox = new PersistentOutbox(new MemoryKeyValueStorage(), 'concurrent-outbox');
    await Promise.all(Array.from({ length: 12 }, (_, index) => outbox.enqueue(mutation({
      operationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      entityId: `subject-${index}`,
      payload: { id: `subject-${index}` },
    }))));

    expect(await outbox.count()).toBe(12);
  });

  it('keeps retryable mutations queued and quarantines non-retryable conflicts', async () => {
    const storage = new MemoryKeyValueStorage();
    const outbox = new PersistentOutbox(storage, 'outbox');
    await outbox.enqueue(mutation());
    const offlineResult = await outbox.flush(async () => {
      throw new StudyRepositoryError('offline', 'offline');
    });
    expect(offlineResult.pending).toBe(1);
    expect((await outbox.list())[0]).toMatchObject({ state: 'queued', attempts: 1 });

    const conflictResult = await outbox.flush(async () => {
      throw new StudyRepositoryError('conflict', 'revision conflict');
    });
    expect(conflictResult.conflicts).toHaveLength(1);
    expect((await outbox.list())[0]).toMatchObject({ state: 'conflict', attempts: 2 });
    const repeated = await outbox.flush(async () => undefined);
    expect(repeated.conflicts).toHaveLength(1);
  });

  it('carries server revisions through consecutive offline mutations of one entity', async () => {
    const outbox = new PersistentOutbox(new MemoryKeyValueStorage(), 'revision-outbox');
    const first = mutation({
      operationId: '10000000-0000-4000-8000-000000000001',
      payload: { id: 'subject-1', name: 'Mathe', expected_revision: 0 },
      expectedRevision: 0,
    });
    const second = mutation({
      operationId: '10000000-0000-4000-8000-000000000002',
      payload: { id: 'subject-1', name: 'Mathematik', expected_revision: 0 },
      expectedRevision: 0,
    });
    await outbox.enqueue(first);
    await outbox.enqueue(second);

    const seen: CoreMutation[] = [];
    await outbox.flush(async (entry) => {
      seen.push({ ...entry, payload: { ...entry.payload } });
      return { revision: seen.length };
    });

    expect(seen[0]).toMatchObject({ expectedRevision: 0 });
    expect(seen[1]).toMatchObject({
      expectedRevision: 1,
      payload: { expected_revision: 1 },
    });
  });

  it('builds stable, bounded import manifests without social trust data', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const manifest = createLocalImportManifest(snapshot(), 'device-123', 1);

    expect(manifest.counts).toEqual({
      subjects: 1,
      goals: 1,
      sessions: 1,
      grades: 1,
      gradeSessionLinks: 1,
    });
    expect(manifest.chunks).toHaveLength(4);
    expect(manifest.excluded).toEqual({ friends: 1, challenges: 0, privacy: true });
    expect(JSON.stringify(manifest.chunks)).toContain('Bestehende Notiz');
    expect(JSON.stringify(manifest.chunks)).not.toContain('local-friend');
    expect(manifest.warnings).toContain('Lokale Freundschaften werden aus Sicherheitsgründen nicht importiert.');
  });

  it('maps incremental pulls without erasing unchanged profile/privacy and includes invitations', () => {
    const initial = mapPullStudyChanges({
      sync_version: 4,
      profile: {
        id: 'account-id', username: 'lea', display_name: 'Lea', avatar_url: null,
        time_zone: 'Europe/Berlin', username_needs_review: false, revision: 1,
      },
      privacy: {
        share_timer_stats: true, share_manual_stats: false,
        share_goal_progress: false, share_streak: false, revision: 1, updated_at: now,
      },
      subjects: [], goals: [], sessions: [], grades: [],
      shared_goals: [{
        goal: {
          id: 'shared-1', creator_id: 'account-id', title: 'Team', target_type: 'duration',
          target_value: 7200, source_policy: 'all', starts_at: '2020-01-01T00:00:00.000Z',
          ends_at: '2030-01-01T00:00:00.000Z', status: 'active', created_at: now,
        },
        details: { description: '', mode: 'shared' },
        participants: [{ user_id: 'account-id', status: 'accepted' }],
      }],
    }, null);
    expect(initial.snapshot.privacy.shareManualMinutes).toBe(false);
    expect(initial.snapshot.data.challenges[0]).toMatchObject({
      id: 'shared-1',
      target: { type: 'duration', targetMinutes: 120 },
    });

    const incremental = mapPullStudyChanges({
      sync_version: 5,
      profile: null,
      privacy: null,
      subjects: [], goals: [], sessions: [], grades: [],
      shared_goals: initial.snapshot.data.challenges,
    }, initial.snapshot);
    expect(incremental.snapshot.data.currentUser).toEqual(initial.snapshot.data.currentUser);
    expect(incremental.snapshot.privacy).toEqual(initial.snapshot.privacy);
  });

  it('replaces account social projections instead of retaining local fake data', () => {
    const cached = snapshot();
    const withLocalSocial: StudyStateSnapshot = {
      ...cached,
      data: {
        ...cached.data,
        friends: [{
          id: 'fake-friend',
          user: { id: 'fake-user', username: 'fake', displayName: 'Fake' },
          status: 'accepted',
          canSeeMyStats: true,
          canSeeTheirStats: true,
        }],
        challenges: [{
          id: 'fake-goal', creatorId: 'local-user', title: 'Lokal manipuliert', description: '',
          cadence: 'weekly',
          target: { type: 'duration', mode: 'shared', targetMinutes: 60 },
          sourcePolicy: 'all', startsAt: '2026-07-01T00:00:00.000Z',
          endsAt: '2026-07-31T00:00:00.000Z', status: 'active', participants: [],
        }],
      },
    };
    const pulled = mapPullStudyChanges({
      sync_version: 9,
      profile: null,
      privacy: null,
      subjects: [], goals: [], sessions: [], grades: [], shared_goals: [],
    }, withLocalSocial);

    expect(pulled.snapshot.data.friends).toEqual([]);
    expect(pulled.snapshot.data.challenges).toEqual([]);
  });

  it('does not expose an expired shared goal as assignable active state', () => {
    expect(mapStudyChallenge({
      goal: {
        id: 'shared-expired', creator_id: 'account-id', title: 'Abgelaufen',
        target_type: 'duration', target_value: 3600, source_policy: 'all',
        starts_at: '2020-01-01T00:00:00.000Z', ends_at: '2020-01-02T00:00:00.000Z',
        status: 'active', created_at: '2020-01-01T00:00:00.000Z',
      },
      details: { description: '', mode: 'shared' },
      participants: [],
    }).status).toBe('completed');
  });

  it('includes self participation for shared-goal invitations without losing authorized profiles', () => {
    const common = {
      goal: {
        id: 'shared-invitation', creator_id: 'account-id', title: 'Teamziel',
        target_type: 'duration', target_value: 3600, source_policy: 'all',
        starts_at: '2026-07-01T00:00:00.000Z', ends_at: '2030-08-01T00:00:00.000Z',
        status: 'active', created_at: now,
      },
      details: { description: '', mode: 'per_participant' },
    };

    expect(mapStudyChallenge({
      ...common,
      self_participation: { user_id: 'friend', role: 'member', status: 'invited' },
    }).participants).toEqual([{ userId: 'friend', status: 'invited' }]);

    expect(mapStudyChallenge({
      ...common,
      participants: [{
        user_id: 'friend', status: 'accepted',
        user: { id: 'friend', username: 'mia', display_name: 'Mia' },
      }],
      selfParticipation: { user_id: 'friend', role: 'member', status: 'accepted' },
    }).participants).toEqual([{
      userId: 'friend',
      status: 'accepted',
      user: { id: 'friend', username: 'mia', displayName: 'Mia' },
    }]);
  });

  it('maps avatar URLs through every server-backed social projection', () => {
    const avatarUrl = 'https://cdn.example.com/avatars/friend/avatar.jpg?v=7';
    const rawUser = {
      id: 'friend',
      username: 'mia',
      display_name: 'Mia Muster',
      avatar_url: avatarUrl,
    };

    expect(mapFriendSearchResult({ user: rawUser, connection: null })).toMatchObject({
      user: { id: 'friend', avatarUrl },
    });

    expect(mapFriendshipConnection({
      id: 'friendship-id',
      requester_id: 'account-id',
      addressee_id: 'friend',
      status: 'accepted',
      direction: 'outgoing',
      created_at: now,
      responded_at: now,
      user: rawUser,
    })).toMatchObject({
      otherUser: { id: 'friend', avatarUrl },
    });

    expect(mapFriendProfileStatistics({
      friend: rawUser,
      periods: [],
      permissions: {},
    })).toMatchObject({
      friend: { id: 'friend', avatarUrl },
    });

    expect(mapStudyChallenge({
      goal: {
        id: 'shared-avatar', creator_id: 'account-id', title: 'Avatar-Team',
        target_type: 'duration', target_value: 3600, source_policy: 'all',
        starts_at: '2026-07-01T00:00:00.000Z', ends_at: '2026-08-01T00:00:00.000Z',
        status: 'active', created_at: now,
      },
      details: { description: '', mode: 'shared' },
      participants: [{ user_id: 'friend', status: 'accepted', user: rawUser }],
    }).participants[0]).toMatchObject({
      userId: 'friend',
      user: { id: 'friend', avatarUrl },
    });

    expect(mapSharedGoalProgress({
      goal_id: 'shared-avatar', type: 'duration', mode: 'shared', target: 60,
      participants: [{
        user_id: 'friend', status: 'accepted', contribution: 30, user: rawUser,
      }],
    }).participants[0]).toMatchObject({
      user: { id: 'friend', avatarUrl },
    });
  });

  it('maps privacy-safe friend, group and shared-session read models', () => {
    const mia = {
      id: 'friend',
      username: 'mia',
      display_name: 'Mia Muster',
      avatar_url: 'https://cdn.example.com/avatars/friend/avatar.jpg',
    };

    expect(mapFriendOverview({
      friend: mia,
      learning_status: 'learning',
      active_since: '2026-07-18T09:45:00.000Z',
      last_study_at: '2026-07-18T09:30:00.000Z',
      week_minutes: 235,
      streak_days: 4,
      shared_goal_ids: ['goal-1', 'goal-1'],
      shared_session_ids: ['shared-session-1'],
      shared_group_ids: ['group-1'],
    })).toEqual({
      friend: {
        id: 'friend',
        username: 'mia',
        displayName: 'Mia Muster',
        avatarUrl: 'https://cdn.example.com/avatars/friend/avatar.jpg',
      },
      learningStatus: 'learning_now',
      activeSince: '2026-07-18T09:45:00.000Z',
      lastStudyAt: '2026-07-18T09:30:00.000Z',
      weekMinutes: 235,
      streakDays: 4,
      sharedGoalIds: ['goal-1'],
      sharedSessionIds: ['shared-session-1'],
      groupIds: ['group-1'],
    });

    expect(mapStudyGroup({
      group: {
        id: 'group-1', creator_id: 'account-id', name: 'Prüfungsteam', icon: 'people',
        image_url: null, created_at: now, updated_at: now,
      },
      members: [
        {
          user_id: 'account-id', role: 'creator', status: 'accepted',
          user: { id: 'account-id', username: 'lea', display_name: 'Lea' },
        },
        { user_id: 'friend', role: 'member', status: 'accepted', user: mia },
      ],
      shared_goal_ids: ['goal-1'],
      shared_session_ids: ['shared-session-1'],
    })).toMatchObject({
      id: 'group-1',
      creatorId: 'account-id',
      name: 'Prüfungsteam',
      members: [
        { userId: 'account-id', role: 'owner', status: 'accepted' },
        { userId: 'friend', role: 'member', status: 'accepted', user: { avatarUrl: mia.avatar_url } },
      ],
      sharedGoalIds: ['goal-1'],
      sharedSessionIds: ['shared-session-1'],
    });

    expect(mapSharedStudySession({
      session: {
        id: 'shared-session-1', creator_id: 'account-id', group_id: 'group-1',
        title: 'Mathe-Fokus', starts_at: now, planned_duration_seconds: 2700,
        status: 'completed', actual_started_at: now,
        completed_at: '2026-07-18T10:45:00.000Z', cancelled_at: null,
        created_at: now, updated_at: '2026-07-18T10:45:00.000Z',
      },
      participants: [{
        user_id: 'friend', status: 'finished', elapsed_seconds: 330,
        joined_at: now, finished_at: '2026-07-18T10:40:00.000Z', user: mia,
      }],
    })).toMatchObject({
      id: 'shared-session-1',
      creatorId: 'account-id',
      groupId: 'group-1',
      plannedDurationMinutes: 45,
      status: 'completed',
      startedAt: now,
      endedAt: '2026-07-18T10:45:00.000Z',
      participants: [{
        userId: 'friend', status: 'finished', elapsedMinutes: 5.5,
        joinedAt: now, finishedAt: '2026-07-18T10:40:00.000Z',
      }],
    });

    expect(mapStudyGroup({
      group: {
        id: 'invited-group', creator_id: 'account-id', name: 'Einladung', icon: 'people',
        created_at: now, updated_at: now,
      },
      creator: { id: 'account-id', username: 'lea', display_name: 'Lea' },
      self_membership: {
        user_id: 'friend', role: 'member', status: 'invited', user: mia,
      },
    }).members).toEqual([
      expect.objectContaining({
        userId: 'friend',
        status: 'invited',
        user: expect.objectContaining({ displayName: 'Mia Muster' }),
      }),
    ]);

    expect(mapSharedStudySession({
      session: {
        id: 'invited-session', creator_id: 'account-id', group_id: null,
        title: 'Einladung', starts_at: now, planned_duration_seconds: 1800,
        status: 'planned', created_at: now, updated_at: now,
      },
      creator: { id: 'account-id', username: 'lea', display_name: 'Lea' },
      self_participant: {
        user_id: 'friend', role: 'member', status: 'invited', user: mia,
      },
    }).participants).toEqual([
      expect.objectContaining({ userId: 'friend', status: 'invited', elapsedMinutes: 0 }),
    ]);
  });

  it('round-trips a private session shared-session binding without exposing its details', () => {
    const session = mapStudySessionProjection({
      id: 'private-session', user_id: 'account-id', subject_id: 'private-subject',
      goal_id: null, shared_session_id: 'shared-session-1', source: 'manual',
      started_at: now, ended_at: '2026-07-18T10:30:00.000Z', entered_at: now,
      duration_seconds: 1800, created_at: now,
      legacy_note: 'private note',
    });

    expect(session).toMatchObject({
      id: 'private-session', sharedSessionId: 'shared-session-1', subjectId: 'private-subject',
    });
    expect(toSessionPayload(session)).toMatchObject({
      id: 'private-session',
      shared_session_id: 'shared-session-1',
      subject_id: 'private-subject',
      legacy_note: 'private note',
    });
  });

  it('preserves privacy redaction and maps server-computed shared progress', () => {
    expect(mapFriendSearchResult({
      user: { id: 'friend', username: 'mia', display_name: 'Mia', avatar_url: null },
      connection: {
        id: 'connection', status: 'pending_received', direction: 'incoming',
        requester_id: 'friend', addressee_id: 'account-id',
      },
    })).toMatchObject({
      user: { id: 'friend', displayName: 'Mia' },
      connection: { id: 'connection', status: 'pending', direction: 'incoming' },
    });

    const stats = mapFriendProfileStatistics({
      friend: { id: 'friend', username: 'mia', display_name: 'Mia', avatar_url: null },
      permissions: { timer: true, manual: false, goal_progress: true, streak: false },
      periods: [{
        key: 'today', starts_at: '2026-07-17T22:00:00.000Z', ends_at: '2026-07-18T22:00:00.000Z',
        timer_minutes: 30, timer_session_count: 1, manual_minutes: null,
        manual_session_count: null, total_minutes: null, total_session_count: null,
      }],
      streak_days: null,
      goal_reached: false,
    });
    expect(stats.periods.today).toMatchObject({ timerMinutes: 30, manualMinutes: null, totalMinutes: null });
    expect(stats.visibility).toEqual({ timer: true, manual: false, goals: true, streak: false });
    expect(stats.goals).toMatchObject({ reached: false, evaluatedGoalCount: 1 });

    const shared = mapSharedGoalProgress({
      goal_id: 'goal-id', type: 'duration', mode: 'shared', target: 120,
      participants: [{
        user_id: 'friend', status: 'accepted', contribution: 150,
        progress_percent: 125, remaining: null, achieved: null, excess: null,
        user: { id: 'friend', username: 'mia', display_name: 'Mia' },
      }],
      team: { contribution: 150, progress_percent: 125, remaining: 0, achieved: true, excess: 30 },
    });
    expect(shared.participants[0]).toMatchObject({
      userId: 'friend', user: { displayName: 'Mia' }, contribution: 150, contributionMinutes: 150,
    });
    expect(shared.team).toMatchObject({ target: 120, achieved: true, exceededBy: 30 });
    expect(shared.overall).toEqual(shared.team);

    const perParticipant = mapSharedGoalProgress({
      goal_id: 'per-participant-goal', type: 'duration', mode: 'per_participant', target: 60,
      participants: [
        {
          user_id: 'friend', status: 'accepted', contribution: 30,
          user: { id: 'friend', username: 'mia', display_name: 'Mia' },
        },
        {
          user_id: 'account-id', status: 'accepted', contribution: 90, target: 120,
          user: { id: 'account-id', username: 'lea', display_name: 'Lea' },
        },
      ],
      team: null,
    });
    expect(perParticipant.team).toBeNull();
    expect(perParticipant.overall).toEqual({
      contribution: 120,
      target: 180,
      progressPercent: 66.7,
      remaining: 60,
      achieved: false,
      exceededBy: 0,
    });
  });

  it('turns lifecycle-only goal changes into atomic transition operations', () => {
    const before = snapshot();
    const goal = before.data.goals[0];
    const after: StudyStateSnapshot = {
      ...before,
      data: {
        ...before.data,
        goals: [{ ...goal, status: 'paused', pausedAt: '2026-07-18T11:00:00.000Z' }],
      },
    };

    expect(diffStudySnapshots(before, after)).toEqual([
      expect.objectContaining({
        name: 'transition_personal_goal',
        entityId: 'goal-local',
        payload: { status: 'paused', at: '2026-07-18T11:00:00.000Z' },
      }),
    ]);
  });
});
