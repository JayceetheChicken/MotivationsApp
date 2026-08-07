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
const ATTRIBUTE_PATTERN = /([a-zA-Z_][\w:.-]*)\s*=\s*"([^"]*)"/g;

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
 * @typedef {{ autoVerify: boolean, data: Record<string, string>[], raw: string }} NativeIntentFilter
 */

/**
 * Every `<intent-filter>` in the manifest, with its `<data>` children.
 *
 * @param {string} xml
 * @returns {NativeIntentFilter[]}
 */
function parseIntentFilters(xml) {
  const text = String(xml ?? '');
  /** @type {NativeIntentFilter[]} */
  const filters = [];

  for (const pattern of [INTENT_FILTER_PATTERN, SELF_CLOSING_INTENT_FILTER]) {
    const scanner = new RegExp(pattern.source, 'gi');
    let match = scanner.exec(text);
    while (match !== null) {
      const attributes = attributesOf(match[1] ?? '');
      const body = match[2] ?? '';
      const data = [];
      const dataScanner = new RegExp(DATA_PATTERN.source, 'gi');
      let dataMatch = dataScanner.exec(body);
      while (dataMatch !== null) {
        data.push(attributesOf(dataMatch[1] ?? ''));
        dataMatch = dataScanner.exec(body);
      }
      filters.push({ autoVerify: attributes.autoVerify === 'true', data, raw: match[0] });
      match = scanner.exec(text);
    }
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

/**
 * Every reason the generated manifest does not match the build profile.
 *
 * @param {string} xml contents of android/app/src/main/AndroidManifest.xml
 * @param {Record<string, string | undefined>} environment
 * @returns {{ failures: string[], notes: string[], summary: Record<string, unknown> }}
 */
function collectNativeLinkingIssues(xml, environment) {
  const failures = [];
  const notes = [];
  const text = String(xml ?? '');

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

  const filters = parseIntentFilters(text);
  const data = allData(filters);
  const customSchemeEntries = data.filter((entry) => entry.scheme === releaseConfig.APP_SCHEME);
  const appLinkFilters = filters.filter(
    (filter) => filter.autoVerify && routesRecovery(filter, 'https'),
  );
  const privateRecoveryFilters = filters.filter(
    (filter) => routesRecovery(filter, releaseConfig.APP_SCHEME),
  );

  if (auth.recoveryTransport === 'https-app-link') {
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
      notes.push(
        `Privater Recovery-Link: ${releaseConfig.APP_SCHEME}://${entry.host}${pathOf(entry)}`,
      );
    }

    if (!data.some((entry) => entry.scheme === releaseConfig.APP_SCHEME)) {
      failures.push(`Das Manifest registriert das Scheme "${releaseConfig.APP_SCHEME}" ueberhaupt nicht.`);
    }
    if (appLinkFilters.length > 0) {
      failures.push(
        `Das Manifest enthaelt ${appLinkFilters.length} verifizierte Recovery-App-Link(s). `
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
      recoveryTransport: auth.recoveryTransport,
      intentFilters: filters.length,
      customSchemeEntries: customSchemeEntries.length,
      verifiedRecoveryAppLinks: appLinkFilters.length,
      privateRecoveryFilters: privateRecoveryFilters.length,
      appLinkHost: appLinkFilters[0]?.data.find((entry) => entry.scheme === 'https')?.host ?? null,
    },
  };
}

module.exports = {
  attributesOf,
  parseIntentFilters,
  pathOf,
  collectNativeLinkingIssues,
};
