#!/usr/bin/env bash
# Negative and positive proofs for the production release gate.
#
# A green gate on its own proves nothing: it also stays green if the gate stops
# checking. Every case below therefore asserts an exit code *and* the reason
# that appears in the output, so a check that starts passing for the wrong
# reason fails here.
#
# Usage: bash scripts/ci-release-gate-matrix.sh
#
# The script restores public/ before it exits; it never publishes anything.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Synthetic tokens. Both are unsigned test values with a decodable payload; they
# are not credentials for any project. The point is the "role" claim, which only
# exists Base64URL encoded - a plaintext grep for service_role finds nothing.
ANON_JWT='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjIwMDAwMDAwMDB9.c2lnbmF0dXJl'
SERVICE_ROLE_JWT='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.c2lnbmF0dXJl'
VALID_FINGERPRINT='AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'
SECOND_FINGERPRINT='11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00'

failures=0
checks=0

# expect_failure <name> <expected substring> <command...>
expect_failure() {
  local name="$1" expected="$2"
  shift 2
  checks=$((checks + 1))

  local output status
  output="$("$@" 2>&1)"
  status=$?

  if [ "$status" -eq 0 ]; then
    printf '\n[FAIL] %s: der Befehl war erfolgreich, erwartet wurde ein Abbruch.\n' "$name"
    printf '%s\n' "$output" | tail -20
    failures=$((failures + 1))
    return
  fi
  if ! printf '%s' "$output" | grep -qF -- "$expected"; then
    printf '\n[FAIL] %s: bricht ab, nennt aber nicht "%s".\n' "$name" "$expected"
    printf '%s\n' "$output" | tail -20
    failures=$((failures + 1))
    return
  fi
  printf '[ok]   blockiert: %s\n' "$name"
}

# expect_success <name> <expected substring> <command...>
expect_success() {
  local name="$1" expected="$2"
  shift 2
  checks=$((checks + 1))

  local output status
  output="$("$@" 2>&1)"
  status=$?

  if [ "$status" -ne 0 ]; then
    printf '\n[FAIL] %s: unerwarteter Abbruch (Exit %s).\n' "$name" "$status"
    printf '%s\n' "$output" | tail -20
    failures=$((failures + 1))
    return
  fi
  if ! printf '%s' "$output" | grep -qF -- "$expected"; then
    printf '\n[FAIL] %s: laeuft durch, nennt aber nicht "%s".\n' "$name" "$expected"
    printf '%s\n' "$output" | tail -20
    failures=$((failures + 1))
    return
  fi
  printf '[ok]   akzeptiert: %s\n' "$name"
}

restore_public() {
  git checkout -- public/ 2>/dev/null || true
}
trap restore_public EXIT

# Runs a command with the complete synthetic production environment plus any
# VAR=VALUE overrides given before the command. An empty value unsets.
with_production_env() {
  (
    set -a
    # shellcheck disable=SC1091
    . scripts/ci-production-env.sh
    set +a
    while [[ "${1:-}" == *=* ]]; do
      local assignment="$1"
      local key="${assignment%%=*}"
      local value="${assignment#*=}"
      if [ -z "$value" ]; then unset "$key"; else export "$key=$value"; fi
      shift
    done
    "$@"
  )
}

printf '=== Negativfaelle: der Production-Build muss scheitern ===\n'

# 1. A service_role key must never pass, no matter how it is spelled.
expect_failure 'Production mit service_role-JWT' 'service_role' \
  with_production_env "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SERVICE_ROLE_JWT" \
  node scripts/check-release-config.mjs --production

expect_failure 'Production mit service_role-JWT als Anon-Key' 'service_role' \
  with_production_env 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' \
  "EXPO_PUBLIC_SUPABASE_ANON_KEY=$SERVICE_ROLE_JWT" \
  node scripts/check-release-config.mjs --production

expect_failure 'Production mit Supabase-Secret-Key' 'Secret-Key' \
  with_production_env 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_secret_abcdefgh12345678' \
  node scripts/check-release-config.mjs --production

