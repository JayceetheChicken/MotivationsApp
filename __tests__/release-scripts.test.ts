/**
 * Tests for the release tooling that runs outside the app bundle:
 * the production gate priority, the Supabase key classifier, the export
 * scanner, the sensitive filename rules and the generated public pages.
 *
 * These modules are CommonJS on purpose - config/release-config.cjs and
 * scripts/lib/*.cjs are the exact files the CLI scripts, app.config.js and the
 * app runtime load, so the tests exercise the shipped implementation instead of
 * a copy.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import authBuild from '../config/auth-build.cjs';
import publicHost from '../config/public-host.cjs';
import releaseConfig from '../config/release-config.cjs';
import atomicWrite from '../scripts/lib/atomic-write.cjs';
import bundleScan from '../scripts/lib/bundle-scan.cjs';
import expoConfigCheck from '../scripts/lib/expo-config-check.cjs';
import publicPages from '../scripts/lib/public-pages.cjs';
import recoveryAttestation from '../scripts/lib/recovery-attestation.cjs';
import sensitiveFiles from '../scripts/lib/sensitive-files.cjs';

type Environment = Record<string, string | undefined>;
type Issue = { key?: string; envVar: string; reason: string; detail: string };

type AuthBuildConfiguration = Readonly<{
  recoveryTransport: 'https-app-link' | 'custom-scheme';
  recoveryRedirectUrl: string;
  recoveryHost: string;
  androidAppLinkHost: string | null;
  acceptsCustomRecoveryScheme: boolean;
  registersCustomRecoverySchemeFilter: boolean;
}>;

type IntentFilterData = { scheme?: string; host?: string | null; path?: string };
type IntentFilter = {
  action: string;
  autoVerify?: boolean;
  category: string[];
  data: IntentFilterData[];
};
type TestManifest = {
  version?: string;
  scheme?: string | string[];
  android: {
    package?: string;
    versionCode?: number;
    allowBackup?: boolean;
    intentFilters: IntentFilter[];
  };
  plugins: unknown[];
  extra: { authBuildAttestation?: string; legalSiteHost?: string };
};

// --- helpers ----------------------------------------------------------------

function base64Url(bytes: readonly number[] | string): string {
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return buffer.toString('base64').replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_');
}

/** A JWT whose payload is exactly the given JSON text. */
function jwtWithPayloadText(payload: string): string {
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(payload)}.${base64Url('signature')}`;
}

function jwtWithPayload(payload: unknown): string {
  return jwtWithPayloadText(JSON.stringify(payload));
}

/** A JWT whose payload segment is raw, non-UTF-8 bytes. */
function jwtWithRawPayload(bytes: readonly number[]): string {
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(bytes)}.${base64Url('signature')}`;
}

const ANON_JWT = jwtWithPayload({ iss: 'supabase', role: 'anon', exp: 2000000000 });
const SERVICE_ROLE_JWT = jwtWithPayload({ iss: 'supabase', role: 'service_role', exp: 2000000000 });

function fingerprint(byte: string): string {
  return Array.from({ length: 32 }, () => byte).join(':');
}

const FINGERPRINT_A = fingerprint('AA');
const FINGERPRINT_B = fingerprint('1F');

const completeEnvironment: Record<string, string> = {
  EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de',
  EXPO_PUBLIC_OPERATOR_NAME: 'Muster Lern GmbH',
  EXPO_PUBLIC_OPERATOR_LEGAL_FORM: 'GmbH, vertreten durch die Geschäftsführung',
  EXPO_PUBLIC_OPERATOR_ADDRESS: 'Musterstraße 5, 10115 Berlin',
  EXPO_PUBLIC_OPERATOR_CONTACT_EMAIL: 'kontakt@lernzeit.de',
  EXPO_PUBLIC_OPERATOR_REGISTER: 'Handelsregister Berlin HRB 123456',
  EXPO_PUBLIC_OPERATOR_SUPERVISORY_AUTHORITY: 'Nicht einschlägig',
  EXPO_PUBLIC_OPERATOR_VAT_ID: 'DE123456789',
  EXPO_PUBLIC_OPERATOR_DISPUTE_RESOLUTION: 'Keine Teilnahme an einem Streitbeilegungsverfahren.',
  EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL: 'datenschutz@lernzeit.de',
  EXPO_PUBLIC_PRIVACY_OFFICER: 'Nicht bestellt',
  EXPO_PUBLIC_SUPPORT_EMAIL: 'support@lernzeit.de',
  EXPO_PUBLIC_ABUSE_CONTACT_EMAIL: 'beschwerde@lernzeit.de',
  EXPO_PUBLIC_DATA_PROTECTION_AUTHORITY: 'Berliner Beauftragte für Datenschutz und Informationsfreiheit',
  EXPO_PUBLIC_LEGAL_BASIS_ACCOUNT: 'Art. 6 Abs. 1 lit. b DSGVO für die Kontoführung.',
  EXPO_PUBLIC_SUPABASE_CONTRACT_PARTY: 'Supabase Inc.',
  EXPO_PUBLIC_SUPABASE_REGION: 'eu-central-1 (Frankfurt)',
  EXPO_PUBLIC_SUPABASE_DPA_REFERENCE: 'AVV inklusive Standardvertragsklauseln.',
  EXPO_PUBLIC_PRODUCTION_SUBPROCESSORS: 'Supabase, Google Play, EAS Build',
  EXPO_PUBLIC_LOG_RETENTION_POLICY: 'Auth- und API-Logs 14 Tage.',
  EXPO_PUBLIC_STATUTORY_RETENTION: 'Keine.',
  EXPO_PUBLIC_TERMS_LIABILITY: 'Es gilt deutsches Recht.',
  EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE: '2026-08-03',
  EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbCdEf1234567890',
};

// --- 1. production gate priority --------------------------------------------

