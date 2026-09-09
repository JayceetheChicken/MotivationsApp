# Lernzeit

Lernzeit ist eine responsive Expo-/Android-App für persönliche Lernziele, zuverlässig gemessene Fokus-Sessions und motivierendes gemeinsames Lernen im privaten Freundeskreis. Der Erststart ist vollständig leer: Es gibt keine Beispielkonten, Fächer, Sessions, Ziele, Freunde oder Challenges.

## Lizenzstatus

Für den eigenen Lernzeit-Anwendungscode ist derzeit keine allgemeine
Open-Source-Lizenz erteilt. Die frühere Expo-Template-`LICENSE` wurde entfernt,
weil sie fälschlich wie eine Lizenz für das Gesamtprojekt wirkte. Rechtlich
erforderliche Hinweise für Expo-/Template- und Drittbestandteile bleiben in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) erhalten. Der
Repository-Inhaber muss die gewünschte Lizenzierung und die derzeit öffentliche
GitHub-Sichtbarkeit ausdrücklich bestätigen.

## Funktionen

- Timer-Sessions mit Fachauswahl, Pause, Fortsetzen und Wiederherstellung
- Schutzdialog für Sessions unter einer Minute und Prüfung ungewöhnlich langer Timer
- manuelle Lernzeiteinträge mit dauerhaft sichtbarer Herkunft
- Wochen-, Monats- und Jahresziele für Lernzeit oder Sessionanzahl
- Zielbearbeitung, Pause/Fortsetzung, Abschluss, Archiv und Löschung
- interaktive Wochen-, Monats- und Jahresdiagramme
- Statistiken für Lernzeit, Sessions, Durchschnitt, Fächer, Ziele, Streaks und Vorperioden
- exakte Freundessuche per eindeutigem Benutzernamen sowie Anfragen, Annahme, Ablehnung und Entfernen
- kompakte Freundesprofile mit Lernstatus, letzter allgemeiner Aktivität, Wochenzeit und Streak
- gemeinsame Tages- oder Wochenziele pro Person oder als Team mit serverseitig berechnetem Fortschritt
- private Lerngruppen mit ausdrücklich zugeordneten Zielen und Sessions
- planbare oder sofort startende gemeinsame Lern-Sessions mit Status und Dauer pro Teilnehmer
- strikte Trennung: Fächer, Aufgaben, Notizen, Noten und private Sessionverläufe werden nie im Social-Bereich ausgegeben
- Smartphone-/Tablet-Layouts im durchgängig hellen Retro-Design (kein Dark Mode)
- lokaler Gaststart ohne Anmeldung sowie kontogetrennte Persistenz bei freiwilliger Kontoverbindung

## Starten

```bash
npm install
npm start
```

Die App lässt sich danach mit Expo Go auf Android oder im Browser mit `npm run web` öffnen.

Beim ersten Start öffnet sich Lernzeit sofort als vollständig nutzbare Gast-App. Fächer,
Lernzeiten, Noten, Ziele und Einstellungen werden ohne Konto lokal auf dem Gerät
gespeichert. Über **Konto & Einstellungen → Konto & Synchronisierung** kann später freiwillig
ein lokales Profil erstellt oder ein Supabase-Konto verbunden werden. Vorhandene
lokale Lerninhalte werden dabei nicht gelöscht. Nach einer Importvorschau und ausdrücklicher
Bestätigung werden Fächer, Lernzeiten, persönliche Ziele und Noten idempotent in das Konto
übertragen. Lokale Freundschaften, Challenges und Freigaben werden nicht als Vertrauen oder
Einwilligung in die Cloud übernommen.

## Supabase konfigurieren

