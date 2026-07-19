begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users(
  id, aud, role, email, raw_user_meta_data, created_at, updated_at
) values (
  '44444444-4444-4444-8444-444444444444',
  'authenticated', 'authenticated', 'import@example.test',
  '{"username":"importer","display_name":"Import Test"}', now(), now()
);

create temporary table import_fixture(payload jsonb) on commit drop;
insert into import_fixture values (jsonb_build_object(
  'subjects', jsonb_build_array(jsonb_build_object(
    'id', 'local-subject', 'name', 'Physik', 'color', '#123456', 'icon', 'atom'
  )),
  'goals', jsonb_build_array(jsonb_build_object(
    'id', '55555555-5555-4555-8555-555555555551', 'subjectId', 'local-subject', 'title', 'Wochenziel',
    'type', 'duration', 'targetMinutes', 60, 'sourcePolicy', 'timer_only',
    'period', 'week', 'status', 'active', 'createdAt', statement_timestamp() - interval '1 day',
    'startsAt', statement_timestamp() - interval '1 day'
  )),
  'sessions', jsonb_build_array(jsonb_build_object(
    'id', '55555555-5555-4555-8555-555555555552', 'subjectId', 'local-subject',
    'goalId', '55555555-5555-4555-8555-555555555551',
    'source', 'timer', 'startedAt', statement_timestamp() - interval '30 minutes',
    'endedAt', statement_timestamp() - interval '20 minutes', 'durationMinutes', 10,
    'note', 'Historische Notiz', 'createdAt', statement_timestamp() - interval '20 minutes',
    'segments', jsonb_build_array(jsonb_build_object(
      'startedAt', statement_timestamp() - interval '30 minutes',
      'endedAt', statement_timestamp() - interval '20 minutes'
    ))
  )),
  'grades', jsonb_build_array(jsonb_build_object(
    'id', '55555555-5555-4555-8555-555555555553', 'subjectId', 'local-subject', 'assessmentType', 'exam',
    'title', 'Klausur', 'points', 12, 'additionalStudyMinutes', 5,
    'sessionIds', jsonb_build_array('55555555-5555-4555-8555-555555555552'),
    'createdAt', statement_timestamp(), 'updatedAt', statement_timestamp()
  ))
));
grant select on import_fixture to authenticated;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (public.begin_local_import(
    'test-device-fingerprint', repeat('a', 64),
    '{"subjects":1,"goals":1,"sessions":1,"grades":1,"gradeSessionLinks":1}'::jsonb
  ) ->> 'status'),
  'staging',
  'new import starts in staging state'
);

select is(
  (public.stage_local_import_chunk(
    (public.begin_local_import(
      'test-device-fingerprint', repeat('a', 64),
      '{"subjects":1,"goals":1,"sessions":1,"grades":1,"gradeSessionLinks":1}'::jsonb
    ) ->> 'import_id')::uuid,
    0, repeat('b', 64), (select payload from import_fixture)
  ) ->> 'accepted')::boolean,
  true,
  'first canonical chunk is accepted'
);

select throws_ok(
  format(
    'select public.stage_local_import_chunk(%L::uuid, 0, %L, %L::jsonb)',
    (public.begin_local_import(
      'test-device-fingerprint', repeat('a', 64),
      '{"subjects":1,"goals":1,"sessions":1,"grades":1,"gradeSessionLinks":1}'::jsonb
    ) ->> 'import_id'),
    repeat('b', 64),
    ((select payload from import_fixture) || jsonb_build_object('subjects', '[]'::jsonb))::text
  ),
  'P0001',
  'import_chunk_payload_conflict',
  'same client hash cannot hide a changed chunk payload'
);

select is(
  (public.finalize_local_import((public.begin_local_import(
    'test-device-fingerprint', repeat('a', 64),
    '{"subjects":1,"goals":1,"sessions":1,"grades":1,"gradeSessionLinks":1}'::jsonb
  ) ->> 'import_id')::uuid) ->> 'status'),
  'completed',
  'valid import finalizes atomically'
);

select is(
  (public.begin_local_import(
    'test-device-fingerprint', repeat('a', 64),
    '{"subjects":1,"goals":1,"sessions":1,"grades":1,"gradeSessionLinks":1}'::jsonb
  ) ->> 'status'),
  'completed',
  'same payload hash returns finalized batch instead of duplicating'
);
select is(
  (public.get_local_import_status((public.begin_local_import(
    'test-device-fingerprint', repeat('a', 64),
    '{"subjects":1,"goals":1,"sessions":1,"grades":1,"gradeSessionLinks":1}'::jsonb
  ) ->> 'import_id')::uuid) -> 'result' -> 'inserted' ->> 'gradeSessionLinks')::integer,
  1,
  'import reports successful grade/session links through the client contract'
);

