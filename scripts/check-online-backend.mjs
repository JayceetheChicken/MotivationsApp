import policy from '../config/backend-policy.cjs';
import release from '../config/release-config.cjs';

try {
  if (!policy.requiresSupabase(process.env)) throw new Error('Online-Build benötigt EXPO_PUBLIC_REQUIRE_SUPABASE=1.');
  policy.assertBackendBuildConfiguration(process.env);
  const base = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).origin;
  const key = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY).trim();
  const request = async (path, options = {}) => {
    let response;
    try {
      response = await fetch(base + path, {
        ...options,
        headers: { apikey: key, 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('Supabase ist nicht erreichbar. Projektstatus, DNS und Netzwerk prüfen.');
    }
    return response;
  };
  const auth = await request('/auth/v1/settings');
  if (!auth.ok) throw new Error(`Supabase lehnt den öffentlichen Key ab (Auth HTTP ${auth.status}).`);
  const settings = await auth.json();
  if (!settings.external?.email || settings.disable_signup) throw new Error('E-Mail/Passwort und Registrierung müssen aktiviert sein.');
  if (settings.mailer_autoconfirm) throw new Error('E-Mail-Bestätigung muss im echten Backend aktiviert sein.');
  const rest = await request('/rest/v1/');
  if (!rest.ok) throw new Error(`Supabase-Daten-API nicht verfügbar (HTTP ${rest.status}).`);
  // A real authorization failure proves the endpoint exists without reading
  // private data or granting anon access to the schema. Missing RPC => PGRST202.
  const probe = await request('/rest/v1/rpc/get_my_profile', { method: 'POST', body: '{}' });
  const body = await probe.json();
  if (body.code !== '42501') throw new Error('get_my_profile muss existieren und anonyme Aufrufe ablehnen. Migrationen prüfen.');
  const deletion = await request('/functions/v1/delete-account', { method: 'POST', body: '{}' });
  if (deletion.status !== 401) throw new Error(`delete-account muss ohne Benutzer-Token HTTP 401 liefern (erhalten: ${deletion.status}).`);
  console.log(`Echtes Supabase-Backend erreichbar; öffentlicher ${release.classifySupabasePublicKey(key).kind}, Auth, Daten-API und geschützte Löschfunktion geprüft.`);
  console.log('Dies ersetzt nicht die authentifizierten Mehrnutzer- und RLS-Tests.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
