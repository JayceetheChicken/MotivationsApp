/**
 * The recovery contract of *this* build, as the running app sees it.
 *
 * Two independent sources have to agree:
 *
 *   1. `resolveAuthBuildConfiguration` over the bundled environment. Metro
 *      inlines the literal `process.env.EXPO_PUBLIC_LEGAL_SITE_URL` read below,
 *      so this is the value compiled into the JavaScript bundle.
 *   2. The attestation app.config.js wrote into `extra.authBuildAttestation`.
 *      That is the value compiled into the app manifest, and it is the value the
 *      Android intent filters were generated from.
 *
 * If they disagree, the manifest and the bundle describe different recovery
 * transports. That is not a situation to paper over: the build is refused the
 * recovery flow entirely (`isConsistent === false`), which turns a possible
 * account-takeover path into a visible, harmless failure to send a reset mail.
 *
 * The derivation itself lives in config/auth-build.cjs, the same file
 * app.config.js, the release gate and the export scanner load.
 */
import Constants from 'expo-constants';

import authBuild from '../../config/auth-build.cjs';

export type RecoveryTransport = 'https-app-link' | 'custom-scheme';

export interface AuthBuildConfiguration {
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

/**
 * Metro only substitutes *literal* `process.env.EXPO_PUBLIC_X` member
 * expressions, so the variable is spelled out rather than looked up.
 */
const BUNDLED_AUTH_ENVIRONMENT: Readonly<Record<string, string | undefined>> = {
  EXPO_PUBLIC_LEGAL_SITE_URL: process.env.EXPO_PUBLIC_LEGAL_SITE_URL,
};

/** The configuration compiled into the JavaScript bundle. */
export const DERIVED_AUTH_BUILD_CONFIGURATION: AuthBuildConfiguration =
  resolveAuthBuildConfiguration(BUNDLED_AUTH_ENVIRONMENT);

/**
 * The attestation app.config.js embedded into the manifest, or null when it is
 * unavailable - which happens in unit tests and in a bare web development
 * server, never in a built app.
 */
export function readAuthBuildAttestation(): AuthBuildConfiguration | null {
  const attestation = (Constants.expoConfig?.extra as { authBuildAttestation?: unknown } | undefined)
    ?.authBuildAttestation;
  return typeof attestation === 'string' ? parseAuthBuildAttestation(attestation) : null;
}

function isSameConfiguration(a: AuthBuildConfiguration, b: AuthBuildConfiguration): boolean {
  return a.recoveryTransport === b.recoveryTransport
    && a.recoveryRedirectUrl === b.recoveryRedirectUrl
    && a.recoveryHost === b.recoveryHost
    && a.androidAppLinkHost === b.androidAppLinkHost
    && a.acceptsCustomRecoveryScheme === b.acceptsCustomRecoveryScheme
    && a.registersCustomRecoverySchemeFilter === b.registersCustomRecoverySchemeFilter;
}

export interface ResolvedAuthBuild {
  readonly configuration: AuthBuildConfiguration;
  /** False when manifest and bundle describe different transports. */
  readonly isConsistent: boolean;
  /** True when the manifest attestation was found and used. */
  readonly isAttested: boolean;
}

/**
 * Reconciles both sources. Exported for the tests, which need to exercise the
 * mismatch branch without a second build.
 */
export function reconcileAuthBuild(
  derived: AuthBuildConfiguration,
  attested: AuthBuildConfiguration | null,
): ResolvedAuthBuild {
  if (!attested) return { configuration: derived, isConsistent: true, isAttested: false };
  if (!isSameConfiguration(derived, attested)) {
    // Fail closed: no transport is accepted and no reset mail is sent.
    return {
      configuration: {
        ...derived,
        acceptsCustomRecoveryScheme: false,
      },
      isConsistent: false,
      isAttested: true,
    };
  }
  return { configuration: attested, isConsistent: true, isAttested: true };
}

const resolved = reconcileAuthBuild(DERIVED_AUTH_BUILD_CONFIGURATION, readAuthBuildAttestation());

/** The one configuration every auth code path reads. */
export const AUTH_BUILD_CONFIGURATION: AuthBuildConfiguration = resolved.configuration;

/**
 * False when the manifest and the bundle disagree. Password recovery is then
 * disabled in both directions: no reset mail is requested and no callback is
 * accepted.
 */
export const AUTH_BUILD_IS_CONSISTENT: boolean = resolved.isConsistent;

/** True when the runtime really used the attestation from the manifest. */
export const AUTH_BUILD_IS_ATTESTED: boolean = resolved.isAttested;
