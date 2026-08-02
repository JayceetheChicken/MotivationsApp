# Google-Play-Release-Plan für Lernzeit

Stand: 31. Juli 2026

## Ziel und Abgrenzung

Dieser Plan fasst die Android-Veröffentlichung nach dem abschließenden
Security-, Datenschutz- und Release-Hardening zusammen. Das bestehende
UI-Design wurde nur für Kontolöschung und rechtliche Seiten erweitert. Es wurde
kein Build erzeugt oder hochgeladen und keine Veröffentlichung ausgelöst.

## 1. Release-Konfiguration: Ist-Stand

| Punkt | Gefundener Stand | Bewertung / nächste Aktion |
| --- | --- | --- |
| App-Name | `Lernzeit` in `app.json` | Technisch gesetzt. Vor dem Anlegen der Play-App endgültig bestätigen. Store-Titel darf höchstens 30 Zeichen haben. |
| Android-Paketname | `de.lernzeit.app` | Technisch gültig. Vor dem ersten AAB-Upload endgültig bestätigen; der Paketname ist danach dauerhaft an die Play-App gebunden. |
| Sichtbare Version | `1.0.0` | Für den Erst-Release plausibel. Nur ändern, wenn bewusst eine andere öffentliche Startversion gewünscht ist. |
| Android `versionCode` | Nicht lokal in `app.json` gesetzt | `eas.json` verwendet jetzt `appVersionSource: "remote"` und `autoIncrement: true`. EAS initialisiert den ersten Remote-Wert bei fehlendem lokalen Wert mit `1` und erhöht ihn bei weiteren Production-Builds. Vor dem ersten Build im EAS-Dashboard oder mit `eas build:version:get -p android` kontrollieren. |
| Allgemeines App-Icon | `assets/images/icon.png`, 1024 × 1024 | Technisch eingebunden, visuell aber ein Expo-Platzhalter. Vor Veröffentlichung durch ein endgültiges Lernzeit-Icon ersetzen. Für den Store zusätzlich eine 512 × 512 PNG-Datei mit höchstens 1 MB bereitstellen. |
| Adaptive Icon | Vordergrund, Hintergrund und Monochrom-Asset sind eingebunden | Technisch vollständig, visuell ebenfalls Expo-/Template-Material. Alle drei Ebenen vor dem Release durch die endgültige Lernzeit-Marke ersetzen und auf runden, squircle- und monochromen Masken prüfen. |
| Splashscreen | `expo-splash-screen` mit Hintergrund `#B44D2B` | Technisch gültiger einfarbiger Splashscreen ohne Bild. Das ungenutzte Expo-Template-`splash-icon.png` wurde entfernt. Vor Release bewusst bestätigen oder durch ein finales Lernzeit-Splashkonzept ersetzen. |
| Production-Profil | `eas.json` wurde ergänzt | Erzeugt explizit ein Android App Bundle, verwaltet `versionCode` remote und konfiguriert Submit nur für `internal` mit Status `draft`. |
| EAS-Projektverknüpfung | Kein `extra.eas.projectId` in `app.json` | Vor dem ersten Cloud-Build mit `npx eas-cli@latest init` beziehungsweise `eas init` verknüpfen. Dies wurde nicht ausgeführt. |
| Production-Umgebung | Supabase-Werte liegen lokal in einer ignorierten `.env.local` | Die Werte werden so nicht verlässlich in den EAS-Cloud-Build übernommen. `EXPO_PUBLIC_SUPABASE_URL` und der Publishable-/Anon-Key müssen im EAS-Environment `production` hinterlegt werden. Keine geheimen Service-Role-Keys in die App übernehmen. |
| Android-/Play-Kompatibilität | Expo SDK 57, React Native 0.86 | Expo SDK 57 kompiliert und zielt auf API 36 und unterstützt Android 7+. Damit ist die ab 31. August 2026 geltende Target-API-36-Anforderung abgedeckt. 64-Bit- und 16-KB-Page-Size-Kompatibilität müssen nach Erstellung am finalen AAB beziehungsweise in der Play Console bestätigt werden. |
| AAB | Noch nicht erstellt | Das Production-Profil erzeugt `.aab`. Der Build-Befehl ist vorbereitet, wurde aber nicht ausgeführt. |

