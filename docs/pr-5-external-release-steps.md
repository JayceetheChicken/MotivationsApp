# PR #5: Externe Schritte bis zur Veröffentlichung

Stand: 5. September 2026. Ein grüner PR bestätigt den Repository-Stand.
Die folgenden Betreiber-, Infrastruktur- und Store-Schritte wurden durch diese
Arbeit nicht durchgeführt. Ihr Abschluss ist vor Veröffentlichung gesondert
nachzuweisen. GitHub `main` wurde gelesen: Branch Protection ist deaktiviert,
Pflichtchecks sind leer, es wurden keine Rulesets zurückgegeben.

| Nr. | Externer Schritt | Konkreter Abschlussnachweis |
| --- | --- | --- |
| 1 | GitHub-Regeln für `main` aktivieren und unabhängigen Review organisieren | PR-Pflicht, sämtliche Checks aus `github-branch-protection.md`, Gesprächsauflösung, Force-Push-/Löschschutz und tatsächlicher Review durch eine zweite berechtigte Person. Kein Bypass als Ersatz. |
| 2 | Betreiber- und Rechtsangaben abschließend festlegen | Alle Pflichtwerte aus `config/operator-fields.json` rechtlich freigeben: Identität, Anschrift, Kontakte, Rechtsgrundlagen, Dienstleister/Region/AVV/Transfers, Logs/Aufbewahrung, Haftung und Freigabedatum. Support-, Datenschutz- und Abuse-Postfächer müssen erreichbar und betreut sein. |
| 3 | Produktionsdomain und HTTPS-Hosting einrichten | Unter der endgültigen Domain: `/impressum`, `/datenschutz`, `/nutzungsbedingungen`, `/community-regeln`, `/konto-loeschen`, `/account-deletion/` und `/update-password` sowie `/.well-known/assetlinks.json`. Öffentliche Seiten mit den echten Werten erzeugen/exportieren; echte HTTP-Header entsprechend `public/_headers` prüfen. `assetlinks.json` ohne Redirect und mit korrektem JSON-MIME-Typ ausliefern. |
| 4 | EAS-Projekt zuordnen und Produktionsumgebung befüllen | Expo-Konto/Projekt-ID verknüpfen; dabei erzeugte Konfiguration vor Nutzung prüfen/versionieren. Environment `production` mit allen Pflichtwerten, tatsächlicher Supabase-URL und ausschließlich öffentlichem Publishable-/Anon-Key befüllen. Keine Service-Role-, SMTP-, Signing- oder Google-Service-Account-Secrets unter `EXPO_PUBLIC_*`. Das Production-Gate muss mit diesen echten Werten bestehen. |
| 5 | Getrennte Supabase-Staging- und Produktionsprojekte vorbereiten | Gewünschte Region und Verträge dokumentieren; Migrationen zunächst in Staging prüfen/anwenden, danach Datenbanklint und Security Advisor prüfen. Bei Altbeständen alle `NOT VALID`-Constraints nach Datenbereinigung validieren. Backups und mindestens eine Wiederherstellung in ein isoliertes Projekt nachweisen. |
| 6 | Edge Function passend zu den Migrationen deployen | Nach den Migrationen `delete-account` deployen. Service-Role-Key bleibt serverseitig; `ALLOWED_BROWSER_ORIGINS` bleibt für den aktuellen nativen Client leer. Die alte Function während Versionsversatz nicht weiterbenutzen: die Kompatibilitäts-RPC blockiert sie absichtlich. |
| 7 | Produktives Supabase Auth und SMTP konfigurieren | E-Mail-Bestätigung, sichere E-Mail-Änderung, Passwort-/Leak-Schutz, Refresh-Rotation und Auth-/Versandlimits setzen; SMTP mit SPF/DKIM/DMARC einrichten und Zustellung testen. Produktion erlaubt nur `https://<domain>/update-password?type=recovery`; das private Scheme gehört nur ins getrennte Staging. Supabases einmaligen Bestätigungslink/PKCE in den E-Mail-Vorlagen erhalten. |
| 8 | Supabase und Betriebsabläufe real abnehmen | Mit Wegwerfkonten in Staging: Auth/Reset einschließlich Replay und falschem Gerät, fremde UID/Zugriffe, Avatar-Quota/Privacy, Export sowie Löschung mit parallelem Upload, Teilfehler und Wiederholung testen. Danach dieselbe Konfiguration kontrolliert nach Produktion übernehmen. Storage-Limits/Policies, Logfristen und rollenbeschränkten Dashboard-Zugriff/MFA prüfen. |
| 9 | Kontolösch- und Moderationssupport einrichten | Zuständige Personen, sichere Identitätsprüfung ohne reine E-Mail-Löschung, Fristen, Eskalationen und Dokumentation festlegen. Eine fehlgeschlagene Löschung behält die Upload-Sperre; Wiederholung/Support müssen diesen Zustand beherrschen. Inhalte melden/blockieren und Moderatorenzugriff praktisch testen. |
| 10 | Play Console und Signing vorbereiten | Entwicklerkonto verifizieren, App mit endgültigem Namen/Paket `de.lernzeit.app` anlegen, Play App Signing und sicheren Upload-Key einrichten. Den tatsächlichen SHA-256-Fingerprint des Play-App-Signaturschlüssels in die erzeugte `assetlinks.json` übernehmen. EAS Submit nur mit minimal berechtigtem Service Account, dessen Key außerhalb des Repositorys bleibt. |
| 11 | Final signiertes Production-AAB erstellen und auf Geräten abnehmen | Eindeutigen Remote-`versionCode` kontrollieren; `eas build --platform android --profile production`. Artefakt/Commit/Prüfsumme sichern, Signatur, Manifest, API-Level, 64-Bit und 16-KB-Seitengröße am tatsächlichen AAB prüfen. Nach Play-Installation App-Link-Verifikation (`adb shell pm get-app-links de.lernzeit.app`) sowie Kalt-/Warmstart, Auth/Recovery, Storage, Export, Löschung und Upgradepfad testen. Die sharebare GitHub-APK ist ausschließlich Preview. |
| 12 | Store-Eintrag, Testphasen und Veröffentlichung abschließen | Store-Grafiken/Screenshots produktseitig freigeben, funktionierenden Reviewer-Zugang bereitstellen, App Access, Data Safety, Altersfreigabe/Zielgruppe, Datenschutz-/Lösch-URLs, Länder und Preis wahrheitsgemäß ausfüllen. Internen/ggf. geschlossenen Test und alle vom jeweiligen Konto verlangten Voraussetzungen erfüllen, Pre-Launch-Report bearbeiten, Produktionszugriff/Review und Rollout freigeben. |

Zusätzliche Abgrenzungen:

- Der native Client hat keinen CAPTCHA-Token-Flow. Eine reine Aktivierung im
  Supabase-Dashboard ist kein fertiger externer Schritt und würde Auth brechen.
  Wenn CAPTCHA als Produktanforderung gewählt wird, ist vor Aktivierung eine
  zusätzliche Client-Implementierung samt Tests erforderlich. Die vorhandenen
  serverseitigen Auth-, E-Mail- und RPC-Limits sind unabhängig davon verbindlich.
- Avatare liegen im öffentlichen Bucket. Das Abschalten der Social-Freigabe
  widerruft bereits bekannte URLs nicht; dieser dokumentierte Restzugriff muss
  in Datenschutz-/Produktfreigabe berücksichtigt werden.
- iOS und browserbasierte Online-Konten sind keine freigegebenen Release-Ziele.
- Die Entfernung alter Fotoanhänge aus der erreichbaren Git-Historie ist nur
  bei gewünschter vollständiger Historienbereinigung ein gesonderter,
  koordinierter History-Rewrite; siehe `repository-history-cleanup.md`.
