# Supabase: Staging-Deploy und Produktionsfreigabe

Verbindlicher Ablauf, um Migrationen, Edge Functions und Auth-Konfiguration
zuerst in einem **eigenen Staging-Projekt** zu verifizieren und erst danach in
Produktion zu übernehmen.

Alles hier Beschriebene ist eine **externe Aktion** am Supabase-Projekt. Nichts
davon wurde aus diesem Repository heraus ausgeführt.

## 0. Voraussetzungen

- Zwei getrennte Supabase-Projekte: `lernzeit-staging` und `lernzeit-prod`.
  Niemals gegen Produktion testen.
- Supabase CLI in exakt der Version aus `package.json` (`supabase@2.109.1`),
  damit lokale Läufe und CI identisch sind.
- Docker für den lokalen Stack.
- Zugriff auf die Access-Token-Verwaltung; das Token nur als Umgebungsvariable
  setzen, niemals in eine Datei im Repository schreiben.

```bash
export SUPABASE_ACCESS_TOKEN='<persönliches Access Token>'
```

## 1. Lokal verifizieren, bevor irgendetwas hochgeladen wird

```bash
supabase start
supabase db reset --local
supabase db lint --local --level warning
supabase test db
```

Anschließend der API-E2E-Test gegen den lokalen Stack:

```bash
eval "$(supabase status -o env)"
export API_URL ANON_KEY SERVICE_ROLE_KEY
npm run test:supabase:e2e
```

Alle vier Schritte müssen fehlerfrei sein. Genau diese Schritte laufen auch in
`.github/workflows/supabase.yml`.

## 2. Migrationen nach Staging

```bash
supabase link --project-ref <STAGING_REF>
supabase db diff --linked --schema public,private   # muss leer sein
supabase db push --linked --dry-run                 # zeigt genau die geplanten Migrationen
supabase db push --linked
```

`db diff` darf **vor** dem Push nichts ausgeben. Eine Ausgabe bedeutet, dass am
Staging-Projekt manuell etwas geändert wurde; das ist zuerst zu klären.

Nach dem Push:

```bash
supabase db lint --linked --level warning
supabase inspect db bloat --linked   # optional, Zustandskontrolle
```

Im Dashboard zusätzlich den **Security Advisor** und den **Performance Advisor**
aufrufen. Beide müssen ohne offene Errors sein; Warnungen sind zu begründen.

## 3. Edge Function und Secrets

Secrets zuerst, damit die Function nie ohne Konfiguration live geht:

```bash
supabase secrets set --project-ref <STAGING_REF> \
  ALLOWED_BROWSER_ORIGINS=""
```

| Secret | Wert | Bemerkung |
| --- | --- | --- |
| `SUPABASE_URL` | automatisch gesetzt | nicht überschreiben |
| `SUPABASE_SERVICE_ROLE_KEY` | automatisch gesetzt | existiert nur in der Function-Laufzeit |
| `ALLOWED_BROWSER_ORIGINS` | leer lassen | Der Web-Build bietet keine Online-Anmeldung. Nur setzen, wenn später wirklich ein Browser-Client existiert; dann kommagetrennte, exakte Origins ohne Wildcard. |

Deploy:

```bash
supabase functions deploy delete-account --project-ref <STAGING_REF>
supabase functions list --project-ref <STAGING_REF>
```

`supabase/config.toml` setzt für diese Function `verify_jwt = false`, weil
Publishable Keys nicht über den Gateway-JWT-Check laufen. Die Function
validiert den Nutzer-Token selbst, prüft die feste Bestätigung `DELETE` und
verlangt ein `iat`-Alter von höchstens fünf Minuten. Vor dem Produktions-Deploy
ist zu prüfen, dass dieser Wert im Dashboard übereinstimmt.

### Rauchtest gegen Staging

Kein Produktionskonto verwenden. Mit einem Wegwerf-Testkonto:

1. Registrieren, E-Mail bestätigen, anmelden.
2. Profilbild hochladen, Freundschaft, Gruppe, gemeinsames Ziel anlegen.
3. Datenexport erzeugen.
4. Konto in der App löschen.
5. Danach in Staging prüfen: `auth.users` ohne diese UID, keine Objekte unter
   `avatars/<uid>/`, keine Zeilen mehr in `public.profiles`, übertragene
   Gruppen haben einen neuen `creator_id`.

Fehlerfälle, die ebenfalls zu testen sind: abgelaufener Token (älter als fünf
Minuten), falsches Passwort, doppelter Aufruf, Aufruf für ein bereits
gelöschtes Konto, Netzwerkabbruch während des Aufrufs.

