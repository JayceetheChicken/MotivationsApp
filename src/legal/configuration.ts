/**
 * Thin compatibility layer over the central operator configuration. All
 * operator supplied values live in config/operator-fields.json and are resolved
 * exactly once in src/legal/operator.ts.
 */
import { DEVELOPMENT_MARKER_DOMAIN, normalizeHttpsBaseUrl, OPERATOR } from '@/legal/operator';

export {
  ACCOUNT_DELETION_PUBLIC_URL,
  DEVELOPMENT_MARKER_DOMAIN,
  LEGAL_SITE_BASE_URL,
  legalSiteHost,
  normalizeHttpsBaseUrl,
  OPERATOR,
  OPERATOR_IS_DEVELOPMENT_ONLY,
} from '@/legal/operator';

/** Development fallback used whenever no clean HTTPS legal base URL is configured. */
export const DEVELOPMENT_LEGAL_SITE = `https://${DEVELOPMENT_MARKER_DOMAIN}`;

export function resolveLegalSiteBaseUrl(value: string | undefined): string {
  return normalizeHttpsBaseUrl(value ?? '') ?? DEVELOPMENT_LEGAL_SITE;
}

export const LEGAL_CONTACT_EMAIL = OPERATOR.privacyContactEmail;
export const SUPPORT_CONTACT_EMAIL = OPERATOR.supportEmail;
export const ABUSE_CONTACT_EMAIL = OPERATOR.abuseContactEmail;
export const COMMUNITY_RULES_VERSION = '2026-08-02';
