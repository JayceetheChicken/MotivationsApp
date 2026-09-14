# Android-APK mit echtem Supabase

## Build und Artefakt

Workflow: `.github/workflows/android-apk.yml` → **Android APK** → **Run workflow**.
Artefaktname: **Lernzeit-preview-APK**. Im heruntergeladenen ZIP:
`Lernzeit-preview.apk` und `Lernzeit-preview.apk.sha256`.
Pfad auf dem Runner: `dist/Lernzeit-preview.apk`.

Die APK ist eine signierte Preview mit eingebettetem JavaScript; sie benötigt
weder Expo Go noch Metro. Der vorhandene Expo-Debug-Signierschlüssel wird für
diese interne Preview verwendet. Sie ist kein Play-Store-Release. Bei einem
späteren Schlüsselwechsel muss eine bereits installierte Version deinstalliert
werden; dabei gehen noch nicht synchronisierte Gerätedaten verloren.

Der Workflow setzt `EXPO_PUBLIC_REQUIRE_SUPABASE=1`, `EXPO_PUBLIC_BUILD_PROFILE=preview`
und `EAS_BUILD_PROFILE=preview`. Das EAS-Profil `preview` setzt denselben
Online-Zwang. Fehlende, nicht öffentliche oder projektfremde Schlüssel brechen
die Config-Auflösung ab. Der Workflow prüft zusätzlich das erreichbare echte
Backend und verweigert die Ausgabe bei einem pausierten oder unvollständigen
Projekt. Alle vorhandenen Production-Gates bleiben erhalten.

Vor Anmeldung wird kein Lernspeicher geöffnet. Gastmodus und lokale Profile
sind für diese APK gesperrt. Nach Anmeldung dient der kontogetrennte lokale
Speicher nur als Cache und Warteschlange für echte Supabase-Daten. Netzwerkfehler
schalten nicht auf ein lokales Repository um. Nicht synchronisierte Änderungen
sind über den vorhandenen Sync-Status erkennbar. Social-Schreibzugriffe gehen
immer an Supabase; es gibt keine simulierten Freunde oder Ersatzantworten.

## Externe Konfiguration

### Aktuell ausgewähltes Projekt

Projekt **MotivationsApp**, Ref **owoifhueznnsmwbrazmq**, Region **eu-west-1**.
Bei der Prüfung am 14.09.2026 meldete die Supabase-CLI `INACTIVE`; die API-Domain
hatte keinen DNS-Eintrag. Das Projekt muss zuerst im Dashboard mit **Restore
project** reaktiviert werden. Kein neues Projekt und keinen anderen Key raten.

### GitHub

Repository → Settings → Secrets and variables → Actions → Variables:

| Name | Wert/Stand |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://owoifhueznnsmwbrazmq.supabase.co`; bereits gesetzt |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | vorhandener, als `anon` validierter Projekt-Key; bereits gesetzt |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | optional: Publishable Key desselben Projekts als Ersatz setzen, danach Anon-Variable entfernen |

Der Workflow akzeptiert auch gleichnamige Actions-Secrets; diese haben Vorrang
vor Variables. Ein alter Secret-Wert muss daher entfernt/aktualisiert werden.
Diese Client-Keys sind öffentlich und werden zwangsläufig in die APK eingebettet.
**Keine** `service_role`-, `sb_secret_*`-, DB-, SMTP-, Expo- oder privaten
Signierschlüssel als `EXPO_PUBLIC_*` setzen. Für diesen GitHub-Gradle-Build sind
weder EAS-Zugangsdaten noch private Supabase-Zugangsdaten erforderlich.

### Migrationen, RLS, Realtime, Storage und Edge Function

Nach Reaktivierung, aus diesem Checkout mit der installierten CLI:

```sh
npx supabase migration list --linked
npx supabase db push --linked --dry-run
# Vor Anwendung die Liste prüfen; alle 16 Repository-Migrationen sind erforderlich.
npx supabase db push --linked
npx supabase db lint --linked --level warning
npx supabase functions deploy delete-account --project-ref owoifhueznnsmwbrazmq
npx supabase functions list --project-ref owoifhueznnsmwbrazmq
```

