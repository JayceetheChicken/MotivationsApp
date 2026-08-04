import {
  classifySupabasePublicKey,
  resolveSupabaseEnvironment,
  validateSupabasePublicKey,
  validateSupabaseUrl,
} from '@/auth/supabase-configuration';

import releaseConfig from '../config/release-config.cjs';

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/=+$/, '')
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

function jwtWithPayloadText(payload: string): string {
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(payload)}.${base64Url('signature')}`;
}

function jwt(payload: unknown): string {
  return jwtWithPayloadText(JSON.stringify(payload));
}

const ANON_JWT = jwt({ iss: 'supabase', role: 'anon' });
const SERVICE_ROLE_JWT = jwt({ iss: 'supabase', role: 'service_role' });

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

});

/**
 * The runtime must not have its own opinion about what a shippable key is.
 * It used to decode the JWT itself with `atob`, which meant the app could
 * accept a key that the release gate rejects (or the other way round).
 */
describe('Supabase public key validation uses the central classifier', () => {
  it('re-exports the classifier from config/release-config.cjs', () => {
    expect(classifySupabasePublicKey).toBe(releaseConfig.classifySupabasePublicKey);
  });

  it.each<[string, string]>([
    ['Publishable Key', 'sb_publishable_AbCdEf1234567890'],
    ['Anon-JWT', ANON_JWT],
  ])('accepts a %s', (_label, key) => {
    expect(validateSupabasePublicKey(key)).toBeNull();
    expect(classifySupabasePublicKey(key).valid).toBe(true);
  });

  it.each<[string, string, RegExp]>([
    ['sb_secret_*', 'sb_secret_realsecretvalue', /Secret-Key/],
    ['leeres Publishable-Präfix', 'sb_publishable_', /nur aus dem Präfix/],
    ['service_role-JWT', SERVICE_ROLE_JWT, /service_role/],
    ['JWT mit unbekannter Rolle', jwt({ role: 'authenticated' }), /unbekannte Rolle/],
    ['JWT ohne Rolle', jwt({ iss: 'supabase' }), /kein role-Feld/],
    ['kaputtes Base64URL', 'header.pay!load.signature', /Base64URL/],
    ['kaputtes UTF-8', `${base64Url('{}')}.__4.${base64Url('signature')}`, /UTF-8|Base64URL/],
    ['kaputtes JSON', jwtWithPayloadText('{"role":'), /JSON/],
    ['JSON-Array', jwtWithPayloadText('["anon"]'), /kein JSON-Objekt/],
    ['zwei Segmente', `${base64Url('{}')}.${base64Url('{"role":"anon"}')}`, /genau drei Segmente/],
    ['vier Segmente', `${ANON_JWT}.${base64Url('extra')}`, /genau drei Segmente/],
    ['leeres Segment', `${base64Url('{}')}..${base64Url('signature')}`, /Segment ist leer/],
    ['Datenbankpasswort', 'database-password-like-value', /Segmente/],
  ])('rejects a %s and says why', (_label, key, expected) => {
    const message = validateSupabasePublicKey(key);
    expect(message).toMatch(/nur Supabase Publishable/);
    expect(message).toMatch(expected);
    expect(classifySupabasePublicKey(key).valid).toBe(false);
  });

  it('disables online accounts instead of shipping a service_role key', () => {
    const resolved = resolveSupabaseEnvironment({
      url: 'https://project.supabase.co',
      anonKey: SERVICE_ROLE_JWT,
    });
    expect(resolved.configuration.isConfigured).toBe(false);
    expect(resolved.configuration.message).toMatch(/service_role/);
  });

  // The old implementation returned null from its decoder whenever `atob` was
  // missing, so a service_role key silently passed on such a runtime.
  it('classifies without relying on globalThis.atob', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'atob');
    try {
      Reflect.deleteProperty(globalThis, 'atob');
      expect(validateSupabasePublicKey(SERVICE_ROLE_JWT)).toMatch(/service_role/);
      expect(validateSupabasePublicKey(ANON_JWT)).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'atob', original);
    }
  });

  it('agrees with the release gate for every case', () => {
    for (const key of [
      'sb_publishable_AbCdEf1234567890',
      'sb_publishable_',
      'sb_secret_realsecretvalue',
      ANON_JWT,
      SERVICE_ROLE_JWT,
      jwt({ role: 'authenticated' }),
      jwt({}),
      'malformed.jwt.value',
      '',
    ]) {
      const gateAccepts = releaseConfig.isShippableSupabasePublicKey(key);
      expect(validateSupabasePublicKey(key) === null).toBe(gateAccepts);
    }
  });
});
