import {
  resolveSupabaseEnvironment,
  validateSupabasePublicKey,
  validateSupabaseUrl,
} from '@/auth/supabase-configuration';

describe('Supabase environment configuration', () => {
  it('accepts a valid HTTPS project URL', () => {
    expect(validateSupabaseUrl('https://project.supabase.co')).toBeNull();
    expect(resolveSupabaseEnvironment({
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_example',
    }).configuration.isConfigured).toBe(true);
  });

  it.each([
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
    'http://10.0.2.2:54321',
    'http://10.0.3.2:54321',
  ])('accepts local HTTP development URL %s', (url) => {
    expect(validateSupabaseUrl(url, { allowLocalHttp: true })).toBeNull();
  });

  it.each([
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ])('rejects local HTTP outside explicit development builds: %s', (url) => {
    expect(validateSupabaseUrl(url)).toMatch(/produktiven Builds https:\/\//);
  });

  it.each([
    'http://project.supabase.co',
    'http://192.168.1.5:54321',
    'http://host.docker.internal:54321',
    'http://preview.localhost:54321',
    'http://localhost.evil.test:54321',
  ])('rejects non-allowlisted HTTP even in development: %s', (url) => {
    expect(validateSupabaseUrl(url, { allowLocalHttp: true })).toMatch(/explizit erlaubte/);
  });

  it('rejects credentials, query parameters, and fragments', () => {
    expect(validateSupabaseUrl('https://user:password@project.supabase.co')).toMatch(/Zugangsdaten/);
    expect(validateSupabaseUrl('https://project.supabase.co?token=value')).toMatch(/Query/);
    expect(validateSupabaseUrl('https://project.supabase.co/#secret')).toMatch(/Fragment/);
  });

  it('rejects an invalid URL', () => {
    expect(validateSupabaseUrl('definitely not a URL')).toBe(
      'EXPO_PUBLIC_SUPABASE_URL ist keine gültige URL.',
    );
  });

  it.each([
    [{ publishableKey: 'sb_publishable_example' }, 'EXPO_PUBLIC_SUPABASE_URL fehlt.'],
    [{ url: 'https://project.supabase.co' }, 'PUBLISHABLE_KEY beziehungsweise EXPO_PUBLIC_SUPABASE_ANON_KEY fehlt.'],
    [{}, 'Supabase ist noch nicht konfiguriert.'],
  ] as const)('disables online accounts for missing configuration %#', (input, message) => {
    const resolved = resolveSupabaseEnvironment(input);
    expect(resolved.configuration.isConfigured).toBe(false);
    expect(resolved.configuration.message).toContain(message);
  });

  it('rejects secret and service-role keys from the public app bundle', () => {
    expect(validateSupabasePublicKey('sb_secret_example')).toMatch(/nur Supabase Publishable/);
    const serviceRolePayload = globalThis.btoa(JSON.stringify({ role: 'service_role' }))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(validateSupabasePublicKey(`header.${serviceRolePayload}.signature`)).toMatch(
      /nur Supabase Publishable/,
    );
  });

  it('accepts only publishable keys or legacy anon-role JWTs', () => {
    const anonPayload = globalThis.btoa(JSON.stringify({ role: 'anon' }))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    expect(validateSupabasePublicKey('sb_publishable_example')).toBeNull();
    expect(validateSupabasePublicKey(`header.${anonPayload}.signature`)).toBeNull();
    expect(validateSupabasePublicKey('database-password-like-value')).toMatch(
      /nur Supabase Publishable/,
    );
    expect(validateSupabasePublicKey('malformed.jwt.value')).toMatch(/nur Supabase Publishable/);
  });
});