Bei einer Passwortabfrage das DB-Passwort nur interaktiv eingeben. Nicht im
Repository speichern. Auf dem gehosteten Projekt **kein** `db reset`, kein
`seed.sql` und keine lokalen Testdaten ausführen. Die letzte Migration muss
`20260809000100_final_release_security_hardening.sql` sein. Drift vor dem Push
gegen die geplanten Migrationen prüfen; siehe `supabase-staging-deployment.md`.

Im SQL Editor `supabase/verify-hosted.sql` ausführen. Die Kommentare geben für
jede Ergebnismenge den Sollzustand an. Zusätzlich Security Advisor prüfen.
Keine Policies manuell öffnen und keine direkte Client-Schreibberechtigung
vergeben. `private` gehört nicht zu den exponierten API-Schemas.

- **Realtime** aktivieren. Private Broadcast-Kanäle nutzen `social:user:<eigene UID>`
  mit der migrierten `social_user_can_receive`-Policy. Kein fremder UID-Kanal,
  keine Client-INSERT-Policy, keine zusätzliche Freigabe privater Tabellen für
  Postgres Changes nötig.
- **Storage**: migrierter Bucket `avatars`, public, 5 MiB, `image/jpeg`,
  `image/png`, `image/webp`; Upload nur im eigenen UUID-Pfad, höchstens 100
  Objekte pro Konto, Löschsperre erhalten. Bereits bekannte öffentliche
  Avatar-URLs bleiben nach Abschalten der Social-Freigabe erreichbar; das ist
  das bestehende Produktverhalten, kein Zugriff auf private Lerndaten.
- **Edge Function**: Nur `delete-account` ist vorgesehen. Social-Funktionen
  laufen über Datenbank-RPCs, nicht über fehlende Social-Edge-Functions.
  `verify_jwt=false` aus `supabase/config.toml` beibehalten: die Function prüft
  das Benutzer-JWT selbst und verlangt frische Passwort-Reauthentifizierung.
  `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` existieren ausschließlich in
  der Supabase-Function-Laufzeit. `ALLOWED_BROWSER_ORIGINS` leer lassen.

### Auth-Dashboard und E-Mails

- E-Mail/Passwort und neue Registrierungen aktivieren, **Confirm email an**,
  anonyme Anmeldungen aus, Secure email change an, Mindestpasswortlänge 10.
- Eigenes SMTP mit verifizierter Absenderdomain konfigurieren. Zustellung an
  beide echten Test-Adressen prüfen; der Standardmailer reicht nicht für
  beliebige externe Empfänger.
- Site URL: eigene erreichbare HTTPS-Seite für die Registrierungsbestätigung.
  Registrierung bestätigt die E-Mail im Browser; anschließend in der APK
  normal anmelden. Der Client behandelt Registrierungscodes ausdrücklich
  nicht als Passwort-Recovery-Capability.
- Für diese Preview exakt
  `lernzeit://auth/update-password?type=recovery` zur Redirect-Allowlist des
  **Testprojekts** hinzufügen, ohne Wildcards. Im Production-Projekt bleibt
  ausschließlich der verifizierte HTTPS-App-Link aus PR #5 erlaubt.
  Falls das ausgewählte Projekt bereits Produktion enthält, die Preview
  stattdessen auf ein getrenntes Staging-Projekt konfigurieren.
- Reset-E-Mail-Vorlage verwendet `{{ .ConfirmationURL }}`; keine direkte
  Token-Weitergabe an die App. Reset auf demselben Handy öffnen, das ihn
  angefordert hat (PKCE). Vorher abmelden.
- JWT-Gültigkeit 3600 Sekunden, Refresh-Rotation an, Reuse-Intervall 10 Sekunden.
  Auth-/E-Mail-Limits passend zum Kontingent konfigurieren und nachprüfen.
  Leaked-password-Schutz einschalten, soweit der Plan ihn anbietet.
