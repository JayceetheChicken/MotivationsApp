#!/usr/bin/env node
/**
 * Generates the operator-hosted static pages from the central configuration:
 *   - public/account-deletion/index.html  (Play-required, reachable without app or login)
 *   - public/.well-known/assetlinks.json  (Android App Links verification)
 *
 * Run with the production environment loaded before publishing the site:
 *   ANDROID_SHA256_CERT_FINGERPRINTS=AA:BB:.. node scripts/build-public-pages.mjs
 *
 * The fingerprint comes from Play Console > Test and release > App integrity >
 * App signing key certificate (SHA-256). Without it the assetlinks file is
 * written with an empty fingerprint list and the release gate fails.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const releaseConfig = require('../config/release-config.cjs');
const appJson = require('../app.json');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.env;
const operator = releaseConfig.resolveOperatorValues(environment);
const androidPackage = appJson.expo.android.package;

const fingerprints = (environment.ANDROID_SHA256_CERT_FINGERPRINTS ?? '')
  .split(/[,\s]+/)
  .map((value) => value.trim().toUpperCase())
  .filter((value) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const isDevelopment = releaseConfig.collectOperatorReleaseIssues(environment).length > 0;
const draftBanner = isDevelopment
  ? '      <p class="draft">Entwicklungsfassung mit Testwerten. Vor der Veröffentlichung müssen die Betreiberangaben als EXPO_PUBLIC_*-Variablen gesetzt und diese Seite neu erzeugt werden.</p>\n'
  : '';

const accountDeletionHtml = `<!doctype html>
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

const assetLinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: androidPackage,
      sha256_cert_fingerprints: fingerprints,
    },
  },
];

const accountDeletionPath = path.join(projectRoot, 'public', 'account-deletion', 'index.html');
const assetLinksPath = path.join(projectRoot, 'public', '.well-known', 'assetlinks.json');

mkdirSync(path.dirname(accountDeletionPath), { recursive: true });
mkdirSync(path.dirname(assetLinksPath), { recursive: true });
writeFileSync(accountDeletionPath, accountDeletionHtml, 'utf8');
writeFileSync(assetLinksPath, `${JSON.stringify(assetLinks, null, 2)}\n`, 'utf8');

process.stdout.write(`Erzeugt: ${path.relative(projectRoot, accountDeletionPath)}\n`);
process.stdout.write(`Erzeugt: ${path.relative(projectRoot, assetLinksPath)}\n`);
if (fingerprints.length === 0) {
  process.stdout.write(
    'Hinweis: ANDROID_SHA256_CERT_FINGERPRINTS ist nicht gesetzt. assetlinks.json enthaelt noch keinen Fingerprint,\n'
    + 'Android App Links werden damit nicht verifiziert. Fingerprint aus der Play Console (App-Signaturschluessel) nachtragen.\n',
  );
}
