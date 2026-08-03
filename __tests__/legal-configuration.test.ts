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
  EXPO_PUBLIC_TERMS_LIABILITY: 'Es gilt deutsches Recht unter Wahrung zwingender Verbraucherschutzvorschriften.',
  EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE: '2026-08-03',
  EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbCdEf1234567890',
};

describe('legal site configuration', () => {
  it('accepts only a clean HTTPS origin or base path', () => {
    expect(resolveLegalSiteBaseUrl('https://legal.example.com/lernzeit/')).toBe(
      'https://legal.example.com/lernzeit',
    );
  });

  it.each([
    'http://legal.example.com',
    'javascript:alert(1)',
    'https://user:password@legal.example.com',
    'https://legal.example.com?token=value',
    'https://legal.example.com/#fragment',
    'https://legal.example.com:8443',
    'not a URL',
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

  it('never lets a secret Supabase key into the app configuration', () => {
    const withSecret = {
      ...completeEnvironment,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_realsecretvalue',
    };
    expect(collectReleaseBlockers(withSecret).map((issue) => issue.envVar))
      .toContain('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
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
    const anonJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl';
    expect(collectReleaseBlockers({
      ...completeEnvironment,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: anonJwt,
    })).toEqual([]);
  });
});