- Kein CAPTCHA im Dashboard einschalten, solange der native CAPTCHA-Token-Flow
  fehlt; eine bereits bestehende CAPTCHA-Anforderung nicht zur Fehlerbehebung
  abschalten, sondern den Client-Flow separat implementieren.

Die lokale `supabase/config.toml` ändert diese Dashboard-Werte **nicht**.
Production benötigt weiterhin die vollständigen Betreiberangaben, eigene
Domain, App-Link-Verifikation und Production-Signierung aus PR #5.

## Test mit zwei Handys

1. Dieselbe APK auf Handy A und B installieren, Installation aus dieser Quelle
   erlauben. Unterschiedliche Netze verwenden, z. B. WLAN und Mobilfunk.
   Ohne Anmeldung dürfen keine lokalen Lernfunktionen erreichbar sein.
2. Zwei unterschiedliche E-Mail-Adressen und eindeutige Benutzernamen
   registrieren, Regeln akzeptieren, beide E-Mails bestätigen und anmelden.
   App beenden/neu öffnen und nach längerer Hintergrundzeit wieder öffnen:
   jeweiliges Konto und Daten müssen erhalten bleiben.
3. Auf beiden Geräten die gewünschten Social-Freigaben und Auffindbarkeit
   einschalten. A sucht den exakten Benutzernamen von B, sendet eine Anfrage;
   B sieht sie ohne Neustart und akzeptiert. Beide sehen die Freundschaft.
4. Profilname/Avatar ändern. Eine Gruppe, eine gemeinsame Session und ein
   gemeinsames Lernziel erstellen; B jeweils einladen und annehmen lassen.
   Session starten, pausieren, fortsetzen, abschließen. Fortschritt muss auf
   beiden Geräten aktualisiert werden. Ein privates Fach, Noten und Notizen
   von A dürfen bei B nicht erscheinen.
5. Bei B Präsenz/Statistik-/Fortschrittsfreigaben ausschalten. A darf die
   entsprechenden Werte nicht mehr erhalten. B blockiert A: Suche,
   Kontaktaufnahme und bisherige Social-Ansichten müssen das berücksichtigen.
   Entblockieren und eine neue Freundschaft bei Bedarf erneut annehmen.
6. Flugmodus einschalten: Social-Aktionen dürfen keinen falschen Erfolg melden.
   Persönliche Änderungen bleiben erkennbar ausstehend. Nach Netzrückkehr
   synchronisieren, dann dasselbe Konto auf dem anderen Gerät anmelden und
   die Daten prüfen. Kontowechsel darf keine Daten des vorherigen Kontos zeigen.
7. Passwort-Reset am anfordernden Handy testen. Datenexport prüfen. Ein eigens
   dafür angelegtes Wegwerfkonto mit Passwortbestätigung löschen; im Dashboard
   muss es samt eigenen Daten/Avataren entfernt sein. Fremde Daten dürfen
   weiterhin bestehen.

## Automatische Prüfungen

Der APK-Workflow verlangt die unveränderten vollständigen pgTAP-/API-Tests
gegen einen echten, isolierten Supabase-Stack. Zusätzlich prüft der API-Test
nun zwei echte WebSocket-Verbindungen: Zustellung an die eigene Inbox und
Ablehnung einer fremden Inbox. Das sind unabhängige Auth-Sitzungen und echte
Postgres/RLS/Realtime-Dienste, keine Datenbank-Mocks. Der Teststack wird nicht
in die APK übernommen.

Typecheck, vollständige Jest-Suite, Lint, Expo Doctor, Lizenzinventar,
Install-Script-Policy, Dependency-Audit, Deno-Prüfungen, native Manifestprüfung,
APK-Signaturprüfung und Secret-/Backend-Scan sind verbindlich. Die bisherigen
CodeQL-, Gitleaks- und OSV-Workflows bleiben aktiv. Der Erfolg dieser Prüfungen
ersetzt keine erfolgreich protokollierte Zwei-Handy-Abnahme des gehosteten
Backends.
