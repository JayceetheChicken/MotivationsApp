# Abschlussbericht: Security- und Google-Play-Release-Hardening

Stand: 31. Juli 2026

## Release-Einstufung

Der Branch `codex/final-release-hardening` ist auf Quellcodeebene geprüft und
als Integrationsstand geeignet. Er ist **noch nicht end-to-end releasefähig**:
die restriktive Forward-Migration und die Kontolösch-Function sind nicht
deployed, die Rechtstexte enthalten Pflichtplatzhalter, das öffentliche HTTPS-
Hosting fehlt, die Markenassets sind Platzhalter und ein finales AAB wurde
auftragsgemäß nicht erzeugt oder geprüft. Eine Veröffentlichung ist damit
weiterhin ausdrücklich blockiert.

## 1. Erledigt

| Priorität | Bereich | Ergebnis |
|---|---|---|
| P0 | Social Realtime | Zugriff auf `social:user:<uid>` ist auf die eigene UID begrenzt; Freundschaft gewährt keinen Topic-Zugriff; authentifizierte Clients erhalten keine INSERT-Policy. |
| P0 | Realtime-Client | Aktueller JWT wird vor privater Channel-Erstellung gesetzt; Token-/Repositorywechsel, Logout und Unmount räumen Channels auf; Topic-Registry verhindert Duplikate; ein kontrollierter Retry degradiert auf eine freundliche UI-Meldung. |
| P0 | Supabase-Fehler | Technische PostgREST-, Realtime- und Storage-Ursachen bleiben in internen Entwicklungslogs und erscheinen nicht roh im UI. |
| P0 | Kontolöschung | Zweistufige In-App-Bestätigung, geschützter Function-Client, serverseitiger Admin-Pfad, Avatarbereinigung, Auth-Löschung, lokale Cache-/Outbox-Bereinigung und Gastmodus sind implementiert und getestet. |
| P1 | Supabase-Konfiguration | Externe URLs erfordern HTTPS; HTTP ist nur für explizite lokale Hosts zulässig; Secret-/Service-Role-Schlüssel werden als App-Key abgelehnt. |
| P1 | CI | Neuer minimal berechtigter GitHub-Workflow für `npm ci`, Typecheck, Jest, Lint und Expo Doctor; bestehender Supabase-Workflow bleibt erhalten. |
| P1 | Repository-Hygiene | Private Codex-Screenshots im aktuellen Tree und eindeutig ungenutzte Expo-/React-Assets entfernt; Ignore-Regeln für Anhänge, Umgebungsdateien, Service-Accounts und Keystores ergänzt. |
| P1 | Lizenz | Irreführende Root-Template-Lizenz entfernt; notwendiger Expo-/650-Industries-Hinweis ist klar abgegrenzt in `THIRD_PARTY_NOTICES.md` erhalten. |
| P1 | Release-Konfiguration | `eas.json` erzeugt im Production-Profil ein AAB, nutzt Remote-Versionierung, `autoIncrement`, die Umgebung `production` und höchstens internen Draft-Submit. |
| P1 | SDK-Abhängigkeiten | Expo-/React-Native-Pakete sind auf die von Expo Doctor erwarteten SDK-57-Patchstände angeglichen; die Jest-Preset-Version folgt React Native 0.86.2. |
| P2 | Rechtliche Seiten | Mobile Expo-Web-Routen `/datenschutz` und `/konto-loeschen` sowie deutsche redaktionelle Entwürfe sind implementiert. |
| P2 | Assets | Alle referenzierten und ungenutzten Template-Assets sind inventarisiert; finale erforderliche Formate und Abmessungen sind dokumentiert. |

## 2. Technisch vorbereitet, aber noch zu deployen

