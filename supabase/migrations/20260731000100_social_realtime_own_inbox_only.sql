begin;

-- 20260729000100 was already deployed with an accepted-friend exception.
-- Replace it forward-only so every authenticated client can receive exactly
-- one database-targeted inbox: its own.
drop policy if exists social_user_can_receive on realtime.messages;
create policy social_user_can_receive
on realtime.messages
for select
to authenticated
using (realtime.topic() = 'social:user:' || auth.uid()::text);

-- Broadcast invalidations remain server/database-originated. Deliberately do
-- not create an INSERT policy for anon or authenticated clients.

commit;
