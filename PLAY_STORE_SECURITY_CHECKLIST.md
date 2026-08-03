# Play-Store-Sicherheitscheckliste

Stand: 3. August 2026

## Automatische Gates (im Repository erzwungen)

- [x] TypeScript, 367 Jest-Tests, ESLint ohne Warnungen, Expo Doctor 20/20.
- [x] Production-Export erzeugt 67 statische Routen; der Export wird auf
  Secret-Muster geprüft und muss die konfigurierten Betreiberangaben
  nachweislich enthalten.
- [x] Release-Gate: `app.config.js` bricht jeden Production-Build ab, solange
  eine der 24 Pflichtangaben fehlt oder noch ein Platzhalter ist. CI prüft
  beide Richtungen, also Blockieren *und* Akzeptieren.
- [x] Brand-Assets sind reproduzierbar (`npm run assets:build -- --check`) und
  enthalten kein Expo-/React-Native-Template-Material mehr.
- [x] Third-Party-Lizenzinventur über den Produktionsbaum: 764 Pakete, kein
  Copyleft, kein Paket ohne Lizenzangabe.
- [x] Deno Format, Lint und Typecheck für die Kontolösch-Function.
- [x] Keine verbotenen sensiblen Dateinamen im Git-Index.
- [x] Gitleaks, CodeQL (JavaScript/TypeScript **und** Actions, `security-extended`)
  sowie OSV sind SHA-gepinnt und minimal berechtigt; Dependabot deckt npm und
  GitHub Actions ab.
- [x] Supabase-CI ist grün: frischer Reset, DB-Lint, 353 pgTAP-Tests und lokaler
  API-E2E-Test. Lokal fehlt Docker; der GitHub-Ubuntu-Runner ist das Nachweis-Gate.

## Funktionale Security- und Privacy-Gates

- [x] Online-Registrierung zeigt Nutzungsbedingungen, Community-Regeln und
  Datenschutz; Zustimmung ist erforderlich und nicht vorangekreuzt.
- [x] Kontolöschung ist leicht auffindbar, verlangt Passwort plus `LÖSCHEN`
  und wird serverseitig nur für die frisch authentifizierte eigene UID erlaubt.
- [x] Datenexport, Datenschutz, Impressum, Bedingungen und Community-Regeln
  sind in **Konto & Einstellungen** erreichbar.
- [x] Normales Abmelden erhält Account-Caches; die zweite Abmeldeoption löscht
  nur lokale Daten des aktuellen Kontos.
- [x] Privacy-Freigaben sind standardmäßig aus und werden im Datenbank-Read-
  Model erzwungen.
- [x] Blockieren, Freundschaft entfernen und Melden sind getrennte Aktionen;
  destruktive Aktionen besitzen Bestätigungen.
- [x] Avatarbilder werden neu codiert, begrenzt und auf Typ/Metadaten geprüft.
- [x] Statisches Web bietet keine Online-Authentifizierung und liefert strikte
  Sicherheitsheader inklusive HSTS und `application/json` für `assetlinks.json`.

## Android-Artefakt (aus der aufgelösten Konfiguration verifiziert)

- [x] `applicationId de.lernzeit.app`, `versionCode`, `versionName 1.0.0`.
- [x] `targetSdkVersion` und `compileSdkVersion` 36, `minSdkVersion` 24.
- [x] ABIs `armeabi-v7a, arm64-v8a, x86, x86_64` – beide 64-Bit-Varianten
  vorhanden.
- [x] `android:allowBackup="false"`, `usesCleartextTraffic="false"`,
  `edgeToEdgeEnabled`, Hermes und neue Architektur aktiv.
- [x] `expo.useLegacyPackaging=false`: native Bibliotheken werden unkomprimiert
  und ausgerichtet verpackt, Voraussetzung für 16-KB-Page-Size.
- [x] Berechtigungen: nur `INTERNET`, `VIBRATE` und Legacy-Storage bis API 32.
  `CAMERA`, `RECORD_AUDIO`, `READ_MEDIA_VIDEO` und `SYSTEM_ALERT_WINDOW` werden
  per `tools:node="remove"` entfernt.
- [x] Deep Links: privater `lernzeit://auth/update-password` und verifizierter
  App Link auf der Betreiberdomain mit `autoVerify="true"`.

## Vor Produktionsfreigabe manuell

- [ ] Die 24 Betreiberangaben in der EAS-Umgebung `production` setzen; danach
  `npm run release:gate` und `npm run release:pages` ausführen.
- [ ] Migration und `delete-account` zuerst in Staging deployen; Ablauf in
  `docs/supabase-staging-deployment.md`.
- [ ] Staging-E2E mit zwei Konten: falsches Passwort, abgelaufener Token,
  Origin-Angriff, Avatarreste, Ownership-Transfer, Wiederholung und lokale
  Daten mehrerer Konten.
- [ ] Rechtstexte durch den Verantwortlichen freigeben lassen. Das Repository
  erzwingt die Vollständigkeit, ersetzt aber keine rechtliche Prüfung.
- [ ] `public/` auf der Betreiberdomain hosten und die Header extern
  verifizieren.
- [ ] `assetlinks.json` mit echtem Play-App-Signing-Fingerprint erzeugen
  (`ANDROID_SHA256_CERT_FINGERPRINTS=... npm run release:pages`) und die
  Verifikation per `adb shell pm get-app-links de.lernzeit.app` prüfen.
- [ ] Supabase Redirect-Allowlist ohne Wildcards; E-Mail-Bestätigung, Auth-
  Limits, CAPTCHA, SMTP, Security Advisor, Logs, Backups/Restore und Alarme.
- [ ] GitHub Secret Scanning, Push Protection und Private Vulnerability
  Reporting aktivieren; echte Security-Adresse in `SECURITY.md` eintragen.
- [ ] Branch Protection für `main` mit den Required Checks aus
  `docs/github-branch-protection.md`.
- [ ] Moderate `uuid`-Advisory mit jedem Expo-SDK-Update erneut bewerten; kein
  brechendes `npm audit fix --force`.
- [ ] Play Data Safety deckt E-Mail, Profil, Avatar-URL, Lern-, Noten- und
  Zieldaten, Presence, Social, Meldungen, lokale Speicherung, Export und
  Löschung ab.
- [ ] Signiertes Release-AAB auf echtem Smartphone und Tablet testen: Signup,
  Recovery, Offline/Sync, Kontowechsel, Avatar-Race, Export, Block/Meldung,
  beide Abmeldewege und Kontolöschung.