| Priorität | Artefakt | Noch erforderliche Abnahme |
|---|---|---|
| P0 | `20260731000100_social_realtime_own_inbox_only.sql` | In einer kontrollierten Supabase-Umgebung anwenden und pgTAP/RLS mit mehreren echten Nutzern prüfen. Remote ist derzeit nur bis `20260729000200` angewandt. |
| P0 | `supabase/functions/delete-account/` | Edge Function deployen und mit Testkonto, Avatar, Social-/Lerndaten, ungültigem JWT, Storage-Fehler und erneutem Aufruf testen. |
| P0 | Rechtliche Webrouten | Platzhalter ausfüllen, rechtlich freigeben, Webausgabe erzeugen und beide Seiten unter stabilen öffentlichen HTTPS-URLs hosten. |

## 3. Manuell vom Repository-Inhaber zu erledigen

| Priorität | Aufgabe |
|---|---|
| P0 | Verantwortlichen, ladungsfähige Anschrift, Kontakt, Rechtsgrundlagen, Aufbewahrung, Supabase-Vertragspartner/-Region/-Transfers, Logkonzept und Aufsicht in der Datenschutzerklärung verbindlich festlegen. |
| P0 | Finale Lernzeit-Markenassets liefern: 1024×1024 App-Icon, adaptive Ebenen, monochromes Icon, 512×512 Store-Icon, 1024×500 Feature-Grafik sowie Smartphone- und Tablet-Screenshots. |
| P0 | EAS-Projekt verknüpfen, Production-Publishable-Werte setzen und Android-Signing/Credentials kontrollieren; niemals einen Service-Role-Key als `EXPO_PUBLIC_*` setzen. |
| P1 | GitHub-Sichtbarkeit `public` oder `private` und eine eventuelle Lizenz für den eigenen App-Code bewusst entscheiden. |
| P1 | Support-Adresse, Reviewer-Demo-Konto, Zielgruppe, Länder, Preisentscheidung und alle Play-Console-Formulare einschließlich Data Safety/Kontolösch-URL ausfüllen. |
| P1 | Separat entscheiden, ob die privaten Anhänge nach der dokumentierten Sicherungs- und Koordinationsprozedur aus der gesamten Git-Historie entfernt werden sollen. |

## 4. Verbleibende Release-Blocker

1. Backend-Migration und Edge Function sind nicht deployed oder gegen die
   Zielumgebung end-to-end getestet.
2. Datenschutz- und Kontolöschseiten sind weder final ausgefüllt/rechtlich
   freigegeben noch per HTTPS veröffentlicht.
3. App-/Store-Icons und Store-Grafiken sind noch Expo-Template-Platzhalter oder
   fehlen.
4. EAS-Projekt-ID, Production-Environment und Android-Signing wurden mangels
   ausdrücklicher Freigabe nicht eingerichtet beziehungsweise abgefragt.
5. Ohne finales AAB bleiben Signatur, 64-Bit-ABIs, 16-KB-Page-Size-Kompatibilität
   und Play-Console-Gerätekompatibilität unbewiesen.
6. Play-Console-Einrichtung, Data Safety, Zielgruppe, Reviewer-Zugang und
   vorgeschriebene Testphasen sind offen.
7. Die privaten Screenshots sind aus dem aktuellen Branch entfernt, aber ohne
   History-Rewrite weiterhin in älteren Git-Objekten vorhanden.

## 5. Ausgeführte Qualitätsprüfungen

| Prüfung | Ergebnis |
|---|---|
| `npm ci --no-audit --no-fund --loglevel=error` | Bestanden; 1.119 Pakete aus dem finalen Lockfile installiert. |
| `npm run typecheck` | Bestanden. |
| `npm test -- --runInBand` | Bestanden; 34/34 Suites, 285/285 Tests. |
| `npm run lint` | Bestanden, ohne Warnungen. |
| `npx.cmd expo-doctor` | Bestanden; 20/20 Checks. |
| `deno fmt --check supabase/functions` | Bestanden. |
| `deno lint supabase/functions` | Bestanden. |
| `deno check supabase/functions/delete-account/index.ts` | Bestanden. |
| `git diff --check` | Bestanden. |
| Secret-Mustersuche in getrackten Dateien | Keine eingecheckten Secret-/Service-Role-Werte gefunden. |
| `supabase migration list --linked` | Gelesen; lokal/remote gleich bis `20260729000200`, neue Migration `20260731000100` nur lokal. |

