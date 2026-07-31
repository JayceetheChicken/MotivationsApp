begin;

-- Social updates are database-originated broadcast invalidations. Every
-- recipient gets a targeted message in their own inbox; friendship must never
-- grant access to another user's inbox. Clients only receive messages, so no
-- INSERT policy is granted to authenticated users. The Realtime-managed
-- service role remains responsible for realtime.send().
drop policy if exists social_user_can_receive on realtime.messages;
create policy social_user_can_receive
on realtime.messages
for select
to authenticated
using (realtime.topic() = 'social:user:' || auth.uid()::text);

commit;
