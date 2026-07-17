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
- kontogetrennte lokale Persistenz

## Starten

```bash
npm install
npm start
```

Die App lässt sich danach mit Expo Go auf Android oder im Browser mit `npm run web` öffnen.

Beim ersten Start stehen zwei Wege zur Verfügung:

1. **Lokales Profil:** funktioniert sofort und speichert Profil und Lernfortschritt nur auf diesem Gerät.
2. **Supabase-Konto:** aktiviert echte Anmeldung, Registrierung, Passwort-Reset und Session-Wiederherstellung.

## Supabase konfigurieren

Kopiere `.env.example` nach `.env` und trage die öffentlichen Projektwerte ein:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://dein-projekt.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=dein-oeffentlicher-anon-key
```

Anschließend Expo neu starten. Ohne beide Werte bleiben Online-Kontoaktionen deaktiviert; die App meldet das klar und simuliert keine Anmeldung. Ein Service-Role-Key gehört niemals in die App.

Die Oberfläche für eine Kontolöschung ist vorbereitet, bleibt aber deaktiviert, bis eine geschützte serverseitige Löschfunktion eingerichtet wurde.

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
