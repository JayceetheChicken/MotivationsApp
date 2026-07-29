begin;

-- Social updates are database-originated broadcast invalidations. Clients only
-- receive them, so no INSERT policy is granted to authenticated users. The
-- Realtime-managed service role remains responsible for realtime.send().
drop policy if exists social_user_can_receive on realtime.messages;
create policy social_user_can_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast')
  and exists (
    select 1
    from (select realtime.topic() as topic) requested
    where requested.topic ~ '^social:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and (
        requested.topic = 'social:user:' || auth.uid()::text
        or exists (
          select 1
          from public.friendships f
          where f.status = 'accepted'
            and f.deleted_at is null
            and (
              (
                f.requester_id = auth.uid()
                and f.addressee_id = case
                  when requested.topic ~ '^social:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                  then split_part(requested.topic, ':', 3)::uuid
                  else null
                end
              )
              or (
                f.addressee_id = auth.uid()
                and f.requester_id = case
                  when requested.topic ~ '^social:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                  then split_part(requested.topic, ':', 3)::uuid
                  else null
                end
              )
            )
        )
      )
  )
);

commit;