describe('isProductionRelease priority', () => {
  const SKIP = { LERNZEIT_SKIP_RELEASE_GATE: '1' };

  it.each<[string, Environment, boolean]>([
    // The escape hatch can never disable a build that says it is production.
    ['LERNZEIT_RELEASE_GATE=1 + SKIP=1', { LERNZEIT_RELEASE_GATE: '1', ...SKIP }, true],
    ['EAS_BUILD_PROFILE=production + SKIP=1', { EAS_BUILD_PROFILE: 'production', ...SKIP }, true],
    ['EAS_BUILD=true ohne Profil + SKIP=1', { EAS_BUILD: 'true', ...SKIP }, true],
    // Only an unambiguous non-production profile may opt out.
    ['EAS_BUILD_PROFILE=development + SKIP=1', { EAS_BUILD_PROFILE: 'development', ...SKIP }, false],
    ['EAS_BUILD_PROFILE=preview + SKIP=1', { EAS_BUILD_PROFILE: 'preview', ...SKIP }, false],
    ['unbekanntes Profil + SKIP=1', { EAS_BUILD_PROFILE: 'staging', ...SKIP }, true],
    // No build context at all: an ordinary local run.
    ['lokaler Start ohne Signal', {}, false],
  ])('%s', (_label, environment, expected) => {
    expect(releaseConfig.isProductionRelease(environment)).toBe(expected);
  });

  it.each<[string, Environment, boolean]>([
    ['production ohne SKIP', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production' }, true],
    ['EAS_BUILD=true + development', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development' }, false],
    ['EAS_BUILD=true + preview', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'preview' }, false],
    ['EAS_BUILD=true + unbekanntes Profil', { EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'staging' }, true],
    ['lokal mit LERNZEIT_RELEASE_GATE=1', { LERNZEIT_RELEASE_GATE: '1' }, true],
  ])('%s', (_label, environment, expected) => {
    expect(releaseConfig.isProductionRelease(environment)).toBe(expected);
  });

  // A local `expo start` with a preview or development profile must stay a
  // development run; only an unknown profile is treated as production.
  it.each(['development', 'preview'])(
    'does not simulate production for a bare %s profile',
    (profile) => {
      expect(releaseConfig.isProductionRelease({ EAS_BUILD_PROFILE: profile })).toBe(false);
      expect(releaseConfig.isProductionRelease({ EAS_BUILD: 'false', EAS_BUILD_PROFILE: profile })).toBe(false);
    },
  );

  it('treats an unknown bare profile as production', () => {
    expect(releaseConfig.isProductionRelease({ EAS_BUILD_PROFILE: 'staging' })).toBe(true);
  });
});

// --- 2. Supabase public key classification ----------------------------------

describe('classifySupabasePublicKey', () => {
  it.each<[string, string]>([
    ['gültiger Publishable Key', 'sb_publishable_AbCdEf1234567890'],
    ['gültiger Anon-JWT', ANON_JWT],
  ])('accepts %s', (_label, key) => {
    const result = releaseConfig.classifySupabasePublicKey(key);
    expect(result.valid).toBe(true);
    expect(releaseConfig.isShippableSupabasePublicKey(key)).toBe(true);
  });

  it.each<[string, string, string]>([
    ['leeres Publishable-Präfix', 'sb_publishable_', 'publishable-empty'],
    // The suffix carries the random part. Anything that could not be a key -
    // a space, a dot, a control character, a truncated value - is rejected
    // rather than shipped as the app's Supabase credential.
    ['Publishable Key mit Leerzeichen', 'sb_publishable_abc def ghi jklmn', 'publishable-charset'],
    ['Publishable Key mit Punkt', 'sb_publishable_abcdef.1234567890', 'publishable-charset'],
    ['Publishable Key mit Steuerzeichen', 'sb_publishable_abcdef1234567890', 'publishable-charset'],
    ['Publishable Key mit Sonderzeichen', 'sb_publishable_abcdef+1234567890', 'publishable-charset'],
    ['abgeschnittener Publishable Key', 'sb_publishable_kurz', 'publishable-short'],
    ['sb_secret_*', 'sb_secret_realsecretvalue', 'secret-key'],
    ['leerer Wert', '', 'missing'],
    // Every JWT segment has to be structurally sound, not just the payload.
    ['kaputter Header', `nicht-base64!.${base64Url('{"role":"anon"}')}.${base64Url('sig')}`, 'malformed-jwt'],
    ['Header ist kein JSON-Objekt', `${base64Url('"HS256"')}.${base64Url('{"role":"anon"}')}.${base64Url('sig')}`, 'malformed-jwt'],
    ['Header ist kein JSON', `${base64Url('{oops')}.${base64Url('{"role":"anon"}')}.${base64Url('sig')}`, 'malformed-jwt'],
    ['Signatur kein Base64URL', `${base64Url('{}')}.${base64Url('{"role":"anon"}')}.sig!nature`, 'malformed-jwt'],
    ['Signatur mit Padding', `${base64Url('{"alg":"HS256"}')}.${base64Url('{"role":"anon"}')}.c2ln==`, 'malformed-jwt'],
    ['unmögliche Signaturlänge', `${base64Url('{"alg":"HS256"}')}.${base64Url('{"role":"anon"}')}.abcde`, 'malformed-jwt'],
    ['service_role-JWT', SERVICE_ROLE_JWT, 'jwt-service-role'],
    ['unbekannte Rolle', jwtWithPayload({ role: 'authenticated' }), 'jwt-role-unknown'],
    ['fehlende Rolle', jwtWithPayload({ iss: 'supabase' }), 'jwt-role-missing'],
    ['nicht-string Rolle', jwtWithPayload({ role: 42 }), 'jwt-role-missing'],
    ['kaputtes Base64URL', 'header.pay!load.signature', 'malformed-jwt'],
    ['unmögliche Base64URL-Länge', `${base64Url('{}')}.abcde.${base64Url('sig')}`, 'malformed-jwt'],
    ['kaputtes UTF-8', jwtWithRawPayload([0xff, 0xfe, 0xfd]), 'malformed-jwt'],
    ['kaputtes JSON', jwtWithPayloadText('{"role":'), 'malformed-jwt'],
    ['JSON-Array', jwtWithPayloadText('["anon"]'), 'malformed-jwt'],
    ['JSON-Skalar', jwtWithPayloadText('"anon"'), 'malformed-jwt'],
    ['JSON null', jwtWithPayloadText('null'), 'malformed-jwt'],
    ['zwei Segmente', `${base64Url('{}')}.${base64Url('{"role":"anon"}')}`, 'malformed-jwt'],
    ['vier Segmente', `${ANON_JWT}.${base64Url('extra')}`, 'malformed-jwt'],
    ['leeres Segment', `${base64Url('{}')}..${base64Url('sig')}`, 'malformed-jwt'],
    ['leeres erstes Segment', `.${base64Url('{"role":"anon"}')}.${base64Url('sig')}`, 'malformed-jwt'],
    ['kein Token', 'database-password-like-value', 'malformed-jwt'],
  ])('rejects %s', (_label, key, kind) => {
    const result = releaseConfig.classifySupabasePublicKey(key);
    expect(result.valid).toBe(false);
    expect(result.kind).toBe(kind);
    expect(result.reason.length).toBeGreaterThan(0);
    expect(releaseConfig.isShippableSupabasePublicKey(key)).toBe(false);
  });

  it('accepts every documented shape of a shippable key', () => {
    // https://supabase.com/docs/guides/api/api-keys - the documentation fixes
    // the prefixes, not a length, so no exact length is asserted here either.
    expect(releaseConfig.classifySupabasePublicKey('sb_publishable_A1b2C3d4E5f6G7h8').kind)
      .toBe('publishable');
    expect(releaseConfig.classifySupabasePublicKey('sb_publishable_a-b_c-d_e-f_g-h_i-j').kind)
      .toBe('publishable');
    expect(releaseConfig.classifySupabasePublicKey(`  ${ANON_JWT}  `).valid).toBe(true);
  });

  it('validates every JWT segment, not only the payload', () => {
    expect(releaseConfig.isBase64UrlSegment('abcd')).toBe(true);
    expect(releaseConfig.isBase64UrlSegment('abcde')).toBe(false);
    expect(releaseConfig.isBase64UrlSegment('ab=d')).toBe(false);
    expect(releaseConfig.isBase64UrlSegment('')).toBe(false);

    const decoded = releaseConfig.decodeJwt(ANON_JWT) as {
      ok: boolean;
      header: Record<string, unknown>;
      payload: Record<string, unknown>;
    };
    expect(decoded.ok).toBe(true);
    expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decoded.payload.role).toBe('anon');
  });

  it('names service_role explicitly so the operator knows what leaked', () => {
    expect(releaseConfig.classifySupabasePublicKey(SERVICE_ROLE_JWT).reason)
      .toMatch(/service_role/);
  });

  it('blocks a service_role key in the release gate', () => {
    const issues = releaseConfig.collectReleaseBlockers({
      ...completeEnvironment,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SERVICE_ROLE_JWT,
    }) as Issue[];
    const issue = issues.find((entry) => entry.envVar === 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(issue?.detail).toMatch(/service_role/);
  });

  it('accepts a legacy anon JWT in the release gate', () => {
    expect(releaseConfig.collectReleaseBlockers({
      ...completeEnvironment,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
    })).toEqual([]);
  });
});

// --- 3. export scanner ------------------------------------------------------

describe('export bundle scanner', () => {
  it('detects a service_role JWT that is only present Base64URL encoded', () => {
    const bundle = `var k="${SERVICE_ROLE_JWT}";`;
    // Proof that the old plaintext-only check could not have found it.
    expect(bundle).not.toMatch(/"role"\s*:\s*"service_role"/);

    const findings = bundleScan.scanTextForSecrets(bundle);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('Unerlaubter eingebetteter JWT');
    expect(findings[0].detail).toMatch(/service_role/);
    // The token itself is never echoed in full.
    expect(findings[0].detail).not.toContain(SERVICE_ROLE_JWT);
  });

  it('raises no false alarm for a legitimate anon JWT or publishable key', () => {
    expect(bundleScan.scanTextForSecrets(`var k="${ANON_JWT}";`)).toEqual([]);
    expect(bundleScan.scanTextForSecrets('var k="sb_publishable_AbCdEf1234567890";')).toEqual([]);
  });

  it.each<[string, string]>([
    ['JWT mit unbekannter Rolle', jwtWithPayload({ role: 'authenticated', sub: 'x' })],
    ['JWT ohne Rolle', jwtWithPayload({ iss: 'supabase', sub: 'user' })],
  ])('rejects an embedded %s', (_label, token) => {
    const findings = bundleScan.scanTextForSecrets(`window.__k=${JSON.stringify(token)}`);
    expect(findings.map((finding) => finding.name)).toContain('Unerlaubter eingebetteter JWT');
  });

  it.each<[string, string]>([
    ['sb_secret_*', 'const key = "sb_secret_abcdefgh12345678";'],
    ['Service-Role-Bezeichner', 'SUPABASE_SERVICE_ROLE_KEY="abcdefghijkl"'],
    ['Klartext-service_role', '{"role": "service_role"}'],
    ['privater Schlüssel', '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----'],
    ['Service-Account-Datei', '{"type": "service_account", "project_id": "x"}'],
    ['Service-Account-Feld', '{"private_key_id": "0123456789abcdef"}'],
    ['AWS-Key', 'AKIAIOSFODNN7EXAMPLE'],
    ['Postgres-URL mit Passwort', 'postgresql://user:hunter2@db.example.org:5432/postgres'],
  ])('still detects %s', (_label, content) => {
    expect(bundleScan.scanTextForSecrets(content).length).toBeGreaterThan(0);
  });

  // A narrow candidate pattern matters: minified bundles are full of Base64 and
  // dotted identifiers that must not be reported as tokens.
  it.each([
    'const a = b.c.d;',
    'sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==',
    'iVBORw0KGgoAAAANSUhEUg.AAAAAQAAAAEAYAAAAB.AAAACklEQVR42mNk',
    'eyJhbGciOiJIUzI1NiJ9.short.x',
    'https://example.org/a.b.c',
  ])('does not treat %s as a token', (content) => {
    expect(bundleScan.scanTextForSecrets(content)).toEqual([]);
  });

  it('ignores Base64 that decodes to something other than a JSON object', () => {
    // Shaped like a JWT, but the payload is not a JSON object.
    const candidate = `${base64Url('{"alg":"none"}')}.${base64Url('plain text payload')}.${base64Url('signature')}`;
    expect(releaseConfig.findJwtCandidates(candidate)).toEqual([candidate]);
    expect(releaseConfig.classifyEmbeddedJwt(candidate).isJwt).toBe(false);
    expect(bundleScan.scanTextForSecrets(candidate)).toEqual([]);
  });

  it('finds each distinct candidate exactly once', () => {
    const text = `${ANON_JWT} ${ANON_JWT} ${SERVICE_ROLE_JWT}`;
    expect(releaseConfig.findJwtCandidates(text)).toEqual([ANON_JWT, SERVICE_ROLE_JWT]);
  });

  it('keeps no regex state between scans', () => {
    const text = `a ${SERVICE_ROLE_JWT} b`;
    expect(bundleScan.scanTextForSecrets(text)).toHaveLength(1);
    expect(bundleScan.scanTextForSecrets(text)).toHaveLength(1);
  });
});

describe('race-free file reading', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'lernzeit-scan-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads a file through a single descriptor', () => {
    const file = path.join(directory, 'bundle.js');
    writeFileSync(file, 'console.log("ok");', 'utf8');
    expect(bundleScan.readTextFileOnce(file)).toEqual({ ok: true, content: 'console.log("ok");' });
  });

  it('reports a vanished file instead of silently succeeding', () => {
    const result = bundleScan.readTextFileOnce(path.join(directory, 'gone.js'));
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/ENOENT/);
  });

  it('reports a path that is a directory rather than a file', () => {
    const result = bundleScan.readTextFileOnce(directory);
    expect(result.ok).toBe(false);
  });

  it('reports a file that is too large to inspect instead of skipping it', () => {
    writeFileSync(path.join(directory, 'huge.js'), 'var a = 1;'.repeat(100), 'utf8');
    const result = bundleScan.readTextFileOnce(path.join(directory, 'huge.js'), 8);
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/Scan-Limit/);
  });

  // "No secrets found" must never be reported for bytes that were never read.
  it('surfaces an unreadable file as a failed scan, not as a clean one', () => {
    writeFileSync(path.join(directory, 'small.js'), 'var a = 1;', 'utf8');
    writeFileSync(path.join(directory, 'big.js'), 'var b = 2;'.repeat(50), 'utf8');

    const scan = bundleScan.scanExportDirectory(directory, { maxBytes: 20 });
    expect(scan.scanned).toBe(1);
    expect(scan.findings).toEqual([]);
    expect(scan.unreadable).toEqual([
      expect.objectContaining({ file: 'big.js', reason: expect.stringMatching(/Scan-Limit/) }),
    ]);
  });

  it('scans a clean export without complaints', () => {
    writeFileSync(path.join(directory, 'ok.js'), 'var a = 1;', 'utf8');
    const scan = bundleScan.scanExportDirectory(directory);
    expect(scan).toMatchObject({ scanned: 1, unreadable: [], findings: [] });
  });

  it('reports an embedded service_role JWT with its file name', () => {
    writeFileSync(path.join(directory, 'entry.js'), `var k="${SERVICE_ROLE_JWT}";`, 'utf8');
    writeFileSync(path.join(directory, 'logo.png'), 'binary', 'utf8');

    const scan = bundleScan.scanExportDirectory(directory);
    expect(scan.scanned).toBe(1);
    expect(scan.skipped).toBe(1);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].file).toBe('entry.js');
    expect(scan.findings[0].detail).toMatch(/service_role/);
  });
});

