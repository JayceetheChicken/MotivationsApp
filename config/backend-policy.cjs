const release = require('./release-config.cjs');

function requiresSupabase(environment) {
  return environment.EXPO_PUBLIC_REQUIRE_SUPABASE === '1'
    || release.resolveBuildProfile(environment).profile === 'production';
}

function assertBackendBuildConfiguration(environment) {
  const flag = environment.EXPO_PUBLIC_REQUIRE_SUPABASE;
  if (flag !== undefined && flag !== '' && flag !== '1') {
    throw new Error('EXPO_PUBLIC_REQUIRE_SUPABASE darf nur leer oder 1 sein.');
  }
  if (!requiresSupabase(environment)) return;
  const issues = release.collectSupabaseReleaseIssues(environment);
  if (issues.length) {
    // Do not print values: a malformed URL may itself contain credentials.
    throw new Error('Online-Build blockiert: ' + issues.map(({ envVar, reason }) => `${envVar} (${reason})`).join(', '));
  }
}

module.exports = { requiresSupabase, assertBackendBuildConfiguration };
