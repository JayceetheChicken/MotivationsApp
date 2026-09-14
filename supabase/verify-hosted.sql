-- Read-only audit in the SQL Editor of the selected hosted project.
-- 1. Must return no missing migrations. Never run seed.sql on a hosted project.
with expected(version) as (values
 ('20260718000100'), ('20260718000200'), ('20260718000300'),
 ('20260718000400'), ('20260718000500'), ('20260722000100'),
 ('20260726000100'), ('20260726000200'), ('20260726000300'),
 ('20260729000100'), ('20260729000200'), ('20260731000100'),
 ('20260802000100'), ('20260802000200'), ('20260802000300'),
 ('20260809000100')
)
select expected.version as missing_migration from expected
left join supabase_migrations.schema_migrations installed using (version)
where installed.version is null;

-- 2. Must return no public table without RLS.
select n.nspname, c.relname as table_without_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 3. Must return no SECURITY DEFINER without the hardened empty search_path.
select n.nspname, p.proname as unsafe_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prosecdef
  and not coalesce(p.proconfig @> array['search_path=""'], false);

-- 4. Must return no direct client writes (mutations are authorized RPCs).
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER');

-- 5. Must return false in all four columns.
select
  has_schema_privilege('anon', 'private', 'USAGE') as anon_private_access,
  has_schema_privilege('authenticated', 'private', 'USAGE') as user_private_access,
  has_function_privilege('anon', 'public.begin_account_deletion(uuid)', 'EXECUTE') as anon_deletion,
  has_function_privilege('authenticated', 'public.begin_account_deletion(uuid)', 'EXECUTE') as user_deletion;

-- 6. Inspect: social_user_can_receive must be own UID only, SELECT only.
-- No client INSERT/broadcast-send policy should be added.
select policyname, roles, cmd, qual, with_check from pg_policies
where schemaname = 'realtime' and tablename = 'messages';

-- 7. Must be public avatars, 5242880 bytes, JPEG/PNG/WebP only.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'avatars';
select policyname, roles, cmd, qual, with_check from pg_policies
where schemaname = 'storage' and tablename = 'objects';
