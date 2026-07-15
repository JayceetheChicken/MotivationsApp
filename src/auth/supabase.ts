import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { authStorage } from '@/auth/storage';

export type SupabaseConfiguration = Readonly<{
  isConfigured: boolean;
  mode: 'supabase' | 'local-development';
  message: string;
}>;

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

function validateUrl(value: string): string | null {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return 'EXPO_PUBLIC_SUPABASE_URL muss mit https:// oder http:// beginnen.';
    }
  } catch {
    return 'EXPO_PUBLIC_SUPABASE_URL ist keine gültige URL.';
  }

  return null;
}

function missingConfigurationMessage(): string {
  if (!supabaseUrl && !supabaseAnonKey) {
    return 'Supabase ist noch nicht konfiguriert. Hinterlege EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY und starte Expo anschließend neu.';
  }

  if (!supabaseUrl) {
    return 'EXPO_PUBLIC_SUPABASE_URL fehlt. Kontoaktionen bleiben deaktiviert.';
  }

  return 'EXPO_PUBLIC_SUPABASE_ANON_KEY fehlt. Kontoaktionen bleiben deaktiviert.';
}

let client: SupabaseClient | null = null;
let configuration: SupabaseConfiguration;

if (!supabaseUrl || !supabaseAnonKey) {
  configuration = {
    isConfigured: false,
    mode: 'local-development',
    message: missingConfigurationMessage(),
  };
} else {
  const urlError = validateUrl(supabaseUrl);

  if (urlError) {
    configuration = {
      isConfigured: false,
      mode: 'local-development',
      message: urlError,
    };
  } else {
    try {
      client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
          storage: authStorage,
        },
      });
      configuration = {
        isConfigured: true,
        mode: 'supabase',
        message: 'Supabase-Authentifizierung ist konfiguriert.',
      };
    } catch {
      configuration = {
        isConfigured: false,
        mode: 'local-development',
        message: 'Die Supabase-Konfiguration konnte nicht geladen werden. Prüfe URL und öffentlichen Anon-Key.',
      };
    }
  }
}

export const supabase = client;
export const supabaseConfiguration = Object.freeze(configuration);
