# Google-Play-Console-Checkliste für Lernzeit

Stand: 29. Juli 2026

Diese Checkliste ist für den App-Datensatz `Lernzeit` / `de.lernzeit.app` vorgesehen. Kästchen erst abhaken, wenn die Angabe in der Play Console gespeichert und ohne offenen Hinweis akzeptiert wurde.

## A. Konto und App-Grunddaten

- [ ] Play-Developer-Konto vollständig verifiziert.
- [ ] Bei neuem persönlichem Konto: reales Android-Gerät mit der Play-Console-App verifiziert.
- [ ] App `Lernzeit` mit Standardsprache Deutsch angelegt.
- [ ] App-Typ `App` gewählt.
- [ ] Kostenlos-/Kostenpflichtig-Entscheidung bestätigt.
- [ ] Paketname des hochgeladenen Bundles ist exakt `de.lernzeit.app`.
- [ ] Play App Signing aktiviert.
- [ ] Länder und Regionen festgelegt.
- [ ] Öffentliche Support-E-Mail eingetragen und erreichbar.

## B. Store-Eintrag

- [ ] App-Titel: `Lernzeit` (final bestätigt, maximal 30 Zeichen).
- [ ] Kurzbeschreibung eingetragen (maximal 80 Zeichen).
- [ ] Ausführliche Beschreibung eingetragen (maximal 4.000 Zeichen).
- [ ] Finales Store-Icon: 512 × 512 px, 32-Bit-PNG, höchstens 1 MB.
- [ ] Feature-Grafik: 1024 × 500 px, JPEG oder 24-Bit-PNG ohne Alpha.
- [ ] Mindestens zwei echte Screenshots vorhanden; empfohlen sind mindestens vier Smartphone-Screenshots mit mindestens 1080 px.
- [ ] Tablet-Unterstützung mit echten Tablet-Screenshots dokumentiert; empfohlen sind mindestens vier Bilder je verwendeter Tablet-Klasse.
- [ ] Alle Bilder enthalten nur freigegebene Demo-Daten und keine echten personenbezogenen Daten.
- [ ] Alt-Texte für Grafiken/Screenshots ergänzt.
- [ ] Kontaktdaten und Website-URLs funktionieren ohne Login, Geoblocking oder Zertifikatsfehler.

Grafikanforderungen: [Google Play – Vorschau-Assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=de).

## C. Formular „App access“ / App-Zugriff

Navigation: `Policy > App content > App access`.

Empfohlene Auswahl für den aktuellen Funktionsumfang: **Nicht alle Funktionen sind ohne besondere Zugriffsrechte erreichbar**, weil Freunde, Gruppen, gemeinsame Ziele/Sessions und Synchronisierung ein Online-Konto benötigen. Der Gastmodus allein reicht für die Prüfung aller Funktionen nicht aus.

- [ ] Reviewer-Hauptkonto angelegt.
- [ ] Optionales zweites Demo-Konto beziehungsweise vorbereitete soziale Gegenstelle angelegt.
- [ ] Zugangsdaten sind dauerhaft, wiederverwendbar und weltweit gültig.
- [ ] Kein OTP, keine ablaufende MFA, kein Standort- oder Einladungs-Gate blockiert Google.
- [ ] Englische Zugangsanleitung eingetragen.
- [ ] Anleitung beschreibt: Anmeldung, vorhandene Demo-Inhalte, Freunde, Gruppen, gemeinsame Ziele und Sessions.
- [ ] Zugang unmittelbar vor dem Einreichen auf einem frischen Gerät getestet.

Eintragsschema:

```text
Access name: Lernzeit reviewer account
Username/email: [REVIEWER_EMAIL]
Password: [REVIEWER_PASSWORD]
Additional instructions (English):
Open Lernzeit, go to Konto & Synchronisierung, choose Online-Konto anmelden,
and use the credentials above. The account contains sample subjects, sessions,
goals, statistics, an accepted friend, a study group, a shared goal and a shared
study session. No OTP, subscription or location restriction is required.
```

