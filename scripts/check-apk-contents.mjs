import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { scanTextForSecrets, readTextFileOnce } from './lib/bundle-scan.cjs';
import { collectAttestationConsistencyIssues } from './lib/recovery-attestation.cjs';
import policy from '../config/backend-policy.cjs';
import release from '../config/release-config.cjs';

policy.assertBackendBuildConfiguration(process.env);
assert.equal(policy.requiresSupabase(process.env), true, 'Online-Build muss verpflichtend sein');
const root = resolve(process.argv[2]);
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    assert.equal(entry.isSymbolicLink(), false, 'Symlink im APK');
    const file = join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = walk(root);
for (const file of files) {
  // Include binary DEX, Hermes and ELF files: their literal string tables may
  // carry credentials. The web scanner's text-extension filter is insufficient.
  const inspected = readTextFileOnce(file, 128 * 1024 * 1024);
  assert.equal(inspected.ok, true, 'APK-Datei konnte nicht sicher gelesen werden');
  const findings = scanTextForSecrets(inspected.content);
  assert.equal(findings.length, 0, `Privilegiertes Secret im APK: ${findings.map(f => f.name).join(', ')}`);
}
const bundle = readFileSync(join(root, 'assets', 'index.android.bundle')).toString('utf8');
for (const value of [
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim(),
  (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim(),
]) {
  assert.ok(value && bundle.includes(value), 'Der Android-Bundle enthält nicht die konfigurierten öffentlichen Supabase-Werte');
}
const configText = readFileSync(join(root, 'assets', 'app.config'), 'utf8');
const config = JSON.parse(configText);
assert.equal(config.extra?.onlineBackendRequired, true, 'Das APK erlaubt lokalen Ersatzbetrieb');
assert.equal(config.extra?.buildProfile, release.resolveBuildProfile(process.env).profile);
if (config.extra.buildProfile === 'preview') {
  assert.equal(config.scheme, 'lernzeit', 'APK lacks the lernzeit scheme');
  assert.ok(config.android?.intentFilters?.some(filter => filter.action === 'VIEW'
    && filter.category?.includes('BROWSABLE') && filter.category?.includes('DEFAULT')
    && filter.data?.some(entry => entry.scheme === 'lernzeit' && entry.host === 'auth' && entry.path === '/callback')),
  'APK lacks the explicit email callback');
  assert.ok(bundle.includes('lernzeit://auth/callback'), 'APK bundle lacks the signup redirect');
}
const docs = [{ file: 'assets/app.config', content: configText }];
assert.deepEqual(collectAttestationConsistencyIssues(docs), []);
assert.equal(config.extra?.authBuildAttestation,
  release.serializeAuthBuildConfiguration(release.resolveAuthBuildConfiguration(process.env)));
console.log(`${files.length} APK-Dateien geprüft: keine privaten Secrets; echtes Supabase eingebettet; Online-Pflicht und Recovery-Vertrag bestätigt.`);
