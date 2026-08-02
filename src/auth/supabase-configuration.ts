export type SupabaseConfiguration = Readonly<{
  isConfigured: boolean;
  mode: 'supabase' | 'local-development';
  message: string;
}>;

export interface SupabaseEnvironmentInput {
  url?: string;
  publishableKey?: string;
  anonKey?: string;
  /** Local plaintext Supabase is permitted only in an explicitly development build. */
  allowLocalHttp?: boolean;
}

export interface ResolvedSupabaseEnvironment {
  configuration: SupabaseConfiguration;
  url: string | null;
  publicKey: string | null;
}

const LOCAL_HTTP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  // Explicit Android/Genymotion host-loopback aliases; no private subnet is
  // accepted generically.
  '10.0.2.2',
  '10.0.3.2',
]);

function isLocalHttpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return LOCAL_HTTP_HOSTS.has(normalized);
}

export function validateSupabaseUrl(
  value: string,
  options: Readonly<{ allowLocalHttp?: boolean }> = {},
): string | null {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.username || parsedUrl.password) {
      return 'EXPO_PUBLIC_SUPABASE_URL darf keine Zugangsdaten enthalten.';
    }
    if (parsedUrl.search || parsedUrl.hash) {
      return 'EXPO_PUBLIC_SUPABASE_URL darf keine Query- oder Fragment-Parameter enthalten.';
    }
    if (parsedUrl.protocol === 'https:') return null;
    if (
      parsedUrl.protocol === 'http:'
      && options.allowLocalHttp === true
      && isLocalHttpHost(parsedUrl.hostname)
    ) return null;
    if (parsedUrl.protocol === 'http:') {
      return options.allowLocalHttp
        ? 'EXPO_PUBLIC_SUPABASE_URL darf HTTP nur für explizit erlaubte lokale Entwicklungs-Hosts verwenden.'
        : 'EXPO_PUBLIC_SUPABASE_URL muss in normalen und produktiven Builds https:// verwenden.';
    }
    return 'EXPO_PUBLIC_SUPABASE_URL muss mit https:// beginnen. HTTP ist nur für lokale Entwicklung erlaubt.';
  } catch {
    return 'EXPO_PUBLIC_SUPABASE_URL ist keine gültige URL.';
  }
}

function jwtRole(value: string): string | null {
  const payload = value.split('.')[1];
  if (!payload || typeof globalThis.atob !== 'function') return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof decoded.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

export function validateSupabasePublicKey(value: string): string | null {
  if (value.startsWith('sb_publishable_')) return null;
  if (jwtRole(value) === 'anon') return null;
  return 'In der App sind nur Supabase Publishable- beziehungsweise Anon-Keys erlaubt.';
}

function missingConfigurationMessage(url: string | null, publicKey: string | null): string {
  if (!url && !publicKey) {
    return 'Supabase ist noch nicht konfiguriert. Hinterlege EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY und starte Expo anschließend neu.';
  }
  if (!url) return 'EXPO_PUBLIC_SUPABASE_URL fehlt. Kontoaktionen bleiben deaktiviert.';
  return 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY beziehungsweise EXPO_PUBLIC_SUPABASE_ANON_KEY fehlt. Kontoaktionen bleiben deaktiviert.';
}

export function resolveSupabaseEnvironment(
  input: SupabaseEnvironmentInput,
): ResolvedSupabaseEnvironment {
  const url = input.url?.trim() || null;
  const publicKey = input.publishableKey?.trim() || input.anonKey?.trim() || null;

  if (!url || !publicKey) {
    return {
      url,
      publicKey,
      configuration: {
        isConfigured: false,
        mode: 'local-development',
        message: missingConfigurationMessage(url, publicKey),
      },
    };
  }

  const error = validateSupabaseUrl(url, { allowLocalHttp: input.allowLocalHttp })
    ?? validateSupabasePublicKey(publicKey);
  if (error) {
    return {
      url,
      publicKey,
      configuration: { isConfigured: false, mode: 'local-development', message: error },
    };
  }

  return {
    url,
    publicKey,
    configuration: {
      isConfigured: true,
      mode: 'supabase',
      message: 'Supabase-Authentifizierung ist konfiguriert.',
    },
  };
}
