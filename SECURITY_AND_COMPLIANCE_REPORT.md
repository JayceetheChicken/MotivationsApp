# Security- und Compliance-Abschlussbericht

Stand: 2. August 2026
Branch: `codex/final-release-hardening`

## Ergebnis und Release-Einstufung

Die technisch im Repository umsetzbaren Security-, Datenschutz- und
Google-Play-Kontrollpunkte sind implementiert. Die App besitzt nun einen
vollständigen, re-authentifizierten Kontolöschpfad, kontogetrennte lokale
Bereinigung, serverseitige Privacy-Projektionen, Blockieren/Melden,
service-role-only Moderation, Community-Zustimmung und JSON-Datenexport.

Ein Produktionsrelease bleibt blockiert, bis Backend und Edge Function in
Staging/Produktion deployed, die Platzhalterdomain ersetzt, Android App Links
verifiziert, Rechtstexte freigegeben, Betreiber-/Aufbewahrungsangaben ergänzt
und ein signiertes AAB praktisch abgenommen wurden.

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
| `npm test -- --runInBand` | Bestanden: 37 Suites, 348 Tests |
| `npm run lint` | Bestanden ohne Fehler oder Warnungen |
| `npx expo-doctor` | Bestanden: 20/20 Checks |
| Expo Web-Export | Bestanden: 67 statische Routen |
| `deno fmt --check supabase/functions` | Bestanden |
| `deno lint supabase/functions` | Bestanden |
| `deno check supabase/functions/delete-account/index.ts` | Bestanden |
| `node scripts/check-sensitive-files.mjs` | Bestanden |
| `npm audit --omit=dev --audit-level=high` | Bestanden; 12 Moderate, keine High/Critical |
| `git diff --check` | Bestanden |
| Supabase Reset/Lint/pgTAP/API-E2E | Bestanden im GitHub-Ubuntu-Workflow: frischer Reset, DB-Lint, 353 pgTAP-Tests und lokaler API-E2E-Test. Lokal ist auf diesem Windows-Rechner kein Docker-Daemon installiert/erreichbar. |

Der transitive Moderate-Befund betrifft `uuid@7.0.3` über Expos Build-Time-
Abhängigkeit `xcode`; npm bietet nur einen brechenden Downgrade-Pfad an. Kein
ungeprüftes `--force` wurde ausgeführt. Vor dem finalen AAB erneut prüfen.

## Manuelle Supabase-, Domain- und Play-Schritte

1. Migration und Function zuerst in Staging deployen; `ALLOWED_BROWSER_ORIGINS`
   auf die echte Domain setzen. Auth Redirect-Allowlist ohne Wildcards, E-Mail-
   Bestätigung, Passwort-/Recovery-Limits, CAPTCHA, SMTP, Security Advisor,
   Log-Retention und Backups prüfen.
2. `lernzeit.example.invalid`, Kontaktadresse und alle Rechtsplatzhalter
   ersetzen. Statische Löschseite und Header unter einer stabilen HTTPS-URL
   hosten.
3. `assetlinks.json` mit Paket `de.lernzeit.app` und echtem Play-App-Signing-
   Fingerprint ausliefern; Anleitung in `docs/web-auth-and-app-links.md`.
4. Datenschutz, Impressum, Bedingungen, Community-Regeln, Rechtsgrundlagen,
   Aufbewahrung, Supabase-Region/AVV/Transfers und Moderationsfristen rechtlich
   freigeben.
5. Play Data Safety, Kontolösch-URL, Zielgruppe, Reviewer-Zugang und
   Moderations-/Beschwerdeprozess ausfüllen; signiertes AAB auf echtem Android-
   Gerät testen.

## Bekannte Restrisiken

- Öffentliche Avatar-URLs bleiben nach Kenntnis der URL abrufbar.
- Lokale Expo-SQLite-Daten sind kontogetrennt und von Android-Backups
  ausgeschlossen, aber nicht mit einem eigenen App-Schlüssel verschlüsselt;
  ein kompromittiertes entsperrtes Gerät kann lokale Lerninhalte lesen.
- Rechtliche Angaben, Staging-/Produktionsdeployment, verifizierte Domain,
  reale Operatorprozesse und binäre AAB-Abnahme liegen außerhalb des
  Repositorys und bleiben Release-Gates.
