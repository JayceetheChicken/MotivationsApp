// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Deno Edge Function entries are checked/deployed by Supabase, not by the
    // Expo app's Node/React-Native ESLint runtime. Shared function logic stays
    // linted and unit-tested.
    ignores: ["dist/*", "supabase/functions/*/index.ts"],
  }
]);
