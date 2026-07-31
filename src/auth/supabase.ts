import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { authStorage } from '@/auth/storage';
import {
  resolveSupabaseEnvironment,
  type SupabaseConfiguration,
} from '@/auth/supabase-configuration';
import type { Database } from '@/types/database.generated';

export type { SupabaseConfiguration } from '@/auth/supabase-configuration';

const environment = resolveSupabaseEnvironment({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

let client: SupabaseClient<Database> | null = null;
let configuration: SupabaseConfiguration;

if (!environment.configuration.isConfigured || !environment.url || !environment.publicKey) {
  configuration = environment.configuration;
} else {
  try {
    client = createClient<Database>(environment.url, environment.publicKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
        storage: authStorage,
      },
    });
    configuration = environment.configuration;
  } catch {
    configuration = {
      isConfigured: false,
      mode: 'local-development',
      message: 'Die Supabase-Konfiguration konnte nicht geladen werden. Prüfe URL und öffentlichen Publishable-Key.',
    };
  }
}

export const supabase = client;
export const supabaseConfiguration = Object.freeze(configuration);
