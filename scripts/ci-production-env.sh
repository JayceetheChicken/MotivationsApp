#!/usr/bin/env bash
# Synthetic but well-formed production environment used only by CI to prove that
# the release gate accepts a complete configuration and that the configured
# values really reach the built artefact.
#
# These are NOT the operator's values. The real values are set as EAS
# environment variables for the "production" environment; see
# docs/operator-configuration.md.
#
# Usage: source scripts/ci-production-env.sh

export LERNZEIT_RELEASE_GATE=1
# The build profile decides the recovery transport and the registered URL
# scheme. It is declared explicitly rather than inferred, and it is the value
# Metro inlines into the bundle so the artefact can attest which profile built
# it. Not a secret: it names the build, not the operator.
export EXPO_PUBLIC_BUILD_PROFILE=production
export EXPO_PUBLIC_LEGAL_SITE_URL=https://lernzeit-ci.de
export EXPO_PUBLIC_OPERATOR_NAME="CI Pruefbetreiber"
export EXPO_PUBLIC_OPERATOR_LEGAL_FORM="Einzelunternehmen, vertreten durch die Inhaberin"
export EXPO_PUBLIC_OPERATOR_ADDRESS="Pruefweg 1, 10115 Berlin"
export EXPO_PUBLIC_OPERATOR_CONTACT_EMAIL=kontakt@lernzeit-ci.de
export EXPO_PUBLIC_OPERATOR_PHONE=""
export EXPO_PUBLIC_OPERATOR_REGISTER="Nicht eingetragen"
export EXPO_PUBLIC_OPERATOR_SUPERVISORY_AUTHORITY="Nicht einschlaegig"
export EXPO_PUBLIC_OPERATOR_VAT_ID=DE999999999
export EXPO_PUBLIC_OPERATOR_DISPUTE_RESOLUTION="Keine Teilnahme an einem Schlichtungsverfahren."
export EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL=datenschutz@lernzeit-ci.de
export EXPO_PUBLIC_PRIVACY_OFFICER="Nicht bestellt"
export EXPO_PUBLIC_SUPPORT_EMAIL=support@lernzeit-ci.de
export EXPO_PUBLIC_ABUSE_CONTACT_EMAIL=beschwerde@lernzeit-ci.de
export EXPO_PUBLIC_DATA_PROTECTION_AUTHORITY="Berliner Beauftragte fuer Datenschutz und Informationsfreiheit"
export EXPO_PUBLIC_LEGAL_BASIS_ACCOUNT="Art. 6 Abs. 1 lit. b DSGVO fuer die Kontofuehrung."
export EXPO_PUBLIC_SUPABASE_CONTRACT_PARTY="Supabase Inc."
export EXPO_PUBLIC_SUPABASE_REGION="eu-central-1 Frankfurt"
export EXPO_PUBLIC_SUPABASE_DPA_REFERENCE="AVV inklusive Standardvertragsklauseln."
export EXPO_PUBLIC_PRODUCTION_SUBPROCESSORS="Supabase, Google Play, EAS Build"
export EXPO_PUBLIC_LOG_RETENTION_POLICY="Auth- und API-Logs 14 Tage."
export EXPO_PUBLIC_STATUTORY_RETENTION="Keine."
export EXPO_PUBLIC_TERMS_LIABILITY="Es gilt deutsches Recht unter Wahrung zwingender Verbraucherschutzvorschriften."
export EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE=2026-08-03
export EXPO_PUBLIC_SUPABASE_URL=https://ciprojectreference.supabase.co
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_CiPruefwert1234567890
export ANDROID_VERSION_CODE=1
export ANDROID_SHA256_CERT_FINGERPRINTS=AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