Kopiere `.env.example` nach `.env.local` und trage die öffentlichen Projektwerte ein:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://dein-projekt.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dein-öffentlicher-publishable-key
```

`EXPO_PUBLIC_SUPABASE_ANON_KEY` wird für bestehende Umgebungen vorübergehend als
Fallback unterstützt. Ein Service-Role-Key gehört niemals in die App.

Anschließend Expo neu starten. Ohne beide Werte bleiben nur die freiwilligen
Cloud-Kontoaktionen deaktiviert; der Gastmodus und lokale Profile funktionieren
vollständig weiter. Social-Funktionen sind ausschließlich mit einem Supabase-Konto verfügbar.

## Betreiberangaben und Release-Gate

Alle rechtlich verpflichtenden Betreiberangaben sind in
[`config/operator-fields.json`](./config/operator-fields.json) beschrieben und
werden ausschließlich über `EXPO_PUBLIC_*`-Variablen gesetzt.

```bash
npm run release:report   # zeigt jedes Feld und seinen aktuellen Zustand
npm run release:gate     # erzwingt exakt das, was ein Production-Build prueft
npm run release:pages    # erzeugt Kontoloeschseite und assetlinks.json
```

Entwicklungsbuilds laufen mit klar gekennzeichneten Testwerten auf der
reservierten `.invalid`-TLD. Ein Production-Build bricht ab, solange eine
Pflichtangabe fehlt oder noch ein Platzhalter ist. Details in
[`docs/operator-configuration.md`](./docs/operator-configuration.md).

## Marken-Assets

Icons, Splash, Favicon und Play-Grafiken werden reproduzierbar aus einer
Geometriedefinition erzeugt, ohne native Bildbibliothek:

```bash
npm run assets:build
npm run assets:build -- --check
```

### Lokale Datenbank

Docker muss laufen. Danach können Schema, RLS, RPCs und pgTAP-Tests lokal geprüft werden:

```bash
npm run supabase:start
npm run supabase:reset
npm run supabase:lint
npm run test:db
npm run types:db
```

Migrationen unter `supabase/migrations` sind die einzige Quelle für Schemaänderungen.
`src/types/database.generated.ts` wird aus der lokalen Datenbank erzeugt und nicht von Hand
gegen ein Remote-Dashboard synchronisiert.

## Qualität prüfen

```bash
npm ci
npm run verify        # sensitive files, release report, typecheck, tests, lint, licences, expo-doctor
npm run test:db       # benoetigt Docker
npm audit --omit=dev --audit-level=high
```

`npm run verify` fasst die Repository-Gates zusammen. Zusätzlich prüfbar:

```bash
npm run assets:build -- --check
npm run licenses:check
node scripts/check-exported-bundle.mjs dist
```

Vor einem Produktions- oder Play-Store-Release ist zusätzlich die
[`PLAY_STORE_SECURITY_CHECKLIST.md`](./PLAY_STORE_SECURITY_CHECKLIST.md)
vollständig abzuarbeiten. Sie trennt automatisierte Nachweise von den noch im
Supabase-Dashboard, bei der Domain und in Google Play zu erledigenden Gates.

## Projektstruktur

- `src/app` – Auth-Flows, Tabs, Modale und Formulare
- `src/auth` – Supabase-Konfiguration, sichere Sessionablage und Validierung
- `src/state` – zentrale UI-/Domain-Fassade und kontogetrennter App-State
- `src/data/repositories` – austauschbare lokale und Supabase-Persistenz
- `src/services/sync` – Outbox, Konfliktbehandlung und bestätigter lokaler Import
- `src/services/realtime` – private Invalidierungen gemeinsamer Zielfortschritte
- `src/lib` – Ziel-, Timer-, Diagramm- und Statistiklogik
- `src/data` – Initialzustand, Mapper und Repository-Adapter
- `src/components` – wiederverwendbare, barrierearme UI-Bausteine
- `src/theme` – zentrales warmes Retro-/70er-Designsystem (nur helles Theme)
- `supabase` – versionierte PostgreSQL-Migrationen, Seed und pgTAP-Tests
- `__tests__` – Domain-, Store-, Repository-, Realtime- und Responsive-Tests

## Spätere Erweiterung

Der Android-Fokusmodus mit Benachrichtigungsreduktion, App-Wechsel-Erfassung oder Einschränkung ausgewählter Apps ist bewusst nicht Teil des aktuellen Kerns.
