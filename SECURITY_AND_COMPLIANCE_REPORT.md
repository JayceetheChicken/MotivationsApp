# Security- und Compliance-Abschlussbericht

Stand: 3. August 2026
Branch: `codex/release-ready-consolidation` (Basis: `codex/final-release-hardening`)

## Ergebnis und Release-Einstufung

Die technisch im Repository umsetzbaren Security-, Datenschutz- und
Google-Play-Kontrollpunkte sind implementiert. Die App besitzt nun einen
vollständigen, re-authentifizierten Kontolöschpfad, kontogetrennte lokale
Bereinigung, serverseitige Privacy-Projektionen, Blockieren/Melden,
service-role-only Moderation, Community-Zustimmung und JSON-Datenexport.

Ein Produktionsrelease bleibt blockiert, bis Backend und Edge Function in
Staging/Produktion deployed, die realen Betreiberangaben gesetzt, Android App
Links verifiziert, Rechtstexte freigegeben und ein signiertes AAB praktisch
abgenommen wurden. Die Platzhalter sind nicht mehr nur dokumentiert, sondern
technisch erzwungen: ein Production-Build bricht ab, solange sie bestehen.

## Nachtrag 3. August 2026: erzwungene Konfiguration und Branding

| Bereich | Umsetzung |
|---|---|
| Betreiberkonfiguration | 24 Pflichtangaben in `config/operator-fields.json`; eine geteilte Validierung in `config/release-config.cjs` für App-Bundle, `app.config.js` und CI. |
| Release-Gate | `app.config.js` wirft bei unvollständiger Produktionsumgebung. EAS, `expo export` und `expo run:android` brechen damit ab. CI prüft Blockieren und Akzeptieren. |
| Rechtstexte | Impressum, Datenschutz, Bedingungen, Community-Regeln und Kontolöschseite lesen aufgelöste Werte statt Klammer-Platzhaltern. |
| Behobene stille Fehlerquelle | Metro inlined nur literale `process.env.EXPO_PUBLIC_X`-Zugriffe. Die vorherige berechnete Auflösung hätte trotz grünem Gate ein Bundle mit Entwicklungswerten erzeugt. Jetzt literal gelesen, durch Test und Export-Scan abgesichert. |
| App Links | Verifizierter Host wird aus `EXPO_PUBLIC_LEGAL_SITE_URL` abgeleitet; `assetlinks.json` wird aus derselben Quelle erzeugt. |
| Android | `versionCode`, `scheme`, Portrait-Orientierung, `blockedPermissions`, `targetSdk`/`compileSdk` 36, `minSdk` 24 über `expo-build-properties`. |
| Branding | Expo-Template-Icons vollständig ersetzt; komplettes Set reproduzierbar aus `scripts/build-brand-assets.mjs`, ohne native Abhängigkeit. |
| Lizenzen | `THIRD_PARTY_NOTICES.md` aus dem Produktionsbaum erzeugt: 764 Pakete, 16 Lizenzausdrücke, kein Copyleft, keine unbekannte Lizenz. |
| CI | Neue Jobs `release-gate`, `edge-functions` und `expo-export`; CodeQL zusätzlich für Workflows mit `security-extended`; OSV auch auf `push` und `schedule`; `persist-credentials: false`. |

## Behobene Befunde

