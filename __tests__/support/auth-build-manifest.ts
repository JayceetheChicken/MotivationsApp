/**
 * Stands in for the manifest app.config.js writes.
 *
 * A production build only runs its recovery flow when the attestation embedded
 * in `extra` proves which transport the manifest was generated for - see
 * src/auth/build-configuration.ts. Under Jest there is no such manifest, so a
 * test that wants to exercise the production shape has to supply the same
 * attestation a real build would have produced.
 *
 * Deliberately a mutable holder rather than a `jest.mock` factory argument:
 * `jest.mock` is hoisted above every `const`, so the factory can only reach a
 * module it requires lazily.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authBuild = require('../../config/auth-build.cjs');

/**
 * What `Constants.expoConfig.extra.authBuildAttestation` should return.
 *
 * Held on `globalThis` rather than in module scope: the tests reload the module
 * graph with `jest.isolateModules`, which hands a fresh copy of every module to
 * the code under test. A module-scoped holder would then be a *different* object
 * from the one the test wrote to, and the mock would always read `undefined`.
 */
const HOLDER = '__lernzeitEmbeddedAuthBuildAttestation__';
const globalScope = globalThis as unknown as Record<string, { value: unknown } | undefined>;
globalScope[HOLDER] ??= { value: undefined };

export const embeddedAuthBuildAttestation = globalScope[HOLDER] as { value: unknown };

/** The attestation app.config.js would embed for this environment. */
export function attestationFor(environment: Readonly<Record<string, string | undefined>>): string {
  return authBuild.serializeAuthBuildConfiguration(
    authBuild.resolveAuthBuildConfiguration(environment),
  );
}

/** Runs `body` with the manifest a build of `environment` would have carried. */
export function withEmbeddedAttestation<T>(
  attestation: unknown,
  body: () => T,
): T {
  const previous = embeddedAuthBuildAttestation.value;
  embeddedAuthBuildAttestation.value = attestation;
  try {
    return body();
  } finally {
    embeddedAuthBuildAttestation.value = previous;
  }
}
