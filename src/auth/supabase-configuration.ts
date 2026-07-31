export type SupabaseConfiguration = Readonly<{
  isConfigured: boolean;
  mode: 'supabase' | 'local-development';
  message: string;
}>;

export interface SupabaseEnvironmentInput {
  url?: string;
  publishableKey?: string;
  anonKey?: string;
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
  '[::1]',
  '10.0.2.2',
  'host.docker.internal',
]);

function isLocalHttpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return LOCAL_HTTP_HOSTS.has(normalized) || normalized.endsWith('.localhost');
}

export function validateSupabaseUrl(value: string): string | null {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.username || parsedUrl.password) {
      return 'EXPO_PUBLIC_SUPABASE_URL darf keine Zugangsdaten enthalten.';
    }
    if (parsedUrl.protocol === 'https:') return null;
    if (parsedUrl.protocol === 'http:' && isLocalHttpHost(parsedUrl.hostname)) return null;
    if (parsedUrl.protocol === 'http:') {
      return 'EXPO_PUBLIC_SUPABASE_URL muss für externe Hosts https:// verwenden.';
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
  if (value.startsWith('sb_secret_') || jwtRole(value) === 'service_role') {
    return 'In der App sind nur Supabase Publishable- beziehungsweise Anon-Keys erlaubt.';
  }
  return null;
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

  const error = validateSupabaseUrl(url) ?? validateSupabasePublicKey(publicKey);
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
