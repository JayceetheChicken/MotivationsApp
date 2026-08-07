/**
 * Proves, from a built export alone, which password recovery transport the
 * shipped app really uses.
 *
 * The point of this module is that it does *not* recompute the expected URL from
 * the environment and then declare victory. app.config.js embeds a flat
 * attestation string into the manifest, the app parses that same string back at
 * runtime (src/auth/build-configuration.ts), and the export therefore carries
 * the value the app will actually act on. This module finds that value in the
 * built bytes and compares it against what production requires.
 *
 * Why a flat string and not a JSON object: the manifest is embedded into the
 * bundle as an escaped JSON *string*, so every quote inside it appears as `\"`.
 * A check that searched for `"recoveryTransport":"https-app-link"` would depend
 * on the bundler's quoting and on the minifier's mood. The attestation contains
 * no quotes, no whitespace and no backslashes at all, so it survives every
 * escaping and minification unchanged and one regex finds it.
 */
const releaseConfig = require('../../config/release-config.cjs');

/**
 * @typedef {{ file: string, attestation: string, configuration: object }} FoundAttestation
 */

/**
 * Every auth build attestation embedded anywhere in the scanned corpus.
 *
 * @param {readonly {file: string, content: string}[]} documents
 * @returns {{ found: FoundAttestation[], unparsable: {file: string, attestation: string}[] }}
 */
function findAttestations(documents) {
  const found = [];
  const unparsable = [];
  for (const { file, content } of documents) {
    for (const attestation of releaseConfig.findAuthBuildAttestations(content)) {
      const configuration = releaseConfig.parseAuthBuildAttestation(attestation);
      if (configuration) found.push({ file, attestation, configuration });
      else unparsable.push({ file, attestation });
    }
  }
  return { found, unparsable };
}

/**
 * Every recovery callback URL that appears literally anywhere in the corpus.
 *
 * Used to prove that no *second* recovery domain was compiled in. The private
 * scheme URL is expected to be present even in a production export: it is a
 * constant of the shared derivation module, and CommonJS has no tree shaking.
 * Its mere presence proves nothing - which transport is *active* is what the
 * attestation states.
 *
 * @param {readonly {file: string, content: string}[]} documents
 * @returns {string[]}
 */
function findRecoveryUrls(documents) {
  const urls = new Set();
  for (const { content } of documents) {
    for (const url of releaseConfig.findRecoveryCallbackUrls(content)) urls.add(url);
  }
  return [...urls];
}

/**
 * Checks a production export.
 *
 * @param {readonly {file: string, content: string}[]} documents
 * @param {Readonly<{ recoveryRedirectUrl: string, androidAppLinkHost: string | null,
 *   profile?: string }>} expected the configuration the release gate resolved
 * @returns {string[]} human readable failures, empty when the export is sound
 */
function collectProductionRecoveryIssues(documents, expected) {
  const failures = [];
  const { found, unparsable } = findAttestations(documents);

  for (const entry of unparsable) {
    failures.push(`${entry.file}: unlesbare Auth-Build-Attestierung "${entry.attestation}".`);
  }

  if (found.length === 0) {
    failures.push(
      'Im Export steht keine Auth-Build-Attestierung. Damit laesst sich nicht belegen, welchen '
      + 'Recovery-Transport die gebaute App tatsaechlich verwendet. Erwartet wird der Marker '
      + `"${releaseConfig.AUTH_BUILD_ATTESTATION_PREFIX}" aus extra.authBuildAttestation.`,
    );
    return failures;
  }

  // More than one distinct attestation means two different configurations were
  // compiled into the same artefact; there is then no single active transport.
  const distinct = [...new Set(found.map((entry) => entry.attestation))];
  if (distinct.length > 1) {
    failures.push(`Der Export enthaelt ${distinct.length} verschiedene Attestierungen: ${distinct.join(' | ')}.`);
  }

  for (const attestation of distinct) {
    const configuration = releaseConfig.parseAuthBuildAttestation(attestation);
    // Same rules the release gate and the Expo config verifier apply, so all
    // three cannot drift apart.
    for (const issue of releaseConfig.collectProductionAuthBuildIssues(configuration)) {
      failures.push(`Gebuendelte Konfiguration: ${issue}`);
    }
    if (configuration.recoveryRedirectUrl !== expected.recoveryRedirectUrl) {
      failures.push(
        `Die gebuendelte Recovery-URL ist "${configuration.recoveryRedirectUrl}", `
        + `erwartet "${expected.recoveryRedirectUrl}".`,
      );
    }
    if (configuration.androidAppLinkHost !== expected.androidAppLinkHost) {
      failures.push(
        `Der gebuendelte App-Link-Host ist "${configuration.androidAppLinkHost}", `
        + `erwartet "${expected.androidAppLinkHost}".`,
      );
    }
    if (expected.profile !== undefined && configuration.profile !== expected.profile) {
      failures.push(
        `Das gebuendelte Buildprofil ist "${configuration.profile}", erwartet "${expected.profile}".`,
      );
    }
  }

  // No second HTTPS recovery domain may be compiled in. A foreign domain here
  // means a second derivation exists somewhere that the attestation does not
  // describe.
  const foreignHttpsUrls = findRecoveryUrls(documents).filter(
    (url) => url.startsWith('https://') && url !== expected.recoveryRedirectUrl.toLowerCase(),
  );
  if (foreignHttpsUrls.length > 0) {
    failures.push(`Der Export enthaelt fremde HTTPS-Recovery-URLs: ${foreignHttpsUrls.join(', ')}.`);
  }

  return failures;
}

