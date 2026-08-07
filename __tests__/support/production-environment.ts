/**
 * A complete, syntactically valid production environment.
 *
 * Synthetic throughout: `lernzeit.de` is not the operator's domain and none of
 * these values may be treated as real operator data. The point is only that the
 * release gate has nothing left to complain about, so a test can exercise what
 * happens *after* the gate passes.
 */
export const COMPLETE_PRODUCTION_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  EXPO_PUBLIC_BUILD_PROFILE: 'production',
  LERNZEIT_RELEASE_GATE: '1',
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
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_Cf7Kq2Xr9Vb4Nd8Ms0Zt',
  ANDROID_VERSION_CODE: '1',
});