// --- 4. sensitive tracked filenames -----------------------------------------

describe('sensitive tracked filenames', () => {
  it.each([
    'service-account.json',
    'service_account_key.json',
    'firebase-adminsdk-example.json',
    'credentials.json',
    'google-credentials-prod.json',
    'config/service-account.json',
    'android/app/release.keystore',
    '.env',
    '.env.production',
    'backup.sql.gz',
  ])('rejects %s', (trackedPath) => {
    expect(sensitiveFiles.classifyTrackedPath(trackedPath)).not.toBeNull();
  });

  it.each([
    'credentials-help.md',
    'docs/service-account-explanation.md',
    'some-service-account-folder/readme.md',
    'docs/firebase-adminsdk-setup.md',
    'credentials/README.md',
    '.env.example',
    'src/auth/credentials.ts',
    'app.json',
    'public/.well-known/assetlinks.json',
    'config/operator-fields.json',
  ])('accepts %s', (trackedPath) => {
    expect(sensitiveFiles.classifyTrackedPath(trackedPath)).toBeNull();
  });

  it('only ever inspects the file name, never a directory name', () => {
    expect(sensitiveFiles.classifyTrackedPath('some-service-account-folder/readme.md')).toBeNull();
    expect(sensitiveFiles.classifyTrackedPath('some-service-account-folder/service-account.json'))
      .toMatchObject({ name: 'service-account' });
  });

  it('reports every finding with its rule', () => {
    const findings = sensitiveFiles.findSensitiveTrackedPaths([
      'app.json',
      'credentials.json',
      'docs/service-account-explanation.md',
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ path: 'credentials.json', rule: 'credentials-json' }),
    ]);
  });
});

