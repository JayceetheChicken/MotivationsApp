import { spawnSync } from 'node:child_process';
import path from 'node:path';
import policy from '../config/backend-policy.cjs';
import { COMPLETE_PRODUCTION_ENVIRONMENT } from './support/production-environment';

const valid = {
  EXPO_PUBLIC_BUILD_PROFILE: 'preview',
  EXPO_PUBLIC_REQUIRE_SUPABASE: '1',
  EXPO_PUBLIC_SUPABASE_URL: COMPLETE_PRODUCTION_ENVIRONMENT.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: COMPLETE_PRODUCTION_ENVIRONMENT.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

describe('mandatory online backend', () => {
  it('accepts only public project configuration and has no skip switch', () => {
    expect(() => policy.assertBackendBuildConfiguration(valid)).not.toThrow();
    for (const flag of ['0', 'false', 'yes']) {
      expect(() => policy.assertBackendBuildConfiguration({ ...valid, EXPO_PUBLIC_REQUIRE_SUPABASE: flag })).toThrow();
    }
    expect(() => policy.assertBackendBuildConfiguration({
      ...valid, LERNZEIT_SKIP_RELEASE_GATE: '1', EXPO_PUBLIC_SUPABASE_URL: '',
    })).toThrow(/Online-Build blockiert/);
  });

  it.each(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])(
    'rejects missing %s', (key) => {
      expect(() => policy.assertBackendBuildConfiguration({ ...valid, [key]: '' })).toThrow();
    },
  );

  it('rejects a privileged unused secondary key', () => {
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const privileged = `${encoded({ alg: 'HS256' })}.${encoded({ role: 'service_role' })}.${encoded('signature')}`;
    expect(() => policy.assertBackendBuildConfiguration({ ...valid, EXPO_PUBLIC_SUPABASE_ANON_KEY: privileged })).toThrow();
  });

  it('does not reveal credentials placed in a malformed URL', () => {
    expect(() => policy.assertBackendBuildConfiguration({
      ...valid, EXPO_PUBLIC_SUPABASE_URL: 'https://user:private-value@host.invalid',
    })).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
    try {
      policy.assertBackendBuildConfiguration({ ...valid, EXPO_PUBLIC_SUPABASE_URL: 'https://user:private-value@host.invalid' });
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
  });

  it('blocks a real Expo config invocation with no backend', () => {
    const env = { ...process.env, EXPO_NO_DOTENV: '1', ...valid, EXPO_PUBLIC_SUPABASE_URL: '' };
    const result = spawnSync(process.execPath, ['-e', 'require("./app.config.js")({config:require("./app.json").expo})'], {
      cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Online-Build blockiert');
  });

  it('requires online mode for production even without the explicit flag', () => {
    expect(policy.requiresSupabase({ EXPO_PUBLIC_BUILD_PROFILE: 'production' })).toBe(true);
    expect(policy.requiresSupabase({ EXPO_PUBLIC_BUILD_PROFILE: 'development' })).toBe(false);
  });
});