## 4. Auth-Konfiguration in Staging und Produktion

Diese Werte stehen bewusst **nicht** in `supabase/config.toml`. Die Datei
konfiguriert ausschließlich den lokalen Stack.

| Einstellung | Sollwert |
| --- | --- |
| Site URL | `https://<betreiber-domain>` |
| Redirect-Allowlist | genau `lernzeit://auth/update-password?type=recovery` und `https://<betreiber-domain>/update-password?type=recovery`. Keine Wildcards, kein `*`. |
| E-Mail-Bestätigung | **aktiviert** („Confirm email“). Lokal ist sie aus, damit Tests ohne SMTP laufen. |
| Secure email change | aktiviert (doppelte Bestätigung) |
| Minimale Passwortlänge | mindestens 10, passend zu `supabase/config.toml` |
| Leaked-password-Schutz | aktiviert |
| JWT-Gültigkeit | 3600 Sekunden |
| Refresh-Token-Rotation | aktiviert, Reuse-Interval 10 Sekunden |
| CAPTCHA | hCaptcha oder Turnstile für Sign-up, Sign-in und Password-Recovery aktivieren |
| Anonyme Anmeldungen | deaktiviert |
| Aktivierte Provider | nur E-Mail/Passwort |

### SMTP

Der eingebaute Supabase-Mailer ist stark rate-limitiert und nicht für
Produktion vorgesehen. Vor dem Release ein eigenes SMTP hinterlegen:

- Absenderadresse auf der Betreiberdomain, mit SPF, DKIM und DMARC.
- Nach der Umstellung Zustellung von Registrierungsbestätigung,
  Passwort-Reset und E-Mail-Änderung real testen (auch Spam-Ordner).
- Die Reset-Vorlage muss auf `lernzeit://auth/update-password?type=recovery`
  beziehungsweise die HTTPS-Variante zeigen.

### Rate Limits

Mindestens einstellen und dokumentieren:

| Endpunkt | Empfehlung |
| --- | --- |
| Sign-up / Sign-in | 30 pro Stunde und IP |
| Password recovery | 5 pro Stunde und IP |
| E-Mail-Versand | am SMTP-Kontingent ausrichten |
| Token-Refresh | Standardwert belassen |

Zusätzlich greifen die anwendungsseitigen Limits aus
`private.rpc_rate_limits` für Freundschaftsanfragen, Meldungen und Suche.

## 5. Storage

- Bucket `avatars` existiert mit der Policy aus
  `supabase/migrations/20260718000500_avatar_storage.sql` und den Härtungen aus
  `20260726000200_social_realtime_avatar_hardening.sql`.
- Upload-Limit und erlaubte MIME-Typen im Dashboard gegenprüfen.
- Der Bucket ist lesbar über schwer erratbare Pfade. Das ist in der
  Datenschutzerklärung so beschrieben und muss so bleiben oder dort geändert
  werden.

## 6. Backups, Logs und Aufbewahrung

- Automatische tägliche Backups aktivieren. Auf dem Free-Plan gibt es keine
  Point-in-Time-Recovery; falls PITR benötigt wird, ist ein bezahlter Plan
  erforderlich. Diese Entscheidung ist zu dokumentieren.
- Mindestens einmal eine Wiederherstellung in ein Wegwerf-Projekt testen.
- Aufbewahrungsdauer der Logs im Dashboard ablesen und exakt so in
  `EXPO_PUBLIC_LOG_RETENTION_POLICY` eintragen. Der Wert erscheint wörtlich in
  der Datenschutzerklärung, er darf nicht geschätzt werden.
- Zugriff auf Dashboard und Logs auf die tatsächlich verantwortlichen Personen
  begrenzen und MFA erzwingen.

## 7. Produktionsübernahme

Erst wenn Staging vollständig grün ist:

```bash
supabase link --project-ref <PROD_REF>
supabase db diff --linked --schema public,private   # muss leer sein
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy delete-account --project-ref <PROD_REF>
```

Danach Abschnitt 4 bis 6 identisch für das Produktionsprojekt durchführen und
`EXPO_PUBLIC_SUPABASE_URL` sowie `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in der
EAS-Umgebung `production` auf das Produktionsprojekt setzen.

Abschließend:

```bash
npm run release:gate
```

## Rollback

Migrationen sind vorwärtsgerichtet geschrieben. Ein fehlgeschlagener Push wird
durch eine neue, korrigierende Migration behoben, nicht durch manuelles
Zurücksetzen im Dashboard. Für einen Datenverlust ist das Backup aus Abschnitt 6
die einzige vorgesehene Wiederherstellung.