select is(
  (public.finalize_local_import((public.begin_local_import(
    'empty-device-fingerprint', repeat('c', 64),
    '{"subjects":0,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) ->> 'status'),
  'completed',
  'an explicitly empty manifest finalizes without a synthetic chunk'
);

select lives_ok(
  format(
    'select public.stage_local_import_chunk(%L::uuid, 0, %L, %L::jsonb)',
    (public.begin_local_import(
      'second-device-fingerprint', repeat('d', 64),
      '{"subjects":1,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
    ) ->> 'import_id'),
    repeat('e', 64),
    jsonb_build_object('subjects', jsonb_build_array(jsonb_build_object(
      'id', 'local-subject-alias', 'name', 'Physik', 'color', '#123456', 'icon', 'atom'
    )))::text
  ),
  'second local id for the same normalized subject can be staged'
);
select is(
  (public.finalize_local_import((public.begin_local_import(
    'second-device-fingerprint', repeat('d', 64),
    '{"subjects":1,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) -> 'duplicates' ->> 'subjects')::integer,
  1,
  'many local subject ids can map to one existing cloud subject without duplication'
);
select throws_ok(
  $$select public.begin_local_import(
    'oversized-manifest-device', repeat('2', 64),
    '{"subjects":0,"goals":0,"sessions":50001,"grades":0,"gradeSessionLinks":0}'::jsonb
  )$$,
  '22023',
  'invalid_import_manifest',
  'server-side entity quotas reject oversized manifests'
);
select throws_ok(
  format(
    'select public.stage_local_import_chunk(%L::uuid, 1, %L, %L::jsonb)',
    (public.begin_local_import(
      'contiguous-index-device', repeat('3', 64),
      '{"subjects":1,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
    ) ->> 'import_id'),
    repeat('4', 64),
    '{"subjects":[{"id":"ordered","name":"Biologie","color":"#123456","icon":"leaf"}]}'
  ),
  '22023',
  'import_chunk_index_not_contiguous',
  'chunks must be staged in a contiguous sequence beginning at zero'
);
select is(
  (public.discard_local_import((public.begin_local_import(
    'contiguous-index-device', repeat('3', 64),
    '{"subjects":1,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) ->> 'discarded')::boolean,
  true,
  'a user can securely discard an unfinished import and its staged payloads'
);

reset role;

select is((select count(*)::integer from public.subjects where owner_id = '44444444-4444-4444-8444-444444444444'), 1, 'one subject imported');
select is((select count(*)::integer from public.goals where creator_id = '44444444-4444-4444-8444-444444444444'), 1, 'one goal imported');
select is((select count(*)::integer from public.study_sessions where user_id = '44444444-4444-4444-8444-444444444444'), 1, 'one session imported');
select is((select count(*)::integer from public.grades where user_id = '44444444-4444-4444-8444-444444444444'), 1, 'one grade imported');
select is((select count(*)::integer from public.grade_sessions where user_id = '44444444-4444-4444-8444-444444444444'), 1, 'grade/session relation imported');
select is((select count(*)::integer from private.local_id_map where user_id = '44444444-4444-4444-8444-444444444444'), 5, 'all local ids receive durable mappings, including aliases');
select is(
  (
    (select count(*) from public.goals where id = '55555555-5555-4555-8555-555555555551')
    + (select count(*) from public.study_sessions where id = '55555555-5555-4555-8555-555555555552')
    + (select count(*) from public.grades where id = '55555555-5555-4555-8555-555555555553')
  )::integer,
  3,
  'valid conflict-free client UUIDs are preserved end to end'
);
select is((select legacy_note from public.study_sessions where user_id = '44444444-4444-4444-8444-444444444444'), 'Historische Notiz', 'legacy note is retained without exposing a new input field');

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
set local role authenticated;
select lives_ok(
  format(
    'select public.stage_local_import_chunk(%L::uuid, 0, %L, %L::jsonb)',
    (public.begin_local_import(
      'invalid-binding-device', repeat('5', 64),
      '{"subjects":0,"goals":0,"sessions":1,"grades":0,"gradeSessionLinks":0}'::jsonb
    ) ->> 'import_id'),
    repeat('6', 64),
    jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object(
      'id', 'manual-session-invalid-binding',
      'subjectId', 'local-subject',
      'goalId', '55555555-5555-4555-8555-555555555551',
      'source', 'manual',
      'startedAt', statement_timestamp() - interval '15 minutes',
      'endedAt', statement_timestamp() - interval '5 minutes',
      'durationMinutes', 10
    )))::text
  ),
  'a legacy session with an invalid goal binding can be staged'
);
select is(
  (public.finalize_local_import((public.begin_local_import(
    'invalid-binding-device', repeat('5', 64),
    '{"subjects":0,"goals":0,"sessions":1,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) ->> 'status'),
  'completed_with_conflicts',
  'an invalid legacy goal binding is reported without dropping the session'
);
reset role;
select is(
  (select goal_id from public.study_sessions
   where user_id = '44444444-4444-4444-8444-444444444444'
     and legacy_imported
     and source = 'manual'),
  null::uuid,
  'the imported session is retained but its invalid goal binding is removed'
);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
set local role authenticated;
select lives_ok(
  format(
    'select public.stage_local_import_chunk(%L::uuid, 0, %L, %L::jsonb)',
    (public.begin_local_import(
      'partially-invalid-device', repeat('f', 64),
      '{"subjects":2,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
    ) ->> 'import_id'),
    repeat('1', 64),
    jsonb_build_object('subjects', jsonb_build_array(
      jsonb_build_object('id', 'invalid-empty-subject', 'name', '', 'color', '#123456', 'icon', 'atom'),
      jsonb_build_object('id', 'valid-chemistry-subject', 'name', 'Chemie', 'color', '#654321', 'icon', 'flask')
    ))::text
  ),
  'a chunk with one invalid and one valid record can be staged'
);
select is(
  (public.finalize_local_import((public.begin_local_import(
    'partially-invalid-device', repeat('f', 64),
    '{"subjects":2,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) ->> 'status'),
  'completed_with_conflicts',
  'one rejected record does not roll back the valid records in its batch'
);
select is(
  jsonb_array_length(public.get_local_import_status((public.begin_local_import(
    'partially-invalid-device', repeat('f', 64),
    '{"subjects":2,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) -> 'result' -> 'conflicts'),
  1,
  'the rejected import record is reported exactly once'
);
reset role;
select is(
  (select count(*)::integer from public.subjects
   where owner_id = '44444444-4444-4444-8444-444444444444'
     and name_normalized = 'chemie'),
  1,
  'the valid sibling record is committed despite the rejected record'
);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
set local role authenticated;
select lives_ok(
  format(
    'select public.stage_local_import_chunk(%L::uuid, 0, %L, %L::jsonb)',
    (public.begin_local_import(
      'conflict-cap-device', repeat('7', 64),
      '{"subjects":201,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
    ) ->> 'import_id'),
    repeat('8', 64),
    jsonb_build_object('subjects', (
      select jsonb_agg(jsonb_build_object(
        'id', '', 'name', 'ungueltig', 'color', '#123456', 'icon', 'x'
      )) from generate_series(1, 201)
    ))::text
  ),
  'a bounded conflict-report fixture can be staged'
);
select is(
  (public.finalize_local_import((public.begin_local_import(
    'conflict-cap-device', repeat('7', 64),
    '{"subjects":201,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) ->> 'conflict_count')::integer,
  201,
  'the report retains the total conflict count beyond its detail cap'
);
select is(
  jsonb_array_length(public.get_local_import_status((public.begin_local_import(
    'conflict-cap-device', repeat('7', 64),
    '{"subjects":201,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) -> 'result' -> 'conflicts'),
  200,
  'conflict details are capped to keep work and response size bounded'
);
select is(
  (public.get_local_import_status((public.begin_local_import(
    'conflict-cap-device', repeat('7', 64),
    '{"subjects":201,"goals":0,"sessions":0,"grades":0,"gradeSessionLinks":0}'::jsonb
  ) ->> 'import_id')::uuid) -> 'result' ->> 'conflicts_truncated')::boolean,
  true,
  'the report explicitly marks truncated conflict details'
);
reset role;
select is(
  (select count(*)::integer from private.import_chunks),
  0,
  'raw import chunks are removed immediately after finalize or discard'
);

select * from finish();
rollback;
