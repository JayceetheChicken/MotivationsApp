# Lernzeit

Lernzeit ist ein lokaler, interaktiver MVP einer motivierenden Lern-App für Android-Smartphones und -Tablets. Im Mittelpunkt stehen persönliche Ziele, zuverlässig gemessene Fokus-Sessions und der freiwillige Vergleich mit bestätigten Freunden.

## Enthalten

- Session-Timer mit Fachauswahl, Pause, Fortsetzen und Wiederherstellung nach einem Neustart
- manuelle Lernzeiteinträge mit dauerhaft sichtbarer Herkunftskennzeichnung
- Wochen- und Monatsziele für Lernzeit oder Anzahl konzentrierter Sessions
- Statistiken für Zeiträume, Fächer, Streak, Durchschnitt und Vorperiodenvergleich
- privater Freundesvergleich ausschließlich mit automatisch gemessenen Minuten
- gemeinsame Challenge ohne öffentliche Rangliste
- Datenschutzschalter pro freigegebener Kennzahl
- responsive Smartphone- und Tablet-Layouts sowie Light/Dark Mode
- lokale Persistenz über Expo SQLite; im Browser über `localStorage`

## Starten

Voraussetzung ist eine aktuelle Node.js-Version.

```bash
npm install
npm start
```

Danach kann die App mit Expo Go auf einem Android-Gerät geöffnet werden. Für die Browser-Vorschau:

```bash
npm run web
```

## Qualität prüfen

```bash
npm run typecheck
npm run lint
```

## Projektstruktur

- `src/app` – Routen, Tabs und Formulare
- `src/state` – lokaler App-State, Timeraktionen und Persistenz
- `src/lib` – Statistik- und Formatierungslogik
- `src/data` – datum-relative Demodaten
- `src/components` – wiederverwendbare, barrierearme UI-Bausteine
- `src/theme` – responsives Light/Dark-Designsystem

## MVP-Grenzen

Konten, echte Freundesanfragen und geräteübergreifende Synchronisation benötigen als nächsten Schritt ein Backend. Der spätere Android-Fokusmodus mit Benachrichtigungsreduktion oder App-Einschränkungen ist bewusst noch nicht Teil dieses MVPs.