Offizielle Referenzen: [Expo SDK 57 / Android API-Level](https://docs.expo.dev/versions/latest/), [EAS-App-Versionen](https://docs.expo.dev/build-reference/app-versions/), [EAS-Android-AAB](https://docs.expo.dev/build-reference/apk/), [Google-Play-Target-API](https://support.google.com/googleplay/android-developer/answer/11926878?hl=de), [16-KB-Page-Size](https://developer.android.com/guide/practices/page-sizes?hl=de).

## 2. Vorbereitete Befehle

Die angeforderten Befehle sind:

```bash
npx expo-doctor
eas build --platform android --profile production
eas submit --platform android
```

`npx.cmd expo-doctor` wurde im Hardening ausgeführt und bestand 20/20 Checks.
EAS Build und Submit wurden bewusst nicht ausgeführt. Auf diesem
Windows-System blockiert die PowerShell-Ausführungsrichtlinie `npx.ps1`; in
PowerShell funktionieren stattdessen die `.cmd`-Varianten, alternativ die
EAS-Befehle in `cmd.exe` ausführen:

```powershell
npx.cmd expo-doctor
npx.cmd eas-cli@latest build --platform android --profile production
npx.cmd eas-cli@latest submit --platform android
```

Wichtig: `eas submit` lädt tatsächlich zu Google Play hoch. Erst ausführen, wenn die Play-App angelegt, die Service-Account-Berechtigung eingerichtet und ein Upload ausdrücklich gewollt ist. Durch `track: "internal"` und `releaseStatus: "draft"` wird dabei keine öffentliche Produktionseinführung ausgelöst.

## 3. Exakte Reihenfolge bis zur öffentlichen Veröffentlichung

### Phase A – offene Release-Entscheidungen schließen

1. `Lernzeit` als endgültigen App-/Store-Namen bestätigen.
2. `de.lernzeit.app` endgültig bestätigen und sicherstellen, dass der Paketname noch nicht anderweitig in Google Play verwendet wird.
3. Version `1.0.0` als Erstversion bestätigen.
4. Endgültige Lernzeit-Icons erstellen und die vorhandenen Expo-Platzhalter ersetzen.
5. Festlegen, ob der Splashscreen bewusst nur die Farbe `#B44D2B` zeigen soll.
6. Datenschutzerklärung unter einer öffentlichen HTTPS-URL veröffentlichen.
7. Den im Repository vollständig implementierten In-App-Löschweg und `/konto-loeschen` nach Function-Deployment end-to-end testen; die externe Seite unter einer stabilen öffentlichen HTTPS-URL hosten und in der Play Console eintragen.
8. Dauerhaft nutzbaren Demo-Zugang für Google anlegen; idealerweise mit vorbereiteten Lerninhalten, Freundschaft, Gruppe, gemeinsamem Ziel und gemeinsamer Session.
9. Support-E-Mail, Zielgruppe, Länder/Regionen und die Entscheidung „kostenlos oder kostenpflichtig“ festlegen.
10. Store-Grafiken und Screenshots gemäß `store-listing-content.md` erstellen.

### Phase B – Google-Play-Developer-Konto anlegen

1. Mit dem vorgesehenen Inhaber-Google-Konto die [Play Console](https://play.google.com/console/signup) öffnen.
2. Developer Distribution Agreement und Play-Console-Bedingungen akzeptieren.
3. Einmalige Registrierungsgebühr von 25 USD zahlen.
4. Den korrekten Kontotyp wählen:
   - `Personal`, wenn eine natürliche Person veröffentlicht.
   - `Organization`, wenn die App rechtlich durch eine Organisation veröffentlicht wird; dafür können Organisationsnachweise und eine D-U-N-S-Nummer nötig sein.
5. Entwicklername, rechtlichen Namen/Anschrift, Kontakt-E-Mail und Telefonnummer vollständig und konsistent angeben.
6. Identität und Zahlungsprofil verifizieren. Bei einem neuen persönlichen Konto zusätzlich mit der Play-Console-Mobile-App ein reales Android-Gerät verifizieren.
7. Zwei-Faktor-Authentifizierung aktivieren und die Registrierungs-/Transaktionsbestätigung aufbewahren.

Quelle: [Google: Play Console einrichten](https://support.google.com/googleplay/android-developer/answer/6112435?hl=de).

### Phase C – neue App in der Play Console anlegen

1. Play Console öffnen und `Home > Create app` wählen.
2. Standardsprache `Deutsch (Deutschland)` wählen.
3. App-Name `Lernzeit` eintragen.
4. `App` und nicht `Game` auswählen.
5. `Free` oder `Paid` gemäß Geschäftsentscheidung auswählen; für den aktuellen Stand ohne Kauf-/Abo-Funktion ist `Free` naheliegend.
6. Öffentliche Support-E-Mail eintragen.
7. Richtlinien-, Export- und Play-App-Signing-Erklärungen bestätigen.
8. `Create app` wählen.
9. Vor dem ersten Bundle-Upload nochmals prüfen, dass die erwartete Application-ID `de.lernzeit.app` angezeigt wird.

Quelle: [Google: App erstellen und einrichten](https://support.google.com/googleplay/android-developer/answer/9859152?hl=de).

### Phase D – EAS einmalig vorbereiten

1. Bei Expo anmelden: `npx.cmd eas-cli@latest login`.
2. Projekt verknüpfen: `npx.cmd eas-cli@latest init`. Die dadurch erzeugte `extra.eas.projectId`-Änderung prüfen und versionieren.
3. Die beiden öffentlichen Supabase-Produktionswerte im EAS-Environment `production` hinterlegen.
4. Android-Build-Credentials mit `npx.cmd eas-cli@latest credentials --platform android` prüfen oder von EAS erzeugen lassen. Upload-Key sicher aufbewahren; Play App Signing verwenden.
5. Nur wenn EAS Submit genutzt werden soll: Google-Cloud-Service-Account erstellen, in der Play Console für die App autorisieren und den JSON-Key über EAS Credentials hochladen. Den JSON-Key niemals committen.

### Phase E – Diagnose und AAB erstellen

1. `npx.cmd expo-doctor` ausführen und alle roten Fehler beheben. Warnungen einzeln bewerten; keine pauschalen Paket-Upgrades kurz vor dem Release.
2. Remote-`versionCode` kontrollieren: `npx.cmd eas-cli@latest build:version:get -p android`.
3. Production-AAB erstellen:

   ```powershell
   npx.cmd eas-cli@latest build --platform android --profile production
   ```

4. Im EAS-Build-Detail prüfen: Paket `de.lernzeit.app`, Version `1.0.0`, eindeutiger `versionCode`, Profil `production`, Artefakt `.aab`.
5. AAB herunterladen und Prüfsumme/Build-Link im Release-Protokoll festhalten.

### Phase F – internen Test starten und Tester hinzufügen

1. In Play Console `Test and release > Testing > Internal testing` öffnen.
2. Im Tab `Testers` eine E-Mail-Liste anlegen; interne Tests erlauben bis zu 100 Google-/Workspace-Konten.
3. `Create new release` wählen.
4. Play App Signing aktivieren beziehungsweise den von Google erzeugten Signing-Key auswählen.
5. Das Production-AAB manuell hochladen. So bleiben erster Upload, Paketname und Play-Warnungen vollständig sichtbar und kontrollierbar.
6. Release-Name zum Beispiel `1.0.0 (1) – Internal` und die Hinweise aus `release-notes.md` eintragen.
7. Warnungen im Bundle Explorer prüfen, insbesondere Target API, 64-Bit, 16-KB-Page-Size, Berechtigungen und Gerätekompatibilität.
8. `Review release` und anschließend den Rollout für den internen Test starten. Dies ist noch keine öffentliche Veröffentlichung.
9. Opt-in-Link aus dem Tester-Tab kopieren und an die internen Tester senden.
10. Installation aus Google Play, Anmeldung/Gastmodus, Kernabläufe und Upgradepfad testen; Pre-Launch-Report auswerten.

Quelle: [Google: interne/geschlossene Tests](https://support.google.com/googleplay/android-developer/answer/9845334?hl=de), [Expo: manueller Android-Upload](https://docs.expo.dev/submit/android-manual/).

### Phase G – geschlossenen Test durchführen

1. `Test and release > Testing > Closed testing` öffnen und einen Track, zum Beispiel `production-candidate`, anlegen.
2. Tester per E-Mail-Liste oder Google Group hinzufügen. Für ein neues persönliches Entwicklerkonto mindestens 12, besser 15–20 verlässliche Tester einplanen.
3. Interne Tester müssen den internen Test verlassen und anschließend dem geschlossenen Test über dessen Opt-in-Link beitreten; sonst erhalten sie weiterhin den internen Track.
4. AAB aus dem internen Track in den geschlossenen Track promoten oder eine neue Release-Version mit höherem `versionCode` hochladen.
5. Geschlossenen Release ausrollen und Opt-in-Link verteilen.
6. Bei einem neuen persönlichen Konto sicherstellen, dass mindestens 12 Tester 14 Tage ohne Unterbrechung optiert bleiben. Der interne Test zählt dafür nicht.
7. Feedbackkanal bereitstellen und protokollieren: getestete Funktionen, Geräte/Android-Versionen, Probleme, Rückmeldungen und daraus abgeleitete Änderungen.
8. Test-Track aktiv lassen, bis Produktionszugriff erteilt wurde.

Quelle: [Google: Testanforderungen für neue persönliche Konten](https://support.google.com/googleplay/android-developer/answer/14151465?hl=de).

### Phase H – Produktionszugriff beantragen

Dieser Schritt ist zwingend für neue persönliche Konten; bei älteren persönlichen oder Organisationskonten kann die Play Console ihn nicht verlangen.

1. Nach erfüllten 12/14-Tagen zum `Dashboard` wechseln.
2. `Apply for production` wählen.
3. Abschnitt `About your closed test` ausfüllen:
   - Wie Tester gewonnen wurden.
   - Wie regelmäßig und umfassend sie die App benutzt haben.
   - Welches Feedback kam und über welchen Kanal es gesammelt wurde.
4. Abschnitt `About your app/game` ausfüllen:
   - Konkrete Zielgruppe.
   - Nutzerwert von Lernzeit.
   - Realistische erwartete Installationen im ersten Jahr.
5. Abschnitt `Production readiness` ausfüllen:
   - Änderungen aus Testerfeedback.
   - Begründung, warum die App produktionsreif ist.
6. Antrag absenden. Google nennt normalerweise bis zu sieben Tage, in Einzelfällen länger.
7. Bei Ablehnung den genannten Testmangel beheben und den geschlossenen Test fortsetzen.

### Phase I – Produktionsrelease und Prüfung

1. Erst fortfahren, wenn alle Punkte in `play-store-checklist.md` grün beziehungsweise abgeschlossen sind.
2. Länder/Regionen sowie Verfügbarkeit/Preis festlegen.
3. `Test and release > Production` öffnen und `Create new release` wählen.
4. Den freigegebenen AAB aus dem Test-Track promoten oder ein neues Production-AAB mit höherem `versionCode` auswählen.
5. Release-Name und Versionshinweise aus `release-notes.md` eintragen.
6. Play-Warnungen, unterstützte Geräte und App-Bundle-Details nochmals prüfen.
7. `Review release` wählen und anschließend `Start rollout to production` beziehungsweise `Send for review` bestätigen.
8. Im Publishing Overview prüfen, ob noch Änderungen ausdrücklich zur Prüfung gesendet werden müssen.
9. Falls Managed Publishing aktiv ist: Nach Googles Freigabe zusätzlich `Publish changes` wählen. Ohne diesen Schritt bleibt die genehmigte Version zurückgehalten.
10. Nach Veröffentlichung Store-Seite, Installation und Login/Gastmodus auf einem nicht als Tester registrierten Google-Konto prüfen.

## 4. Bereits fertig

- App-Name, Slug, Paketname und sichtbare Version sind in `app.json` gesetzt.
- Expo SDK 57 / React Native 0.86 zielt auf Android API 36.
- Allgemeines Icon, Adaptive-Icon-Ebenen und Splash-Hintergrund sind technisch konfiguriert.
- Ein Production-Profil für AAB und automatisch eindeutige `versionCode`s ist in `eas.json` vorhanden.
- EAS Submit ist bewusst auf internen Draft-Upload begrenzt.
- Entwürfe für Store-Texte und Versionshinweise liegen in `docs/` vor.

## 5. Was noch fehlt

- Endgültige Bestätigung von Name, Paketname und Version.
- Finale Lernzeit-Icons statt der Expo-Platzhalter.
- Entscheidung über den farbigen Splashscreen.
- EAS-Projektverknüpfung und Production-Environment-Variablen.
- Production-AAB; `expo-doctor` bestand im Hardening 20/20 Checks.
- Play-Developer-Konto und vollständig angelegte Play-App.
- Support-E-Mail, veröffentlichte Datenschutzerklärung und externe Kontolöschseite.
- Deployment und End-to-End-Test der implementierten Edge Function `delete-account`.
- Öffentliches HTTPS-Hosting der vorbereiteten Datenschutz- und Kontolöschseiten.
- Reviewer-Demo-Konto mit stabilen Zugangsdaten.
- Feature-Grafik sowie Smartphone- und Tablet-Screenshots.
- Vollständig und wahrheitsgemäß ausgefüllte Play-Console-Formulare.
- Interner Test, geschlossener Test und gegebenenfalls Produktionszugriff.

## 6. Mögliche Release-Blocker

1. **Kontolöschung:** In-App-UI, Edge Function, serverseitige Löschmigration und statische Seite sind im Repository implementiert, aber die Function ist nicht deployed und die Seite nicht öffentlich gehostet.
2. **Datenschutz:** Die deutsche Entwurfsseite ist vorbereitet, enthält aber Pflichtplatzhalter, ist nicht rechtlich freigegeben und nicht öffentlich gehostet.
3. **Branding:** Die aktuellen App- und Adaptive-Icon-Dateien zeigen Expo-/Template-Material und sind nicht als finale Lernzeit-Marke geeignet.
4. **Reviewer-Zugang:** Für kontogebundene Social-Funktionen fehlen dauerhaft gültige Demo-Zugangsdaten.
5. **EAS Cloud:** Projekt-ID und Production-Environment fehlen; dadurch kann der Cloud-Build unvollständig konfiguriert sein.
6. **Persönliches Entwicklerkonto:** Bei einem neuen Konto erzwingen 12 Tester über 14 durchgehende Tage eine Mindestwartezeit vor dem Produktionsantrag.
7. **Finale Bundle-Prüfung:** 64-Bit-, 16-KB-Page-Size-, Signing- und Gerätekompatibilität können erst am erzeugten AAB abschließend bestätigt werden.
8. **PowerShell:** `npx.ps1` ist lokal durch die Ausführungsrichtlinie blockiert; `.cmd` oder `cmd.exe` verwenden.