| Bereich | Umsetzung |
|---|---|
| Recovery Deep Links | Exaktes Scheme/HTTPS-Host/Pfad/`type=recovery`, eindeutige Parameter, PKCE bevorzugt, manipulierte Tokenpaare und normale Login-Codes abgewiesen, Replay-Fingerprint und Schutz einer bestehenden Sitzung. |
| Kontolöschung | Passwort-Re-Authentifizierung derselben Nutzer-ID, maximal fünf Minuten alter JWT, Origin-Allowlist, rekursive Avatarbereinigung, service-role-only Datenvorbereitung, Auth-Löschung und kontospezifische lokale Bereinigung. |
| Gemeinsame Inhalte | Gruppen, Ziele und Sessions werden deterministisch auf verbleibende akzeptierte Mitglieder übertragen; leere Objekte werden gelöscht; private Daten und Teilnehmerreferenzen kaskadieren. |
| Gerätebereinigung | Zweite Abmeldeoption mit `ABMELDEN`; entfernt nur Study-State, Cache, Cursor, Outbox, Import- und Shared-Session-Schlüssel des aktuellen Kontos. |
| Privacy | Opt-in-Felder für Lernen, Pause, letzte Aktivität, heute, Woche, Streak, Avatar und Auffindbarkeit. Die Datenbank liefert bei fehlender Freigabe `null` oder eine neutrale Kategorie. |
| Safety/UGC | Getrennte Aktionen für Freundschaft entfernen und blockieren; Blockierungen verhindern Suche, neue Anfragen, direkte Einladungen und Presence. Ziele werden vor Meldung serverseitig validiert und Meldungen rate-limitiert. |
| Moderation | Status `open`, `reviewing`, `resolved`, `rejected`; service-role-only Maßnahmen `none`, `hide`, `remove`; keine Adminrechte im Client. |
| Community-Regeln | Nicht vorangekreuzte Zustimmung bei Registrierung, Version/Zeitpunkt serverseitig gespeichert und vor Profil-/Shared-Content-Uploads erzwungen. |
| Profilbilder | Vor Upload immer neu als JPEG codiert, maximal 1024 × 1024, Metadatenmarker abgewiesen, Signatur/MIME/Endung/Größe geprüft und zufällige UUID-Objekte beibehalten. |
| Web | Online-Konten im statischen Web-Build deaktiviert; Gastmodus bleibt. CSP, Frame-Schutz, MIME-Sniffing-, Referrer- und Permissions-Policy für statisches Hosting vorhanden. |
| Datenexport | Eigene Daten als lesbares JSON; keine Tokens, Rate-Limits, internen Moderationsnotizen oder privaten Fremddaten; temporäre Klartextdatei wird nach dem Teilen entfernt. |
| Git/CI | Sensible Dateinamen werden lokal/CI abgewiesen; Gitleaks, CodeQL, OSV-Scanner, npm Audit, App- und Supabase-Pipeline sind SHA-gepinnt beziehungsweise minimal berechtigt. |

## Geänderte Architektur und Dateien

- Auth und Löschung: `src/auth/navigation.ts`, `src/state/auth-store.tsx`,
  `src/auth/account-deletion.ts`, `supabase/functions/delete-account/index.ts`,
  `supabase/functions/_shared/delete-account.ts`.
- Privacy/Social/Export: `src/state/study-store.tsx`, Repository-Interfaces,
  Supabase-Repository, Mapper, Datenbanktypen, Freundeskomponenten,
  `src/lib/account-data-export.ts`.
- UGC-Oberfläche: Profil-, Freund-, Gruppen-, Shared-Goal-, Shared-Session- und
  Melderouten unter `src/app/`.
- Rechtliches/Web: `src/legal/`, neue Nutzungsbedingungen, Community-Regeln und
  Impressumsroute, `public/account-deletion/index.html`, `public/_headers`,
  `src/app/+html.tsx`.
- Supply Chain: `.github/workflows/`, `.github/dependabot.yml`, `.gitignore`,
  `scripts/check-sensitive-files.mjs`, `SECURITY.md`.
- Tests: Jest-Suites unter `__tests__/`, pgTAP-Inventare und
  `supabase/tests/008_privacy_moderation_deletion.sql`, erweiterte lokale API-
  E2E-Suite.

## Neue Migration

`supabase/migrations/20260802000300_privacy_moderation_export_deletion.sql`
legt granulare Privacy-Felder, Blockierungen, Regelzustimmungen und Meldungen
an; ersetzt die betroffenen Read Models/RPCs; erzwingt Block-/Community-Regeln;
stellt sicheren Export, Moderation und Löschvorbereitung bereit. Bestehende
veröffentlichte Migrationen wurden nicht rückwirkend verändert.

## Lösch- und lokale Datenregeln

Die exakte Reihenfolge, Transferauswahl, Cascade-Matrix, Idempotenzgrenzen und
lokale Schlüsselliste stehen in `docs/account-deletion.md`. Nach erfolgreicher
Online-Löschung startet die App ohne Profil als Gast. Daten anderer Konten und
der getrennte Gastbereich bleiben erhalten.

