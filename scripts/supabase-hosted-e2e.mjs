// Explicit opt-in hosted counterpart of the local suite. Creates only unique
// temporary accounts and cleans only IDs/objects created by this invocation.
// Admin credentials arrive on stdin from the authenticated Supabase CLI; never
// put them in Expo variables, an env file, GitHub build inputs or command args.
import { runApiE2e } from './supabase-local-e2e.mjs';
import release from '../config/release-config.cjs';

try {
  const projectRef = process.argv[2];
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new Error('Explicit project ref required');
  const apiUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (apiUrl !== `https://${projectRef}.supabase.co`) throw new Error('Project URL mismatch');
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!release.classifySupabasePublicKey(anonKey ?? '').valid) throw new Error('Public key required');
  if (process.stdin.isTTY) throw new Error('Pipe API key JSON from Supabase CLI into stdin');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 64 * 1024) throw new Error('Unexpected credential payload size');
  }
  const keys = JSON.parse(input);
  input = '';
  const serviceRoleKey = keys.find((key) => key.name === 'service_role')?.api_key;
  if (typeof serviceRoleKey !== 'string' || serviceRoleKey === anonKey) throw new Error('Admin setup credential missing');
  await runApiE2e({ apiUrl, anonKey, serviceRoleKey });
} catch {
  // Never print credential parsing errors or SDK response objects.
  console.error('Hosted E2E setup failed; check explicit project ref, public environment and piped CLI credentials.');
  process.exitCode = 1;
}
