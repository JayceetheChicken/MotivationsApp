import { DEVELOPMENT_LEGAL_SITE, resolveLegalSiteBaseUrl } from '@/legal/configuration';
import {
  BUNDLED_ENVIRONMENT,
  collectOperatorReleaseIssues,
  collectReleaseBlockers,
  isPlaceholderValue,
  legalSiteHost,
  normalizeHttpsBaseUrl,
  OPERATOR_FIELDS,
  resolveOperatorValues,
} from '@/legal/operator';

import releaseConfig from '../config/release-config.cjs';

const {
  collectRecoveryReleaseIssues,
  passwordRecoveryHttpsUrl,
  passwordRecoverySchemeUrl,
  recoveryRedirectUrl,
} = releaseConfig;

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/=+$/, '')
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

function jwt(payload: unknown): string {
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(payload))}.${base64Url('signature')}`;
}

const ANON_JWT = jwt({ iss: 'supabase', role: 'anon' });
const SERVICE_ROLE_JWT = jwt({ iss: 'supabase', role: 'service_role' });

const completeEnvironment: Record<string, string> = {
  // A complete production environment names its build profile: it decides the
  // recovery transport and whether the private URL scheme is registered.
  EXPO_PUBLIC_BUILD_PROFILE: 'production',
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
  EXPO_PUBLIC_TERMS_LIABILITY: 'Es gilt deutsches Recht unter Wahrung zwingender Verbraucherschutzvorschriften.',
  EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE: '2026-08-03',
  EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbCdEf1234567890',
};

describe('legal site configuration', () => {
  it('accepts only a clean HTTPS origin or base path', () => {
    expect(resolveLegalSiteBaseUrl('https://legal.lernzeit.de/lernzeit/')).toBe(
      'https://legal.lernzeit.de/lernzeit',
    );
  });

  it.each([
    'http://legal.lernzeit.de',
    'javascript:alert(1)',
    'https://user:password@legal.lernzeit.de',
    'https://legal.lernzeit.de?token=value',
    'https://legal.lernzeit.de/#fragment',
    'https://legal.lernzeit.de:8443',
    'not a URL',
    // Not publicly usable: see config/public-host.cjs.
    'https://localhost',
    'https://lernzeit.localhost',
    'https://192.168.10.4',
    'https://[::1]',
    'https://lernzeit',
    'https://example.com',
  ])('falls back to the development marker for %s', (value) => {
    expect(resolveLegalSiteBaseUrl(value)).toBe(DEVELOPMENT_LEGAL_SITE);
    expect(normalizeHttpsBaseUrl(value)).toBeNull();
  });

  it('derives the App Links host from the operator domain', () => {
    expect(legalSiteHost('https://lernzeit.de/rechtliches')).toBe('lernzeit.de');
    expect(legalSiteHost('kaputt')).toBe('lernzeit.invalid');
  });
});

describe('operator release gate', () => {
  it('describes every legally required operator detail exactly once', () => {
    const keys = OPERATOR_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(OPERATOR_FIELDS.map((field) => field.envVar)).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([
      'operatorName',
      'operatorAddress',
      'operatorContactEmail',
      'privacyContactEmail',
      'supportEmail',
      'abuseContactEmail',
      'dataProtectionAuthority',
      'supabaseContractParty',
      'supabaseRegion',
      'supabaseDataProcessingAgreement',
      'accountLegalBasis',
      'logRetentionPolicy',
      'statutoryRetention',
      'legalSiteUrl',
    ]));
  });

  // Metro only inlines literal process.env.EXPO_PUBLIC_X member expressions.
  // If a field were missing from BUNDLED_ENVIRONMENT the release gate would
  // still pass while the shipped bundle silently used a development value.
  it('reads every catalogue variable literally so Metro can inline it', () => {
    const bundled = Object.keys(BUNDLED_ENVIRONMENT).sort();
    const catalogue = OPERATOR_FIELDS.map((field) => field.envVar).sort();
    expect(bundled).toEqual(catalogue);
  });

  it('blocks an empty environment and names every missing field', () => {
    const issues = collectOperatorReleaseIssues({});
    const required = OPERATOR_FIELDS.filter((field) => field.requirement === 'required');
    expect(issues).toHaveLength(required.length);
    expect(issues.every((issue) => issue.reason === 'missing')).toBe(true);
  });

  it('passes a complete production environment', () => {
    expect(collectReleaseBlockers(completeEnvironment)).toEqual([]);
  });

  it.each([
    ['EXPO_PUBLIC_OPERATOR_NAME', '[NAME/FIRMA]'],
    ['EXPO_PUBLIC_OPERATOR_ADDRESS', 'Anschrift noch ergänzen'],
    ['EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL', 'datenschutz@lernzeit.example.invalid'],
    ['EXPO_PUBLIC_LEGAL_SITE_URL', 'https://lernzeit.example.invalid'],
    ['EXPO_PUBLIC_SUPABASE_URL', 'https://your-project-id.supabase.co'],
    ['EXPO_PUBLIC_STATUTORY_RETENTION', 'TODO'],
    ['EXPO_PUBLIC_SUPPORT_EMAIL', 'Testwert: Support'],
  ])('rejects the placeholder %s=%s', (envVar, value) => {
    const issues = collectReleaseBlockers({ ...completeEnvironment, [envVar]: value });
    expect(issues.map((issue) => issue.envVar)).toContain(envVar);
    expect(issues.find((issue) => issue.envVar === envVar)?.reason).toBe('placeholder');
  });

  it.each([
    ['EXPO_PUBLIC_OPERATOR_CONTACT_EMAIL', 'kontakt(at)lernzeit.de'],
    ['EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE', '03.08.2026'],
    ['EXPO_PUBLIC_LEGAL_SITE_URL', 'http://lernzeit.de'],
  ])('rejects the malformed %s=%s', (envVar, value) => {
    const issues = collectReleaseBlockers({ ...completeEnvironment, [envVar]: value });
    expect(issues.map((issue) => issue.envVar)).toContain(envVar);
  });

  it.each([
    ['sb_secret_*', 'sb_secret_realsecretvalue'],
    ['service_role-JWT', SERVICE_ROLE_JWT],
    ['JWT mit unbekannter Rolle', jwt({ role: 'authenticated' })],
    ['JWT ohne Rolle', jwt({ iss: 'supabase' })],
  ])('never lets a %s into the app configuration', (_label, key) => {
    const issues = collectReleaseBlockers({
      ...completeEnvironment,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    });
    expect(issues.map((issue) => issue.envVar))
      .toContain('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });

  it('explains a service_role key differently from a typo', () => {
    const detailFor = (key: string) => collectReleaseBlockers({
      ...completeEnvironment,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    }).find((issue) => issue.envVar === 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')?.detail ?? '';

    expect(detailFor(SERVICE_ROLE_JWT)).toMatch(/service_role/);
    expect(detailFor('nonsense-key')).not.toMatch(/service_role/);
  });

  it('keeps development builds usable with clearly marked test values', () => {
    const values = resolveOperatorValues({});
    expect(values.operatorName).toContain('Testwert');
    expect(values.privacyContactEmail).toContain('lernzeit.invalid');
    expect(values.legalSiteUrl).toBe('https://lernzeit.invalid');
    expect(values.operatorPhone).toBe('');
    for (const field of OPERATOR_FIELDS) {
      if (field.requirement === 'required') expect(isPlaceholderValue(values[field.key])).toBe(true);
    }
  });

  it('accepts a real anon JWT as the public key', () => {
    expect(collectReleaseBlockers({
      ...completeEnvironment,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
    })).toEqual([]);
  });
});

/**
 * The app, app.config.js and the release gate must all derive the recovery
 * callback from the same place, otherwise the Android intent filter and the URL
 * in the recovery mail can drift apart.
 */
describe('password recovery callback in the app', () => {
  it('builds the HTTPS App Link from the operator domain', () => {
    expect(recoveryRedirectUrl(completeEnvironment)).toEqual({
      url: 'https://lernzeit.de/update-password?type=recovery',
      kind: 'https-app-link',
    });
    expect(passwordRecoveryHttpsUrl(completeEnvironment))
      .toBe('https://lernzeit.de/update-password?type=recovery');
  });

  it('uses the fixed recovery path even when the legal URL has a base path', () => {
    expect(recoveryRedirectUrl({
      ...completeEnvironment,
      EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de/rechtliches',
    }).url).toBe('https://lernzeit.de/update-password?type=recovery');
  });

  it('uses the private scheme only where no real domain exists', () => {
    expect(recoveryRedirectUrl({})).toEqual({
      url: passwordRecoverySchemeUrl(),
      kind: 'custom-scheme',
    });
    expect(passwordRecoverySchemeUrl()).toBe('lernzeit://auth/update-password?type=recovery');
    expect(passwordRecoveryHttpsUrl({})).toBeNull();
  });

  it('blocks a production release that would fall back to the private scheme', () => {
    expect(collectRecoveryReleaseIssues(completeEnvironment)).toEqual([]);

    const withoutDomain = { ...completeEnvironment, EXPO_PUBLIC_LEGAL_SITE_URL: '' };
    const issues = collectRecoveryReleaseIssues(withoutDomain);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain('lernzeit://auth/update-password');
    expect(collectReleaseBlockers(withoutDomain).map((issue) => issue.key))
      .toContain('passwordRecoveryRedirect');
  });

  it.each([
    ['Entwicklungsmarker', 'https://lernzeit.invalid'],
    ['andere .invalid-Domain', 'https://lernzeit.example.invalid'],
    ['HTTP', 'http://lernzeit.de'],
  ])('blocks a production release with %s as the legal site URL', (_label, value) => {
    expect(collectReleaseBlockers({ ...completeEnvironment, EXPO_PUBLIC_LEGAL_SITE_URL: value })
      .map((issue) => issue.key)).toContain('passwordRecoveryRedirect');
  });

  it('resolves the redirect of this build from the bundled environment', () => {
    expect(recoveryRedirectUrl(BUNDLED_ENVIRONMENT).url).toContain('/update-password?type=recovery');
  });

  it('names the same host that app.config.js declares as the App Link host', () => {
    expect(new URL(recoveryRedirectUrl(completeEnvironment).url).hostname)
      .toBe(legalSiteHost(completeEnvironment.EXPO_PUBLIC_LEGAL_SITE_URL));
  });
});