## Moderation und Datenschutz

`docs/moderation-workflow.md` beschreibt den Operatorweg ohne Admin-Dashboard
oder Client-Secret. Nur eigene sichere Meldungsprojektionen sind exportierbar.
Bestehende gemeinsame Gruppen bleiben auch zwischen blockierten Mitgliedern
erhalten, damit eine Blockierung keine Daten anderer löscht; direkte Social-
Interaktionen und Presence bleiben gesperrt.

Der Avatar-Bucket bleibt wegen bestehender URL-Architektur öffentlich. Das
Read Model gibt URLs nur nach Freigabe aus, verhindert aber nicht den Abruf
einer bereits bekannten URL. Ein privater Bucket würde signierte URL-
Erneuerung, Caching und Realtime-Projektionen in allen Social-Ansichten
erfordern und ist als spätere Architekturverbesserung dokumentiert.

## Repository- und Secret-Prüfung

- `.codex-remote-attachments/` ist im aktuellen Tree nicht getrackt und wird
  ignoriert. Zwei historische Screenshot-Anhänge sind weiterhin in alten
  Commits referenziert; die bewusst nicht ausgeführte Rewrite-Anleitung steht
  in `docs/repository-history-cleanup.md`.
- Die Dateinamenprüfung findet im aktuellen Index keine verbotenen `.env`-,
  Schlüssel-, Zertifikats-, Service-Account-, Datenbank- oder Attachment-
  Dateien. Eine dateinamenbasierte High-Signal-Mustersuche in allen
  erreichbaren Commits fand keinen privaten Schlüssel-/Tokenwert.
- Gitleaks scannt die vollständige erreichbare Historie in GitHub Actions; bei
  einem echten Fund sind betroffene Werte zuerst extern zu rotieren. Kein
  automatischer History-Rewrite wurde vorgenommen.

## Ausgeführte Prüfungen

| Befehl | Ergebnis |
|---|---|
| `npm run typecheck` | Bestanden |
| `npm test -- --runInBand` | Bestanden: 37 Suites, 367 Tests |
| `npm run lint` | Bestanden ohne Fehler oder Warnungen |
| `npx expo-doctor` | Bestanden: 20/20 Checks |
| Expo Production-Export | Bestanden: 67 statische Routen |
| `node scripts/check-release-config.mjs --production` | Blockiert ohne Betreiberangaben, besteht mit vollständiger Umgebung |
| `npx expo config` mit `LERNZEIT_RELEASE_GATE=1` | Bricht ohne Betreiberangaben ab, löst mit vollständiger Umgebung auf |
| `node scripts/verify-expo-config.mjs` | Bestanden: Paket, versionCode, targetSdk 36, minSdk 24, App-Links-Host, keine Platzhalter, keine Secret-Muster |
| `node scripts/check-exported-bundle.mjs dist` | Bestanden: keine Secret-Muster, Betreiberangaben nachweisbar im Bundle |
| `node scripts/build-brand-assets.mjs --check` | Bestanden: alle Assets reproduzierbar |
| `node scripts/build-third-party-notices.mjs --check` | Bestanden: 764 Pakete, kein Copyleft, keine unbekannte Lizenz |
| `npx expo prebuild --platform android` | Bestanden: Manifest und Gradle entsprechen der Konfiguration |
| `deno fmt --check supabase/functions` | Bestanden |
| `deno lint supabase/functions` | Bestanden |
| `deno check supabase/functions/delete-account/index.ts` | Bestanden |
| `node scripts/check-sensitive-files.mjs` | Bestanden |
| `npm audit --omit=dev --audit-level=high` | Bestanden; 12 Moderate, keine High/Critical |
| `git diff --check` | Bestanden |
| Supabase Reset/Lint/pgTAP/API-E2E | Bestanden im GitHub-Ubuntu-Workflow: frischer Reset, DB-Lint, 353 pgTAP-Tests und lokaler API-E2E-Test. Lokal ist auf diesem Windows-Rechner kein Docker-Daemon installiert/erreichbar. |

### Bewertung der verbleibenden Moderate-Befunde

