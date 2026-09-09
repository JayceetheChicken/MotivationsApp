/**
 * The runtime half of the recovery contract.
 *
 * config/auth-build.cjs resolves the build profile and the transport;
 * src/auth/build-configuration.ts reconciles that with the attestation
 * app.config.js embedded into the manifest. Two properties are load bearing and
 * are therefore tested branch by branch:
 *
 *   - the transport follows the *profile*, not "is a domain configured?",
 *   - a production build without a provable attestation gets no recovery at all.
 */
import {
  AUTH_BUILD_CONFIGURATION,
  DERIVED_AUTH_BUILD_CONFIGURATION,
  reconcileAuthBuild,
  type AttestationReading,
  type AuthBuildConfiguration,
} from '@/auth/build-configuration';

import authBuild from '../config/auth-build.cjs';

const PRODUCTION: AuthBuildConfiguration = authBuild.resolveAuthBuildConfiguration({
  EXPO_PUBLIC_BUILD_PROFILE: 'production',
  EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de',
});
const DEVELOPMENT: AuthBuildConfiguration = authBuild.resolveAuthBuildConfiguration({
  EXPO_PUBLIC_BUILD_PROFILE: 'development',
});
const LOCAL: AuthBuildConfiguration = authBuild.resolveAuthBuildConfiguration({});

const absent: AttestationReading = { state: 'absent' };
const present = (configuration: AuthBuildConfiguration): AttestationReading => (
  { state: 'present', configuration }
);

describe('build profile resolution', () => {
  it.each([
    ['nichts gesetzt', {}, 'local'],
    ['nur EXPO_PUBLIC_BUILD_PROFILE', { EXPO_PUBLIC_BUILD_PROFILE: 'preview' }, 'preview'],
    ['nur EAS_BUILD_PROFILE', { EAS_BUILD_PROFILE: 'development' }, 'development'],
    [
      'beide identisch',
      { EXPO_PUBLIC_BUILD_PROFILE: 'production', EAS_BUILD_PROFILE: 'production' },
      'production',
    ],
    ['Release-Gate ohne Profil', { LERNZEIT_RELEASE_GATE: '1' }, 'production'],
    ['EAS-Build ohne Profil', { EAS_BUILD: 'true' }, 'production'],
  ])('resolves %s to %s', (_label, environment, expected) => {
    const resolved = authBuild.resolveBuildProfile(environment);
    expect(resolved.issue).toBeNull();
    expect(resolved.profile).toBe(expected);
  });

  it.each([
    ['unbekanntes oeffentliches Profil', { EXPO_PUBLIC_BUILD_PROFILE: 'staging' }],
    ['unbekanntes EAS-Profil', { EAS_BUILD_PROFILE: 'qa' }],
    [
      'widersprechende Profile',
      { EXPO_PUBLIC_BUILD_PROFILE: 'development', EAS_BUILD_PROFILE: 'production' },
    ],
  ])('refuses to resolve %s', (_label, environment) => {
    const resolved = authBuild.resolveBuildProfile(environment);
    expect(resolved.profile).toBe('invalid');
    expect(resolved.issue).toEqual(expect.any(String));
    // An unresolvable profile disables recovery instead of guessing a transport.
    expect(authBuild.resolveAuthBuildConfiguration(environment).recoveryTransport).toBe('disabled');
  });

  it('registers the private app scheme for every profile except production', () => {
    expect(authBuild.registersAppScheme('production')).toBe(false);
    expect(authBuild.registersAppScheme('invalid')).toBe(false);
    for (const profile of ['development', 'preview', 'local'] as const) {
      expect(authBuild.registersAppScheme(profile)).toBe(true);
    }
  });
});

