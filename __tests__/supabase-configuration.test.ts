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
    'http://10.0.2.2:54321',
    'http://host.docker.internal:54321',
  ])('accepts local HTTP development URL %s', (url) => {
    expect(validateSupabaseUrl(url)).toBeNull();
  });

  it('rejects an external HTTP URL', () => {
    expect(validateSupabaseUrl('http://project.supabase.co')).toMatch(/externe Hosts https:\/\//);
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
});
