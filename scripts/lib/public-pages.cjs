/**
 * Rendering and validation of the two operator-hosted files:
 *   - public/account-deletion/index.html  (Play-required deletion page)
 *   - public/.well-known/assetlinks.json  (Android App Links verification)
 *
 * The generator (scripts/build-public-pages.mjs) and the release gate
 * (scripts/check-release-config.mjs) share this module, so a page can never be
 * produced in a shape the gate does not check. CommonJS so
 * __tests__/release-scripts.test.ts exercises the same code.
 */
const releaseConfig = require('../../config/release-config.cjs');

/** Android App Links accept exactly 32 hex bytes, colon separated. */
const FINGERPRINT_PATTERN = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const REQUIRED_RELATION = 'delegate_permission/common.handle_all_urls';
const REQUIRED_NAMESPACE = 'android_app';
const DRAFT_BANNER_MARKER = 'class="draft"';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Splits ANDROID_SHA256_CERT_FINGERPRINTS into valid and invalid entries.
 *
 * Valid entries are upper-cased and de-duplicated while keeping their order.
 * Invalid entries are *returned*, never silently dropped: in production the
 * caller must abort, because a typo in a fingerprint disables App Links
 * verification just as completely as leaving it out.
 *
 * @param {string | undefined} raw
 * @returns {{ fingerprints: string[], invalid: string[] }}
 */
function parseFingerprints(raw) {
  const entries = String(raw ?? '')
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const fingerprints = [];
  const invalid = [];
  const seen = new Set();

  for (const entry of entries) {
    const normalized = entry.toUpperCase();
    if (!FINGERPRINT_PATTERN.test(normalized)) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    fingerprints.push(normalized);
  }

  return { fingerprints, invalid };
}

/**
 * @param {string} androidPackage
 * @param {readonly string[]} fingerprints
 */
function buildAssetLinks(androidPackage, fingerprints) {
  return [{
    relation: [REQUIRED_RELATION],
    target: {
      namespace: REQUIRED_NAMESPACE,
      package_name: androidPackage,
      sha256_cert_fingerprints: [...fingerprints],
    },
  }];
}

/** @param {readonly string[]} fingerprints @param {string} androidPackage */
function renderAssetLinks(androidPackage, fingerprints) {
  return `${JSON.stringify(buildAssetLinks(androidPackage, fingerprints), null, 2)}\n`;
}

/**
 * Structural validation of an assetlinks.json document.
 *
 * Accepts the raw file text so a syntactically broken file is a finding rather
 * than a crash.
 *
 * @param {string} text
 * @param {string} expectedPackage
 * @returns {string[]} human readable reasons, empty when the document is valid
 */
