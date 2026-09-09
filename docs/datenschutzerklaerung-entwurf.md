# Datenschutzerklärung für Lernzeit – Entwurf

> Entwurfsfassung vom 2. August 2026. Vor Veröffentlichung rechtlich prüfen.
> Betreiber, Anschrift, Kontakt, Rechtsgrundlagen, Domain, Hostingregion,
> Auftragsverarbeitung, Drittlandtransfers, Logs und Aufbewahrungsfristen sind
> mit echten Angaben zu vervollständigen. Die vollständige In-App-Fassung wird
> in `src/legal/privacy-content.ts` gepflegt.

## Tatsächlich verarbeitete Bereiche

- **Gastmodus und lokales Profil:** Fächer, Lernzeiten, Segmente, Noten, Ziele,
  Timer, Statistiken, Einstellungen sowie optional Anzeigename, Benutzername
  und lokales Bild bleiben auf dem Gerät, solange kein bestätigter Import in
  ein Online-Konto erfolgt.
- **Online-Konto:** Supabase verarbeitet E-Mail, Authentifizierung, technische
  Nutzer-ID, Benutzername, Anzeigename, Zeitzone, Profilstatus und optionales
  Profilbild. Passwörter und Tokens werden nicht als Anwendungsdaten exportiert.
- **Synchronisierung und Import:** Fächer, Sessions, Segmente, persönliche Ziele,
  Noten sowie technische Import-IDs, Prüfsummen, Zuordnungen, Revisionen,
  Cursor, Konflikte und Outboxes.
- **Social-Funktionen:** Freundschaften, Blockierungen, Gruppen,
  Mitgliedschaften, Einladungen, gemeinsame Ziele/Sessions, Teilnehmerstatus,
  aggregierte Beiträge, Presence und letzte Lernaktivität.
- **Meldungen und Moderation:** gemeldete Entität, Grund, optionale kurze
  Beschreibung, Zeit, Status und minimale interne Bearbeitungsangaben.
- **Technischer Betrieb:** Revisionsstände, Gerätekennung für Presence,
  Rate-Limits, Mutation-Receipts und notwendige Server-/Fehlerlogs. Es sind
  derzeit keine eigenen Werbe-, Tracking- oder Analytics-SDKs ausgewiesen.

## Datenschutzfreigaben

Auffindbarkeit über Benutzernamen, Profilbild, aktuelles Lernen, Pausenstatus,
letzte Lernaktivität, heutige Aktivität, Wochenlernzeit und Streak sind
getrennte, standardmäßig deaktivierte Freigaben. Das serverseitige Read Model
liefert nicht freigegebene Werte als `null` oder neutrale Kategorie. Private
Fächer, Noten, Notizen und Sessionverläufe werden niemals in Freundesansichten
ausgegeben. Blockierungen verhindern Suche, neue Anfragen, direkte Einladungen
und Presence-Ansichten; die Gegenseite erhält keine Blockliste.

## Profilbilder

Ausgewählte JPEG-, PNG- oder WebP-Bilder werden auf maximal 1024 × 1024 Pixel
begrenzt, als JPEG neu codiert und auf unerwartete EXIF-/GPS-/XMP-Metadaten
geprüft. Der Bucket bleibt aus Kompatibilitätsgründen öffentlich; die App gibt
die URL nur nach Freigabe aus, eine bereits bekannte URL bleibt aber technisch
abrufbar. Alte und verwaiste Nutzerobjekte werden bereinigt.

## Dienstleister, Speicherung, Export und Löschung

Supabase wird für Auth, Datenbank, Realtime, Edge Functions, Storage und
technische Logs eingesetzt. [VERTRAGSPARTNER, REGION, AVV,
UNTERAUFTRAGSVERARBEITER UND TRANSFERMECHANISMUS EINFÜGEN]. Abhängig vom
Produktionsbetrieb können Google Play, Expo/EAS und Plattformanbieter eigene
Verarbeitungen vornehmen.

Ein JSON-Export enthält eigene Profil-, Privacy-, Lern-, Gruppen-, Beziehungs-,
Blockierungs- und Meldedaten, aber keine Tokens, internen Rate-Limits,
Moderationsnotizen oder privaten Daten anderer Personen. Die temporäre
Exportdatei wird nach dem Teilen aus dem App-Cache entfernt.

Die Kontolöschung erfordert eine frische Re-Authentifizierung. Profilbilder und
private Daten werden gelöscht; gemeinsam genutzte Objekte werden bei
verbleibenden Teilnehmern deterministisch übertragen, sonst gelöscht. Konkrete
gesetzliche Aufbewahrungen sind nicht bekannt: [PFLICHTEN UND FRISTEN
EINFÜGEN ODER RECHTLICH BESTÄTIGEN, DASS KEINE GELTEN].

## Rechte und Verantwortlicher

[NAME/FIRMA], [LADUNGSFÄHIGE ANSCHRIFT], [KONTAKT],
[DATENSCHUTZKONTAKT], [AUFSICHTSBEHÖRDE]. Je nach gesetzlichen
Voraussetzungen bestehen Rechte auf Auskunft, Berichtigung, Löschung,
Einschränkung, Datenübertragbarkeit, Widerspruch und Widerruf. Rechtsgrundlagen
und Beschwerdeweg sind vor Release rechtlich festzulegen.