// --- 5. public pages and assetlinks.json ------------------------------------

describe('assetlinks fingerprints', () => {
  it('accepts a well formed fingerprint', () => {
    expect(publicPages.parseFingerprints(FINGERPRINT_A))
      .toEqual({ fingerprints: [FINGERPRINT_A], invalid: [] });
  });

  it('normalises to upper case', () => {
    expect(publicPages.parseFingerprints(FINGERPRINT_B.toLowerCase()).fingerprints)
      .toEqual([FINGERPRINT_B]);
  });

  it('keeps several fingerprints, e.g. upload and Play signing key', () => {
    expect(publicPages.parseFingerprints(`${FINGERPRINT_A} ${FINGERPRINT_B}`).fingerprints)
      .toEqual([FINGERPRINT_A, FINGERPRINT_B]);
    expect(publicPages.parseFingerprints(`${FINGERPRINT_A},${FINGERPRINT_B}`).fingerprints)
      .toEqual([FINGERPRINT_A, FINGERPRINT_B]);
  });

  it('removes duplicates regardless of case', () => {
    expect(publicPages.parseFingerprints(
      `${FINGERPRINT_A} ${FINGERPRINT_A.toLowerCase()} ${FINGERPRINT_B}`,
    ).fingerprints).toEqual([FINGERPRINT_A, FINGERPRINT_B]);
  });

  it.each([
    ['zu kurz', 'AA:BB:CC'],
    ['31 Bytes', Array.from({ length: 31 }, () => 'AA').join(':')],
    ['33 Bytes', Array.from({ length: 33 }, () => 'AA').join(':')],
    ['kein Hex', Array.from({ length: 32 }, () => 'ZZ').join(':')],
    ['ohne Trenner', 'AA'.repeat(32)],
    ['einzelne Ziffern', Array.from({ length: 32 }, () => 'A').join(':')],
  ])('reports %s as invalid instead of dropping it', (_label, value) => {
    const parsed = publicPages.parseFingerprints(value);
    expect(parsed.fingerprints).toEqual([]);
    expect(parsed.invalid).toEqual([value]);
  });

  it('returns nothing at all for an empty variable', () => {
    expect(publicPages.parseFingerprints(undefined)).toEqual({ fingerprints: [], invalid: [] });
    expect(publicPages.parseFingerprints('   ')).toEqual({ fingerprints: [], invalid: [] });
  });
});