function collectAssetLinksIssues(text, expectedPackage) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return [`Kein gueltiges JSON: ${error?.message ?? error}.`];
  }

  if (!Array.isArray(document)) return ['Das Dokument ist kein JSON-Array.'];
  if (document.length === 0) return ['Das Dokument enthaelt keinen Eintrag.'];

  const issues = [];
  document.forEach((entry, index) => {
    const at = `Eintrag ${index + 1}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(`${at}: kein Objekt.`);
      return;
    }

    const relation = entry.relation;
    if (!Array.isArray(relation) || !relation.includes(REQUIRED_RELATION)) {
      issues.push(`${at}: relation enthaelt "${REQUIRED_RELATION}" nicht.`);
    }

    const target = entry.target;
    if (target === null || typeof target !== 'object' || Array.isArray(target)) {
      issues.push(`${at}: target fehlt oder ist kein Objekt.`);
      return;
    }
    if (target.namespace !== REQUIRED_NAMESPACE) {
      issues.push(`${at}: namespace ist "${target.namespace}", erwartet "${REQUIRED_NAMESPACE}".`);
    }
    if (target.package_name !== expectedPackage) {
      issues.push(`${at}: package_name ist "${target.package_name}", erwartet "${expectedPackage}".`);
    }

    const prints = target.sha256_cert_fingerprints;
    if (!Array.isArray(prints) || prints.length === 0) {
      issues.push(
        `${at}: sha256_cert_fingerprints ist leer. Ohne Fingerprint verifiziert Android den App Link nicht, `
        + 'der HTTPS-Recovery-Link oeffnet dann den Browser statt der App.',
      );
      return;
    }
    prints.forEach((print, printIndex) => {
      if (typeof print !== 'string' || !FINGERPRINT_PATTERN.test(print.toUpperCase())) {
        issues.push(`${at}: Fingerprint ${printIndex + 1} ist ungueltig: ${JSON.stringify(print)}.`);
      }
    });
  });

  return issues;
}

/**
 * Content validation of the rendered account deletion page.
 *
 * The page is the one artefact a Play reviewer opens without the app, so it may
 * not carry a single development marker.
 *
 * @param {string} html
 * @param {Record<string, string>} [operator] resolved operator values; when
 *   given, the page must actually contain them
 * @returns {string[]}
 */
function collectAccountDeletionPageIssues(html, operator) {
  const issues = [];

  if (html.includes(releaseConfig.DEVELOPMENT_MARKER_DOMAIN)) {
    issues.push(`Enthaelt die Entwicklungsdomain "${releaseConfig.DEVELOPMENT_MARKER_DOMAIN}".`);
  }
  const otherInvalid = html.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.invalid\b/gi) ?? [];
  const foreignInvalid = [...new Set(otherInvalid)].filter(
    (value) => value.toLowerCase() !== releaseConfig.DEVELOPMENT_MARKER_DOMAIN,
  );
  if (foreignInvalid.length > 0) {
    issues.push(`Enthaelt reservierte .invalid-Domains: ${foreignInvalid.join(', ')}.`);
  }
  if (/Testwert/i.test(html)) {
    issues.push('Enthaelt den Entwicklungs-Testwert-Marker "Testwert".');
  }
  if (html.includes(DRAFT_BANNER_MARKER) || /Entwicklungsfassung/i.test(html)) {
    issues.push('Enthaelt den sichtbaren Entwicklungsbanner.');
  }

  const mailtoAddresses = [...html.matchAll(/mailto:([^"?>\s]+)/gi)].map((match) => match[1]);
  const realMail = mailtoAddresses.find(
    (address) => address.includes('@') && !releaseConfig.isPlaceholderValue(address),
  );
  if (!realMail) {
    issues.push('Enthaelt keine echte Betreiber-E-Mail-Adresse fuer Loeschanfragen.');
  }

  if (operator) {
    const expectations = [
      ['operatorName', 'Betreibername'],
      ['operatorAddress', 'Betreiberanschrift'],
      ['operatorContactEmail', 'Betreiber-Kontaktadresse'],
      ['privacyContactEmail', 'Datenschutz-Kontaktadresse'],
    ];
    for (const [key, label] of expectations) {
      const value = operator[key];
      if (!value) {
        issues.push(`${label} (${key}) ist nicht konfiguriert.`);
        continue;
      }
      if (!html.includes(escapeHtml(value))) {
        issues.push(`${label} (${key}) steht nicht auf der Seite: "${value}".`);
      }
    }
  }

  return issues;
}

/**
 * @param {Record<string, string>} operator resolved operator values
 * @param {{ isDevelopment: boolean }} options
 */
function renderAccountDeletionPage(operator, options) {
  const draftBanner = options.isDevelopment
    ? '      <p class="draft">Entwicklungsfassung mit Testwerten. Vor der Veröffentlichung müssen die Betreiberangaben als EXPO_PUBLIC_*-Variablen gesetzt und diese Seite neu erzeugt werden.</p>\n'
    : '';

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action mailto:; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'">
    <title>Lernzeit-Konto löschen</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f4e8d0; color: #382a21; }
      body { margin: 0; padding: 32px 18px; }
      main { max-width: 760px; margin: auto; }
      section { margin: 18px 0; padding: 20px; border: 1px solid #bc9b78; border-radius: 16px; background: #fffaf0; }
      h1, h2 { color: #7a321f; }
      a { color: #7a321f; font-weight: 700; }
      .warning { border-color: #b44d2b; background: #fff1eb; }
      .draft { font-weight: 700; color: #8a5a00; }
      footer { margin-top: 28px; font-size: 0.9rem; color: #6b5346; }
    </style>
  </head>
  <body>
    <main>
      <h1>Lernzeit-Konto dauerhaft löschen</h1>
${draftBanner}
      <section>
        <h2>Direkt in der App</h2>
        <p>Öffne nach der Anmeldung „Konto &amp; Einstellungen“, dann „Konto löschen“. Bestätige den Vorgang mit deinem Passwort und dem eingeblendeten Bestätigungstext. Die Löschung kann nicht rückgängig gemacht werden.</p>
      </section>

      <section>
        <h2>Ohne Zugriff auf die App</h2>
        <p>Sende eine Löschanfrage von der E-Mail-Adresse des Kontos an <a href="mailto:${escapeHtml(operator.privacyContactEmail)}?subject=Lernzeit-Konto%20l%C3%B6schen">${escapeHtml(operator.privacyContactEmail)}</a>. Gib den Benutzernamen des Kontos an.</p>
        <p>Die Identitätsprüfung läuft so ab:</p>
        <ol>
          <li>Der Betreiber sendet innerhalb von sieben Tagen eine Bestätigungs-E-Mail an die im Konto hinterlegte Adresse.</li>
          <li>Diese E-Mail enthält einen einmaligen, auf 72 Stunden begrenzten Bestätigungscode.</li>
          <li>Die Löschung wird erst nach Rücksendung des Codes von derselben Adresse ausgeführt.</li>
          <li>Stimmt die Absenderadresse nicht mit der Kontoadresse überein, wird stattdessen um eine Anmeldung in der App gebeten.</li>
        </ol>
        <p>Der Betreiber fragt niemals nach dem Passwort oder einem Anmelde-Token. Teile beides niemals per E-Mail.</p>
      </section>

      <section class="warning">
        <h2>Was gelöscht, übertragen oder erhalten wird</h2>
        <ul>
          <li>Login, Profil, Profilbilder, private Fächer, Lernzeiten, Noten, persönliche Ziele, Geräte-Presence, Import- und Synchronisationsdaten werden gelöscht.</li>
          <li>Freundschaften, offene Einladungen und personenbezogene Teilnehmerbeziehungen werden entfernt.</li>
          <li>Gruppen mit weiteren akzeptierten Mitgliedern gehen deterministisch an das am längsten beteiligte verbleibende Mitglied über; leere Gruppen werden gelöscht.</li>
          <li>Gemeinsame Ziele und Sessions werden an einen verbleibenden berechtigten Teilnehmer übertragen. Ohne verbleibende Teilnehmer werden sie gelöscht.</li>
          <li>Lokale Daten anderer Konten auf demselben Gerät werden nicht gelöscht.</li>
        </ul>
      </section>

      <section>
        <h2>Aufbewahrung</h2>
        <p>${escapeHtml(operator.statutoryRetention)}</p>
        <p>${escapeHtml(operator.logRetentionPolicy)}</p>
      </section>

      <footer>
        <p>${escapeHtml(operator.operatorName)}, ${escapeHtml(operator.operatorAddress)} &middot; ${escapeHtml(operator.operatorContactEmail)}</p>
        <p>Diese Seite wird aus config/operator-fields.json erzeugt. Manuelle Änderungen gehen beim nächsten Build verloren.</p>
      </footer>
    </main>
  </body>
</html>
`;
}

module.exports = {
  FINGERPRINT_PATTERN,
  REQUIRED_RELATION,
  REQUIRED_NAMESPACE,
  escapeHtml,
  parseFingerprints,
  buildAssetLinks,
  renderAssetLinks,
  collectAssetLinksIssues,
  collectAccountDeletionPageIssues,
  renderAccountDeletionPage,
};
