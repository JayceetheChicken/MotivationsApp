# Release-Verifikation: ausgeführte Prüfungen und Ergebnisse

Stand: 3. August 2026
Branch: `codex/release-ready-consolidation`

Diese Datei listet ausschließlich Prüfungen, die **tatsächlich ausgeführt**
wurden, mit ihrem echten Ergebnis. Nicht ausgeführte Schritte sind am Ende als
solche benannt.

## Lokal ausgeführt (Windows 11, Node 24.13.0, npm 11.6.2)

| Prüfung | Ergebnis |
| --- | --- |
| `node scripts/check-sensitive-files.mjs` | Bestanden, keine verbotenen Dateinamen im Index |
| `node scripts/check-release-config.mjs` | Entwicklungsmodus erkannt, 25 offene Pflichtangaben gemeldet |
| `node scripts/check-release-config.mjs --production` | Blockiert wie vorgesehen, Exit 1, alle 26 Blocker benannt |
| Gate mit vollständiger Produktionsumgebung | Bestanden, Exit 0 |
| `npx tsc --noEmit` | Bestanden |
| `npx jest --runInBand` | Bestanden: 37 Suites, 367 Tests |
| `npm run lint` | Bestanden, keine Fehler, keine Warnungen |
| `npx expo-doctor@1.20.1` | Bestanden: 20/20 |
| `npx expo config` ohne Betreiberangaben, Gate aktiv | Bricht ab, Exit 1 |
| `npx expo config` mit vollständiger Umgebung | Löst auf, Exit 0 |
| `node scripts/verify-expo-config.mjs` | Bestanden: `de.lernzeit.app`, Version 1.0.0, versionCode 1, targetSdk 36, minSdk 24, App-Links-Host `lernzeit-ci.de`, keine Platzhalter, keine Secret-Muster |
| `expo export --platform web` (Production) | Bestanden: 67 statische Routen |
| `node scripts/check-exported-bundle.mjs dist` | Bestanden: keine Secret-Muster, Betreiberangaben im Bundle nachweisbar |
| `node scripts/build-brand-assets.mjs --check` | Bestanden: alle 10 Assets reproduzierbar |
| `node scripts/build-third-party-notices.mjs --check` | Bestanden: 764 Pakete, 16 Lizenzausdrücke, 0 Copyleft, 0 unbekannt |
| `node scripts/build-public-pages.mjs` | Erzeugt Kontolöschseite und `assetlinks.json` |
| `npm audit --omit=dev --audit-level=high` | Bestanden, Exit 0 |
| `npm audit --omit=dev` | 12 moderate, 0 high, 0 critical; eine Ursache (`uuid`) |
| `git diff --check origin/main HEAD` | Bestanden |
| `deno fmt --check` in `supabase/functions` | Bestanden: 3 Dateien |
| `deno lint` in `supabase/functions` | Bestanden: 2 Dateien |
| `deno check --frozen delete-account/index.ts` | Bestanden |
| Gitleaks 8.28.0 über `--log-opts=--all` | Bestanden: 53 Commits, keine Funde |
| Gitleaks Gegentest mit echtem `sb_secret_`-Muster | Erkannt durch Regel `supabase-secret-key` |
| `npx expo prebuild --platform android --clean` | Bestanden, Manifest und Gradle geprüft |
| `./gradlew :app:bundleRelease` | **BUILD SUCCESSFUL in 56m 26s**, 591 Tasks, AAB mit 75 817 432 Byte (debug-signiert) |
| 16-KB-Alignment aller 100 `.so`-Dateien im AAB | Bestanden: `arm64-v8a` und `x86_64` durchgehend `0x4000` |
| Secret-Scan über 1280 Dateien im AAB | Bestanden: 0 Treffer |
| Manifestwerte im AAB | Bestanden: `de.lernzeit.app`, 1.0.0, versionCode 1, minSdk 24, targetSdk 36, `allowBackup=false`, `usesCleartextTraffic=false` |

## In GitHub Actions ausgeführt

| Workflow / Job | Ergebnis |
| --- | --- |
| App quality → Typecheck, tests, lint and Expo Doctor | Bestanden |
| App quality → Production release gate rejects placeholders | Bestanden (blockiert *und* akzeptiert korrekt) |
| App quality → Deno format, lint and typecheck | Bestanden |
| App quality → Static production export | Bestanden |
| CodeQL → javascript-typescript, `security-extended` | Bestanden |
| CodeQL → actions, `security-extended` | Bestanden |
| Secret scan (Gitleaks, vollständige Historie) | Bestanden |
| OSV dependency scan | Bestanden |
| Supabase database → Reset, lint, pgTAP, API-E2E | Bestanden (353 pgTAP-Tests). Ein Lauf schlug mit `error running container: exit 1` beim Container-Start fehl; das ist ein Infrastrukturfehler des Runners, kein Migrationsfehler. |

## Bewusst nicht ausgeführt

| Schritt | Grund |
| --- | --- |
| Supabase-Deploy nach Staging oder Produktion | Externe Zugangsdaten; Ablauf in `docs/supabase-staging-deployment.md` |
| `eas build --platform android --profile production` | Ein lokaler Release-AAB wurde erzeugt und vollständig geprüft, ist aber mit dem Debug-Keystore signiert. Ein hochladbares Artefakt erfordert den Play-Upload-Schlüssel aus EAS beziehungsweise Play App Signing |
| Play-Console-Aktionen | Externe Freigabe erforderlich |
| History-Rewrite mit `git filter-repo` | Erfordert Force-Push; Bewertung und Ablauf in `docs/repository-history-cleanup.md` |
| Gerätetests auf Smartphone und Tablet | Erfordert ein signiertes Artefakt; Matrix in `docs/functional-test-matrix.md` |
| Lokaler Supabase-Stack (`supabase db reset`, `test db`) | Auf diesem Rechner ist kein Docker installiert; der Ubuntu-Runner ist das Nachweis-Gate |

## Hinweis zur Build-Umgebung

Für den lokalen Android-Build wurden auf diesem Rechner die Android-SDK-Lizenzen
über `sdkmanager --licenses` akzeptiert und `platforms;android-36`,
`build-tools;36.0.0` sowie `platform-tools` installiert. Das betrifft nur die
lokale Entwicklungsumgebung, nicht das Repository.