describe('assetlinks document validation', () => {
  const PACKAGE = 'de.lernzeit.app';
  const valid = publicPages.renderAssetLinks(PACKAGE, [FINGERPRINT_A]);

  it('accepts a complete document', () => {
    expect(publicPages.collectAssetLinksIssues(valid, PACKAGE)).toEqual([]);
  });

  it('accepts several fingerprints', () => {
    const document = publicPages.renderAssetLinks(PACKAGE, [FINGERPRINT_A, FINGERPRINT_B]);
    expect(publicPages.collectAssetLinksIssues(document, PACKAGE)).toEqual([]);
    expect(JSON.parse(document)[0].target.sha256_cert_fingerprints).toHaveLength(2);
  });

  it('rejects an empty fingerprint list', () => {
    const issues = publicPages.collectAssetLinksIssues(
      publicPages.renderAssetLinks(PACKAGE, []),
      PACKAGE,
    );
    expect(issues.join(' ')).toMatch(/sha256_cert_fingerprints ist leer/);
  });

  it.each<[string, string, RegExp]>([
    ['kaputtes JSON', '{ not json', /Kein gueltiges JSON/],
    ['kein Array', '{"relation":[]}', /kein JSON-Array/],
    ['leeres Array', '[]', /keinen Eintrag/],
    [
      'falsche Relation',
      JSON.stringify([{ relation: ['delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: [FINGERPRINT_A] } }]),
      /relation enthaelt/,
    ],
    [
      'falscher Namespace',
      JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'web', package_name: PACKAGE, sha256_cert_fingerprints: [FINGERPRINT_A] } }]),
      /namespace/,
    ],
    [
      'falscher Paketname',
      publicPages.renderAssetLinks('com.example.other', [FINGERPRINT_A]),
      /package_name/,
    ],
    [
      'ungültiger Fingerprint',
      JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: ['AA:BB'] } }]),
      /Fingerprint 1 ist ungueltig/,
    ],
    [
      'fehlendes target',
      JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'] }]),
      /target fehlt/,
    ],
  ])('rejects %s', (_label, document, expected) => {
    expect(publicPages.collectAssetLinksIssues(document, PACKAGE).join(' ')).toMatch(expected);
  });
});

describe('account deletion page', () => {
  const productionOperator = releaseConfig.resolveOperatorValues(completeEnvironment);
  const developmentOperator = releaseConfig.resolveOperatorValues({});

  it('renders a clean production page', () => {
    const html = publicPages.renderAccountDeletionPage(productionOperator, { isDevelopment: false });
    expect(publicPages.collectAccountDeletionPageIssues(html, productionOperator)).toEqual([]);
    expect(html).toContain('Muster Lern GmbH');
    expect(html).toContain('mailto:datenschutz@lernzeit.de');
    expect(html).not.toContain('class="draft"');
  });

  it('rejects the development draft', () => {
    const html = publicPages.renderAccountDeletionPage(developmentOperator, { isDevelopment: true });
    const issues = publicPages.collectAccountDeletionPageIssues(html, developmentOperator).join(' ');
    expect(issues).toMatch(/Entwicklungsdomain "lernzeit\.invalid"/);
    expect(issues).toMatch(/Testwert/);
    expect(issues).toMatch(/Entwicklungsbanner/);
    expect(issues).toMatch(/keine echte Betreiber-E-Mail/);
  });

  it('rejects a page that only hides the banner but keeps the test values', () => {
    const html = publicPages.renderAccountDeletionPage(developmentOperator, { isDevelopment: false });
    expect(html).not.toContain('class="draft"');
    expect(publicPages.collectAccountDeletionPageIssues(html, developmentOperator).join(' '))
      .toMatch(/Entwicklungsdomain/);
  });

  it('rejects any other reserved .invalid domain', () => {
    const html = publicPages
      .renderAccountDeletionPage(productionOperator, { isDevelopment: false })
      .replace('datenschutz@lernzeit.de', 'datenschutz@betreiber.invalid');
    expect(publicPages.collectAccountDeletionPageIssues(html).join(' '))
      .toMatch(/reservierte \.invalid-Domains: betreiber\.invalid/);
  });

  it('rejects a page whose operator details do not match the configuration', () => {
    const html = publicPages.renderAccountDeletionPage(
      { ...productionOperator, operatorName: 'Alte Firma GmbH' },
      { isDevelopment: false },
    );
    expect(publicPages.collectAccountDeletionPageIssues(html, productionOperator).join(' '))
      .toMatch(/Betreibername \(operatorName\) steht nicht auf der Seite/);
  });

  /**
   * The page may only describe a process that exists. There is no implemented
   * workflow that mails a one-time confirmation code, and no binding deadline
   * the operator has committed to, so the page must promise neither.
   */
  it('promises no confirmation-code workflow and no deadline', () => {
    const html = publicPages.renderAccountDeletionPage(productionOperator, { isDevelopment: false });
    expect(html).not.toMatch(/Best(ä|ae)tigungscode/i);
    expect(html).not.toMatch(/72\s*Stunden/i);
    expect(html).not.toMatch(/innerhalb von sieben Tagen/i);
    // What it does say: a manual identity check that never deletes on an
    // unverified mail alone.
    expect(html).toMatch(/l(ö|oe)st f(ü|ue)r sich genommen keine L(ö|oe)schung aus/i);
    expect(html).toMatch(/gesetzlichen Fristen/i);
  });

  it('escapes operator values into the page', () => {
    const html = publicPages.renderAccountDeletionPage(
      { ...productionOperator, operatorName: 'Müller & Co <GmbH>' },
      { isDevelopment: false },
    );
    expect(html).toContain('Müller &amp; Co &lt;GmbH&gt;');
    expect(html).not.toContain('<GmbH>');
  });
});

// --- 6. recovery callback derivation ----------------------------------------