`npm audit --omit=dev` meldet 12 moderate Befunde. Die Auswertung des
JSON-Reports zeigt genau **eine** Ursache:

- Advisory: `GHSA-w5hq-g745-h8pq`, `uuid` – fehlende Buffer-Bounds-Prüfung in
  v3/v5/v6, wenn `buf` übergeben wird.
- Betroffene Version im Baum: genau ein Eintrag, `node_modules/uuid@7.0.3`.
- Erreichbarkeit: ausschließlich über `@expo/config-plugins` → `xcode`. `xcode`
  wird nur von den **iOS**-Codepfaden von `@expo/config-plugins` verwendet
  (`build/ios/BundleIdentifier.js`, `build/ios/DevelopmentTeam.js`,
  `build/ios/utils/Xcodeproj.js`). Es handelt sich um Build-Zeit-Tooling.
- Die restlichen 11 Meldungen sind dieselbe Ursache, entlang der Kette nach oben
  gezählt.
- Im ausgelieferten JavaScript-Bundle ist das npm-Paket `uuid` **nicht**
  enthalten. Die dortigen `uuid`-Treffer stammen aus der eigenen
  `expo-modules-core`-Implementierung auf Basis von `crypto.randomUUID`.

Damit erreicht der Befund weder die Android-Laufzeit noch das Artefakt. npm
bietet nur einen brechenden Downgrade an; kein `npm audit fix --force` wurde
ausgeführt. Bei jedem Expo-SDK-Update erneut bewerten.

### Gitleaks über die vollständige Historie

Lokal mit Gitleaks 8.28.0 und `.gitleaks.toml` über alle Refs ausgeführt:

```text
gitleaks git --log-opts=--all --config=.gitleaks.toml --redact .
53 commits scanned. no leaks found.
```

Die Allowlist enthält ausschließlich drei exakte Literale synthetischer
Fixtures. Ein Gegentest mit einem realistisch geformten `sb_secret_`-Key wird
weiterhin von der neu ergänzten Regel `supabase-secret-key` gemeldet.

## Manuelle Supabase-, Domain- und Play-Schritte

1. Die 24 Betreiberangaben in der EAS-Umgebung `production` setzen; Feldliste
   und Anleitung in `docs/operator-configuration.md`. Danach
   `npm run release:gate` und `npm run release:pages`.
2. Migration und Function zuerst in Staging deployen; vollständiger Ablauf in
   `docs/supabase-staging-deployment.md` inklusive Redirect-Allowlist ohne
   Wildcards, E-Mail-Bestätigung, Rate Limits, CAPTCHA, SMTP, Security Advisor,
   Log-Retention und Backups.
3. `public/` auf der Betreiberdomain hosten. `assetlinks.json` mit dem echten
   Play-App-Signing-Fingerprint erzeugen
   (`ANDROID_SHA256_CERT_FINGERPRINTS=... npm run release:pages`) und die
   Verifikation per ADB prüfen; Anleitung in `docs/web-auth-and-app-links.md`.
4. Rechtstexte durch den Verantwortlichen freigeben lassen. Das Repository
   erzwingt die Vollständigkeit der Angaben, ersetzt aber keine rechtliche
   Prüfung.
5. Play Data Safety, Kontolösch-URL, Zielgruppe, Reviewer-Zugang und
   Moderations-/Beschwerdeprozess ausfüllen; signiertes AAB auf echtem
   Smartphone und Tablet testen.
6. Branch Protection und Secret Scanning nach `docs/github-branch-protection.md`
   aktivieren.

## Bekannte Restrisiken

- Öffentliche Avatar-URLs bleiben nach Kenntnis der URL abrufbar.
- Lokale Expo-SQLite-Daten sind kontogetrennt und von Android-Backups
  ausgeschlossen, aber nicht mit einem eigenen App-Schlüssel verschlüsselt;
  ein kompromittiertes entsperrtes Gerät kann lokale Lerninhalte lesen.
- Rechtliche Angaben, Staging-/Produktionsdeployment, verifizierte Domain,
  reale Operatorprozesse und binäre AAB-Abnahme liegen außerhalb des
  Repositorys und bleiben Release-Gates.
