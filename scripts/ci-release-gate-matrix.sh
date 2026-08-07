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

# 6. Only a publicly usable operator domain may become the App Links host. The
#    ranges are checked numerically in config/public-host.cjs, so a boundary such
#    as 172.32.0.0 (public) versus 172.16.0.1 (private) cannot be confused.
for host in 'https://localhost' 'https://lernzeit.localhost' 'https://192.168.10.4' \
            'https://172.16.0.1' 'https://100.64.0.1' 'https://[::1]' 'https://intranet'; do
  expect_failure "Production mit nicht oeffentlicher Domain $host" 'EXPO_PUBLIC_LEGAL_SITE_URL' \
    with_production_env "EXPO_PUBLIC_LEGAL_SITE_URL=$host" \
    node scripts/check-release-config.mjs --production
done

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

printf '\n=== Recovery-Transport und App-Scheme pro Buildprofil ===\n'

# Everything below runs against the *really resolved* Expo config, never against
# the source. The contract per profile:
#
#   production          → verified HTTPS App Link, no `lernzeit` scheme at all
#   development/preview → `lernzeit` scheme plus the private recovery filter,
#                         and no autoVerify App Link - even when the build was
#                         handed a real operator domain, because its signing
#                         certificate is not in that domain's assetlinks.json
#   unknown/conflicting → the config must refuse to resolve
config_dir="$(mktemp -d)"
trap 'restore_public; rm -rf "$config_dir"' EXIT

resolve_config() {
  local target="$1"
  shift
  "$@" npx --yes expo config --type public --json > "$target"
}

# Asserts a jq-free property of a resolved config via node.
# assert_config <name> <file> <node expression over `manifest`> <description>
assert_config() {
  local name="$1" file="$2" expression="$3" description="$4"
  checks=$((checks + 1))
  local output status
  output="$(node -e '
    const fs = require("node:fs");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const manifest = config.expo ?? config;
    const ok = Boolean(eval(process.argv[2]));
    if (!ok) {
      console.error("Erwartet: " + process.argv[3]);
      console.error(JSON.stringify({ scheme: manifest.scheme, intentFilters: manifest.android?.intentFilters, buildProfile: manifest.extra?.buildProfile }, null, 2));
      process.exit(1);
    }
  ' "$file" "$expression" "$description" 2>&1)"
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '\n[FAIL] %s: %s\n' "$name" "$description"
    printf '%s\n' "$output" | tail -20
    failures=$((failures + 1))
    return
  fi
  printf '[ok]   %s: %s\n' "$name" "$description"
}

if with_production_env resolve_config "$config_dir/production.json"; then
  expect_success 'Production-Manifest ohne privaten Recovery-Filter' 'privater Intent-Filter: nein' \
    with_production_env node scripts/verify-expo-config.mjs "$config_dir/production.json"

  # The decisive production property: Expo registers `expo.scheme` as a general
  # incoming deep link, so its presence would keep lernzeit://auth/update-password
  # able to open the app even without the specific recovery intent filter.
  assert_config 'Production' "$config_dir/production.json" \
    'manifest.scheme === undefined' \
    'die aufgeloeste Config enthaelt kein scheme'
  # Deliberately compares the scheme field rather than searching the JSON text:
  # the operator domain in this matrix is lernzeit-ci.de, so a substring search
  # would match the host and pass for the wrong reason.
  assert_config 'Production' "$config_dir/production.json" \
    '(manifest.android?.intentFilters ?? []).flatMap((f) => Array.isArray(f.data) ? f.data : [f.data ?? {}]).every((d) => d?.scheme !== "lernzeit")' \
    'kein Intent-Filter nennt das lernzeit-Scheme'
  assert_config 'Production' "$config_dir/production.json" \
    '(manifest.android?.intentFilters ?? []).filter((f) => f.autoVerify === true).length === 1' \
    'genau ein verifizierter App Link'
  assert_config 'Production' "$config_dir/production.json" \
    'manifest.extra?.buildProfile === "production"' \
    'das Manifest attestiert das Profil production'

  # Proof that the verifier really rejects the dangerous shapes.
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const manifest = config.expo ?? config;
    manifest.android.intentFilters.push({
      action: "VIEW",
      category: ["BROWSABLE", "DEFAULT"],
      data: [{ scheme: "lernzeit", host: "auth", path: "/update-password" }],
    });
    fs.writeFileSync(process.argv[2], JSON.stringify(config));
  ' "$config_dir/production.json" "$config_dir/production-with-private-filter.json"

  expect_failure 'Production-Verifier mit privatem Recovery-Filter' \
    'privaten Recovery-Intent-Filter' \
    with_production_env node scripts/verify-expo-config.mjs \
    "$config_dir/production-with-private-filter.json"

  node -e '
    const fs = require("node:fs");
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const manifest = config.expo ?? config;
    manifest.scheme = "lernzeit";
    fs.writeFileSync(process.argv[2], JSON.stringify(config));
  ' "$config_dir/production.json" "$config_dir/production-with-scheme.json"

  expect_failure 'Production-Verifier mit registriertem lernzeit-Scheme' \
    'darf das Scheme "lernzeit" nicht registrieren' \
    with_production_env node scripts/verify-expo-config.mjs \
    "$config_dir/production-with-scheme.json"