describe('password recovery callback', () => {
  it('builds an HTTPS App Link from a real operator domain', () => {
    expect(releaseConfig.recoveryRedirectUrl(completeEnvironment)).toEqual({
      url: 'https://lernzeit.de/update-password?type=recovery',
      kind: 'https-app-link',
    });
  });

  it('keeps the fixed recovery path even when the base URL has a path', () => {
    expect(releaseConfig.recoveryRedirectUrl({
      EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de/rechtliches/lernzeit',
    })).toEqual({
      url: 'https://lernzeit.de/update-password?type=recovery',
      kind: 'https-app-link',
    });
  });

  it('falls back to the private scheme only without a real domain', () => {
    expect(releaseConfig.recoveryRedirectUrl({})).toEqual({
      url: 'lernzeit://auth/update-password?type=recovery',
      kind: 'custom-scheme',
    });
  });

  it.each([
    ['keine Domain', {}],
    ['Entwicklungsmarker', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.invalid' }],
    ['andere .invalid-Domain', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.example.invalid' }],
    ['HTTP statt HTTPS', { EXPO_PUBLIC_LEGAL_SITE_URL: 'http://lernzeit.de' }],
    ['Port', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de:8443' }],
    ['Zugangsdaten', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://user:pw@lernzeit.de' }],
  ])('has no HTTPS callback for %s', (_label, environment) => {
    expect(releaseConfig.passwordRecoveryHttpsUrl(environment)).toBeNull();
    expect(releaseConfig.recoveryRedirectUrl(environment).kind).toBe('custom-scheme');
  });

  it('blocks a production release that would use the private scheme', () => {
    const issues = releaseConfig.collectRecoveryReleaseIssues({}) as Issue[];
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/lernzeit:\/\/auth\/update-password/);

    const blockers = releaseConfig.collectReleaseBlockers({
      ...completeEnvironment,
      EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.invalid',
    }) as Issue[];
    expect(blockers.some((issue) => issue.detail.includes('lernzeit://auth/update-password'))).toBe(true);
  });

  it('raises no recovery blocker for a complete production environment', () => {
    expect(releaseConfig.collectRecoveryReleaseIssues(completeEnvironment)).toEqual([]);
    expect(releaseConfig.collectReleaseBlockers(completeEnvironment)).toEqual([]);
  });

  it('derives the App Links host exactly once for app and manifest', () => {
    expect(releaseConfig.legalSiteHostFromEnvironment(completeEnvironment)).toBe('lernzeit.de');
    expect(releaseConfig.legalSiteHostFromBaseUrl('https://lernzeit.de/rechtliches')).toBe('lernzeit.de');
    expect(releaseConfig.legalSiteHostFromBaseUrl('kaputt')).toBe('lernzeit.invalid');
    // The host in the callback is the same host the intent filter declares.
    const host = releaseConfig.legalSiteHostFromEnvironment(completeEnvironment);
    expect(releaseConfig.recoveryRedirectUrl(completeEnvironment).url).toBe(
      `https://${host}/update-password?type=recovery`,
    );
  });
});

// --- 7. public operator hosts -----------------------------------------------
//
// The ranges are checked numerically. A prefix test such as
// startsWith('172.16.') would miss 172.20.0.1 and wrongly reject 172.160.0.1,
// so the boundaries of every range are asserted individually.

describe('public operator hosts', () => {
  it.each([
    ['gewoehnliche Domain', 'lernzeit.de'],
    ['Subdomain', 'legal.lernzeit.de'],
    ['Punycode', 'xn--bcher-kva.de'],
    ['Punycode-TLD', 'lernzeit.xn--p1ai'],
    ['langes TLD', 'lernzeit.software'],
    ['abschliessender Punkt', 'lernzeit.de.'],
    ['Grossschreibung', 'LERNZEIT.DE'],
  ])('accepts %s', (_label, host) => {
    expect(publicHost.classifyPublicHost(host).public).toBe(true);
    expect(publicHost.isPublicOperatorHost(host)).toBe(true);
    expect(publicHost.publicOperatorHostIssue(host)).toBeNull();
  });

  it.each([
    ['localhost', 'localhost'],
    ['*.localhost', 'app.localhost'],
    ['*.local', 'drucker.local'],
    ['Single-Label', 'intranet'],
    ['*.invalid', 'lernzeit.invalid'],
    ['*.test', 'lernzeit.test'],
    ['*.example', 'lernzeit.example'],
    ['RFC-2606-Beispieldomain', 'example.com'],
    ['numerisches TLD', 'lernzeit.12'],
    ['leerer Host', ''],
    ['Host mit Pfad', 'lernzeit.de/pfad'],
    ['Host mit Zugangsdaten', 'user@lernzeit.de'],
    // IDNA is performed differently by different URL implementations, so the
    // punycode form has to be configured explicitly.
    ['nicht-ASCII', 'bücher.de'],
  ])('rejects %s', (_label, host) => {
    expect(publicHost.classifyPublicHost(host).public).toBe(false);
    expect(publicHost.isPublicOperatorHost(host)).toBe(false);
    expect(publicHost.publicOperatorHostIssue(host)).toEqual(expect.any(String));
  });

  // The exact boundaries of every non-public IPv4 range.
  it.each<[string, boolean]>([
    ['0.0.0.0', false],
    ['0.255.255.255', false],
    ['1.0.0.0', true],
    ['9.255.255.255', true],
    ['10.0.0.0', false],
    ['10.255.255.255', false],
    ['11.0.0.0', true],
    ['100.63.255.255', true],
    ['100.64.0.0', false],
    ['100.127.255.255', false],
    ['100.128.0.0', true],
    ['126.255.255.255', true],
    ['127.0.0.0', false],
    ['127.255.255.255', false],
    ['128.0.0.0', true],
    ['169.253.255.255', true],
    ['169.254.0.0', false],
    ['169.254.255.255', false],
    ['169.255.0.0', true],
    ['172.15.255.255', true],
    ['172.16.0.0', false],
    ['172.31.255.255', false],
    ['172.32.0.0', true],
    ['192.167.255.255', true],
    ['192.168.0.0', false],
    ['192.168.255.255', false],
    ['192.169.0.0', true],
    ['223.255.255.255', true],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
  ])('classifies IPv4 %s as public=%s', (host, expected) => {
    expect(publicHost.classifyPublicHost(host).public).toBe(expected);
  });

  it.each<[string, boolean]>([
    ['[::]', false],
    ['[::1]', false],
    ['[fe80::1]', false],
    ['[febf:ffff::1]', false],
    ['[fc00::1]', false],
    ['[fd12:3456::1]', false],
    ['[fdff:ffff::1]', false],
    ['[2001:db8::1]', false],
    ['[2606:4700:4700::1111]', true],
    ['[2a00:1450:4001:80e::200e]', true],
    // IPv4-mapped addresses reach the IPv4 stack, so the embedded address
    // decides. The URL parser rewrites the dotted quad to hex groups first.
    ['[::ffff:127.0.0.1]', false],
    ['[::ffff:10.0.0.1]', false],
    ['[::ffff:8.8.8.8]', true],
  ])('classifies IPv6 %s as public=%s', (host, expected) => {
    expect(publicHost.classifyPublicHost(host).public).toBe(expected);
  });

  // Every legal spelling of an address must reach the same verdict as the
  // canonical one, otherwise an operator could smuggle a loopback past the gate.
  it.each(['0x7f.1', '2130706433', '127.1', '0177.0.0.1'])(
    'normalises the loopback spelling %s before classifying it',
    (host) => {
      expect(publicHost.classifyPublicHost(host).public).toBe(false);
    },
  );

  it('refuses a bare public IP as an operator domain', () => {
    expect(publicHost.classifyPublicHost('8.8.8.8').public).toBe(true);
    expect(publicHost.isPublicOperatorHost('8.8.8.8')).toBe(false);
    expect(publicHost.publicOperatorHostIssue('8.8.8.8')).toMatch(/App Links|Domainname/);
  });

  it('blocks a non-public legal site URL in the release gate', () => {
    for (const url of ['https://localhost', 'https://192.168.1.10', 'https://intranet']) {
      const issues = releaseConfig.collectReleaseBlockers({
        ...completeEnvironment,
        EXPO_PUBLIC_LEGAL_SITE_URL: url,
      }) as Issue[];
      expect(issues.map((issue) => issue.envVar)).toContain('EXPO_PUBLIC_LEGAL_SITE_URL');
      expect(issues.map((issue) => issue.key)).toContain('passwordRecoveryRedirect');
    }
  });
});

// --- 8. resolved Expo configuration -----------------------------------------

describe('expo config release checks', () => {
  const PRODUCTION_ENVIRONMENT = { ...completeEnvironment, LERNZEIT_RELEASE_GATE: '1' };
  const DEVELOPMENT_ENVIRONMENT = { EAS_BUILD_PROFILE: 'development' };

  function manifest(environment: Record<string, string | undefined>): TestManifest {
    const auth = releaseConfig.resolveAuthBuildConfiguration(environment) as AuthBuildConfiguration;
    const intentFilters: IntentFilter[] = auth.recoveryTransport === 'https-app-link'
      ? [{
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: auth.androidAppLinkHost, path: '/update-password' }],
      }]
      : [{
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'lernzeit', host: 'auth', path: '/update-password' }],
      }];
    return {
      version: '1.0.0',
      scheme: 'lernzeit',
      android: {
        package: 'de.lernzeit.app',
        versionCode: 1,
        allowBackup: false,
        intentFilters,
      },
      plugins: [['expo-build-properties', {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 24,
          usesCleartextTraffic: false,
        },
      }]],
      extra: { authBuildAttestation: authBuild.serializeAuthBuildConfiguration(auth) },
    };
  }

  const PRIVATE_RECOVERY_FILTER: IntentFilter = {
    action: 'VIEW',
    category: ['BROWSABLE', 'DEFAULT'],
    data: [{ scheme: 'lernzeit', host: 'auth', path: '/update-password' }],
  };

  it('accepts a production manifest', () => {
    expect(
      expoConfigCheck.collectExpoConfigIssues(manifest(PRODUCTION_ENVIRONMENT), PRODUCTION_ENVIRONMENT).failures,
    ).toEqual([]);
  });

  it('accepts a development manifest with the private recovery filter', () => {
    const config = manifest(DEVELOPMENT_ENVIRONMENT);
    expect(expoConfigCheck.findPrivateRecoveryFilter(config.android.intentFilters)).not.toBeNull();
    expect(
      expoConfigCheck.collectExpoConfigIssues(config, DEVELOPMENT_ENVIRONMENT).failures,
    ).toEqual([]);
  });

  it('production manifests carry no private recovery intent filter', () => {
    const config = manifest(PRODUCTION_ENVIRONMENT);
    expect(expoConfigCheck.findPrivateRecoveryFilter(config.android.intentFilters)).toBeNull();
  });

  // The gate must fail loudly, not merely stay silent, when the private
  // recovery route is put back into a production manifest.
  it('rejects a production manifest that still registers the private scheme', () => {
    const config = manifest(PRODUCTION_ENVIRONMENT);
    config.android.intentFilters.push(PRIVATE_RECOVERY_FILTER);
    const { failures } = expoConfigCheck.collectExpoConfigIssues(config, PRODUCTION_ENVIRONMENT);
    expect(failures.join(' ')).toMatch(/privaten Recovery-Intent-Filter/);
  });

  it('rejects a development manifest without the private scheme', () => {
    const config = manifest(DEVELOPMENT_ENVIRONMENT);
    config.android.intentFilters = [];
    expect(expoConfigCheck.collectExpoConfigIssues(config, DEVELOPMENT_ENVIRONMENT).failures.join(' '))
      .toMatch(/fehlt der private Recovery-Deep-Link/);
  });

  it('rejects a development manifest that claims a verified App Link', () => {
    const config = manifest(DEVELOPMENT_ENVIRONMENT);
    config.android.intentFilters.push({
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'https', host: 'lernzeit.de', path: '/update-password' }],
    });
    expect(expoConfigCheck.collectExpoConfigIssues(config, DEVELOPMENT_ENVIRONMENT).failures.join(' '))
      .toMatch(/kein autoVerify-App-Link/);
  });

  it.each<[string, (config: TestManifest) => void, RegExp]>([
    ['fehlender App Link', (config) => { config.android.intentFilters = []; }, /kein verifizierter Android App Link/],
    [
      'abweichender App-Links-Host',
      (config) => { config.android.intentFilters[0].data[0].host = 'andere.de'; },
      /App-Links-Host/,
    ],
    ['fehlende Attestierung', (config) => { delete config.extra.authBuildAttestation; }, /keine lesbare Auth-Build-Attestierung/],
    [
      'manipulierte Attestierung',
      (config) => {
        config.extra.authBuildAttestation = authBuild.serializeAuthBuildConfiguration(
          releaseConfig.resolveAuthBuildConfiguration({}),
        );
      },
      /passt nicht zur aufgeloesten Konfiguration/,
    ],
    ['falscher Paketname', (config) => { config.android.package = 'com.other.app'; }, /Paketname/],
    ['Backup erlaubt', (config) => { config.android.allowBackup = true; }, /allowBackup/],
    ['fehlendes App-Scheme', (config) => { config.scheme = undefined; }, /App-Scheme/],
  ])('rejects a production manifest with %s', (_label, mutate, expected) => {
    const config = manifest(PRODUCTION_ENVIRONMENT);
    mutate(config);
    expect(expoConfigCheck.collectExpoConfigIssues(config, PRODUCTION_ENVIRONMENT).failures.join(' '))
      .toMatch(expected);
  });

  it('rejects a production manifest that carries the development marker domain', () => {
    const config = manifest(PRODUCTION_ENVIRONMENT);
    config.extra.legalSiteHost = 'lernzeit.invalid';
    expect(expoConfigCheck.collectExpoConfigIssues(config, PRODUCTION_ENVIRONMENT).failures.join(' '))
      .toMatch(/lernzeit\.invalid/);
  });
});

