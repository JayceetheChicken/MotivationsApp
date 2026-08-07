/**
 * The recovery contract of *this* build, as the running app sees it.
 *
 * Two independent sources have to agree:
 *
 *   1. `resolveAuthBuildConfiguration` over the bundled environment. Metro
 *      inlines the literal `process.env.EXPO_PUBLIC_*` reads below, so this is
 *      the value compiled into the JavaScript bundle.
 *   2. The attestation app.config.js wrote into `extra.authBuildAttestation`.
 *      That is the value compiled into the app manifest, and it is the value the
 *      Android intent filters and the registered URL scheme were generated from.
 *
 * If they disagree, the manifest and the bundle describe different recovery
 * transports. That is not a situation to paper over: the build is refused the
 * recovery flow entirely (`isConsistent === false`), which turns a possible
 * account-takeover path into a visible, harmless failure to send a reset mail.
 *
 * ## Why a missing attestation is fatal in production
 *
 * Treating "no attestation" as "trust the bundle" would make the attestation
 * decorative: anything that strips or renames `extra` - a repacked APK, a
 * modified manifest, an OTA update built by a different pipeline - would silently
 * fall back to the unverified half of the contract. A build that claims the
 * verified App Link therefore has to prove it, and a build that cannot is denied
 * recovery in both directions.
 *
 * The single exception is a local start (`npx expo start`, a unit test) whose
 * profile is unambiguously non-production. There is no embedded manifest to
 * read, the transport is the private scheme either way, and refusing recovery
 * there would only break development without protecting anything.
 *
 * The derivation itself lives in config/auth-build.cjs, the same file
 * app.config.js, the release gate and the export scanner load.
 */
import Constants from 'expo-constants';

import authBuild from '../../config/auth-build.cjs';

export type RecoveryTransport = 'https-app-link' | 'custom-scheme' | 'disabled';
export type BuildProfile = 'production' | 'development' | 'preview' | 'local' | 'invalid';

export interface AuthBuildConfiguration {
  /** Which build profile produced this artefact. */
  readonly profile: BuildProfile;
  /** The transport a recovery mail must use, and the only one accepted back. */
  readonly recoveryTransport: RecoveryTransport;
  /** Exact value handed to `resetPasswordForEmail({ redirectTo })`. */
  readonly recoveryRedirectUrl: string;
  /** Host part of the callback: the operator domain, or `auth` for the scheme. */
  readonly recoveryHost: string;
  /** Host of the verified Android App Link, null when there is none. */
  readonly androidAppLinkHost: string | null;
  /** Whether `lernzeit://auth/update-password` is an accepted recovery route. */
  readonly acceptsCustomRecoveryScheme: boolean;
  /** Whether the manifest registers the private recovery intent filter. */
  readonly registersCustomRecoverySchemeFilter: boolean;
}

const resolveAuthBuildConfiguration = authBuild.resolveAuthBuildConfiguration as (
  environment: Readonly<Record<string, string | undefined>>,
) => AuthBuildConfiguration;

const parseAuthBuildAttestation = authBuild.parseAuthBuildAttestation as (
  attestation: string,
) => AuthBuildConfiguration | null;

const disabledAuthBuildConfiguration = authBuild.disabledAuthBuildConfiguration as (
  profile: BuildProfile,
) => AuthBuildConfiguration;

const NON_PRODUCTION_PROFILES = authBuild.NON_PRODUCTION_BUILD_PROFILES as readonly BuildProfile[];

/**
 * Metro only substitutes *literal* `process.env.EXPO_PUBLIC_X` member
 * expressions, so both variables are spelled out rather than looked up.
 *
 * `EXPO_PUBLIC_BUILD_PROFILE` is the only spelling of the build profile that can
 * reach the bundle at all - `EAS_BUILD_PROFILE` exists on the build machine and
 * nowhere inside the artefact. It is not a secret: it names the build, not the
 * operator.
 */
const BUNDLED_AUTH_ENVIRONMENT: Readonly<Record<string, string | undefined>> = {
  EXPO_PUBLIC_BUILD_PROFILE: process.env.EXPO_PUBLIC_BUILD_PROFILE,
  EXPO_PUBLIC_LEGAL_SITE_URL: process.env.EXPO_PUBLIC_LEGAL_SITE_URL,
};

/** The configuration compiled into the JavaScript bundle. */
export const DERIVED_AUTH_BUILD_CONFIGURATION: AuthBuildConfiguration =
  resolveAuthBuildConfiguration(BUNDLED_AUTH_ENVIRONMENT);

/**
 * What the manifest had to say, kept as three distinct outcomes.
 *
 * "Absent" and "unreadable" must not collapse into one value: a local start
 * legitimately has no manifest, while an attestation that exists but does not
 * parse means something rewrote it.
 */
