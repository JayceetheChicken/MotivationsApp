export interface LegalSection {
  title: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
}

export const privacyIntroduction = 'Entwurfsfassung – vor Veröffentlichung durch den Verantwortlichen und gegebenenfalls eine Datenschutzberatung zu prüfen. Angaben in eckigen Klammern müssen ausgefüllt werden.';

export const privacySections: readonly LegalSection[] = [
  {
    title: '1. Verantwortlicher und Kontakt',
    paragraphs: [
      'Verantwortlich für die Verarbeitung personenbezogener Daten in Lernzeit: [NAME/FIRMA EINFÜGEN], [LADUNGSFÄHIGE ANSCHRIFT EINFÜGEN], E-Mail: [KONTAKT-E-MAIL EINFÜGEN].',
      'Datenschutzkontakt beziehungsweise Datenschutzbeauftragter, sofern erforderlich: [ANGABE EINFÜGEN ODER „NICHT BESTELLT“ NACH PRÜFUNG].',
    ],
  },
  {
    title: '2. Gastmodus und lokale Daten',
    paragraphs: [
      'Lernzeit kann ohne Anmeldung im Gastmodus verwendet werden. Lernzeiten, Fächer, Noten, persönliche Ziele, Statistiken, Timerzustände und Einstellungen werden dabei ausschließlich im lokalen App-Speicher des Geräts verarbeitet, solange keine Kontoverbindung und kein ausdrücklich bestätigter Import erfolgt.',
      'Diese lokalen Daten werden nicht automatisch an Supabase übertragen. Sie können durch Löschen der App-Daten beziehungsweise Deinstallieren der App verloren gehen. Gerätesicherungen des Betriebssystems können je nach Nutzereinstellung Kopien enthalten; deren Verwaltung richtet sich nach dem jeweiligen Plattformanbieter.',
    ],
  },
  {
    title: '3. Lokales Profil',
    paragraphs: [
      'Ein freiwilliges lokales Profil mit Anzeigename, Benutzername und optional ausgewähltem Profilbild bleibt auf dem Gerät. Das lokale Profil ist kein Online-Konto, ermöglicht keine Freundessuche und wird nicht automatisch synchronisiert.',
    ],
  },
  {
    title: '4. Supabase-Online-Konto',
    paragraphs: [
      'Bei freiwilliger Registrierung werden E-Mail-Adresse, Authentifizierungsdaten in geschützter Form, eine technische Nutzer-ID sowie Anzeigename, eindeutiger Benutzername, Zeitzone und Profilstatus verarbeitet. Passwörter werden vom Authentifizierungsdienst verarbeitet und nicht im Anwendungscode gespeichert.',
      'Die konkret anzuwendende Rechtsgrundlage für Registrierung, Kontoführung und optionale Social-Funktionen ist durch den Verantwortlichen vor Veröffentlichung festzulegen: [RECHTSGRUNDLAGE UND BEGRÜNDUNG EINFÜGEN].',
    ],
  },
  {
    title: '5. Synchronisierung und Import',
    paragraphs: [
      'Nach ausdrücklicher Bestätigung können lokale Fächer, Lernzeiten, persönliche Ziele und Noten in das Online-Konto importiert und anschließend zwischen Geräten synchronisiert werden. Technische Import-IDs, Prüfsummen, Zuordnungstabellen, Änderungsstände, Konflikte und eine lokale Outbox unterstützen Idempotenz und Offline-Nutzung.',
      'Lokale Freundschaften oder gemeinsame Inhalte werden nicht als Vertrauen oder Einwilligung in ein Online-Konto übernommen.',
    ],
  },
  {
    title: '6. Profilbilder',
    paragraphs: [
      'Ein freiwillig ausgewähltes Profilbild wird vor dem Upload auf höchstens 1024 × 1024 Pixel verkleinert und als JPEG neu codiert. Dadurch werden EXIF-, GPS- und XMP-Metadaten entfernt; Dateisignatur, MIME-Typ, Endung, Abmessungen und Größe werden zusätzlich geprüft.',
      'Das Bild liegt im derzeit öffentlichen Supabase-Storage-Bucket unter einer schwer erratbaren URL. Die App gibt die URL in Social-Ansichten nur nach ausdrücklicher Avatar-Freigabe aus; wer die URL bereits kennt, kann sie technisch dennoch abrufen. Alte Profilbildobjekte werden nach einem erfolgreichen Wechsel bereinigt; bei der Kontolöschung entfernt die serverseitige Löschfunktion alle Objekte im kontobezogenen Avatar-Pfad.',
    ],
  },
  {
    title: '7. Freundschaften und Sichtbarkeit',
    paragraphs: [
      'Die Freundessuche erfolgt nur bei ausdrücklich aktivierter Auffindbarkeit über einen exakten eindeutigen Benutzernamen. Verarbeitet werden Anfragen, Annahme oder Ablehnung, Zeitpunkte und der Beziehungsstatus. Nur ausdrücklich akzeptierte, nicht blockierte Kontakte erhalten die vorgesehenen, begrenzten Social-Ansichten.',
      'Lernstatus, Pausenstatus, letzte Lernaktivität, heutige Aktivität, Wochenlernzeit, Streak und Profilbild sind getrennte, standardmäßig deaktivierte Freigaben. Die Datenbank setzt diese Regeln vor der Antwort durch und liefert nicht freigegebene Werte als null oder neutrale Kategorie.',
      'Private Fächer, Notizen, Noten und vollständige Sessionverläufe werden nicht als Freundesdaten freigegeben. Social-Realtime-Nachrichten dienen nur als gezielte Invalidierungen an die eigene private Inbox; die sichtbaren Daten werden anschließend über zugriffsgeschützte Datenbankfunktionen neu geladen.',
      'Blockierungen verhindern Suche, neue Freundschaftsanfragen, direkte Einladungen und Presence-Ansichten. Nur die blockierende Person kann ihre eigene Blockliste sehen. Profile und gemeinsame Inhalte können mit Grund, optionaler Kurzbeschreibung, Zeit und Bearbeitungsstatus gemeldet werden; Moderationsnotizen und Meldungen anderer Personen werden nicht ausgegeben.',
    ],
  },
  {
    title: '8. Gruppen, gemeinsame Ziele und gemeinsame Sessions',
    paragraphs: [
      'Für private Lerngruppen werden Gruppenname, Ersteller, Mitgliedschaften, Einladungsstatus und zugeordnete Inhalte verarbeitet. Für gemeinsame Ziele werden Zieldefinition, Zeitraum, Teilnehmende, Einladungsstatus und berechnete Beiträge verarbeitet. Für gemeinsame Sessions werden Titel, Planung, Status, Teilnehmende, Start-/Endzeit und berechnete Beiträge verarbeitet.',
      'Beim Löschen des Kontos werden eigene Mitgliedschaften und personenbezogene Teilnehmerbeziehungen entfernt. Hat ein gemeinsam genutztes Objekt verbleibende akzeptierte Mitglieder, wird der Besitz vor der Löschung deterministisch auf ein geeignetes Mitglied übertragen. Nur Objekte ohne verbleibende berechtigte Teilnehmer werden gelöscht.',
    ],
  },
  {
    title: '9. Lernzeiten, Fächer, Noten, Ziele und Statistiken',
    paragraphs: [
      'Je nach Nutzung werden Fächer, Timer- und manuelle Sessions, Sessionsegmente, Dauer, Zeitpunkte, Herkunft, Notizen beziehungsweise Legacy-Felder, Noten, Prüfungsangaben, persönliche Ziele, Pausenintervalle und daraus berechnete Statistiken verarbeitet. Im Gastmodus bleiben sie lokal; im Online-Konto werden sie nach Kontoverbindung beziehungsweise Import synchronisiert.',
    ],
  },
  {
    title: '10. Technische Daten, Presence und Logs',
    paragraphs: [
      'Für Betrieb und Sicherheit können technische Nutzer- und Gerätekennungen, Revisionsnummern, Synchronisationscursor, Zeitstempel, Online-/Lernstatus, Rate-Limit-Daten sowie Fehler- und Serverlogs verarbeitet werden. Die App zeigt technische Supabase-Fehlermeldungen nicht unmittelbar im UI an.',
      'Konkrete Logquellen, Protokollinhalte, Zugriffsberechtigungen und Löschfristen sind vor Veröffentlichung zu inventarisieren: [LOG- UND AUFBEWAHRUNGSKONZEPT EINFÜGEN]. Es sind derzeit keine eigenen Werbe-, Tracking- oder Analytics-SDKs im Projekt ausgewiesen; dies ist vor jedem Release erneut zu prüfen.',
    ],
  },
  {
    title: '11. Community-Regeln, Meldungen und Moderation',
    paragraphs: [
      'Vor dem ersten Hochladen oder Teilen nutzergenerierter Inhalte wird die ausdrückliche Zustimmung zur aktuellen Version der Community-Regeln mit Version und Zeitpunkt gespeichert. Die Checkbox ist nicht vorangekreuzt.',
      'Eigene Meldungen enthalten gemeldete Entität, Grund, optionale Beschreibung, Zeitpunkt und Status. Zugriff auf die Moderationswarteschlange und Maßnahmen wie Ausblenden oder Entfernen ist ausschließlich über einen serverseitigen Betreiberweg möglich. Rate-Limit-Daten und interne Moderationsnotizen werden nicht in den Datenexport aufgenommen.',
    ],
  },
  {
    title: '12. Dienstleister und Datenübermittlung',
    paragraphs: [
      'Als Backend- und Authentifizierungsdienst wird Supabase eingesetzt. Betroffen sind insbesondere Datenbank, Authentifizierung, Realtime, Edge Functions, Storage und technische Logs. Vertragspartner, Projektregion, Auftragsverarbeitungsvertrag, Unterauftragsverarbeiter und mögliche Drittlandübermittlungen sind anhand des tatsächlich verwendeten Supabase-Projekts zu ergänzen: [SUPABASE-VERTRAGSPARTNER, REGION, AVV UND TRANSFERMECHANISMUS EINFÜGEN].',
      'Für App-Verteilung und optionale Plattformdienste können Google Play, Expo/EAS und der jeweilige Betriebssystemanbieter eigenständig Daten verarbeiten. Welche Dienste im Produktionsbetrieb tatsächlich aktiviert werden, muss in der finalen Fassung konkret benannt werden: [PRODUKTIONS-DIENSTLEISTER EINFÜGEN].',
    ],
  },
  {
    title: '13. Speicherung, Export und Löschung',
    paragraphs: [
      'Lokale Gast- und Profildaten bleiben bis zur lokalen Löschung, zum Zurücksetzen der App-Daten oder zur Deinstallation gespeichert. Online-Kontodaten bleiben bis zur Kontolöschung oder bis zu einer anderweitig festgelegten, zulässigen Löschung gespeichert.',
      'Ein maschinenlesbarer JSON-Export des eigenen Online-Kontos kann in den Kontoeinstellungen erstellt und über das System-Teilen-Menü gespeichert werden. Er enthält eigene Profil-, Privacy-, Lern-, Gruppen-, Beziehungs-, Blockierungs- und Meldedaten, aber keine Tokens, Rate-Limits, internen Moderationsnotizen oder privaten Daten anderer Personen. Die temporäre Klartextdatei wird nach dem Teilen aus dem App-Cache entfernt.',
      'Die In-App-Kontolöschung erfordert eine erneute Passwortbestätigung, entfernt zuerst alle Profilbildobjekte, überträgt erforderlichenfalls gemeinsame Inhalte und löscht danach den Auth-Nutzer; private Datenbankdatensätze werden über geprüfte ON-DELETE-CASCADE-Beziehungen entfernt. Gesetzlich zwingende Aufbewahrungspflichten sind derzeit nicht festgelegt und dürfen nicht erfunden werden. Falls solche Pflichten bestehen, sind Datenarten, Rechtsgrund, Sperrung und konkrete Frist hier einzutragen: [AUFBEWAHRUNGSPFLICHTEN EINFÜGEN ODER NACH PRÜFUNG „KEINE“].',
    ],
  },
  {
    title: '14. Rechte betroffener Personen',
    paragraphs: [
      'Betroffene Personen können – soweit die gesetzlichen Voraussetzungen erfüllt sind – Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch verlangen sowie eine erteilte Einwilligung mit Wirkung für die Zukunft widerrufen. Das Bestehen und der konkrete Umfang richten sich nach dem anwendbaren Recht und der jeweiligen Verarbeitung.',
      'Anfragen sind an [DATENSCHUTZ-KONTAKT EINFÜGEN] zu richten. Außerdem besteht gegebenenfalls ein Beschwerderecht bei einer zuständigen Datenschutzaufsichtsbehörde; die für den Verantwortlichen zuständige Behörde ist vor Veröffentlichung einzutragen: [AUFSICHTSBEHÖRDE EINFÜGEN].',
    ],
  },
  {
    title: '15. Sicherheit, Änderungen und Stand',
    paragraphs: [
      'Lernzeit setzt unter anderem kontobezogene lokale Speicherbereiche, sichere Sessionablage, Row Level Security, verifizierte Nutzer-JWTs, private Realtime-Topics und eine serverseitige Kontolöschung ohne Service-Role-Key im Client ein. Kein Verfahren kann absolute Sicherheit garantieren.',
      'Diese Erklärung ist bei Änderungen an Funktionen, Dienstleistern oder Rechtslage zu aktualisieren. Stand der Entwurfsfassung: 2. August 2026. Final freigegeben am: [DATUM EINFÜGEN].',
    ],
  },
];