/**
 * Checks an export whose build environment is not available at scan time.
 *
 * A scan can legitimately run without the environment that produced the export
 * - CI does exactly that when it re-scans an artefact after injecting a test
 * token. The attestation is then the only source of truth, so this asserts what
 * can be asserted from it alone: it exists, it parses, there is exactly one, and
 * it is internally consistent. An attestation that claims the App Link transport
 * is additionally held to the full production rules, minus the environment
 * derived expectation.
 *
 * @param {readonly {file: string, content: string}[]} documents
 * @returns {string[]}
 */
function collectAttestationConsistencyIssues(documents) {
  const failures = [];
  const { found, unparsable } = findAttestations(documents);
  for (const entry of unparsable) {
    failures.push(`${entry.file}: unlesbare Auth-Build-Attestierung "${entry.attestation}".`);
  }
  if (found.length === 0) {
    return [...failures, 'Im Export steht keine Auth-Build-Attestierung.'];
  }

  const distinct = [...new Set(found.map((entry) => entry.attestation))];
  if (distinct.length > 1) {
    failures.push(`Der Export enthaelt ${distinct.length} verschiedene Attestierungen: ${distinct.join(' | ')}.`);
  }

  for (const attestation of distinct) {
    const configuration = releaseConfig.parseAuthBuildAttestation(attestation);
    // The attestation names its own profile, so the rules that apply are the
    // ones for that profile - the same functions the release gate, the Expo
    // config verifier and the runtime use.
    for (const issue of releaseConfig.collectAuthBuildIssues(configuration)) {
      failures.push(`Gebuendelte Konfiguration: ${issue}`);
    }
  }
  return failures;
}

/**
 * Checks a development or preview export: the private scheme must be the active
 * transport, the profile must be a non-production one and no App Link may claim
 * to be verified.
 *
 * @param {readonly {file: string, content: string}[]} documents
 * @returns {string[]}
 */
function collectDevelopmentRecoveryIssues(documents) {
  const failures = [];
  const { found, unparsable } = findAttestations(documents);
  for (const entry of unparsable) {
    failures.push(`${entry.file}: unlesbare Auth-Build-Attestierung "${entry.attestation}".`);
  }
  if (found.length === 0) return [...failures, 'Im Export steht keine Auth-Build-Attestierung.'];

  const distinct = [...new Set(found.map((entry) => entry.attestation))];
  if (distinct.length > 1) {
    failures.push(`Der Export enthaelt ${distinct.length} verschiedene Attestierungen: ${distinct.join(' | ')}.`);
  }
  for (const attestation of distinct) {
    const configuration = releaseConfig.parseAuthBuildAttestation(attestation);
    failures.push(...releaseConfig.collectDevelopmentAuthBuildIssues(configuration));
  }
  return failures;
}

module.exports = {
  findAttestations,
  findRecoveryUrls,
  collectProductionRecoveryIssues,
  collectDevelopmentRecoveryIssues,
  collectAttestationConsistencyIssues,
};
