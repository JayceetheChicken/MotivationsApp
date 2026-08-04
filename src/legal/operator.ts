/**
 * App-facing view of the central operator configuration.
 *
 * The validation logic itself lives in config/release-config.cjs so that the
 * app bundle, the Expo config and the CI release gate all execute the exact
 * same code. This module only adds types and the resolved singletons.
 */
import releaseConfig from '../../config/release-config.cjs';

export type OperatorFieldKind = 'text' | 'email' | 'https-url' | 'iso-date';
export type OperatorFieldRequirement = 'required' | 'optional';

export interface OperatorFieldDefinition {
  readonly key: string;
  readonly envVar: string;
  readonly label: string;
  readonly requirement: OperatorFieldRequirement;
  readonly kind: OperatorFieldKind;
  readonly description: string;
}

export interface OperatorFieldIssue {
  readonly key: string;
  readonly envVar: string;
  readonly label: string;
  readonly reason: 'missing' | 'placeholder' | 'invalid-format';
  readonly detail: string;
}

export type OperatorEnvironment = Readonly<Record<string, string | undefined>>;
export type OperatorValues = Readonly<Record<string, string>>;

export const OPERATOR_FIELDS = releaseConfig.OPERATOR_FIELDS as readonly OperatorFieldDefinition[];
export const DEVELOPMENT_MARKER_DOMAIN: string = releaseConfig.DEVELOPMENT_MARKER_DOMAIN;

export const isPlaceholderValue = releaseConfig.isPlaceholderValue as (value: string) => boolean;
export const normalizeHttpsBaseUrl = releaseConfig.normalizeHttpsBaseUrl as (value: string) => string | null;
export const resolveOperatorValues = releaseConfig.resolveOperatorValues as (
  environment: OperatorEnvironment,
) => OperatorValues;
export const collectOperatorReleaseIssues = releaseConfig.collectOperatorReleaseIssues as (
  environment: OperatorEnvironment,
) => readonly OperatorFieldIssue[];
export const collectReleaseBlockers = releaseConfig.collectReleaseBlockers as (
  environment: OperatorEnvironment,
) => readonly OperatorFieldIssue[];
export const collectRecoveryReleaseIssues = releaseConfig.collectRecoveryReleaseIssues as (
  environment: OperatorEnvironment,
) => readonly OperatorFieldIssue[];

export type PasswordRecoveryRedirect = Readonly<{
  url: string;
  kind: 'https-app-link' | 'custom-scheme';
}>;

/**
 * Verified HTTPS App Link callback, or null when no real operator domain is
 * configured.
 */
export const passwordRecoveryHttpsUrl = releaseConfig.passwordRecoveryHttpsUrl as (
  environment: OperatorEnvironment,
) => string | null;

/** Private-scheme fallback, only reachable in development and preview builds. */
export const passwordRecoverySchemeUrl = releaseConfig.passwordRecoverySchemeUrl as () => string;

/** The single derivation of the recovery callback handed to Supabase. */
export const recoveryRedirectUrl = releaseConfig.recoveryRedirectUrl as (
  environment: OperatorEnvironment,
) => PasswordRecoveryRedirect;

const legalSiteHostFromBaseUrl = releaseConfig.legalSiteHostFromBaseUrl as (
  baseUrl: string,
) => string;

/**
 * Metro only substitutes *literal* `process.env.EXPO_PUBLIC_X` member
 * expressions. A computed lookup such as `process.env[field.envVar]` is left
 * untouched and evaluates to undefined in the bundle, which would silently ship
 * development placeholders in a production build.
 *
 * Every variable is therefore listed literally here. `__tests__/legal-configuration.test.ts`
 * asserts that this map matches config/operator-fields.json exactly, so a new
 * field cannot be forgotten.
 */