else
  printf '\n[FAIL] Production-Config liess sich nicht aufloesen.\n'
  failures=$((failures + 1))
  checks=$((checks + 1))
fi

# Development and preview, each without and *with* a real operator domain. The
# second half is the case the old "is a domain configured?" rule got wrong.
for profile in development preview; do
  for domain in ohne mit; do
    target="$config_dir/$profile-$domain-domain.json"
    if [ "$domain" = 'ohne' ]; then
      resolved=$(env EAS_BUILD=true EAS_BUILD_PROFILE="$profile" \
        EXPO_PUBLIC_BUILD_PROFILE="$profile" LERNZEIT_SKIP_RELEASE_GATE=1 \
        npx --yes expo config --type public --json > "$target" 2>&1) && status=0 || status=$?
    else
      # The full synthetic operator environment, but without the release-gate
      # flag: the profile, not the domain, decides the transport.
      resolved=$(with_production_env 'LERNZEIT_RELEASE_GATE=' \
        "EXPO_PUBLIC_BUILD_PROFILE=$profile" "EAS_BUILD_PROFILE=$profile" \
        'EAS_BUILD=true' 'LERNZEIT_SKIP_RELEASE_GATE=1' \
        npx --yes expo config --type public --json > "$target" 2>&1) && status=0 || status=$?
    fi

    if [ "$status" -ne 0 ]; then
      printf '\n[FAIL] %s-Config (%s Domain) liess sich nicht aufloesen.\n' "$profile" "$domain"
      printf '%s\n' "$resolved" | tail -20
      failures=$((failures + 1))
      checks=$((checks + 1))
      continue
    fi

    expect_success "$profile-Manifest ($domain Domain) mit privatem Recovery-Filter" \
      'privater Intent-Filter: ja' \
      env EAS_BUILD=true EAS_BUILD_PROFILE="$profile" EXPO_PUBLIC_BUILD_PROFILE="$profile" \
      LERNZEIT_SKIP_RELEASE_GATE=1 node scripts/verify-expo-config.mjs "$target"

    assert_config "$profile ($domain Domain)" "$target" \
      'manifest.scheme === "lernzeit"' \
      'das allgemeine lernzeit-Scheme ist registriert'
    assert_config "$profile ($domain Domain)" "$target" \
      '(manifest.android?.intentFilters ?? []).every((f) => f.autoVerify !== true)' \
      'kein verifizierter App Link'
    assert_config "$profile ($domain Domain)" "$target" \
      "manifest.extra?.authBuildAttestation?.includes(';profile=$profile;')" \
      "das Manifest attestiert das Profil $profile"
    assert_config "$profile ($domain Domain)" "$target" \
      'manifest.extra?.passwordRecoveryRedirect === "lernzeit://auth/update-password?type=recovery"' \
      'der Recovery-Callback ist das private Schema'
  done
done

# A profile the app does not know, and two profiles that contradict each other,
# must both stop the config from resolving at all.
expect_failure 'Unbekanntes Buildprofil' 'kein bekanntes Buildprofil' \
  env EAS_BUILD=true EAS_BUILD_PROFILE=staging \
  npx --yes expo config --type public --json

expect_failure 'Widersprechende Buildprofile' 'widersprechen sich' \
  env EAS_BUILD=true EAS_BUILD_PROFILE=production EXPO_PUBLIC_BUILD_PROFILE=development \
  npx --yes expo config --type public --json

# A production profile without an operator domain has no verifiable transport
# and must not produce a manifest at all.
expect_failure 'Production-Profil ohne Betreiberdomain' 'EXPO_PUBLIC_LEGAL_SITE_URL' \
  env EXPO_PUBLIC_BUILD_PROFILE=production \
  npx --yes expo config --type public --json

restore_public

printf '\n%s\n' '------------------------------------------------------------'
if [ "$failures" -gt 0 ]; then
  printf 'Release-Gate-Matrix: %s von %s Faellen fehlgeschlagen.\n' "$failures" "$checks"
  exit 1
fi
printf 'Release-Gate-Matrix: alle %s Faelle wie erwartet.\n' "$checks"
