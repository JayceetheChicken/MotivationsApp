# Lernzeit

Lernzeit ist eine responsive Expo-/Android-App für persönliche Lernziele, zuverlässig gemessene Fokus-Sessions und freiwillige Vergleiche im privaten Freundeskreis. Der Erststart ist vollständig leer: Es gibt keine Beispielkonten, Fächer, Sessions, Ziele, Freunde oder Challenges.

## Funktionen

- Timer-Sessions mit Fachauswahl, Pause, Fortsetzen und Wiederherstellung
- Schutzdialog für Sessions unter einer Minute und Prüfung ungewöhnlich langer Timer
- manuelle Lernzeiteinträge mit dauerhaft sichtbarer Herkunft
- Wochen-, Monats- und Jahresziele für Lernzeit oder Sessionanzahl
- Zielbearbeitung, Pause/Fortsetzung, Abschluss, Archiv und Löschung
- interaktive Wochen-, Monats- und Jahresdiagramme
- Statistiken für Lernzeit, Sessions, Durchschnitt, Fächer, Ziele, Streaks und Vorperioden
- freiwilliger privater Freundesvergleich und vorbereitete Challenges ohne öffentliche Rangliste
- zentrale Datenschutzfreigaben pro Kennzahl
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
lokale Lerninhalte werden dabei nicht gelöscht, sondern einmalig und ohne Duplikate
in den kontogetrennten Gerätespeicher übernommen.

## Supabase konfigurieren

Kopiere `.env.example` nach `.env` und trage die öffentlichen Projektwerte ein:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://dein-projekt.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=dein-oeffentlicher-anon-key
```

Anschließend Expo neu starten. Ohne beide Werte bleiben nur die freiwilligen
Cloud-Kontoaktionen deaktiviert; der Gastmodus und lokale Profile funktionieren
vollständig weiter. Ein Service-Role-Key gehört niemals in die App.

## Qualität prüfen

```bash
npm test
npm run typecheck
npm run lint
npx expo-doctor
```

## Projektstruktur

- `src/app` – Auth-Flows, Tabs, Modale und Formulare
- `src/auth` – Supabase-Konfiguration, sichere Sessionablage und Validierung
- `src/state` – kontogetrennter App-State, Timeraktionen und Persistenz
- `src/lib` – Ziel-, Timer-, Diagramm- und Statistiklogik
- `src/data` – ausschließlich leerer Initialzustand und Farbpalette
- `src/components` – wiederverwendbare, barrierearme UI-Bausteine
- `src/theme` – zentrales warmes Retro-/70er-Designsystem (nur helles Theme)
- `__tests__` – Domain-, Store-, Statistik-, Chart- und Responsive-Tests

## Spätere Erweiterung

Der Android-Fokusmodus mit Benachrichtigungsreduktion, App-Wechsel-Erfassung oder Einschränkung ausgewählter Apps ist bewusst nicht Teil des aktuellen Kerns.