describe('resolveAuthBuildConfiguration', () => {
  it('uses the verified App Link for a production build with a public domain', () => {
    expect(PRODUCTION).toEqual({
      profile: 'production',
      recoveryTransport: 'https-app-link',
      recoveryRedirectUrl: 'https://lernzeit.de/update-password?type=recovery',
      recoveryHost: 'lernzeit.de',
      androidAppLinkHost: 'lernzeit.de',
      acceptsCustomRecoveryScheme: false,
      registersCustomRecoverySchemeFilter: false,
    });
  });

  it('uses the private scheme for a development build', () => {
    expect(DEVELOPMENT).toEqual({
      profile: 'development',
      recoveryTransport: 'custom-scheme',
      recoveryRedirectUrl: 'lernzeit://auth/update-password?type=recovery',
      recoveryHost: 'auth',
      androidAppLinkHost: null,
      acceptsCustomRecoveryScheme: true,
      registersCustomRecoverySchemeFilter: true,
    });
  });

  /**
   * The reason the profile and not the domain is the input: a development or
   * preview build may legitimately carry the real operator values, and its
   * signing certificate is not in the operator's assetlinks.json, so the App
   * Link it would claim can never verify.
   */
  it.each(['development', 'preview', 'local'])(
    'keeps the private scheme in a %s build that has a real domain',
    (profile) => {
      const configuration = authBuild.resolveAuthBuildConfiguration({
        EXPO_PUBLIC_BUILD_PROFILE: profile,
        EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de',
      });
      expect(configuration.recoveryTransport).toBe('custom-scheme');
      expect(configuration.androidAppLinkHost).toBeNull();
      expect(authBuild.collectDevelopmentAuthBuildIssues(configuration)).toEqual([]);
    },
  );

  it.each([
    ['keine Domain', {}],
    ['Entwicklungsmarker', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.invalid' }],
    ['HTTP statt HTTPS', { EXPO_PUBLIC_LEGAL_SITE_URL: 'http://lernzeit.de' }],
    ['Port', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://lernzeit.de:8443' }],
    ['Zugangsdaten', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://user:pw@lernzeit.de' }],
    ['Loopback', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://127.0.0.1' }],
    ['privates Netz', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://192.168.1.10' }],
    ['Single-Label-Host', { EXPO_PUBLIC_LEGAL_SITE_URL: 'https://intranet' }],
  ])('disables recovery for a production build with %s', (_label, environment) => {
    const configuration = authBuild.resolveAuthBuildConfiguration({
      EXPO_PUBLIC_BUILD_PROFILE: 'production',
      ...environment,
    });
    expect(configuration.recoveryTransport).toBe('disabled');
    expect(configuration.recoveryRedirectUrl).toBe('');
    expect(authBuild.collectProductionAuthBuildIssues(configuration).length).toBeGreaterThan(0);
  });

  it('accepts a production configuration without complaint', () => {
    expect(authBuild.collectProductionAuthBuildIssues(PRODUCTION)).toEqual([]);
  });

  it.each<[string, AuthBuildConfiguration]>([
    ['custom-scheme als Production-Transport', { ...PRODUCTION, recoveryTransport: 'custom-scheme' }],
    ['Development-Profil', { ...PRODUCTION, profile: 'development' }],
    ['weiterhin akzeptiertes Custom Scheme', { ...PRODUCTION, acceptsCustomRecoveryScheme: true }],
    ['registrierter privater Intent-Filter', { ...PRODUCTION, registersCustomRecoverySchemeFilter: true }],
    ['nicht öffentlicher Host', { ...PRODUCTION, recoveryHost: 'localhost', androidAppLinkHost: 'localhost' }],
    ['abweichender App-Link-Host', { ...PRODUCTION, androidAppLinkHost: 'andere.de' }],
    ['URL passt nicht zum Host', { ...PRODUCTION, recoveryRedirectUrl: 'https://andere.de/update-password?type=recovery' }],
  ])('rejects %s in production', (_label, configuration) => {
    expect(authBuild.collectProductionAuthBuildIssues(configuration).length).toBeGreaterThan(0);
  });

  it.each<[string, AuthBuildConfiguration]>([
    ['Production-Profil', { ...DEVELOPMENT, profile: 'production' }],
    ['App-Link-Transport', { ...DEVELOPMENT, recoveryTransport: 'https-app-link' }],
    ['fremde Recovery-URL', { ...DEVELOPMENT, recoveryRedirectUrl: 'https://lernzeit.de/update-password?type=recovery' }],
    ['fremder Recovery-Host', { ...DEVELOPMENT, recoveryHost: 'lernzeit.de' }],
    ['attestierter App-Link-Host', { ...DEVELOPMENT, androidAppLinkHost: 'lernzeit.de' }],
    ['abgeschaltetes Custom Scheme', { ...DEVELOPMENT, acceptsCustomRecoveryScheme: false }],
    ['fehlender Intent-Filter', { ...DEVELOPMENT, registersCustomRecoverySchemeFilter: false }],
  ])('rejects %s in development', (_label, configuration) => {
    expect(authBuild.collectDevelopmentAuthBuildIssues(configuration).length).toBeGreaterThan(0);
  });

  it('routes each configuration to the rules of its own profile', () => {
    expect(authBuild.collectAuthBuildIssues(PRODUCTION)).toEqual([]);
    expect(authBuild.collectAuthBuildIssues(DEVELOPMENT)).toEqual([]);
    expect(authBuild.collectAuthBuildIssues(LOCAL)).toEqual([]);
    expect(authBuild.collectAuthBuildIssues(
      authBuild.disabledAuthBuildConfiguration('invalid'),
    ).length).toBeGreaterThan(0);
  });
});

describe('deterministic operator domain normalisation', () => {
  it.each([
    ['Unicode-Domain', 'https://bücher.de'],
    ['Unicode mit Pfad', 'https://bücher.de/rechtliches'],
    ['Dezimales IPv4-Literal', 'https://2130706433'],
    ['hexadezimales IPv4-Literal', 'https://0x7f.1'],
    ['verkuerztes IPv4-Literal', 'https://127.1'],
    ['oktales IPv4-Literal', 'https://0177.0.0.1'],
  ])('rejects %s', (_label, value) => {
    expect(authBuild.normalizePublicHttpsBaseUrl(value)).toBeNull();
    expect(authBuild.publicHostFromBaseUrl(value)).toBeNull();
  });

  it.each([
    ['Punycode', 'https://xn--bcher-kva.de', 'https://xn--bcher-kva.de'],
    ['Grossschreibung', 'https://LERNZEIT.DE', 'https://lernzeit.de'],
    ['abschliessender Punkt', 'https://lernzeit.de.', 'https://lernzeit.de'],
    ['abschliessender Slash', 'https://lernzeit.de/', 'https://lernzeit.de'],
    ['Basispfad', 'https://lernzeit.de/rechtliches/', 'https://lernzeit.de/rechtliches'],
  ])('normalises %s to the canonical base', (_label, value, expected) => {
    expect(authBuild.normalizePublicHttpsBaseUrl(value)).toBe(expected);
  });

  /**
   * The trailing dot is a different host in DNS and would produce an App Link
   * host that no assetlinks.json matches, so it must not survive into the
   * recovery URL either.
   */
  it('never carries a trailing dot into the recovery callback', () => {
    const configuration = authBuild.resolveAuthBuildConfiguration({
      EXPO_PUBLIC_BUILD_PROFILE: 'production',
      EXPO_PUBLIC_LEGAL_SITE_URL: 'https://LERNZEIT.DE.',
    });
    expect(configuration.recoveryHost).toBe('lernzeit.de');
    expect(configuration.androidAppLinkHost).toBe('lernzeit.de');
    expect(configuration.recoveryRedirectUrl).toBe('https://lernzeit.de/update-password?type=recovery');
  });
});

describe('auth build attestation', () => {
  it('round-trips through the flat serialisation', () => {
    for (const configuration of [PRODUCTION, DEVELOPMENT, LOCAL]) {
      const attestation = authBuild.serializeAuthBuildConfiguration(configuration);
      expect(authBuild.parseAuthBuildAttestation(attestation)).toEqual(configuration);
    }
  });

  it('names the build profile', () => {
    expect(authBuild.serializeAuthBuildConfiguration(PRODUCTION)).toContain(';profile=production;');
    expect(authBuild.serializeAuthBuildConfiguration(DEVELOPMENT)).toContain(';profile=development;');
    expect(authBuild.serializeAuthBuildConfiguration(LOCAL)).toContain(';profile=local;');
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

  const VALID = 'lernzeit.auth-build/v1;profile=production;transport=https-app-link;host=a.de;'
    + 'appLinkHost=a.de;customScheme=off;schemeFilter=off;'
    + 'url=https://a.de/update-password?type=recovery;end';

  it('parses the reference attestation it is derived from', () => {
    expect(authBuild.parseAuthBuildAttestation(VALID)).not.toBeNull();
  });

  it.each([
    ['fehlender Marker', VALID.replace('lernzeit.auth-build/v1;', '')],
    ['fehlender Abschluss', VALID.replace(';end', '')],
    ['zweiter Abschlussmarker', `${VALID.slice(0, -';end'.length)}end;end`],
    ['zweiter Prefix-Marker', `${VALID.slice(0, -';end'.length)}lernzeit.auth-build/v1;end`],
    ['leerer Rumpf', 'lernzeit.auth-build/v1;;end'],
    ['unbekannter Transport', VALID.replace('transport=https-app-link', 'transport=carrier-pigeon')],
    ['unbekanntes Profil', VALID.replace('profile=production', 'profile=staging')],
    ['fehlendes Profil', VALID.replace('profile=production;', '')],
    ['fehlender Host', VALID.replace('host=a.de;', '')],
    ['fehlender appLinkHost', VALID.replace('appLinkHost=a.de;', '')],
    ['fehlende URL', VALID.replace('url=https://a.de/update-password?type=recovery;', '')],
    ['fehlendes customScheme', VALID.replace('customScheme=off;', '')],
    ['fehlendes schemeFilter', VALID.replace('schemeFilter=off;', '')],
    ['leerer Host', VALID.replace('host=a.de;appLinkHost', 'host=;appLinkHost')],
    ['leere URL', VALID.replace('url=https://a.de/update-password?type=recovery', 'url=')],
    ['leeres Profil', VALID.replace('profile=production', 'profile=')],
    ['doppeltes Feld', VALID.replace(';end', ';host=b.de;end')],
    ['unbekanntes Feld', VALID.replace(';end', ';signer=someone;end')],
    ['kaputtes Flag', VALID.replace('customScheme=off', 'customScheme=maybe')],
    ['App Link mit erlaubtem Custom Scheme', VALID.replace('customScheme=off', 'customScheme=on')],
    ['App Link mit registriertem Filter', VALID.replace('schemeFilter=off', 'schemeFilter=on')],
    ['App Link ohne passenden appLinkHost', VALID.replace('appLinkHost=a.de', 'appLinkHost=b.de')],
    ['App Link mit fremder URL', VALID.replace('https://a.de/update-password', 'https://b.de/update-password')],
    [
      'App-Link-Transport mit Custom-Scheme-URL',
      VALID.replace('url=https://a.de/update-password?type=recovery',
        'url=lernzeit://auth/update-password?type=recovery'),
    ],
    [
      'Custom-Scheme-Transport mit HTTPS-URL',
      'lernzeit.auth-build/v1;profile=development;transport=custom-scheme;host=auth;appLinkHost=none;'
      + 'customScheme=on;schemeFilter=on;url=https://a.de/update-password?type=recovery;end',
    ],
    [
      'Custom Scheme mit App-Link-Host',
      'lernzeit.auth-build/v1;profile=development;transport=custom-scheme;host=auth;appLinkHost=a.de;'
      + 'customScheme=on;schemeFilter=on;url=lernzeit://auth/update-password?type=recovery;end',
    ],
    [
      'Custom Scheme mit abgeschaltetem Flag',
      'lernzeit.auth-build/v1;profile=development;transport=custom-scheme;host=auth;appLinkHost=none;'
      + 'customScheme=off;schemeFilter=on;url=lernzeit://auth/update-password?type=recovery;end',
    ],
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
  it('uses the attested configuration when both agree', () => {
    const result = reconcileAuthBuild(PRODUCTION, present({ ...PRODUCTION }));
    expect(result.isConsistent).toBe(true);
    expect(result.isAttested).toBe(true);
    expect(result.reason).toBe('attested');
    expect(result.configuration).toEqual(PRODUCTION);
  });

  /**
   * The decisive fail-closed property. Treating "no attestation" as "trust the
   * bundle" would make the attestation decorative: anything that strips `extra`
   * would silently fall back to the unverified half of the contract.
   */
  it('disables recovery in a production build without an attestation', () => {
    const result = reconcileAuthBuild(PRODUCTION, absent);
    expect(result.isConsistent).toBe(false);
    expect(result.reason).toBe('missing-attestation');
    expect(result.configuration.recoveryTransport).toBe('disabled');
    expect(result.configuration.recoveryRedirectUrl).toBe('');
    expect(result.configuration.acceptsCustomRecoveryScheme).toBe(false);
  });

  it('disables recovery when the attestation cannot be read', () => {
    for (const reading of [
      { state: 'unreadable', raw: 'lernzeit.auth-build/v1;transport=nonsense;end' },
      { state: 'unreadable', raw: '' },
    ] as AttestationReading[]) {
      const result = reconcileAuthBuild(PRODUCTION, reading);
      expect(result.isConsistent).toBe(false);
      expect(result.reason).toBe('unreadable-attestation');
      expect(result.configuration.recoveryTransport).toBe('disabled');
    }
  });

  it('disables recovery when the manifest attests a different profile', () => {
    const result = reconcileAuthBuild(PRODUCTION, present({ ...PRODUCTION, profile: 'development' }));
    expect(result.isConsistent).toBe(false);
    expect(result.reason).toBe('mismatch');
    expect(result.configuration.recoveryTransport).toBe('disabled');
  });

  /**
   * A manifest that routes one transport while the bundle expects another is a
   * broken build. Picking either side could mean sending a recovery mail to a
   * callback the app will not honour - or honouring one it never requested.
   */
  it('disables recovery entirely when manifest and bundle disagree', () => {
    const result = reconcileAuthBuild(PRODUCTION, present(DEVELOPMENT));
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
    expect(reconcileAuthBuild(PRODUCTION, present(attested)).isConsistent).toBe(false);
  });

  /**
   * A local start has no embedded manifest and no verified domain. Refusing
   * recovery there would break development without protecting anything.
   */
  it.each<[string, AuthBuildConfiguration]>([
    ['lokaler Start', LOCAL],
    ['Development-Build', DEVELOPMENT],
  ])('keeps the private scheme working for an unattested %s', (_label, derived) => {
    const result = reconcileAuthBuild(derived, absent);
    expect(result.isConsistent).toBe(true);
    expect(result.isAttested).toBe(false);
    expect(result.reason).toBe('unattested-development');
    expect(result.configuration).toEqual(derived);
  });

  it('still refuses an unattested development build whose transport is not the private scheme', () => {
    const result = reconcileAuthBuild({ ...DEVELOPMENT, recoveryTransport: 'https-app-link' }, absent);
    expect(result.isConsistent).toBe(false);
    expect(result.reason).toBe('missing-attestation');
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
