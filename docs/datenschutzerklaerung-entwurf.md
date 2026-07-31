# Datenschutzerklärung für Lernzeit – Entwurf

> Entwurfsfassung vom 31. Juli 2026. Vor Veröffentlichung rechtlich prüfen.
> Alle Angaben in eckigen Klammern müssen anhand des tatsächlichen Betriebs
> ausgefüllt werden. Die vollständig ausformulierte, in der App gerenderte
> Fassung wird in `src/legal/privacy-content.ts` gepflegt.

## Verantwortlicher

[NAME/FIRMA EINFÜGEN], [LADUNGSFÄHIGE ANSCHRIFT EINFÜGEN],
E-Mail: [KONTAKT-E-MAIL EINFÜGEN]. Datenschutzbeauftragter, sofern erforderlich:
[ANGABE EINFÜGEN ODER NACH PRÜFUNG „NICHT BESTELLT“].

## Verarbeitungsbereiche

- **Gastmodus:** Lernzeiten, Fächer, Noten, Ziele, Statistiken, Timerzustand und
  Einstellungen bleiben lokal, solange kein bestätigter Cloud-Import erfolgt.
- **Lokales Profil:** Anzeigename, Benutzername und optionales Bild bleiben auf
  dem Gerät und bilden kein Online-Konto.
- **Online-Konto:** Supabase verarbeitet E-Mail, geschützte Auth-Daten,
  Nutzer-ID, Profil, Benutzername, Zeitzone und Kontostatus. Die konkrete
  Rechtsgrundlage ist einzutragen: [RECHTSGRUNDLAGE EINFÜGEN].
- **Synchronisierung/Import:** Übertragen werden nur ausdrücklich bestätigte
  Fächer, Sessions, persönliche Ziele und Noten sowie technische Import-IDs,
  Prüfsummen, Cursor, Revisionen und Konfliktdaten. Lokales Vertrauen und
  Social-Freigaben werden nicht importiert.
- **Profilbilder:** Freiwillige Bilder liegen im Supabase-Storage und sind nur
  in den vorgesehenen Profil-/Social-Kontexten sichtbar. Sie werden bei der
  Kontolöschung explizit entfernt.
- **Freundschaften:** Exakte Benutzernamensuche, Anfrage, Status und Zeitpunkte.
  Private Fächer, Notizen, Noten und vollständige Sessionverläufe werden nicht
  als Freundesdaten freigegeben.
- **Gruppen, gemeinsame Ziele und Sessions:** Definitionen, Einladungen,
  Mitgliedschaften, Status, Zeitpunkte und berechnete Beiträge. Vom gelöschten
  Nutzer erstellte gemeinsame Objekte werden aufgrund der Cascades mitgelöscht.
- **Lerndaten:** Fächer, Timer-/manuelle Sessions, Segmente, Herkunft, Dauer,
  Noten, Prüfungsangaben, Ziele, Pausenintervalle und berechnete Statistiken.
- **Technik/Logs:** Geräte-/Nutzerkennungen, Revisionen, Cursor, Presence,
  Rate-Limits, Zeitstempel und mögliche Fehler-/Serverlogs. Inventar und
  Löschfristen: [LOGKONZEPT EINFÜGEN].

## Dienstleister und Übermittlungen

Supabase wird für Datenbank, Auth, Realtime, Edge Functions, Storage und
technische Logs eingesetzt. [VERTRAGSPARTNER, REGION, AVV,
UNTERAUFTRAGSVERARBEITER UND TRANSFERMECHANISMUS EINFÜGEN]. Abhängig vom
tatsächlichen Produktionsbetrieb können Google Play, Expo/EAS und der
Betriebssystemanbieter eigenständig verarbeiten; aktivierte Dienste sind vor
Release konkret zu benennen. Es sind derzeit keine eigenen Werbe-, Tracking-
oder Analytics-SDKs im Projekt ausgewiesen; dies ist pro Release zu prüfen.

## Speicherung und Löschung

Lokale Daten bleiben bis zur lokalen Löschung, zum Zurücksetzen der App-Daten
oder zur Deinstallation gespeichert. Online-Daten bleiben bis zur
Kontolöschung oder einer anderweitig zulässig festgelegten Löschung. Die
In-App-Löschung entfernt zuerst Storage-Objekte, dann den Auth-Nutzer und über
`ON DELETE CASCADE` die zugehörigen Datenbankdaten. Konkrete gesetzliche
Aufbewahrungen sind nicht bekannt: [PFLICHTEN UND FRISTEN EINFÜGEN ODER NACH
PRÜFUNG „KEINE“].

## Rechte

Soweit die jeweiligen gesetzlichen Voraussetzungen vorliegen, kommen Auskunft,
Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch und
Widerruf einer Einwilligung in Betracht. Anfragen: [DATENSCHUTZ-KONTAKT
EINFÜGEN]. Zuständige Aufsicht: [AUFSICHTSBEHÖRDE EINFÜGEN].

## Sicherheit und Änderungen

Eingesetzt werden unter anderem getrennte lokale Kontobereiche, sichere
Sessionablage, RLS, verifizierte Nutzer-JWTs, private Realtime-Inboxen und eine
serverseitige Kontolöschung ohne Service-Role-Key im Client. Die Erklärung ist
bei Änderungen an Funktionen, Dienstleistern oder Rechtslage zu aktualisieren.
Final freigegeben am: [DATUM EINFÜGEN].