# 2. The escape hatch must not work for a build that identifies as production.
expect_failure 'Production mit LERNZEIT_SKIP_RELEASE_GATE=1 und fehlenden Pflichtwerten' \
  'EXPO_PUBLIC_OPERATOR_NAME' \
  env LERNZEIT_RELEASE_GATE=1 LERNZEIT_SKIP_RELEASE_GATE=1 \
  node scripts/check-release-config.mjs

expect_failure 'EAS-Production-Profil mit LERNZEIT_SKIP_RELEASE_GATE=1' \
  'EXPO_PUBLIC_OPERATOR_NAME' \
  env EAS_BUILD=true EAS_BUILD_PROFILE=production LERNZEIT_SKIP_RELEASE_GATE=1 \
  node scripts/check-release-config.mjs

# 3./4. Public pages without a usable App Links fingerprint.
expect_failure 'Production-Seiten ohne Fingerprint' 'keinen gueltigen Fingerprint' \
  with_production_env 'ANDROID_SHA256_CERT_FINGERPRINTS=' \
  node scripts/build-public-pages.mjs

expect_failure 'Production-Seiten mit ungueltigem Fingerprint' 'Ungueltige SHA-256-Fingerprints' \
  with_production_env 'ANDROID_SHA256_CERT_FINGERPRINTS=AA:BB:CC' \
  node scripts/build-public-pages.mjs

expect_failure 'Production-Gate mit Entwicklungs-Kontoloeschseite' 'Entwicklungsbanner' \
  with_production_env node scripts/check-release-config.mjs --production
restore_public

# 5. A production build must never fall back to the private URL scheme.
expect_failure 'Production mit Custom-Scheme-Recovery-Fallback' 'lernzeit://auth/update-password' \
  with_production_env 'EXPO_PUBLIC_LEGAL_SITE_URL=' \
  node scripts/check-release-config.mjs --production

expect_failure 'Production mit .invalid-Domain als Recovery-Host' 'lernzeit://auth/update-password' \
  with_production_env 'EXPO_PUBLIC_LEGAL_SITE_URL=https://lernzeit.invalid' \
  node scripts/check-release-config.mjs --production

printf '\n=== Positivfaelle: die vollstaendige Produktionsumgebung muss durchlaufen ===\n'

# Generate the production pages once; the gate below validates them.
expect_success 'Production-Seiten mit gueltigem Fingerprint' 'Erzeugt' \
  with_production_env node scripts/build-public-pages.mjs

expect_success 'Production-Seiten mit mehreren Fingerprints' 'Erzeugt' \
  with_production_env "ANDROID_SHA256_CERT_FINGERPRINTS=$VALID_FINGERPRINT $SECOND_FINGERPRINT" \
  node scripts/build-public-pages.mjs

expect_success 'Vollstaendige Production-Umgebung mit Publishable Key' 'Release-Gate bestanden' \
  with_production_env node scripts/check-release-config.mjs --production

expect_success 'Vollstaendige Production-Umgebung mit Anon-JWT' 'Release-Gate bestanden' \
  with_production_env 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' \
  "EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_JWT" \
  node scripts/check-release-config.mjs --production

expect_success 'Gueltige HTTPS-Recovery-URL' 'https://lernzeit-ci.de/update-password?type=recovery' \
  with_production_env node scripts/check-release-config.mjs --production

expect_success 'Gueltiges assetlinks.json' 'assetlinks.json ist gueltig' \
  with_production_env node scripts/check-release-config.mjs --production

restore_public

printf '\n%s\n' '------------------------------------------------------------'
if [ "$failures" -gt 0 ]; then
  printf 'Release-Gate-Matrix: %s von %s Faellen fehlgeschlagen.\n' "$failures" "$checks"
  exit 1
fi
printf 'Release-Gate-Matrix: alle %s Faelle wie erwartet.\n' "$checks"
