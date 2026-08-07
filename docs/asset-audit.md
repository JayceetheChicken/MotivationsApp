# Asset-Audit für den Google-Play-Release

## Eingebundene Platzhalter

| Zweck | Aktuelle Datei / Konfiguration | Befund |
|---|---|---|
| Allgemeines App-Icon | `assets/images/icon.png`, 1024 × 1024 | Expo-Template-Symbol, kein Lernzeit-Branding |
| Android Vordergrund | `assets/images/android-icon-foreground.png`, 512 × 512 | Expo-Template-Symbol |
| Android Hintergrund | `assets/images/android-icon-background.png`, 512 × 512 | Expo-Template-Konstruktionsraster |
| Android monochrom | `assets/images/android-icon-monochrome.png`, 432 × 432 | Monochromes Expo-Template-Symbol |
| iOS Icon-Set | `assets/expo.icon/` | Expo-Template-Komposition; für Android nicht relevant, aber ebenfalls nicht final |
| Web-Favicon | `assets/images/favicon.png`, 48 × 48 | Expo-Template-Symbol |
| Splashscreen | `expo-splash-screen`, nur Hintergrund `#B44D2B` | Technisch verwendbar, Markenentscheidung offen |

Diese Dateien bleiben eingebunden, weil ihre ersatzlose Entfernung native und
Web-Builds beschädigen würde. Sie sind keine finalen Markenassets und blockieren
die Veröffentlichung.

## Sicher entfernte, ungenutzte Template-Dateien

Die Referenzsuche in App-Konfiguration und Quellcode ergab keine Verwendung.
Entfernt wurden Expo-Badges/-Logo, `logo-glow`, alle drei React-Logos,
`tutorial-web.png`, die alten Home-/Explore-Tabicons und das ungenutzte
`splash-icon.png`.

## Vom Nutzer noch bereitzustellen

- finales **1024 × 1024** App-Icon als PNG, ohne improvisiertes Template-Logo
- adaptive Android-Ebenen: finale Vordergrundebene mit Safe-Zone und passende
  Hintergrundfarbe oder Hintergrundebene
- finales monochromes Android-Icon für Themed Icons
- finales **512 × 512** Play-Store-Icon als PNG (maximale Dateigröße gemäß
  aktueller Play-Console-Vorgabe prüfen)
- finale **1024 × 500** Feature-Grafik
- aktuelle Smartphone-Screenshots der Release-App in den von Google Play
  akzeptierten Formaten und Seitenverhältnissen
- Tablet-Screenshots für die tatsächlich unterstützten Tablet-Klassen
- Entscheidung, ob der einfarbige Splash final ist; andernfalls finales
  Splash-Konzept und bei Bedarf Web-Favicon

Nach Austausch müssen transparente Ränder/Safe-Zone, Maskenformen, Dark-/Light-
Launcher, monochrome Darstellung und die Play-Console-Vorschau auf realen
Android-Geräten geprüft werden.
