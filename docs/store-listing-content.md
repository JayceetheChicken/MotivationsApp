# Store-Listing-Inhalte für Lernzeit

Stand: 29. Juli 2026

## Statusübersicht

| Inhalt | Status | Benötigte Freigabe / Lieferung |
| --- | --- | --- |
| App-Titel | Entwurf fertig | `Lernzeit` endgültig bestätigen |
| Kurzbeschreibung | Entwurf fertig | Text final freigeben |
| Ausführliche Beschreibung | Entwurf fertig | Aussagen mit finalem Production-Funktionsumfang abgleichen |
| App-Icon | Fehlt in finaler Form | Branded 512 × 512 PNG; aktuelle Datei ist ein Expo-Platzhalter |
| Feature-Grafik | Fehlt | 1024 × 500 JPEG/24-Bit-PNG ohne Alpha |
| Smartphone-Screenshots | Fehlen | Mindestens 2, empfohlen 4–8 echte Screenshots |
| Tablet-Screenshots | Fehlen | Empfohlen mindestens 4 je verwendeter Tablet-Klasse |
| Support-E-Mail | Fehlt | Öffentliche, überwachte Support-Adresse |
| Datenschutzerklärung | Fehlt | Öffentliche HTTPS-URL |
| Externe Kontolöschung | Fehlt | Öffentliche HTTPS-Seite mit Löschanfrage |
| Demo-Zugang | Fehlt | Dauerhaftes Reviewer-Konto und englische Anleitung |
| Versionshinweise | Entwurf fertig | Siehe `release-notes.md` |

## App-Titel

```text
Lernzeit
```

8 Zeichen; Google Play erlaubt höchstens 30 Zeichen.

## Kurzbeschreibung

```text
Lernziele planen, Fokuszeiten messen und gemeinsam motiviert bleiben
```

Der Entwurf bleibt unter dem Limit von 80 Zeichen.

## Ausführliche Beschreibung

```text
Lernzeit hilft dir, deine Lernphasen zu planen, zuverlässig zu erfassen und deinen Fortschritt im Blick zu behalten.

Starte eine Fokus-Session mit Timer, pausiere sie bei Bedarf oder trage bereits absolvierte Lernzeit manuell ein. Ordne deine Lernzeit deinen Fächern zu und erkenne in übersichtlichen Wochen-, Monats- und Jahresstatistiken, wie sich deine Gewohnheiten entwickeln.

Mit Lernzeit kannst du:

• Fokus-Sessions starten, pausieren und fortsetzen
• Lernzeit manuell nachtragen
• Wochen-, Monats- und Jahresziele festlegen
• Lernzeit, Sessions, Fächer, Streaks und Zielerfolge auswerten
• Diagramme für unterschiedliche Zeiträume vergleichen
• Lernziele bearbeiten, pausieren, archivieren oder abschließen

Du kannst Lernzeit ohne Konto verwenden und deine Inhalte lokal auf deinem Gerät speichern. Ein Online-Konto ist freiwillig und erweitert die App um Synchronisierung und gemeinsames Lernen.

Mit einem Online-Konto kannst du Freunde über ihren eindeutigen Benutzernamen finden, private Lerngruppen bilden sowie gemeinsame Ziele und Lern-Sessions planen. Dabei bleiben private Fächer, Aufgaben, Notizen, Noten und persönliche Sessionverläufe vom Social-Bereich getrennt.

Lernzeit verbindet persönlichen Fokus mit motivierendem Fortschritt – allein oder gemeinsam mit deinem privaten Freundeskreis.
```

Vor Freigabe prüfen:

- Keine Funktion nennen, die im Production-Build deaktiviert ist.
- Aussagen zu Synchronisierung erst verwenden, wenn die EAS-Production-Umgebung korrekt gesetzt ist.
- Datenschutzversprechen mit Datenschutzerklärung und Data-Safety-Formular abgleichen.

## App-Icon

Benötigt wird ein endgültiges Lernzeit-Store-Icon:

- 512 × 512 px.
- 32-Bit-PNG mit Alpha.
- Höchstens 1 MB.
- Keine Preis-, Ranking- oder Play-Store-Badges.
- Klare Lernzeit-Marke, die auch klein erkennbar bleibt.
- Optisch konsistent mit den Launcher-/Adaptive-Icon-Ebenen.

Die aktuelle Datei `assets/images/icon.png` ist zwar 1024 × 1024 px groß und technisch eingebunden, zeigt aber ein generisches Expo-Symbol. Auch Vordergrund, Hintergrund und Monochrom-Asset des Adaptive Icons sind Template-Material. Sie müssen gemeinsam ersetzt werden, damit Store-Icon und Launcher-Icon dieselbe Marke zeigen.

## Feature-Grafik

Pflichtformat:

- 1024 × 500 px.
- JPEG oder 24-Bit-PNG ohne Transparenz.
- Wichtige Inhalte in der Mitte, weil Ränder je nach Play-Fläche beschnitten werden können.

Creative Brief:

- Warmes Lernzeit-Farbsystem rund um `#B44D2B` verwenden.
- Eine klare Kombination aus Fokus-Timer, Ziel-Fortschritt und Statistik andeuten.
- Optionaler kurzer Claim: `Fokus. Fortschritt. Gemeinsam.`
- Keine Geräte-Rahmen, Play-Badges, Ranglistenbehauptungen, Preise oder zeitlich begrenzten Aussagen.
- Wenn Text verwendet wird, für weitere Store-Sprachen lokalisierte Varianten erstellen.

