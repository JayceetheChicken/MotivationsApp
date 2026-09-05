/**
 * Checks the AndroidManifest.xml that `expo prebuild` really generates.
 *
 * Why this exists next to scripts/lib/expo-config-check.cjs: that module reads
 * `expo config --type public --json`, which is Expo's *input* to the prebuild.
 * Between the two sits `@expo/config-plugins`, which decides how `expo.scheme`
 * and `android.intentFilters` become `<data>` elements, which activity they land
 * on, and what it adds on its own. A resolved config that looks correct and a
 * manifest that ships a `lernzeit://` entry anyway is exactly the gap an
 * upstream change could open, so the generated XML is asserted directly.
 *
 * CommonJS and dependency free for the same reason as its neighbours: the tests
 * run the identical code the CLI runs, and no XML library is pulled into the
 * release path.
 */
const releaseConfig = require('../../config/release-config.cjs');

/** `<data .../>` and `<intent-filter ...>` are the only elements of interest. */
const INTENT_FILTER_PATTERN = /<intent-filter\b([^>]*)>([\s\S]*?)<\/intent-filter>/gi;
const SELF_CLOSING_INTENT_FILTER = /<intent-filter\b([^>]*)\/>/gi;
const DATA_PATTERN = /<data\b([^>]*?)\/?>/gi;
const ACTION_PATTERN = /<action\b([^>]*?)\/?>/gi;
const CATEGORY_PATTERN = /<category\b([^>]*?)\/?>/gi;
const COMPONENT_PATTERN = /<(activity-alias|activity|service|receiver|provider)(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
const ATTRIBUTE_PATTERN = /([a-zA-Z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
const EXPECTED_ANDROID_PACKAGE = 'de.lernzeit.app';
const EXPECTED_MAIN_ACTIVITIES = new Set(['.MainActivity', `${EXPECTED_ANDROID_PACKAGE}.MainActivity`]);
const ALLOWED_ANDROID_PERMISSIONS = new Set([
  'android.permission.INTERNET',
  'android.permission.VIBRATE',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  `${EXPECTED_ANDROID_PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
]);

/**
 * The attributes of one XML start tag.
 * @param {string} text everything between the element name and the closing `>`
 * @returns {Record<string, string>} keyed without the `android:` prefix
 */
function attributesOf(text) {
  /** @type {Record<string, string>} */
  const attributes = {};
  const pattern = new RegExp(ATTRIBUTE_PATTERN.source, 'g');
  let match = pattern.exec(text);
  while (match !== null) {
    attributes[match[1].replace(/^android:/, '')] = decodeXmlEntities(match[2]);
    match = pattern.exec(text);
  }
  return attributes;
}

/** The five predefined XML entities; Expo writes no others into a manifest. */
function decodeXmlEntities(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/**
 * @typedef {{type: string, name: string, exported: string, permission: string}} NativeComponent
 * @typedef {{ autoVerify: boolean, actions: string[], categories: string[], data: Record<string, string>[], component: NativeComponent, raw: string }} NativeIntentFilter
 */

/** Remove comments before regex parsing so commented-out XML cannot satisfy a release check. */
function withoutXmlComments(xml) {
  const source = String(xml ?? '');
  const fragments = [];
  let cursor = 0;
  while (cursor < source.length) {
    const commentStart = source.indexOf('<!--', cursor);
    if (commentStart === -1) {
      fragments.push(source.slice(cursor));
      break;
    }
    fragments.push(source.slice(cursor, commentStart));
    const commentEnd = source.indexOf('-->', commentStart + 4);
    if (commentEnd === -1) break;
    cursor = commentEnd + 3;
  }
  return fragments.join('');
}

/** @param {string} body @param {RegExp} expression */
function childNames(body, expression) {
  const names = [];
  const scanner = new RegExp(expression.source, 'gi');
  let match = scanner.exec(body);
  while (match !== null) {
    const name = attributesOf(match[1] ?? '').name;
    if (name) names.push(name);
    match = scanner.exec(body);
  }
  return names;
}

/** @param {string} body @param {NativeComponent} component */
function filtersInComponent(body, component) {
  const filters = [];
  for (const pattern of [INTENT_FILTER_PATTERN, SELF_CLOSING_INTENT_FILTER]) {
    const scanner = new RegExp(pattern.source, 'gi');
    let match = scanner.exec(body);
    while (match !== null) {
      const attributes = attributesOf(match[1] ?? '');
      const filterBody = match[2] ?? '';
      const data = [];
      const dataScanner = new RegExp(DATA_PATTERN.source, 'gi');
      let dataMatch = dataScanner.exec(filterBody);
      while (dataMatch !== null) {
        data.push(attributesOf(dataMatch[1] ?? ''));
        dataMatch = dataScanner.exec(filterBody);
      }
      filters.push({
        autoVerify: attributes.autoVerify === 'true',
        actions: childNames(filterBody, ACTION_PATTERN),
        categories: childNames(filterBody, CATEGORY_PATTERN),
        component,
        data,
        raw: match[0],
      });
      match = scanner.exec(body);
    }
  }
  return filters;
}

/**
 * Every `<intent-filter>` in the manifest, with its `<data>` children.
 *
 * @param {string} xml
 * @returns {NativeIntentFilter[]}
 */
function parseIntentFilters(xml) {
  const text = withoutXmlComments(xml);
  /** @type {NativeIntentFilter[]} */
  const filters = [];

  const componentScanner = new RegExp(COMPONENT_PATTERN.source, 'gi');
  let componentMatch = componentScanner.exec(text);
  while (componentMatch !== null) {
    const attributes = attributesOf(componentMatch[2] ?? '');
    const component = {
      type: componentMatch[1].toLowerCase(),
      name: attributes.name ?? '',
      exported: attributes.exported ?? '',
      permission: attributes.permission ?? '',
    };
    // A self-closing component has no children. Consume it separately so its
    // name/exported flag can never be attributed to the next activity's links.
    filters.push(...filtersInComponent(componentMatch[3] ?? '', component));
    componentMatch = componentScanner.exec(text);
  }
  return filters;
}

/** The path a `<data>` element declares, whichever attribute spells it. */
function pathOf(entry) {
  return entry.path ?? entry.pathPrefix ?? entry.pathPattern ?? null;
}

/** Every `<data>` element of every intent filter. */
function allData(filters) {
  return filters.flatMap((filter) => filter.data);
}

/**
 * Does this filter route the recovery callback over the given scheme?
 * @param {NativeIntentFilter} filter
 * @param {string} scheme
 */
function routesRecovery(filter, scheme) {
  return filter.data.some(
    (entry) => entry.scheme === scheme && pathOf(entry) === releaseConfig.RECOVERY_PATH,
  );
}

/** @param {readonly string[]} actual @param {readonly string[]} expected */
function hasExactNames(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === expected.length
    && expected.every((entry) => actual.includes(entry));
}

/** @param {NativeIntentFilter} filter */
function isBrowsableViewFilter(filter) {
  return filter.actions.includes('android.intent.action.VIEW')
    && filter.categories.includes('android.intent.category.BROWSABLE');
}

/**
 * @param {NativeIntentFilter} filter
 * @param {{scheme: string, host: string, autoVerify: boolean}} expected
 */
function exactNativeRecoveryFilterIssues(filter, expected) {
  const issues = [];
  if (!hasExactNames(filter.actions, ['android.intent.action.VIEW'])) {
    issues.push('action muss exakt android.intent.action.VIEW sein');
  }
  if (!hasExactNames(filter.categories, [
    'android.intent.category.BROWSABLE',
    'android.intent.category.DEFAULT',
  ])) {
    issues.push('categories müssen exakt BROWSABLE und DEFAULT sein');
  }
  if (filter.autoVerify !== expected.autoVerify) {
    issues.push(`android:autoVerify muss ${expected.autoVerify ? 'true' : 'false/abwesend'} sein`);
  }
  if (
    filter.component.type !== 'activity'
    || !EXPECTED_MAIN_ACTIVITIES.has(filter.component.name)
    || filter.component.exported !== 'true'
  ) {
    issues.push('der Filter muss auf der exportierten MainActivity liegen');
  }
  if (filter.data.length !== 1) {
    issues.push(`genau ein data-Element ist erlaubt, gefunden: ${filter.data.length}`);
  } else {
    const entry = filter.data[0];
    const keys = Object.keys(entry);
    if (
      entry.scheme !== expected.scheme
      || entry.host !== expected.host
      || entry.path !== releaseConfig.RECOVERY_PATH
      || keys.some((key) => !['scheme', 'host', 'path'].includes(key))
    ) {
      issues.push(
        `data muss exakt ${expected.scheme}://${expected.host}${releaseConfig.RECOVERY_PATH} mit android:path sein`,
      );
    }
  }
  return issues;
}

/** @param {string} xml @param {string} tag */
function tagAttributes(xml, tag) {
  const pattern = new RegExp(`<${tag}(?=[\\s/>])([^>]*)>`, 'i');
  const match = pattern.exec(withoutXmlComments(xml));
  return match ? attributesOf(match[1] ?? '') : null;
}

/** @param {string} xml @param {string} tag */
function allTagAttributes(xml, tag) {
  const values = [];
  const scanner = new RegExp(`<${tag}(?=[\\s/>])([^>]*?)(?:\\/?>)`, 'gi');
  let match = scanner.exec(withoutXmlComments(xml));
  while (match !== null) {
    values.push(attributesOf(match[1] ?? ''));
    match = scanner.exec(withoutXmlComments(xml));
  }
  return values;
}

/**
 * Security properties that must survive config plugins and manifest merging.
 * Missing package/SDK/version attributes are tolerated in the CNG source
 * manifest because Gradle owns them; when a merged manifest contains them they
 * are validated.
 * @param {string} xml
 * @param {{ allowDebuggable?: boolean }} [options]
 */
function collectNativeHardeningIssues(xml, options = {}) {
  const failures = [];
  const text = withoutXmlComments(xml);
  const manifest = tagAttributes(text, 'manifest');
  const application = tagAttributes(text, 'application');
  if (!application) return ['Das Manifest enthält kein application-Element.'];

  if (application.allowBackup !== 'false') failures.push('android:allowBackup muss false sein.');
  if (application.usesCleartextTraffic !== 'false') {
    failures.push('android:usesCleartextTraffic muss false sein.');
  }
  if (application.debuggable === 'true' && !options.allowDebuggable) {
    failures.push('Ein Release-Manifest darf nicht debuggable=true sein.');
  }
  if (application.networkSecurityConfig) {
    failures.push('Eine unerwartete Network Security Config ist im Manifest aktiv.');
  }

  if (manifest?.package && manifest.package !== EXPECTED_ANDROID_PACKAGE) {
    failures.push(`Manifest-Paket ist "${manifest.package}", erwartet "${EXPECTED_ANDROID_PACKAGE}".`);
  }
  if (manifest?.versionCode && !/^[1-9]\d*$/.test(manifest.versionCode)) {
    failures.push(`Manifest-versionCode ist ungültig: "${manifest.versionCode}".`);
  }
  if (manifest?.versionName && !/^\d+\.\d+\.\d+$/.test(manifest.versionName)) {
    failures.push(`Manifest-versionName ist ungültig: "${manifest.versionName}".`);
  }

  const sdk = tagAttributes(text, 'uses-sdk');
  if (sdk) {
    if (!/^\d+$/.test(sdk.minSdkVersion ?? '') || Number(sdk.minSdkVersion) < 24) {
      failures.push(`minSdkVersion muss mindestens 24 sein, gefunden: "${sdk.minSdkVersion ?? ''}".`);
    }
    if (sdk.targetSdkVersion !== '36') {
      failures.push(`targetSdkVersion muss 36 sein, gefunden: "${sdk.targetSdkVersion ?? ''}".`);
    }
  }

  for (const permission of allTagAttributes(text, 'uses-permission')) {
    if (permission['tools:node'] === 'remove') continue;
    const name = permission.name ?? '';
    if (!ALLOWED_ANDROID_PERMISSIONS.has(name)) {
      failures.push(`Unerwartete aktive Android-Berechtigung: "${name}".`);
    }
  }

  for (const component of allTagAttributes(text, 'activity')) {
    if (component.exported === 'true' && !EXPECTED_MAIN_ACTIVITIES.has(component.name ?? '')) {
      failures.push(`Unerwartete exportierte Activity: "${component.name ?? ''}".`);
    }
  }
  for (const component of allTagAttributes(text, 'activity-alias')) {
    if (component.exported === 'true') {
      failures.push(`Unerwarteter exportierter Activity-Alias: "${component.name ?? ''}".`);
    }
  }
  for (const component of allTagAttributes(text, 'service')) {
    if (component.exported === 'true') failures.push(`Unerwarteter exportierter Service: "${component.name ?? ''}".`);
  }
  for (const component of allTagAttributes(text, 'provider')) {
    if (component.exported === 'true') failures.push(`Unerwarteter exportierter Provider: "${component.name ?? ''}".`);
    if (component.authorities && !component.authorities.startsWith(`${EXPECTED_ANDROID_PACKAGE}.`)) {
      failures.push(`Provider-Authority liegt außerhalb des Pakets: "${component.authorities}".`);
    }
  }
  for (const component of allTagAttributes(text, 'receiver')) {
    const permittedProfileInstaller = component.name === 'androidx.profileinstaller.ProfileInstallReceiver'
      && component.permission === 'android.permission.DUMP';
    if (component.exported === 'true' && !permittedProfileInstaller) {
      failures.push(`Unerwarteter exportierter Receiver: "${component.name ?? ''}".`);
    }
  }
  return failures;
}

/** @param {string | undefined} appBuildGradle @param {string | undefined} gradleProperties */
function collectNativeGradleIssues(appBuildGradle, gradleProperties) {
  if (appBuildGradle === undefined && gradleProperties === undefined) return [];
  const failures = [];
  const build = String(appBuildGradle ?? '');
  const properties = String(gradleProperties ?? '');
  const property = (name) => new RegExp(`^${name.replaceAll('.', '\\.') }=(.+)$`, 'm').exec(properties)?.[1]?.trim();

  if (!/\bnamespace\s+['"]de\.lernzeit\.app['"]/.test(build)) failures.push('Gradle namespace muss de.lernzeit.app sein.');
  if (!/\bapplicationId\s+['"]de\.lernzeit\.app['"]/.test(build)) failures.push('Gradle applicationId muss de.lernzeit.app sein.');
  if (!/\bversionCode\s+[1-9]\d*\b/.test(build)) failures.push('Gradle versionCode fehlt oder ist ungültig.');
  if (property('android.minSdkVersion') !== '24') failures.push('android.minSdkVersion muss 24 sein.');
  if (property('android.compileSdkVersion') !== '36') failures.push('android.compileSdkVersion muss 36 sein.');
  if (property('android.targetSdkVersion') !== '36') failures.push('android.targetSdkVersion muss 36 sein.');
  if (property('android.enableMinifyInReleaseBuilds') !== 'true') failures.push('R8-Minifizierung muss für Release aktiv sein.');
  if (property('android.enableShrinkResourcesInReleaseBuilds') !== 'true') failures.push('Release Resource Shrinking muss aktiv sein.');
  return failures;
}

/**
 * Every reason the generated manifest does not match the build profile.
 *
 * @param {string} xml contents of android/app/src/main/AndroidManifest.xml
 * @param {Record<string, string | undefined>} environment
 * @param {{appBuildGradle?: string, gradleProperties?: string}} [nativeFiles]
 * @returns {{ failures: string[], notes: string[], summary: Record<string, unknown> }}
 */
function collectNativeLinkingIssues(xml, environment, nativeFiles = {}) {
  const failures = [];
  const notes = [];
  const text = withoutXmlComments(xml);

  if (!/<manifest\b/i.test(text)) {
    return {
      failures: ['Die Datei enthaelt kein <manifest>-Element; das ist kein AndroidManifest.xml.'],
      notes,
      summary: {},
    };
  }
  const profile = releaseConfig.resolveBuildProfile(environment);
  if (profile.issue) {
    return { failures: [profile.issue], notes, summary: { buildProfile: profile.profile } };
  }
  const auth = releaseConfig.resolveAuthBuildConfiguration(environment);
  const nativeVariant = ['development', 'local'].includes(auth.profile) ? 'debug' : 'release';
  failures.push(...collectNativeHardeningIssues(text, {
    allowDebuggable: nativeVariant === 'debug',
  }));
  failures.push(...collectNativeGradleIssues(nativeFiles.appBuildGradle, nativeFiles.gradleProperties));

  const filters = parseIntentFilters(text);
  const data = allData(filters);
  const customSchemeEntries = data.filter((entry) => entry.scheme === releaseConfig.APP_SCHEME);
  const verifiedFilters = filters.filter((filter) => filter.autoVerify);
  const appLinkFilters = filters.filter(
    (filter) => filter.autoVerify && routesRecovery(filter, 'https'),
  );
  const privateRecoveryFilters = filters.filter(
    (filter) => routesRecovery(filter, releaseConfig.APP_SCHEME),
  );

  if (auth.recoveryTransport === 'https-app-link') {
    const unapprovedBrowsableFilters = filters.filter(isBrowsableViewFilter).filter(
      (filter) => exactNativeRecoveryFilterIssues(filter, {
        scheme: 'https',
        host: auth.androidAppLinkHost,
        autoVerify: true,
      }).length > 0,
    );
    for (const filter of unapprovedBrowsableFilters) {
      failures.push(
        'Unerlaubter VIEW+BROWSABLE-Intent-Filter in Production auf '
        + `${filter.component.type} "${filter.component.name}": ${JSON.stringify(filter.data)}. `
        + 'Erlaubt ist ausschliesslich der exakte Recovery-App-Link.',
      );
    }
    // Production. The decisive assertions are the two negatives: no lernzeit
    // scheme anywhere - Expo would register it as a general incoming deep link -
    // and no private recovery route.
    if (customSchemeEntries.length > 0) {
      failures.push(
        `Das Manifest registriert das Scheme "${releaseConfig.APP_SCHEME}" `
        + `(${customSchemeEntries.length} <data>-Element(e)). Ein Production-Build darf das nicht: `
        + 'jede andere installierte App kann dasselbe Scheme beanspruchen.',
      );
    }
    if (privateRecoveryFilters.length > 0) {
      failures.push('Das Manifest enthaelt einen privaten Recovery-Intent-Filter.');
    }
    const recoveryHostFilters = filters.filter(
      (filter) => filter.data.some((entry) => entry.host === releaseConfig.CUSTOM_RECOVERY_HOST),
    );
    if (recoveryHostFilters.length > 0) {
      failures.push(
        `Das Manifest enthaelt einen Intent-Filter auf dem Host "${releaseConfig.CUSTOM_RECOVERY_HOST}". `
        + 'Das ist der Host des privaten Recovery-Schemas und gehoert nicht in einen Production-Build.',
      );
    }

    if (verifiedFilters.length !== 1) {
      failures.push(
        `Das Manifest muss genau einen android:autoVerify="true"-Filter enthalten; gefunden: ${verifiedFilters.length}.`,
      );
    }
    if (appLinkFilters.length === 0) {
      failures.push(
        'Es gibt keinen Intent-Filter mit android:autoVerify="true" auf '
        + `https://<Betreiberdomain>${releaseConfig.RECOVERY_PATH}.`,
      );
    } else if (appLinkFilters.length > 1) {
      failures.push(`Das Manifest enthaelt ${appLinkFilters.length} verifizierte Recovery-App-Links; erwartet genau einen.`);
    } else {
      const entry = appLinkFilters[0].data.find(
        (candidate) => candidate.scheme === 'https' && pathOf(candidate) === releaseConfig.RECOVERY_PATH,
      );
      if (entry.host !== auth.androidAppLinkHost) {
        failures.push(
          `Der App-Link-Host im Manifest ist "${entry.host}", erwartet "${auth.androidAppLinkHost}".`,
        );
      }
      if (entry.path !== releaseConfig.RECOVERY_PATH) {
        failures.push(
          `Der Recovery-App-Link verwendet "${Object.keys(entry).find((key) => key.startsWith('path'))}" `
          + `statt eines exakten android:path="${releaseConfig.RECOVERY_PATH}".`,
        );
      }
      for (const issue of exactNativeRecoveryFilterIssues(appLinkFilters[0], {
        scheme: 'https',
        host: auth.androidAppLinkHost,
        autoVerify: true,
      })) failures.push(`Der Production-App-Link ist nicht exakt: ${issue}.`);
      notes.push(`Verifizierter App Link: https://${entry.host}${pathOf(entry)} (autoVerify)`);
    }
  } else if (auth.recoveryTransport === 'custom-scheme') {
    // Development and preview. The private scheme has to be there, and nothing
    // may claim to be a verified App Link - the signing certificate of these
    // builds is not in the operator's assetlinks.json.
    if (privateRecoveryFilters.length === 0) {
      failures.push(
        `Im Profil "${auth.profile}" fehlt der Intent-Filter fuer `
        + `${releaseConfig.APP_SCHEME}://${releaseConfig.CUSTOM_RECOVERY_HOST}${releaseConfig.RECOVERY_PATH}.`,
      );
    } else if (privateRecoveryFilters.length > 1) {
      failures.push(`Das Manifest enthaelt ${privateRecoveryFilters.length} private Recovery-Filter; erwartet genau einen.`);
    } else {
      const entry = privateRecoveryFilters[0].data.find(
        (candidate) => candidate.scheme === releaseConfig.APP_SCHEME,
      );
      if (entry.host !== releaseConfig.CUSTOM_RECOVERY_HOST) {
        failures.push(
          `Der private Recovery-Filter nennt den Host "${entry.host}", erwartet `
          + `"${releaseConfig.CUSTOM_RECOVERY_HOST}".`,
        );
      }
      if (privateRecoveryFilters[0].autoVerify) {
        failures.push('Ein Intent-Filter auf dem privaten Scheme darf nicht autoVerify="true" tragen.');
      }
      for (const issue of exactNativeRecoveryFilterIssues(privateRecoveryFilters[0], {
        scheme: releaseConfig.APP_SCHEME,
        host: releaseConfig.CUSTOM_RECOVERY_HOST,
        autoVerify: false,
      })) failures.push(`Der private Recovery-Filter ist nicht exakt: ${issue}.`);
      notes.push(
        `Privater Recovery-Link: ${releaseConfig.APP_SCHEME}://${entry.host}${pathOf(entry)}`,
      );
    }

    if (!data.some((entry) => entry.scheme === releaseConfig.APP_SCHEME)) {
      failures.push(`Das Manifest registriert das Scheme "${releaseConfig.APP_SCHEME}" ueberhaupt nicht.`);
    }
    if (verifiedFilters.length > 0) {
      failures.push(
        `Das Manifest enthaelt ${verifiedFilters.length} autoVerify-App-Link(s). `
        + `Ein ${auth.profile}-Build kann keinen App Link verifizieren, weil seine Signatur nicht in `
        + 'der assetlinks.json der Betreiberdomain steht.',
      );
    }
  } else {
    failures.push(
      `Der aufgeloeste Recovery-Transport ist "${auth.recoveryTransport}". Fuer diese Konfiguration `
      + 'darf kein natives Manifest erzeugt werden.',
    );
  }

  return {
    failures,
    notes,
    summary: {
      buildProfile: auth.profile,
      nativeVariant,
      recoveryTransport: auth.recoveryTransport,
      intentFilters: filters.length,
      customSchemeEntries: customSchemeEntries.length,
      verifiedRecoveryAppLinks: appLinkFilters.length,
      verifiedFilters: verifiedFilters.length,
      privateRecoveryFilters: privateRecoveryFilters.length,
      appLinkHost: appLinkFilters[0]?.data.find((entry) => entry.scheme === 'https')?.host ?? null,
    },
  };
}

module.exports = {
  attributesOf,
  withoutXmlComments,
  parseIntentFilters,
  pathOf,
  exactNativeRecoveryFilterIssues,
  isBrowsableViewFilter,
  collectNativeHardeningIssues,
  collectNativeGradleIssues,
  collectNativeLinkingIssues,
};