// --- 9. bundled recovery attestation ----------------------------------------
//
// The scanner must prove what the *built* app does, not recompute the expected
// value from the environment and agree with itself.

describe('bundled recovery attestation', () => {
  const PRODUCTION = releaseConfig
    .resolveAuthBuildConfiguration(completeEnvironment) as AuthBuildConfiguration;
  const DEVELOPMENT = releaseConfig.resolveAuthBuildConfiguration({}) as AuthBuildConfiguration;

  /** An export document shaped like the escaped manifest Metro embeds. */
  function exportWith(configuration: AuthBuildConfiguration, file = 'entry.js') {
    const manifest = JSON.stringify({
      extra: { authBuildAttestation: authBuild.serializeAuthBuildConfiguration(configuration) },
    });
    return [{ file, content: `var m=${JSON.stringify(manifest)};console.log(m);` }];
  }

  it('accepts a correct production export', () => {
    expect(recoveryAttestation.collectProductionRecoveryIssues(exportWith(PRODUCTION), PRODUCTION))
      .toEqual([]);
  });

  it('rejects an export whose bundled HTTPS domain is not the expected one', () => {
    const other = releaseConfig.resolveAuthBuildConfiguration({
      EXPO_PUBLIC_LEGAL_SITE_URL: 'https://angreifer.de',
    }) as AuthBuildConfiguration;
    const failures = recoveryAttestation.collectProductionRecoveryIssues(exportWith(other), PRODUCTION);
    expect(failures.join(' ')).toMatch(/gebuendelte Recovery-URL/);
  });

  it('rejects an export without any attestation', () => {
    const failures = recoveryAttestation.collectProductionRecoveryIssues(
      [{ file: 'entry.js', content: 'var a=1;' }],
      PRODUCTION,
    );
    expect(failures.join(' ')).toMatch(/keine Auth-Build-Attestierung/);
  });

  it('rejects custom-scheme as the production transport', () => {
    const failures = recoveryAttestation.collectProductionRecoveryIssues(
      exportWith(DEVELOPMENT),
      PRODUCTION,
    );
    expect(failures.join(' ')).toMatch(/custom-scheme/);
  });

  it('rejects a host mismatch between manifest App Link and runtime', () => {
    const drifted = { ...PRODUCTION, androidAppLinkHost: 'andere.de' };
    const failures = recoveryAttestation.collectProductionRecoveryIssues(
      exportWith(drifted),
      PRODUCTION,
    );
    expect(failures.join(' ')).toMatch(/App-Link-Host/);
  });

  it('rejects an export that carries two different attestations', () => {
    const documents = [...exportWith(PRODUCTION, 'a.js'), ...exportWith(DEVELOPMENT, 'b.js')];
    expect(recoveryAttestation.collectProductionRecoveryIssues(documents, PRODUCTION).join(' '))
      .toMatch(/verschiedene Attestierungen/);
  });

  it('rejects a second, foreign HTTPS recovery domain in the bundle', () => {
    const documents = [
      ...exportWith(PRODUCTION),
      { file: 'other.js', content: 'var u="https://angreifer.de/update-password?type=recovery";' },
    ];
    expect(recoveryAttestation.collectProductionRecoveryIssues(documents, PRODUCTION).join(' '))
      .toMatch(/fremde HTTPS-Recovery-URLs/);
  });

  /**
   * The private scheme URL is a constant of the shared derivation module and
   * CommonJS has no tree shaking, so it is present even in a production export.
   * Its presence must not be mistaken for it being the active transport - the
   * attestation is what decides.
   */
  it('tolerates the inactive custom-scheme constant in a production export', () => {
    const documents = [
      ...exportWith(PRODUCTION),
      { file: 'shared.js', content: `var fallback="${releaseConfig.CUSTOM_RECOVERY_URL}";` },
    ];
    expect(recoveryAttestation.collectProductionRecoveryIssues(documents, PRODUCTION)).toEqual([]);
  });

  it('accepts a development export that attests the custom scheme', () => {
    expect(recoveryAttestation.collectDevelopmentRecoveryIssues(exportWith(DEVELOPMENT))).toEqual([]);
    expect(recoveryAttestation.collectAttestationConsistencyIssues(exportWith(DEVELOPMENT))).toEqual([]);
  });

  it('rejects a development export that attests an App Link', () => {
    expect(recoveryAttestation.collectDevelopmentRecoveryIssues(exportWith(PRODUCTION)).join(' '))
      .toMatch(/erwartet "custom-scheme"/);
  });
});