### Analysierte npm-Audit-Hinweise

`npm audit --omit=dev` meldet weiterhin 36 transitive Findings (25 high,
11 moderate), obwohl der normale, nicht-brechende `npm audit fix` ausgeführt
wurde. Die von npm vorgeschlagenen verbleibenden Fixes würden inkompatibel auf
Jest 25 beziehungsweise Expo 46/`expo-splash-screen` 55 zurückgehen und wurden
deshalb nicht erzwungen.

- Die High-Meldungen beziehen sich auf `brace-expansion`. Der produktnahe
  Expo-Pfad ist auf die gepatchte Version `5.0.9` aktualisiert. Die verbleibenden
  Test-/Lint-Pfade verwenden den am 30. Juli 2026 veröffentlichten Backport
  `1.1.18`; dessen installierter Quellcode enthält den
  `EXPANSION_MAX_LENGTH`-Schutz gegen CVE-2026-14257. Die derzeitigen
  Audit-Metadaten nennen trotzdem pauschal alle Versionen `<=5.0.7` als
  betroffen und markieren den Backport daher weiterhin.
- Die Moderate-Meldungen betreffen `uuid@7.0.3` ausschließlich über Expos
  Build-Time-Abhängigkeit `xcode@3.0.1`. `xcode` ruft nach lokaler Quellprüfung
  nur `uuid.v4()` auf; die Advisory betrifft die Buffer-APIs v3, v5 und v6,
  nicht v4. Ein ungeprüfter Major-Override auf UUID 11 wurde nicht erzwungen.

Primärquellen: [CVE-2026-14257 / brace-expansion](https://github.com/advisories/GHSA-mh99-v99m-4gvg),
[CVE-2026-41907 / uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
Die Upstream-Pakete und Audit-Metadaten sind vor dem finalen AAB erneut zu
prüfen.

Nicht ausgeführt wurden `supabase start`, `supabase db reset`, lokaler DB-Lint,
pgTAP und Supabase-E2E, weil kein erreichbarer Docker-Daemon vorhanden ist. Das
ist ein offener Verifikationspunkt und kein stillschweigend ignorierter Erfolg.
Ebenfalls nicht ausgeführt wurden Webexport/Hosting, `eas init`, EAS Build,
Google-Play-Upload, Submit oder Veröffentlichung.

## 6. Erst nach ausdrücklicher Freigabe auszuführende Befehle

Backend nach Review, vorzugsweise zuerst gegen Staging:

```bash
npx supabase migration up --linked
npx supabase functions deploy delete-account --project-ref <SUPABASE_PROJECT_REF>
```

Lokale Supabase-Gesamtprüfung auf einem Rechner mit laufendem Docker:

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:lint
npm run test:db
npm run test:supabase:e2e
```

EAS erst nach Assets, Rechtsfreigabe, Backend-E2E und Environment-Einrichtung:

```bash
npx.cmd eas-cli@latest init
npx.cmd eas-cli@latest build --platform android --profile production
```

`eas submit` oder ein Upload in die Play Console ist bewusst nicht Teil dieser
Befehlsliste und erfordert eine weitere ausdrückliche Freigabe.

Der optionale History-Rewrite ist separat und destruktiv; seine vollständige
Sicherungs-, Prüf- und Force-Push-Anleitung steht in
`docs/repository-history-cleanup.md`.

## Nächste drei Schritte

1. Migration und Edge Function nach Review zuerst in Staging deployen und den
   Lösch-/Realtime-Pfad mit mehreren Testkonten end-to-end prüfen.
2. Alle Datenschutzplatzhalter verbindlich ausfüllen, rechtlich freigeben und
   Datenschutz-/Kontolöschseite unter stabilen HTTPS-URLs hosten.
3. Finale Markenassets bereitstellen, EAS-Projekt/Production-Environment/Signing
   einrichten und danach mit separater Freigabe ein AAB zur binären 16-KB- und
   Play-Console-Prüfung erzeugen.
