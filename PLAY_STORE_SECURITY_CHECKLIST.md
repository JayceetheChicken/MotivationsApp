# Play-Store-Sicherheitscheckliste

Stand: 2. August 2026

## Automatische Gates

- [x] TypeScript, 348 Jest-Tests und Expo-Web-Export bestehen lokal.
- [x] ESLint besteht ohne Fehler oder Warnungen.
- [x] Expo Doctor: 20/20.
- [x] Deno Format, Lint und Typecheck für die Kontolösch-Function.
- [x] Keine verbotenen sensiblen Dateinamen im aktuellen Git-Index.
- [x] Gitleaks, CodeQL und Dependency Review sind SHA-gepinnt und minimal
  berechtigt; Dependabot deckt npm und GitHub Actions ab.
- [ ] Supabase-CI nach diesem Push grün: Reset, DB-Lint, alle pgTAP- und lokalen
  API-E2E-Tests. Lokal fehlt Docker; der GitHub-Runner ist das Nachweis-Gate.

## Funktionale Security-/Privacy-Gates

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
  Sicherheitsheader-Konfiguration.

## Vor Produktionsfreigabe manuell

- [ ] Neue Migration in Staging/Produktion anwenden und `delete-account`
  deployen; keinen Service-Role-Key in Client/EAS/Expo-Variablen setzen.
- [ ] Staging-E2E mit zwei Konten: falsches Passwort, abgelaufener Token,
  Origin-Angriff, Avatarreste, Ownership-Transfer, Wiederholung und lokale Daten
  mehrerer Konten.
- [ ] Echte Betreiber-/Security-/Datenschutzkontakte, Anschrift,
  Rechtsgrundlagen, Aufbewahrungsfristen, Supabase-Region/AVV/Transfers,
  Hosting und Moderationsfristen rechtlich freigeben.
- [ ] Platzhalterdomain ersetzen; Kontolöschseite öffentlich per HTTPS hosten
  und alle CSP-/Security-Header extern verifizieren.
- [ ] `assetlinks.json` mit echtem Google-Play-App-Signing-Fingerprint
  veröffentlichen und App-Link-Verifikation per ADB testen.
- [ ] Supabase Redirect-Allowlist ohne Wildcards; E-Mail-Bestätigung, Auth-
  Limits, CAPTCHA, SMTP, Security Advisor, Logs, Backups/Restore und Alarme.
- [ ] GitHub Secret Scanning/Push Protection und Private Vulnerability Reporting
  aktivieren; echte Security-Adresse in `SECURITY.md` eintragen.
- [ ] Moderate `uuid`-Advisory mit aktuellem Expo-SDK erneut bewerten; keine
  brechenden `npm audit fix --force`-Downgrades.
- [ ] Play Data Safety deckt E-Mail, Profil, Avatar-URL, Lern-/Noten-/Zieldaten,
  Presence, Social, Meldungen, lokale Speicherung, Export und Löschung ab.
- [ ] Signiertes Release-AAB auf echtem Android testen: Signup, Recovery,
  Offline/Sync, Kontowechsel, Avatar-Race, Export, Block/Meldung, beide
  Abmeldewege und Kontolöschung.
