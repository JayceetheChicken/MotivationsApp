import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const AVATAR_BUCKET = 'avatars';
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Both fixtures are complete, decodable raster images. Keeping them inline
// makes this test portable and lets Storage receive a real ArrayBuffer.
const JPEG_BYTES = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxeiiiv6IPyQ//2Q==',
  'base64',
);
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
  global: {
    headers: { 'X-Client-Info': 'lernzeit-local-api-e2e' },
  },
};

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required (run eval "$(supabase status -o env)" first)`);
  }
  return value;
}

function localApiUrl() {
  const rawUrl = requireEnvironment('API_URL');
  const parsed = new URL(rawUrl);

  if (parsed.protocol !== 'http:' || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run against non-local Supabase URL: ${parsed.origin}`,
    );
  }
  if (!parsed.port) {
    throw new Error(`Local Supabase URL must include its explicit port: ${parsed.origin}`);
  }

  return parsed.origin;
}

function errorSummary(error) {
  if (!error || typeof error !== 'object') return 'unknown error';
  const code = typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(error.code)
    ? `code=${error.code}`
    : null;
  const status = Number.isInteger(error.statusCode) && error.statusCode >= 100 && error.statusCode <= 599
    ? `status=${error.statusCode}`
    : null;
  return [code, status].filter(Boolean).join(', ') || 'unknown error';
}

async function must(promise, label) {
  const result = await promise;
  if (result.error) {
    throw new Error(`${label}: ${errorSummary(result.error)}`, { cause: result.error });
  }
  return result.data;
}

async function mustFail(promise, label) {
  const result = await promise;
  if (!result.error) {
    throw new Error(`${label}: operation unexpectedly succeeded`);
  }
  return result.error;
}

async function mustBeForbidden(promise, label) {
  const error = await mustFail(promise, label);
  assert.equal(error.code, '42501', `${label}: expected permission denial, got ${errorSummary(error)}`);
  return error;
}

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function assertOnlyIds(rows, expectedIds, label) {
  assert.ok(Array.isArray(rows), `${label} must be an array`);
  assert.deepEqual(
    [...rows.map((row) => row.user_id).sort()],
    [...expectedIds].sort(),
    label,
  );
}

function avatarFor(rows, userId) {
  return rows.find((row) => row.user_id === userId)?.user?.avatar_url ?? null;
}

async function assertPublicAvatar(url, expectedBytes, expectedContentType) {
  assert.equal(typeof url, 'string');
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.ok, true, `public avatar request failed with ${response.status}`);
  assert.match(
    response.headers.get('content-type') ?? '',
    new RegExp(`^${expectedContentType}(?:;|$)`),
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expectedBytes);
}

