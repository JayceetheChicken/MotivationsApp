const PLACEHOLDER_LEGAL_SITE = 'https://lernzeit.example.invalid';

export function resolveLegalSiteBaseUrl(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return PLACEHOLDER_LEGAL_SITE;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) return PLACEHOLDER_LEGAL_SITE;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return PLACEHOLDER_LEGAL_SITE;
  }
}

export const LEGAL_SITE_BASE_URL = resolveLegalSiteBaseUrl(
  process.env.EXPO_PUBLIC_LEGAL_SITE_URL,
);

export const ACCOUNT_DELETION_PUBLIC_URL = `${LEGAL_SITE_BASE_URL}/account-deletion/`;
export const LEGAL_CONTACT_EMAIL = 'datenschutz@lernzeit.example.invalid';
export const COMMUNITY_RULES_VERSION = '2026-08-02';