## Smartphone-Screenshots

Google verlangt mindestens zwei Screenshots über die unterstützten Gerätetypen hinweg. Für eine gute App-Darstellung werden 4–8 Smartphone-Screenshots mit mindestens 1080 px empfohlen, idealerweise 1080 × 1920 px im Hochformat.

Empfohlene Reihenfolge:

1. **Start und Fokus-Timer** – Fach wählen und Session starten.
2. **Persönliche Lernziele** – Wochen-/Monatsziel mit sichtbarem Fortschritt.
3. **Statistiken** – aussagekräftiges Diagramm mit Lernzeit, Sessions und Streak.
4. **Gemeinsam lernen** – Freunde, gemeinsames Ziel oder geplante Gruppen-Session.
5. **Fächer und manuelle Einträge** – strukturierte Erfassung ohne Timer.
6. **Ohne Konto nutzbar** – lokaler Einstieg beziehungsweise Kontooption, nur wenn die Aussage visuell verständlich ist.

Produktionsregeln:

- Aktuelle echte App-Oberfläche zeigen, keine erfundenen Mockups.
- Nur künstliche Demo-Daten und neutrale Profilbilder verwenden.
- Keine E-Mail-Adressen, Klarnamen oder Benachrichtigungen echter Personen zeigen.
- Text-Overlays sparsam einsetzen; die App-Oberfläche soll in den ersten drei Bildern dominieren.
- Statusleiste aufräumen und keine fremden Marken zeigen.
- Für jedes Bild einen Alt-Text mit höchstens 140 Zeichen vorbereiten.

## Tablet-Screenshots

Da Lernzeit Smartphone-/Tablet-Layouts bietet, sollten Tablet-Assets bereitgestellt werden. In der Play Console gibt es getrennte Bereiche für 7-Zoll- und 10-Zoll-Tablets.

- Empfohlen: mindestens vier echte Screenshots je verwendeter Tablet-Klasse.
- Für Empfehlungstauglichkeit mindestens 1080 px, 9:16 Hochformat oder 16:9 Querformat.
- Oberfläche ohne Verzerrung aufnehmen/exportieren.
- Motive: Dashboard, Ziele, Statistik und Social-/Gruppenansicht mit der tatsächlichen Tablet-Anordnung.
- Wenn Play Console eine Tablet-Klasse wegen des Bundles anbietet, diesen Bereich nicht mit hochskalierten Smartphone-Bildern füllen.

## Support-E-Mail

Noch einzutragen:

```text
[SUPPORT_EMAIL]
```

Die Adresse muss dauerhaft überwacht werden und sollte nicht identisch mit dem privaten Login des Play-Console-Inhabers sein.

## Datenschutzerklärung

Noch zu veröffentlichen und einzutragen:

```text
[https://DEINE-DOMAIN.example/datenschutz]
```

Die Seite muss Lernzeit beziehungsweise den Store-Entwicklernamen nennen und Gastdaten, Online-Konto/Supabase, Profilbilder, soziale Funktionen, Aufbewahrung, Löschung, Dienstleister und Betroffenenrechte korrekt beschreiben.

## Externe Seite zur Kontolöschung

Noch zu erstellen:

```text
[https://DEINE-DOMAIN.example/konto-loeschen]
```

Die Seite muss ohne installierte App erreichbar sein und eine tatsächliche Löschanfrage ermöglichen, etwa über ein authentifiziertes Webformular oder einen klaren Support-Workflow. Sie muss erklären, welche Konto- und Nutzerdaten gelöscht werden, was aus rechtlichen Gründen gegebenenfalls aufbewahrt wird und was der Nutzer nach der Anfrage erwarten kann.

Zusätzlich ist in der App ein leicht auffindbarer Weg zur Online-Kontolöschung erforderlich. Das bloße Abmelden oder Entfernen eines lokalen Profils erfüllt diese Anforderung nicht.

## Demo-Zugang für die Google-Prüfung

Noch bereitzustellen:

```text
Reviewer email: [REVIEWER_EMAIL]
Reviewer password: [REVIEWER_PASSWORD]
Companion account, if needed: [SECOND_REVIEWER_EMAIL]
```

Das Hauptkonto sollte enthalten:

- Mehrere Demo-Fächer und Lern-Sessions.
- Aktive und abgeschlossene Ziele.
- Aussagekräftige Statistiken.
- Mindestens eine akzeptierte Freundschaft.
- Eine private Lerngruppe.
- Ein gemeinsames Ziel und eine gemeinsame Session.

Anforderungen:

- Keine MFA/OTP-Abhängigkeit.
- Passwort läuft nicht ab.
- Kein Standort-, Zeit- oder Geräte-Gate.
- Keine echten Nutzerdaten.
- Englische Schrittfolge im App-Access-Formular.

## Versionshinweise

Der freigabefertige Entwurf steht in `docs/release-notes.md`.

## Offizielle Formatquellen

- [Google Play – Vorschau-Assets und Screenshots](https://support.google.com/googleplay/android-developer/answer/9866151?hl=de)
- [Google Play – Store-Listing-Empfehlungen und Textlimits](https://support.google.com/googleplay/android-developer/answer/13393723?hl=de)
- [Google Play – App-Zugang für die Prüfung](https://support.google.com/googleplay/android-developer/answer/15748846?hl=de)
- [Google Play – Kontolöschung](https://support.google.com/googleplay/android-developer/answer/13327111?hl=de)

