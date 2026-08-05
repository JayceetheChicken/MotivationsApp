/**
 * The runtime half of the recovery contract.
 *
 * config/auth-build.cjs resolves the transport; src/auth/build-configuration.ts
 * reconciles that with the attestation app.config.js embedded into the manifest.
 * A disagreement between the two must disable password recovery rather than pick
 * a winner, so that branch is tested explicitly.
 */
import {
  AUTH_BUILD_CONFIGURATION,
  DERIVED_AUTH_BUILD_CONFIGURATION,
  reconcileAuthBuild,
  type AuthBuildConfiguration,
} from '@/auth/build-configuration';

import authBuild from '../config/auth-build.cjs';

const PRODUCTION: AuthBuildConfiguration = authBuild.resolveAuthBuildConfiguration({
  EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de',
});
const DEVELOPMENT: AuthBuildConfiguration = authBuild.resolveAuthBuildConfiguration({});

describe('resolveAuthBuildConfiguration', () => {
  it('uses the verified App Link when a public operator domain is configured', () => {
    expect(PRODUCTION).toEqual({
      recoveryTransport: 'https-app-link',
      recoveryRedirectUrl: 'https://lernzeit.de/update-password?type=recovery',
      recoveryHost: 'lernzeit.de',
      androidAppLinkHost: 'lernzeit.de',
      acceptsCustomRecoveryScheme: false,
      registersCustomRecoverySchemeFilter: false,
    });
  });

  it('uses the private scheme when there is no usable domain', () => {
    expect(DEVELOPMENT).toEqual({
      recoveryTransport: 'custom-scheme',
      recoveryRedirectUrl: 'lernzeit://auth/update-password?type=recovery',
      recoveryHost: 'auth',
      androidAppLinkHost: null,
      acceptsCustomRecoveryScheme: true,
      registersCustomRecoverySchemeFilter: true,
    });
  });

  it.each([
    ['keine Domain', {}],
    ['Entwicklungsmarker', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.invalid' }],
    ['HTTP statt HTTPS', { EXPO_PUBLIC_LEGAL_SITE_URL: 'http://lernzeit.de' }],
    ['Port', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de:8443' }],
    ['Zugangsdaten', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://user:pw@lernzeit.de' }],
    ['Loopback', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://127.0.0.1' }],
    ['privates Netz', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://192.168.1.10' }],
    ['Single-Label-Host', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://intranet' }],
  ])('never produces an App Link for %s', (_label, environment) => {
    const configuration = authBuild.resolveAuthBuildConfiguration(environment);
    expect(configuration.recoveryTransport).toBe('custom-scheme');
    expect(authBuild.collectProductionAuthBuildIssues(configuration).length).toBeGreaterThan(0);
  });

  it('accepts a production configuration without complaint', () => {
    expect(authBuild.collectProductionAuthBuildIssues(PRODUCTION)).toEqual([]);
  });

  it.each<[string, AuthBuildConfiguration]>([
    ['custom-scheme als Production-Transport', { ...PRODUCTION, recoveryTransport: 'custom-scheme' }],
    ['weiterhin akzeptiertes Custom Scheme', { ...PRODUCTION, acceptsCustomRecoveryScheme: true }],
    ['registrierter privater Intent-Filter', { ...PRODUCTION, registersCustomRecoverySchemeFilter: true }],
    ['nicht öffentlicher Host', { ...PRODUCTION, recoveryHost: 'localhost', androidAppLinkHost: 'localhost' }],
    ['abweichender App-Link-Host', { ...PRODUCTION, androidAppLinkHost: 'andere.de' }],
    ['URL passt nicht zum Host', { ...PRODUCTION, recoveryRedirectUrl: 'https://andere.de/update-password?type=recovery' }],
  ])('rejects %s in production', (_label, configuration) => {
    expect(authBuild.collectProductionAuthBuildIssues(configuration).length).toBeGreaterThan(0);
  });
});

describe('auth build attestation', () => {
  it('round-trips through the flat serialisation', () => {
    for (const configuration of [PRODUCTION, DEVELOPMENT]) {
      const attestation = authBuild.serializeAuthBuildConfiguration(configuration);
      expect(authBuild.parseAuthBuildAttestation(attestation)).toEqual(configuration);
    }
  });

  /**
   * The manifest is embedded into the bundle as an escaped JSON string. An
   * attestation containing a quote, a backslash or whitespace would be rewritten
   * by that escaping and the scanner would no longer find it verbatim.
   */
  it('contains nothing that JSON escaping or a minifier would rewrite', () => {
    const attestation = authBuild.serializeAuthBuildConfiguration(PRODUCTION);
    expect(attestation).not.toMatch(/["'\\\s]/);
    expect(JSON.stringify({ attestation })).toContain(attestation);
  });

  it('finds the attestation inside escaped and minified surroundings', () => {
    const attestation = authBuild.serializeAuthBuildConfiguration(PRODUCTION);
    const embedded = `var m=${JSON.stringify(JSON.stringify({ extra: { authBuildAttestation: attestation } }))};`;
    expect(authBuild.findAuthBuildAttestations(embedded)).toEqual([attestation]);
  });

  it('de-duplicates and keeps no regex state between scans', () => {
    const attestation = authBuild.serializeAuthBuildConfiguration(PRODUCTION);
    const text = `${attestation} ${attestation}`;
    expect(authBuild.findAuthBuildAttestations(text)).toEqual([attestation]);
    expect(authBuild.findAuthBuildAttestations(text)).toEqual([attestation]);
  });

  it.each([
    ['fehlender Marker', 'transport=https-app-link;end'],
    ['fehlender Abschluss', 'lernzeit.auth-build/v1;transport=https-app-link'],
    ['unbekannter Transport', 'lernzeit.auth-build/v1;transport=carrier-pigeon;host=a.de;url=x;customScheme=off;schemeFilter=off;end'],
    ['fehlender Host', 'lernzeit.auth-build/v1;transport=https-app-link;url=x;customScheme=off;schemeFilter=off;end'],
    ['kaputtes Flag', 'lernzeit.auth-build/v1;transport=https-app-link;host=a.de;url=x;customScheme=maybe;schemeFilter=off;end'],
  ])('refuses to parse %s', (_label, attestation) => {
    expect(authBuild.parseAuthBuildAttestation(attestation)).toBeNull();
  });

  it('finds every recovery callback URL that is literally present', () => {
    const text = 'a="https://lernzeit.de/update-password?type=recovery";'
      + "b='lernzeit://auth/update-password?type=recovery';";
    expect(authBuild.findRecoveryCallbackUrls(text).sort()).toEqual([
      'https://lernzeit.de/update-password?type=recovery',
      'lernzeit://auth/update-password?type=recovery',
    ]);
  });
});

describe('reconciling manifest and bundle', () => {
  it('uses the derived configuration when no attestation is available', () => {
    expect(reconcileAuthBuild(PRODUCTION, null)).toEqual({
      configuration: PRODUCTION,
      isConsistent: true,
      isAttested: false,
    });
  });

  it('uses the attested configuration when both agree', () => {
    const result = reconcileAuthBuild(PRODUCTION, { ...PRODUCTION });
    expect(result.isConsistent).toBe(true);
    expect(result.isAttested).toBe(true);
    expect(result.configuration).toEqual(PRODUCTION);
  });

  /**
   * A manifest that routes one transport while the bundle expects another is a
   * broken build. Picking either side could mean sending a recovery mail to a
   * callback the app will not honour - or honouring one it never requested.
   */
  it('disables recovery entirely when manifest and bundle disagree', () => {
    const result = reconcileAuthBuild(PRODUCTION, DEVELOPMENT);
    expect(result.isConsistent).toBe(false);
    expect(result.configuration.acceptsCustomRecoveryScheme).toBe(false);
  });

  it.each<[string, AuthBuildConfiguration]>([
    ['anderer Host', { ...PRODUCTION, recoveryHost: 'andere.de' }],
    ['andere URL', { ...PRODUCTION, recoveryRedirectUrl: 'https://andere.de/update-password?type=recovery' }],
    ['anderer App-Link-Host', { ...PRODUCTION, androidAppLinkHost: 'andere.de' }],
    ['Custom Scheme wieder erlaubt', { ...PRODUCTION, acceptsCustomRecoveryScheme: true }],
    ['Intent-Filter wieder registriert', { ...PRODUCTION, registersCustomRecoverySchemeFilter: true }],
  ])('treats %s as a disagreement', (_label, attested) => {
    expect(reconcileAuthBuild(PRODUCTION, attested).isConsistent).toBe(false);
  });
});

describe('configuration of this test build', () => {
  it('exposes one resolved configuration to the whole app', () => {
    expect(AUTH_BUILD_CONFIGURATION.recoveryRedirectUrl).toContain('/update-password?type=recovery');
    expect(['https-app-link', 'custom-scheme']).toContain(AUTH_BUILD_CONFIGURATION.recoveryTransport);
    expect(DERIVED_AUTH_BUILD_CONFIGURATION.recoveryTransport)
      .toBe(AUTH_BUILD_CONFIGURATION.recoveryTransport);
  });
});
