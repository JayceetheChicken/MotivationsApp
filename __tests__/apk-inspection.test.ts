import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import release from '../config/release-config.cjs';
import { COMPLETE_PRODUCTION_ENVIRONMENT } from './support/production-environment';

describe('actual APK content gate', () => {
  let directory: string;
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('EXPO_PUBLIC_') && key !== 'EAS_BUILD_PROFILE')),
    NODE_ENV: 'test' as const,
    EXPO_PUBLIC_BUILD_PROFILE: 'preview',
    EAS_BUILD_PROFILE: 'preview',
    EXPO_PUBLIC_REQUIRE_SUPABASE: '1',
    EXPO_PUBLIC_SUPABASE_URL: COMPLETE_PRODUCTION_ENVIRONMENT.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: COMPLETE_PRODUCTION_ENVIRONMENT.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  const inspect = () => spawnSync(process.execPath, ['scripts/check-apk-contents.mjs', directory], { env, encoding: 'utf8' });
  const config = (required = true) => JSON.stringify({ scheme: 'lernzeit', android: { intentFilters: [{
    action: 'VIEW', category: ['BROWSABLE', 'DEFAULT'],
    data: [{ scheme: 'lernzeit', host: 'auth', path: '/callback' }],
  }] }, extra: {
    onlineBackendRequired: required,
    buildProfile: 'preview',
    authBuildAttestation: release.serializeAuthBuildConfiguration(release.resolveAuthBuildConfiguration(env)),
  } });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lernzeit-apk-test-'));
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'assets', 'app.config'), config());
    writeFileSync(join(directory, 'assets', 'index.android.bundle'),
      `${env.EXPO_PUBLIC_SUPABASE_URL}\0${env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY}\0lernzeit://auth/callback`);
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('executes the scanner and accepts a complete online APK fixture', () => {
    const result = inspect();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it('rejects an embedded privileged credential in binary content', () => {
    writeFileSync(join(directory, 'native.bin'), Buffer.concat([
      Buffer.from([0, 255, 0]), Buffer.from('sb_secret_' + 'A'.repeat(40)), Buffer.from([0]),
    ]));
    expect(inspect().status).not.toBe(0);
  });
  it('rejects a bundle without the actual public configuration', () => {
    writeFileSync(join(directory, 'assets', 'index.android.bundle'), 'offline bundle');
    expect(inspect().status).not.toBe(0);
  });
  it('rejects an APK manifest that permits local fallback', () => {
    writeFileSync(join(directory, 'assets', 'app.config'), config(false));
    expect(inspect().status).not.toBe(0);
  });
  it('rejects an APK without the registered email callback', () => {
    const manifest = JSON.parse(config());
    manifest.android.intentFilters = [];
    writeFileSync(join(directory, 'assets', 'app.config'), JSON.stringify(manifest));
    expect(inspect().status).not.toBe(0);
  });
});