export const BUNDLED_ENVIRONMENT: OperatorEnvironment = {
  EXPO_PUBLIC_LEGAL_SITE_URL: process.env.EXPO_PUBLIC_LEGAL_SITE_URL,
  EXPO_PUBLIC_OPERATOR_NAME: process.env.EXPO_PUBLIC_OPERATOR_NAME,
  EXPO_PUBLIC_OPERATOR_LEGAL_FORM: process.env.EXPO_PUBLIC_OPERATOR_LEGAL_FORM,
  EXPO_PUBLIC_OPERATOR_ADDRESS: process.env.EXPO_PUBLIC_OPERATOR_ADDRESS,
  EXPO_PUBLIC_OPERATOR_CONTACT_EMAIL: process.env.EXPO_PUBLIC_OPERATOR_CONTACT_EMAIL,
  EXPO_PUBLIC_OPERATOR_PHONE: process.env.EXPO_PUBLIC_OPERATOR_PHONE,
  EXPO_PUBLIC_OPERATOR_REGISTER: process.env.EXPO_PUBLIC_OPERATOR_REGISTER,
  EXPO_PUBLIC_OPERATOR_SUPERVISORY_AUTHORITY: process.env.EXPO_PUBLIC_OPERATOR_SUPERVISORY_AUTHORITY,
  EXPO_PUBLIC_OPERATOR_VAT_ID: process.env.EXPO_PUBLIC_OPERATOR_VAT_ID,
  EXPO_PUBLIC_OPERATOR_DISPUTE_RESOLUTION: process.env.EXPO_PUBLIC_OPERATOR_DISPUTE_RESOLUTION,
  EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL: process.env.EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL,
  EXPO_PUBLIC_PRIVACY_OFFICER: process.env.EXPO_PUBLIC_PRIVACY_OFFICER,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_ABUSE_CONTACT_EMAIL: process.env.EXPO_PUBLIC_ABUSE_CONTACT_EMAIL,
  EXPO_PUBLIC_DATA_PROTECTION_AUTHORITY: process.env.EXPO_PUBLIC_DATA_PROTECTION_AUTHORITY,
  EXPO_PUBLIC_LEGAL_BASIS_ACCOUNT: process.env.EXPO_PUBLIC_LEGAL_BASIS_ACCOUNT,
  EXPO_PUBLIC_SUPABASE_CONTRACT_PARTY: process.env.EXPO_PUBLIC_SUPABASE_CONTRACT_PARTY,
  EXPO_PUBLIC_SUPABASE_REGION: process.env.EXPO_PUBLIC_SUPABASE_REGION,
  EXPO_PUBLIC_SUPABASE_DPA_REFERENCE: process.env.EXPO_PUBLIC_SUPABASE_DPA_REFERENCE,
  EXPO_PUBLIC_PRODUCTION_SUBPROCESSORS: process.env.EXPO_PUBLIC_PRODUCTION_SUBPROCESSORS,
  EXPO_PUBLIC_LOG_RETENTION_POLICY: process.env.EXPO_PUBLIC_LOG_RETENTION_POLICY,
  EXPO_PUBLIC_STATUTORY_RETENTION: process.env.EXPO_PUBLIC_STATUTORY_RETENTION,
  EXPO_PUBLIC_TERMS_LIABILITY: process.env.EXPO_PUBLIC_TERMS_LIABILITY,
  EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE: process.env.EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE,
};

export const OPERATOR: OperatorValues = resolveOperatorValues(BUNDLED_ENVIRONMENT);

/** True while at least one mandatory operator detail is still a development value. */
export const OPERATOR_IS_DEVELOPMENT_ONLY: boolean =
  collectOperatorReleaseIssues(BUNDLED_ENVIRONMENT).length > 0;

export const LEGAL_SITE_BASE_URL: string = OPERATOR.legalSiteUrl;
export const ACCOUNT_DELETION_PUBLIC_URL = `${LEGAL_SITE_BASE_URL}/account-deletion/`;

/** Host used for verified Android App Links and the HTTPS recovery callback. */
export function legalSiteHost(baseUrl: string = LEGAL_SITE_BASE_URL): string {
  return legalSiteHostFromBaseUrl(baseUrl);
}

/**
 * Recovery callback of this build, resolved from the same bundled environment
 * that produced OPERATOR.
 *
 * With a real operator domain this is the verified HTTPS App Link. The private
 * scheme remains only for development and preview builds, where no verified
 * domain exists; a production build cannot reach that branch because
 * `collectRecoveryReleaseIssues` turns it into a release blocker and
 * app.config.js aborts the build.
 */
export const PASSWORD_RECOVERY_REDIRECT: PasswordRecoveryRedirect =
  recoveryRedirectUrl(BUNDLED_ENVIRONMENT);