async function run() {
  const apiUrl = localApiUrl();
  const anonKey = requireEnvironment('ANON_KEY');
  const serviceRoleKey = requireEnvironment('SERVICE_ROLE_KEY');
  assert.notEqual(anonKey, serviceRoleKey, 'anon and service-role keys must differ');

  const admin = createClient(apiUrl, serviceRoleKey, clientOptions);
  const createdUserIds = [];
  const avatarObjectPaths = new Set();
  const cleanupErrors = [];
  let testFailure = null;

  const createUser = async (label, suffix) => {
    const email = `local-e2e-${label}-${suffix}@example.test`;
    const password = `Local-E2E-${randomUUID()}-aA1!`;
    const username = `e2e_${label}_${suffix}`;
    const data = await must(
      admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: `E2E ${label.toUpperCase()}`,
          time_zone: 'UTC',
          username,
          community_rules_version: '2026-08-02',
          community_rules_accepted_at: new Date().toISOString(),
        },
      }),
      `create ${label} user`,
    );
    assert.ok(data.user?.id, `${label} user id is missing`);
    createdUserIds.push(data.user.id);
    return { email, id: data.user.id, password, username };
  };

  const signIn = async (user) => {
    const client = createClient(apiUrl, anonKey, clientOptions);
    const data = await must(
      client.auth.signInWithPassword({ email: user.email, password: user.password }),
      `sign in ${user.username}`,
    );
    assert.equal(data.user?.id, user.id, `wrong session for ${user.username}`);
    assert.ok(data.session?.access_token, `missing access token for ${user.username}`);
    return client;
  };

  const uploadAvatar = async (client, userId, extension, bytes, contentType) => {
    const objectPath = `${userId}/profile/${randomUUID()}.${extension}`;
    avatarObjectPaths.add(objectPath);
    const data = await must(
      client.storage.from(AVATAR_BUCKET).upload(objectPath, asArrayBuffer(bytes), {
        cacheControl: '3600',
        contentType,
        upsert: false,
      }),
      `upload ${extension} avatar`,
    );
    assert.equal(data.path, objectPath);
    return objectPath;
  };

  const setAvatar = (client, objectPath) =>
    must(client.rpc('set_my_avatar', { p_object_path: objectPath }), 'set avatar');

  const rpc = (client, name, args = undefined) =>
    must(client.rpc(name, args), `${name} RPC`);

  const setSocialSharing = async (client, enabled) => {
    const current = await must(
      client.from('privacy_settings').select('revision').single(),
      'read own privacy revision',
    );
    return rpc(client, 'update_privacy_settings', {
      p_share_timer_stats: enabled,
      p_share_manual_stats: enabled,
      p_share_goal_progress: enabled,
      p_share_streak: enabled,
      p_share_currently_learning: enabled,
      p_share_pause_status: enabled,
      p_share_last_active_at: enabled,
      p_share_today_activity: enabled,
      p_share_weekly_minutes: enabled,
      p_share_avatar: enabled,
      p_discoverable_by_username: enabled,
      p_expected_revision: current.revision,
    });
  };

  const assertForeignRowsHidden = async (client, table, column, value) => {
    const rows = await must(
      client.from(table).select('*').eq(column, value),
      `read protected ${table}`,
    );
    assert.deepEqual(rows, [], `${table} exposed another user's private rows`);
  };

  const assertOwnRows = async (client, table, column, value, expectedCount) => {
    const data = await must(
      client.from(table).select('*').eq(column, value),
      `verify own ${table} fixture`,
    );
    assert.equal(data.length, expectedCount, `${table} fixture count`);
  };

  try {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const aliceUser = await createUser('alice', suffix);
    const bobUser = await createUser('bob', suffix);
    const carolUser = await createUser('carol', suffix);
    const alice = await signIn(aliceUser);
    const bob = await signIn(bobUser);
    const carol = await signIn(carolUser);
    await setSocialSharing(alice, true);
    await setSocialSharing(bob, true);
    await setSocialSharing(carol, true);

    console.log('[supabase-e2e] testing RPC-only writes and anonymous denial');
    const anonymous = createClient(apiUrl, anonKey, clientOptions);
    await mustFail(
      anonymous.rpc('get_my_profile'),
      'anonymous profile RPC',
    );
    const exposedTables = [
      ['profiles', 'id'],
      ['privacy_settings', 'user_id'],
      ['subjects', 'id'],
      ['goals', 'id'],
      ['personal_goal_details', 'goal_id'],
      ['shared_goal_details', 'goal_id'],
      ['goal_participants', 'goal_id'],
      ['goal_pause_intervals', 'id'],
      ['study_sessions', 'id'],
      ['study_session_segments', 'session_id'],
      ['grades', 'id'],
      ['grade_sessions', 'grade_id'],
      ['friendships', 'id'],
      ['learning_presence', 'user_id'],
      ['study_groups', 'id'],
      ['study_group_members', 'group_id'],
      ['shared_study_sessions', 'id'],
      ['shared_study_session_participants', 'session_id'],
      ['user_blocks', 'blocker_id'],
      ['community_rule_acceptances', 'user_id'],
      ['content_reports', 'id'],
    ];
    for (const [table, probeColumn] of exposedTables) {
      await mustBeForbidden(
        anonymous.from(table).select('*').limit(1),
        `anonymous SELECT from ${table}`,
      );
      await mustBeForbidden(
        alice.from(table).insert({ [probeColumn]: randomUUID() }),
        `authenticated direct INSERT into ${table}`,
      );
      await mustBeForbidden(
        alice.from(table).update({ [probeColumn]: randomUUID() }).eq(probeColumn, randomUUID()),
        `authenticated direct UPDATE of ${table}`,
      );
      await mustBeForbidden(
        alice.from(table).delete().eq(probeColumn, randomUUID()),
        `authenticated direct DELETE from ${table}`,
      );
    }

    for (const table of [
      'shared_goal_details',
      'learning_presence',
      'study_groups',
      'study_group_members',
      'shared_study_sessions',
      'shared_study_session_participants',
      'user_blocks',
      'community_rule_acceptances',
      'content_reports',
    ]) {
      await mustBeForbidden(
        alice.from(table).select('*').limit(1),
        `authenticated raw SELECT from RPC-only ${table}`,
      );
    }
    await mustFail(
      alice.from('subjects').insert({
        color: '#123456',
        icon: 'book',
        id: randomUUID(),
        name: 'Manipulated owner',
        owner_id: bobUser.id,
      }),
      'direct subject insert with another owner_id',
    );
    await mustFail(
      alice.from('goals').insert({
        creator_id: bobUser.id,
        id: randomUUID(),
        scope: 'personal',
        source_policy: 'all',
        starts_at: new Date().toISOString(),
        target_type: 'duration',
        target_value: 60,
      }),
      'direct goal insert with another creator_id',
    );
    await mustFail(
      alice.from('study_sessions').insert({
        duration_seconds: 60,
        ended_at: new Date().toISOString(),
        entered_at: new Date().toISOString(),
        id: randomUUID(),
        source: 'manual',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        subject_id: randomUUID(),
        user_id: bobUser.id,
      }),
      'direct session insert with another user_id',
    );

    console.log('[supabase-e2e] testing Storage-backed avatar lifecycle');
    const aliceJpegPath = await uploadAvatar(
      alice,
      aliceUser.id,
      'jpg',
      JPEG_BYTES,
      'image/jpeg',
    );
    const aliceJpegResult = await setAvatar(alice, aliceJpegPath);
    const aliceJpegUrl = aliceJpegResult.profile?.avatar_url;
    assert.equal(aliceJpegResult.object_path, aliceJpegPath);
    assert.equal(aliceJpegResult.previous_avatar_url, null);
    await assertPublicAvatar(aliceJpegUrl, JPEG_BYTES, 'image/jpeg');

    const alicePngPath = await uploadAvatar(
      alice,
      aliceUser.id,
      'png',
      PNG_BYTES,
      'image/png',
    );
    const alicePngResult = await setAvatar(alice, alicePngPath);
    const alicePngUrl = alicePngResult.profile?.avatar_url;
    assert.equal(alicePngResult.previous_avatar_url, aliceJpegUrl);
    assert.notEqual(alicePngUrl, aliceJpegUrl);
    await assertPublicAvatar(alicePngUrl, PNG_BYTES, 'image/png');

    await must(
      alice.storage.from(AVATAR_BUCKET).remove([aliceJpegPath]),
      'remove replaced avatar',
    );
    const oldAvatarResponse = await fetch(aliceJpegUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(oldAvatarResponse.ok, false, 'replaced avatar is still publicly readable');
    const aliceObjects = await must(
      alice.storage.from(AVATAR_BUCKET).list(`${aliceUser.id}/profile`),
      'list current avatar objects',
    );
    assert.ok(aliceObjects.some((object) => object.name === alicePngPath.split('/').at(-1)));
    assert.ok(!aliceObjects.some((object) => object.name === aliceJpegPath.split('/').at(-1)));

    const bobJpegPath = await uploadAvatar(
      bob,
      bobUser.id,
      'jpg',
      JPEG_BYTES,
      'image/jpeg',
    );
    const bobJpegResult = await setAvatar(bob, bobJpegPath);
    const bobJpegUrl = bobJpegResult.profile?.avatar_url;
    await assertPublicAvatar(bobJpegUrl, JPEG_BYTES, 'image/jpeg');

    const foreignPath = `${aliceUser.id}/profile/${randomUUID()}.png`;
    avatarObjectPaths.add(foreignPath);
    await mustFail(
      bob.storage.from(AVATAR_BUCKET).upload(foreignPath, asArrayBuffer(PNG_BYTES), {
        contentType: 'image/png',
        upsert: false,
      }),
      'upload into another user folder',
    );
    const invalidMimePath = `${aliceUser.id}/profile/${randomUUID()}.png`;
    avatarObjectPaths.add(invalidMimePath);
    await mustFail(
      alice.storage
        .from(AVATAR_BUCKET)
        .upload(invalidMimePath, asArrayBuffer(PNG_BYTES), {
          contentType: 'text/plain',
          upsert: false,
        }),
      'upload avatar with forbidden MIME type',
    );
    const oversizedPath = `${aliceUser.id}/profile/${randomUUID()}.png`;
    avatarObjectPaths.add(oversizedPath);
    await mustFail(
      alice.storage
        .from(AVATAR_BUCKET)
        .upload(oversizedPath, new ArrayBuffer(MAX_AVATAR_BYTES + 1), {
          contentType: 'image/png',
          upsert: false,
        }),
      'upload avatar above five MiB',
    );

    console.log('[supabase-e2e] testing search, requests, acceptance, and avatar projections');
    const searchResult = await rpc(alice, 'find_profile_by_exact_username', {
      p_username: bobUser.username,
    });
    assert.equal(searchResult.user?.id, bobUser.id);
    assert.equal(searchResult.user?.avatar_url, bobJpegUrl);

    const bobRequest = await rpc(alice, 'send_friend_request', {
      p_username: bobUser.username,
    });
    assert.equal(bobRequest.status, 'pending');
    assert.equal(bobRequest.user?.avatar_url, bobJpegUrl);
    const bobIncoming = await rpc(bob, 'list_friend_connections');
    const incomingFromAlice = bobIncoming.connections?.find(
      (connection) => connection.id === bobRequest.id,
    );
    assert.ok(incomingFromAlice, 'Bob did not receive Alice friend request');
    assert.equal(incomingFromAlice.user?.avatar_url, alicePngUrl);
    const acceptedBob = await rpc(bob, 'accept_friend_request', {
      p_friendship_id: bobRequest.id,
    });
    assert.equal(acceptedBob.status, 'accepted');

    const carolRequest = await rpc(alice, 'send_friend_request', {
      p_username: carolUser.username,
    });
    const acceptedCarol = await rpc(carol, 'accept_friend_request', {
      p_friendship_id: carolRequest.id,
    });
    assert.equal(acceptedCarol.status, 'accepted');

    const aliceConnections = await rpc(alice, 'list_friend_connections');
    const bobConnection = aliceConnections.connections?.find(
      (connection) => connection.id === bobRequest.id,
    );
    assert.equal(bobConnection?.status, 'accepted');
    assert.equal(bobConnection?.user?.avatar_url, bobJpegUrl);

    console.log('[supabase-e2e] testing multi-device presence aggregation');
    const learningDeviceId = randomUUID();
    const idleDeviceId = randomUUID();
    const learningPresence = await rpc(bob, 'update_learning_presence', {
      p_active_since: new Date().toISOString(),
      p_device_id: learningDeviceId,
      p_state: 'learning',
    });
    assert.equal(learningPresence.state, 'learning');
    assert.ok(new Date(learningPresence.expires_at).getTime() > Date.now());
    await rpc(bob, 'update_learning_presence', {
      p_active_since: null,
      p_device_id: idleDeviceId,
      p_state: 'idle',
    });
    let bobOverview = await rpc(alice, 'get_friend_overview', {
      p_friend_id: bobUser.id,
    });
    assert.equal(bobOverview.presence_status, 'learning');
    assert.equal(bobOverview.friend?.avatar_url, bobJpegUrl);

    await rpc(bob, 'update_learning_presence', {
      p_active_since: null,
      p_device_id: learningDeviceId,
      p_state: 'offline',
    });
    bobOverview = await rpc(alice, 'get_friend_overview', {
      p_friend_id: bobUser.id,
    });
    assert.equal(bobOverview.presence_status, 'online');

    await rpc(bob, 'update_learning_presence', {
      p_active_since: null,
      p_device_id: idleDeviceId,
      p_state: 'offline',
    });
    bobOverview = await rpc(alice, 'get_friend_overview', {
      p_friend_id: bobUser.id,
    });
    assert.equal(bobOverview.presence_status, 'offline');
    assert.ok(bobOverview.last_active_at, 'offline presence has no last-active timestamp');

    console.log('[supabase-e2e] testing accepted-only shared session progress');
    const sharedSessionId = randomUUID();
    const sharedSession = await rpc(alice, 'create_shared_study_session', {
      p_invitee_ids: [bobUser.id, carolUser.id],
      p_operation_id: randomUUID(),
      p_session: {
        id: sharedSessionId,
        planned_duration_minutes: 25,
        start_now: false,
        starts_at: new Date().toISOString(),
        title: `E2E focus ${suffix}`,
      },
    });
    assert.equal(sharedSession.session?.id, sharedSessionId);

    const bobSessionInvitation = await rpc(bob, 'get_shared_study_session_details', {
      p_session_id: sharedSessionId,
    });
    assert.equal(bobSessionInvitation.self_participant?.status, 'invited');
    assert.equal('participants' in bobSessionInvitation, false);
    const acceptedSession = await rpc(bob, 'respond_shared_study_session_invitation', {
      p_accept: true,
      p_session_id: sharedSessionId,
    });
    assertOnlyIds(
      acceptedSession.participants,
      [aliceUser.id, bobUser.id],
      'accepted shared-session participants',
    );
    assert.equal(avatarFor(acceptedSession.participants, aliceUser.id), alicePngUrl);
    assert.equal(avatarFor(acceptedSession.participants, bobUser.id), bobJpegUrl);

    const startedSession = await rpc(bob, 'update_shared_study_session_participant', {
      p_action: 'start',
      p_session_id: sharedSessionId,
    });
    assert.equal(startedSession.self_participant?.status, 'active');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const pausedSession = await rpc(bob, 'update_shared_study_session_participant', {
      p_action: 'pause',
      p_session_id: sharedSessionId,
    });
    assert.equal(pausedSession.self_participant?.status, 'paused');
    assert.ok(pausedSession.self_participant?.elapsed_seconds >= 1);
    assertOnlyIds(
      pausedSession.participants,
      [aliceUser.id, bobUser.id],
      'shared-session progress roster',
    );
    assert.ok(
      !pausedSession.participants.some((participant) => participant.user_id === carolUser.id),
      'an invited non-participant leaked into shared-session progress',
    );

    console.log('[supabase-e2e] testing shared goals, progress, and private data isolation');
    const sharedGoalId = randomUUID();
    const sharedGoal = await rpc(alice, 'create_shared_goal', {
      p_goal: {
        cadence: 'weekly',
        description: 'Aggregate E2E progress only',
        endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000).toISOString(),
        id: sharedGoalId,
        mode: 'per_participant',
        period: 'custom',
        sourcePolicy: 'all',
        startsAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
        targetMinutes: 30,
        title: `E2E shared goal ${suffix}`,
        type: 'duration',
      },
      p_invitee_ids: [bobUser.id, carolUser.id],
      p_operation_id: randomUUID(),
    });
    assert.equal(sharedGoal.goal?.id, sharedGoalId);
    const bobGoalInvitation = await rpc(bob, 'get_shared_goal_details', {
      p_goal_id: sharedGoalId,
    });
    assert.equal(bobGoalInvitation.self_participation?.status, 'invited');
    assert.equal('participants' in bobGoalInvitation, false);
    const acceptedGoal = await rpc(bob, 'respond_shared_goal_invitation', {
      p_accept: true,
      p_goal_id: sharedGoalId,
    });
    assertOnlyIds(
      acceptedGoal.participants,
      [aliceUser.id, bobUser.id],
      'accepted shared-goal participants',
    );
    assert.equal(avatarFor(acceptedGoal.participants, aliceUser.id), alicePngUrl);
    assert.equal(avatarFor(acceptedGoal.participants, bobUser.id), bobJpegUrl);

    const subjectId = randomUUID();
    const privateGoalId = randomUUID();
    const privateTimerSessionId = randomUUID();
    const sharedProgressSessionId = randomUUID();
    const gradeId = randomUUID();
    const privateSubjectName = `PRIVATE-SUBJECT-${suffix}`;
    const privateGoalTitle = `PRIVATE-GOAL-${suffix}`;
    const privateNote = `PRIVATE-NOTE-${suffix}`;
    const privateGradeTitle = `PRIVATE-GRADE-${suffix}`;

    await rpc(bob, 'upsert_subject', {
      p_operation_id: randomUUID(),
      p_subject: {
        color: '#123456',
        icon: 'book',
        id: subjectId,
        name: privateSubjectName,
      },
    });
    const privateGoal = await rpc(bob, 'upsert_personal_goal', {
      p_goal: {
        id: privateGoalId,
        period: 'week',
        sourcePolicy: 'all',
        startsAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
        subjectId,
        targetMinutes: 15,
        title: privateGoalTitle,
        type: 'duration',
      },
      p_operation_id: randomUUID(),
    });
    const pausedGoal = await rpc(bob, 'transition_personal_goal', {
      p_at: new Date(Date.now() - 30_000).toISOString(),
      p_expected_revision: privateGoal.goal.revision,
      p_goal_id: privateGoalId,
      p_operation_id: randomUUID(),
      p_status: 'paused',
    });
    await rpc(bob, 'transition_personal_goal', {
      p_at: new Date().toISOString(),
      p_expected_revision: pausedGoal.goal.revision,
      p_goal_id: privateGoalId,
      p_operation_id: randomUUID(),
      p_status: 'active',
    });

    const timerStartedAt = new Date(Date.now() - 6 * 60 * 1_000).toISOString();
    const timerEndedAt = new Date(Date.now() - 5 * 60 * 1_000).toISOString();
    await rpc(bob, 'save_completed_session', {
      p_operation_id: randomUUID(),
      p_session: {
        endedAt: timerEndedAt,
        id: privateTimerSessionId,
        segments: [{ endedAt: timerEndedAt, startedAt: timerStartedAt }],
        source: 'timer',
        startedAt: timerStartedAt,
        subjectId,
        subjectNameSnapshot: privateSubjectName,
      },
    });

    const progressStartedAt = new Date(Date.now() - 2 * 60 * 1_000).toISOString();
    const progressEndedAt = new Date(Date.now() - 30 * 1_000).toISOString();
    await rpc(bob, 'save_completed_session', {
      p_operation_id: randomUUID(),
      p_session: {
        endedAt: progressEndedAt,
        enteredAt: new Date().toISOString(),
        goalId: sharedGoalId,
        id: sharedProgressSessionId,
        legacyNote: privateNote,
        sharedSessionId: sharedSessionId,
        source: 'manual',
        startedAt: progressStartedAt,
        subjectId,
        subjectNameSnapshot: privateSubjectName,
      },
    });
    await rpc(bob, 'upsert_grade', {
      p_grade: {
        additionalStudyMinutes: 3,
        assessmentDate: new Date().toISOString().slice(0, 10),
        assessmentType: 'exam',
        id: gradeId,
        points: 13,
        sessionIds: [privateTimerSessionId],
        subjectId,
        subjectNameSnapshot: privateSubjectName,
        title: privateGradeTitle,
      },
      p_operation_id: randomUUID(),
    });

    const goalProgress = await rpc(alice, 'get_shared_goal_progress', {
      p_goal_id: sharedGoalId,
    });
    assertOnlyIds(
      goalProgress.participants,
      [aliceUser.id, bobUser.id],
      'shared-goal progress roster',
    );
    assert.ok(
      !goalProgress.participants.some((participant) => participant.user_id === carolUser.id),
      'an invited non-participant leaked into shared-goal progress',
    );
    const bobProgress = goalProgress.participants.find(
      (participant) => participant.user_id === bobUser.id,
    );
    assert.ok(bobProgress?.contribution > 0, 'Bob shared-goal contribution was not counted');
    assert.equal(avatarFor(goalProgress.participants, aliceUser.id), alicePngUrl);
    assert.equal(avatarFor(goalProgress.participants, bobUser.id), bobJpegUrl);
    const progressProjection = JSON.stringify(goalProgress);
    for (const privateValue of [
      privateSubjectName,
      privateGoalTitle,
      privateNote,
      privateGradeTitle,
    ]) {
      assert.equal(
        progressProjection.includes(privateValue),
        false,
        `shared progress exposed ${privateValue}`,
      );
    }
    console.log('[supabase-e2e] shared-goal aggregate projection verified');

    bobOverview = await rpc(alice, 'get_friend_overview', {
      p_friend_id: bobUser.id,
    });
    assert.ok(bobOverview.shared_session_ids.includes(sharedSessionId));
    assert.ok(bobOverview.shared_goal_ids.includes(sharedGoalId));
    for (const forbiddenKey of [
      'permissions',
      'periods',
      'timer_minutes',
      'manual_minutes',
      'last_study_at',
    ]) {
      assert.equal(forbiddenKey in bobOverview, false, `friend overview exposed ${forbiddenKey}`);
    }
    assert.ok(Number.isInteger(bobOverview.today_minutes));
    assert.ok(Number.isInteger(bobOverview.week_minutes));
    assert.ok(Number.isInteger(bobOverview.streak_days));
    console.log('[supabase-e2e] friend overview projection verified');

    const ownPrivateFixtures = [
      ['profiles', 'id', bobUser.id, 1],
      ['privacy_settings', 'user_id', bobUser.id, 1],
      ['subjects', 'owner_id', bobUser.id, 1],
      ['goals', 'id', privateGoalId, 1],
      ['personal_goal_details', 'owner_id', bobUser.id, 1],
      ['goal_participants', 'goal_id', privateGoalId, 1],
      ['goal_pause_intervals', 'goal_id', privateGoalId, 1],
      ['study_sessions', 'user_id', bobUser.id, 2],
      ['study_session_segments', 'user_id', bobUser.id, 1],
      ['grades', 'user_id', bobUser.id, 1],
      ['grade_sessions', 'user_id', bobUser.id, 1],
      ['friendships', 'id', bobRequest.id, 1],
    ];
    for (const [table, column, value, expectedCount] of ownPrivateFixtures) {
      await assertOwnRows(bob, table, column, value, expectedCount);
    }
    console.log('[supabase-e2e] owner-only fixtures verified');

    const foreignPrivateFixtures = [
      ['profiles', 'id', bobUser.id],
      ['privacy_settings', 'user_id', bobUser.id],
      ['subjects', 'owner_id', bobUser.id],
      ['goals', 'id', privateGoalId],
      ['personal_goal_details', 'owner_id', bobUser.id],
      ['goal_participants', 'goal_id', privateGoalId],
      ['goal_pause_intervals', 'goal_id', privateGoalId],
      ['study_sessions', 'user_id', bobUser.id],
      ['study_session_segments', 'user_id', bobUser.id],
      ['grades', 'user_id', bobUser.id],
      ['grade_sessions', 'user_id', bobUser.id],
      ['friendships', 'id', carolRequest.id],
    ];
    for (const [table, column, value] of foreignPrivateFixtures) {
      await assertForeignRowsHidden(alice, table, column, value);
    }
    console.log('[supabase-e2e] foreign-row isolation verified');

    console.log('[supabase-e2e] testing granular privacy, blocks, reports, and export');
    await setSocialSharing(bob, false);
    const privateBobOverview = await rpc(alice, 'get_friend_overview', {
      p_friend_id: bobUser.id,
    });
    assert.equal(privateBobOverview.presence_status, 'offline');
    assert.equal(privateBobOverview.last_active_at, null);
    assert.equal(privateBobOverview.today_minutes, null);
    assert.equal(privateBobOverview.week_minutes, null);
    assert.equal(privateBobOverview.streak_days, null);
    assert.equal(privateBobOverview.friend?.avatar_url, null);

    const blockReceipt = await rpc(alice, 'block_user', { p_user_id: bobUser.id });
    assert.equal(blockReceipt.blocked, true);
    const blockedSearch = await rpc(alice, 'find_profile_by_exact_username', {
      p_username: bobUser.username,
    });
    assert.equal(blockedSearch, null);
    const blockedOverviews = await rpc(alice, 'list_friend_overviews');
    assert.ok(
      !blockedOverviews.friends.some((overview) => overview.friend?.id === bobUser.id),
      'blocked friend leaked into overviews',
    );
    await mustFail(
      alice.rpc('send_friend_request', { p_username: bobUser.username }),
      'friend request to blocked user',
    );
    const reportReceipt = await rpc(alice, 'submit_content_report', {
      p_entity_type: 'profile',
      p_entity_id: bobUser.id,
      p_reason: 'privacy',
      p_description: 'Local E2E report',
    });
    assert.equal(reportReceipt.status, 'open');
    await mustBeForbidden(
      alice.from('content_reports').select('*'),
      'read raw reports',
    );
    const aliceExport = await rpc(alice, 'export_my_data');
    assert.equal(aliceExport.reports.length, 1);
    assert.equal('resolution_note' in aliceExport.reports[0], false);
    assert.equal('moderator_reference' in aliceExport.reports[0], false);
    const carolExport = await rpc(carol, 'export_my_data');
    assert.equal(carolExport.reports.length, 0);
    assert.equal(carolExport.blocks.length, 0);
    await rpc(alice, 'unblock_user', { p_user_id: bobUser.id });

    console.log('[supabase-e2e] all local API assertions passed');
  } catch (error) {
    testFailure = error;
  } finally {
    if (avatarObjectPaths.size > 0) {
      try {
        const { error } = await admin.storage
          .from(AVATAR_BUCKET)
          .remove([...avatarObjectPaths]);
        if (error) cleanupErrors.push(new Error(`remove avatars: ${errorSummary(error)}`));
      } catch (error) {
        cleanupErrors.push(new Error(`remove avatars: ${errorSummary(error)}`));
      }
    }

    for (const userId of createdUserIds.reverse()) {
      try {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) cleanupErrors.push(new Error(`delete temporary user: ${errorSummary(error)}`));
      } catch (error) {
        cleanupErrors.push(new Error(`delete temporary user: ${errorSummary(error)}`));
      }
    }
  }

  if (testFailure) {
    console.error(`[supabase-e2e] test failed: ${errorSummary(testFailure)}`);
  }
  for (const cleanupError of cleanupErrors) {
    console.error(`[supabase-e2e] cleanup failed: ${errorSummary(cleanupError)}`);
  }
  if (testFailure || cleanupErrors.length > 0) process.exitCode = 1;
}

await run().catch((error) => {
  console.error(`[supabase-e2e] fatal setup failure: ${errorSummary(error)}`);
  process.exitCode = 1;
});
