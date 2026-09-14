import Constants from 'expo-constants';
import { Platform } from 'react-native';

import policy from '../../config/backend-policy.cjs';

// Literal reads are necessary for Metro's build-time substitution. Either
// source can require online mode; a missing/changed manifest cannot turn it off.
export const ONLINE_BACKEND_REQUIRED: boolean = Platform.OS !== 'web' && (
  policy.requiresSupabase({
    EXPO_PUBLIC_REQUIRE_SUPABASE: process.env.EXPO_PUBLIC_REQUIRE_SUPABASE,
    EXPO_PUBLIC_BUILD_PROFILE: process.env.EXPO_PUBLIC_BUILD_PROFILE,
  })
  || Constants.expoConfig?.extra?.onlineBackendRequired === true
);