export type AttestationReading =
  | Readonly<{ state: 'absent' }>
  | Readonly<{ state: 'unreadable'; raw: string }>
  | Readonly<{ state: 'present'; configuration: AuthBuildConfiguration }>;

/**
 * Reads `extra.authBuildAttestation` back out of the embedded manifest.
 *
 * Only a missing value is "absent". A present but empty or non-string value is
 * "unreadable" - something wrote it, and whatever that was is not this build's
 * app.config.js.
 */
export function readAuthBuildAttestation(): AttestationReading {
  const attestation = (Constants.expoConfig?.extra as { authBuildAttestation?: unknown } | undefined)
    ?.authBuildAttestation;
  if (attestation === undefined || attestation === null) return { state: 'absent' };
  if (typeof attestation !== 'string') return { state: 'unreadable', raw: String(attestation) };
  const configuration = parseAuthBuildAttestation(attestation);
  return configuration ? { state: 'present', configuration } : { state: 'unreadable', raw: attestation };
}

function isSameConfiguration(a: AuthBuildConfiguration, b: AuthBuildConfiguration): boolean {
  return a.profile === b.profile
    && a.recoveryTransport === b.recoveryTransport
    && a.recoveryRedirectUrl === b.recoveryRedirectUrl
    && a.recoveryHost === b.recoveryHost
    && a.androidAppLinkHost === b.androidAppLinkHost
    && a.acceptsCustomRecoveryScheme === b.acceptsCustomRecoveryScheme
    && a.registersCustomRecoverySchemeFilter === b.registersCustomRecoverySchemeFilter;
}

/**
 * May this build run its recovery flow on the bundle alone?
 *
 * Only an unambiguously non-production build with the private-scheme transport
 * may: there is nothing an attacker gains from a development client honouring
 * `lernzeit://`, and there is no manifest to attest against.
 */
function mayRunUnattested(derived: AuthBuildConfiguration): boolean {
  return NON_PRODUCTION_PROFILES.includes(derived.profile)
    && derived.recoveryTransport === 'custom-scheme';
}

export interface ResolvedAuthBuild {
  readonly configuration: AuthBuildConfiguration;
  /** False when manifest and bundle do not provably describe the same build. */
  readonly isConsistent: boolean;
  /** True when the manifest attestation was found and used. */
  readonly isAttested: boolean;
  /** Why recovery is disabled, for the tests and for a diagnostic screen. */
  readonly reason: 'attested' | 'unattested-development' | 'missing-attestation'
    | 'unreadable-attestation' | 'mismatch';
}

/**
 * Reconciles both sources. Exported for the tests, which need to exercise every
 * failure branch without a second build.
 */
export function reconcileAuthBuild(
  derived: AuthBuildConfiguration,
  attestation: AttestationReading,
): ResolvedAuthBuild {
  // Fail closed: an explicitly disabled configuration, not a flag flipped on an
  // otherwise plausible one. A caller that forgets to read `isConsistent` then
  // gets an empty redirect URL rather than a live one.
  const disabled = (reason: ResolvedAuthBuild['reason'], isAttested: boolean): ResolvedAuthBuild => ({
    configuration: disabledAuthBuildConfiguration(derived.profile),
    isConsistent: false,
    isAttested,
    reason,
  });

  if (attestation.state === 'unreadable') return disabled('unreadable-attestation', false);
  if (attestation.state === 'absent') {
    if (mayRunUnattested(derived)) {
      return { configuration: derived, isConsistent: true, isAttested: false, reason: 'unattested-development' };
    }
    return disabled('missing-attestation', false);
  }
  if (!isSameConfiguration(derived, attestation.configuration)) return disabled('mismatch', true);
  return {
    configuration: attestation.configuration,
    isConsistent: true,
    isAttested: true,
    reason: 'attested',
  };
}

const resolved = reconcileAuthBuild(DERIVED_AUTH_BUILD_CONFIGURATION, readAuthBuildAttestation());

/** The one configuration every auth code path reads. */
export const AUTH_BUILD_CONFIGURATION: AuthBuildConfiguration = resolved.configuration;

/**
 * False when the manifest and the bundle do not provably describe the same
 * build. Password recovery is then disabled in both directions: no reset mail is
 * requested and no callback is accepted.
 */
export const AUTH_BUILD_IS_CONSISTENT: boolean = resolved.isConsistent;

/** True when the runtime really used the attestation from the manifest. */
export const AUTH_BUILD_IS_ATTESTED: boolean = resolved.isAttested;

/** Why recovery is available or disabled. Never contains operator data. */
export const AUTH_BUILD_REASON: ResolvedAuthBuild['reason'] = resolved.reason;
