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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import releaseConfig from '../config/release-config.cjs';
import bundleScan from '../scripts/lib/bundle-scan.cjs';
import publicPages from '../scripts/lib/public-pages.cjs';
import sensitiveFiles from '../scripts/lib/sensitive-files.cjs';

type Environment = Record<string, string | undefined>;
type Issue = { envVar: string; reason: string; detail: string };

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
    ['sb_secret_*', 'sb_secret_realsecretvalue', 'secret-key'],
    ['leerer Wert', '', 'missing'],
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