// --- 10. atomic generation of the published files ---------------------------

describe('atomic public page generation', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'lernzeit-atomic-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const pagePath = () => path.join(directory, 'account-deletion', 'index.html');
  const linksPath = () => path.join(directory, '.well-known', 'assetlinks.json');

  it('writes both files and creates the target directories', () => {
    atomicWrite.writeFilesAtomically([
      { path: pagePath(), content: '<html>neu</html>' },
      { path: linksPath(), content: '[]\n' },
    ]);
    expect(readFileSync(pagePath(), 'utf8')).toBe('<html>neu</html>');
    expect(readFileSync(linksPath(), 'utf8')).toBe('[]\n');
  });

  it('replaces both files together', () => {
    atomicWrite.writeFilesAtomically([
      { path: pagePath(), content: 'alt-1' },
      { path: linksPath(), content: 'alt-2' },
    ]);
    atomicWrite.writeFilesAtomically([
      { path: pagePath(), content: 'neu-1' },
      { path: linksPath(), content: 'neu-2' },
    ]);
    expect(readFileSync(pagePath(), 'utf8')).toBe('neu-1');
    expect(readFileSync(linksPath(), 'utf8')).toBe('neu-2');
  });

  /**
   * The point of the module: a failure on the second file must not leave the
   * first one updated. A published deletion page next to a stale
   * assetlinks.json is exactly the mixed state nobody notices.
   */
  it('leaves the previous state untouched when the second write fails', () => {
    atomicWrite.writeFilesAtomically([
      { path: pagePath(), content: 'alt-1' },
      { path: linksPath(), content: 'alt-2' },
    ]);
    // A directory can never be replaced by a file rename.
    const blocked = path.join(directory, 'blocked');
    mkdirSync(path.join(blocked, 'inner'), { recursive: true });

    expect(() => atomicWrite.writeFilesAtomically([
      { path: pagePath(), content: 'neu-1' },
      { path: blocked, content: 'neu-2' },
    ])).toThrow();

    expect(readFileSync(pagePath(), 'utf8')).toBe('alt-1');
    expect(readFileSync(linksPath(), 'utf8')).toBe('alt-2');
  });

  it('removes a file again that did not exist before a failed run', () => {
    const blocked = path.join(directory, 'blocked');
    mkdirSync(path.join(blocked, 'inner'), { recursive: true });

    expect(() => atomicWrite.writeFilesAtomically([
      { path: pagePath(), content: 'neu-1' },
      { path: blocked, content: 'neu-2' },
    ])).toThrow();

    expect(atomicWrite.readExisting(pagePath())).toBeNull();
  });

  it('leaves no temporary files behind', () => {
    const blocked = path.join(directory, 'blocked');
    mkdirSync(blocked, { recursive: true });
    try {
      atomicWrite.writeFilesAtomically([
        { path: pagePath(), content: 'neu-1' },
        { path: blocked, content: 'neu-2' },
      ]);
    } catch {
      // expected
    }
    const leftovers = bundleScan.scanExportDirectory(directory).documents
      .map((document: { file: string }) => document.file)
      .filter((file: string) => file.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