Quelle: [Google – Anmeldedaten für die Prüfung](https://support.google.com/googleplay/android-developer/answer/15748846?hl=de).

## D. Formular „Ads“ / Werbung

Navigation: `Policy > App content > Ads`.

Aktueller releasebezogener Befund: In `package.json`, `app.json` und den geprüften Release-Signalen wurde kein Werbe-SDK und keine Werbefunktion gefunden.

- [ ] Mit Product Owner bestätigen, dass auch serverseitig keine Anzeigen, gesponserten Einblendungen oder werbeähnlichen Angebote ausgespielt werden.
- [ ] Wenn unverändert: **No, my app does not contain ads** auswählen.
- [ ] Bei späterer Einführung von Werbung die Erklärung vor dem betreffenden Release aktualisieren.

## E. Formular „Target audience and content“ / Zielgruppe

Navigation: `Policy > App content > Target audience and content`.

Die Auswahl ist eine Produkt-/Rechtsentscheidung und darf nicht allein aus dem App-Namen abgeleitet werden.

- [ ] Tatsächliche Zielgruppenentscheidung dokumentiert.
- [ ] Nur Altersgruppen gewählt, für die Lernzeit bewusst gestaltet und rechtlich vorbereitet ist.
- [ ] Falls 13–15 oder andere Kinder-/Jugendgruppen gewählt werden: Families-Anforderungen, Datenschutzerklärung, Social-Funktionen und Datenerhebung dafür geprüft.
- [ ] Falls ausschließlich 18+ gewählt wird: Store-Auftritt und tatsächliche Nutzung richten sich glaubwürdig nur an Erwachsene.
- [ ] Store-Grafiken, Texte und IARC-Angaben stimmen mit der Zielgruppenauswahl überein.

Naheliegende Produktentscheidung zur Bestätigung: Lernende ab 13 Jahren plus Erwachsene. Diese Auswahl kann zusätzliche Families-/Jugendschutzpflichten auslösen und ist daher **nicht vorab als erledigt markiert**.

Quelle: [Google – Zielgruppe und App-Inhalte](https://support.google.com/googleplay/android-developer/answer/9867159?hl=de).

## F. Formular „Content rating“ / Inhaltsbewertung

Navigation: `Policy > App content > Content rating`.

- [ ] Kontakt-E-Mail für IARC angegeben.
- [ ] Kategorie `Utility, Productivity, Communication or Other` beziehungsweise die in der Console passendste App-Kategorie gewählt.
- [ ] Gewalt, Sexualität, Sprache, Drogen, Glücksspiel und Angstinhalte wahrheitsgemäß beantwortet.
- [ ] Nutzerinteraktion/Social-Funktionen angegeben: Profile, Freundschaften, Gruppen, gemeinsame Ziele und gemeinsame Sessions.
- [ ] Festgehalten, dass keine direkte Chatfunktion beschrieben ist; bei Änderungen Fragebogen neu einreichen.
- [ ] Optionale Profilbilder und benutzergenerierte Namen/Inhalte im Fragebogen berücksichtigt.
- [ ] Berechnete regionale Ratings geprüft und IARC-Zertifikat gespeichert.

Quelle: [Google – IARC-Inhaltsbewertung](https://support.google.com/googleplay/android-developer/answer/9859655?hl=de).

## G. Formular „Data safety“ / Datensicherheit

Navigation: `Policy > App content > Data safety`.

Dies ist kein allgemeines Sicherheitsaudit. Vor dem Ausfüllen muss die verantwortliche Person die tatsächliche Production-Datenverarbeitung einschließlich Supabase und weiterer Dienstleister bestätigen.

Bekannte, mindestens zu bewertende Datentypen:

- Konto-E-Mail und Authentifizierungsdaten.
- Anzeigename und eindeutiger Benutzername.
- Optionales Profilbild.
- Lerninhalte: Fächer, Lernzeiten/Sessions, Ziele, Statistiken und Noten.
- Soziale Daten: Freundschaften, Gruppen, gemeinsame Ziele/Sessions und Freigabeeinstellungen.
- App-Interaktionen beziehungsweise Diagnosedaten nur dann, wenn sie in Production tatsächlich serverseitig erfasst werden.

- [ ] Für jeden Datentyp `collected`, `shared`, Zweck, Erforderlichkeit und Aufbewahrung bestätigt.
- [ ] Verarbeitung durch Supabase und andere SDKs/Dienstleister in der Erklärung berücksichtigt.
- [ ] Nutzerinitiierte Freigaben an Freunde/Gruppen korrekt eingeordnet.
- [ ] Verschlüsselung bei Übertragung für alle Production-Endpunkte bestätigt.
- [ ] Datenlöschmechanismus wahrheitsgemäß angegeben.
- [ ] Data-Safety-Angaben stimmen exakt mit Datenschutzerklärung und App-Verhalten überein.
- [ ] Formularvorschau geprüft und eingereicht.

Quelle: [Google – Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=de).

## H. Formular „Account deletion“ / Kontolöschung

Da Lernzeit innerhalb der App Online-Konten erstellen kann, gelten die Anforderungen auch dann, wenn der Gastmodus ohne Konto funktioniert.

- [ ] Leicht auffindbarer In-App-Weg zum Löschen des Online-Kontos und der zugehörigen Daten vorhanden.
- [ ] Externe HTTPS-Seite vorhanden, über die Nutzer ohne installierte App die Löschung anstoßen können.
- [ ] Seite nennt `Lernzeit` oder den identischen Entwicklernamen.
- [ ] Seite beschreibt gelöschte Daten, gegebenenfalls rechtlich aufbewahrte Daten und die Bearbeitungsfrist.
- [ ] Löschanfrage funktioniert ohne erneute App-Installation.
- [ ] URL im Data-Safety-/Kontolöschformular eingetragen.
- [ ] Prozess end-to-end mit einem Testkonto verifiziert.

**Aktueller Status: TECHNISCH VORBEREITET, NOCH BLOCKIERT.** Der In-App-Weg,
die serverseitige Function und `/konto-loeschen` liegen im Release-Branch. Vor
Abschluss müssen die Function deployed, die Platzhalter ausgefüllt, die Seite
öffentlich per HTTPS gehostet und der Prozess end-to-end geprüft werden.

Quelle: [Google – Anforderungen zur Kontolöschung](https://support.google.com/googleplay/android-developer/answer/13327111?hl=de).

## I. Datenschutzrichtlinie

- [ ] Öffentliche HTTPS-URL vorhanden.
- [ ] Seite ist ohne Anmeldung erreichbar und mobil lesbar.
- [ ] Lernzeit oder der Store-Entwicklername wird ausdrücklich genannt.
- [ ] Verantwortlicher und Kontaktmöglichkeit sind enthalten.
- [ ] Erhobene Daten, Zwecke, Rechtsgrundlage, Empfänger/Dienstleister, Aufbewahrung, Löschung und Nutzerrechte sind beschrieben.
- [ ] Gast-/lokale Daten und Online-/Supabase-Daten werden verständlich unterschieden.
- [ ] Profilbilder und soziale Freigaben werden beschrieben.
- [ ] Richtlinie stimmt mit Data Safety und Kontolöschseite überein.
- [ ] URL in `Policy > App content > Privacy policy` und gegebenenfalls im Store-Eintrag hinterlegt.

**Aktueller Status: ENTWURF VORBEREITET, NOCH BLOCKIERT.** `/datenschutz` und
die redaktionelle Entwurfsfassung sind vorhanden. Verantwortlicher, Kontakt,
Rechtsgrundlagen, Dienstleister-/Transferangaben, Logs und Aufbewahrung müssen
ausgefüllt, rechtlich geprüft und öffentlich per HTTPS gehostet werden.

## J. Kategorie und Tags

Navigation: `Grow users > Store presence > Store settings`.

- [ ] App-Typ: `Application`.
- [ ] Empfohlene Kategorie bestätigt: `Education`.
- [ ] Bis zu fünf nur tatsächlich passende Tags in der Console gewählt.
- [ ] Kandidaten anhand der verfügbaren Console-Liste geprüft: Lernen/Studium, Produktivität, Zeitmanagement, Ziele, Bildung.
- [ ] Keine irrelevanten Tags nur für Reichweite verwendet.

Quelle: [Google – Kategorie und Tags](https://support.google.com/googleplay/android-developer/answer/9859673?hl=de).

## K. Test-Tracks und Produktionsfreigabe

- [ ] Interne Tester-Liste angelegt und Opt-in-Link verteilt.
- [ ] Internes AAB erfolgreich aus Google Play installiert.
- [ ] Pre-Launch-Report ohne ungeklärten kritischen Fehler.
- [ ] Geschlossener Track angelegt.
- [ ] Bei neuem persönlichen Konto: mindestens 12 Tester 14 Tage durchgehend optiert.
- [ ] Testerfeedback und daraus folgende Änderungen dokumentiert.
- [ ] Produktionszugriff beantragt und erteilt, falls erforderlich.
- [ ] Production-Release enthält das freigegebene AAB und finale Versionshinweise.
- [ ] Alle App-Content-Aufgaben zeigen keinen offenen Pflichtpunkt.
- [ ] Release zur Prüfung gesendet.
- [ ] Nach Freigabe bei Managed Publishing ausdrücklich veröffentlicht.
