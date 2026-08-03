# Store-Listing-Inhalte für Lernzeit

Stand: 3. August 2026

## Statusübersicht

| Inhalt | Status | Benötigte Freigabe / Lieferung |
| --- | --- | --- |
| App-Titel | Entwurf fertig | `Lernzeit` endgültig bestätigen |
| Kurzbeschreibung | Entwurf fertig | Text final freigeben |
| Ausführliche Beschreibung | Entwurf fertig | Aussagen mit finalem Production-Funktionsumfang abgleichen |
| App-Icon | **Fertig** | `assets/store/play-icon-512.png`, erzeugt mit `npm run assets:build` |
| Feature-Grafik | **Fertig** | `assets/store/play-feature-graphic-1024x500.png`, 24-Bit-PNG ohne Alpha |
| Smartphone-Screenshots | Fehlen | Mindestens 2, empfohlen 4–8 echte Screenshots vom Gerät |
| Tablet-Screenshots | Fehlen | Empfohlen mindestens 4 je verwendeter Tablet-Klasse |
| Support-E-Mail | Konfigurierbar | `EXPO_PUBLIC_SUPPORT_EMAIL` setzen; Wert erscheint in App und Store |
| Datenschutzerklärung | **Technisch fertig** | Betreiberangaben setzen, rechtlich prüfen lassen und Seite hosten |
| Externe Kontolöschung | **Technisch fertig** | `npm run release:pages` mit Produktionsumgebung, dann `public/` hosten |
| Demo-Zugang | Fehlt | Dauerhaftes Reviewer-Konto und englische Anleitung |
| Versionshinweise | Entwurf fertig | Siehe `release-notes.md` |

Screenshots und der Reviewer-Zugang sind die einzigen Store-Inhalte, die sich
nicht aus dem Repository erzeugen lassen: sie brauchen ein echtes Gerät
beziehungsweise ein echtes Konto im Produktionsprojekt.

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

**Vorhanden:** `assets/store/play-icon-512.png` (512 × 512, deckend, 10,6 KB).

Das gesamte Icon-Set wird aus einer Geometriedefinition erzeugt:

```bash
npm run assets:build      # schreibt PNG und SVG neu
npm run assets:build -- --check   # schlaegt fehl, wenn Dateien abweichen
```

| Datei | Größe | Verwendung |
| --- | --- | --- |
| `assets/images/icon.png` | 1024 × 1024 | App-Icon, wird von Android und iOS maskiert |
| `assets/images/android-icon-foreground.png` | 432 × 432 | Adaptive-Icon-Vordergrund, Motiv in der Safe Zone |
| `assets/images/android-icon-background.png` | 432 × 432 | Adaptive-Icon-Hintergrund `#B44D2B` |
| `assets/images/android-icon-monochrome.png` | 432 × 432 | Themed Icon ab Android 13 |
| `assets/images/splash-icon.png` | 512 × 512 | Splashscreen |
| `assets/images/favicon.png` | 48 × 48 | Web |
| `assets/store/play-icon-512.png` | 512 × 512 | Play-Store-Icon |
| `assets/brand/lernzeit-mark.svg` | Vektor | Master für Print und weitere Größen |

Das Motiv ist ein Uhrring mit zwei Zeigern in Creme auf Terrakotta. Es enthält
keinerlei Expo- oder React-Native-Template-Material, keine Badges und keine
Preis- oder Ranking-Aussagen. Die Vordergrundgeometrie liegt vollständig
innerhalb eines Kreises von 52 % der Kantenlänge und damit sicher in der
Android-Safe-Zone von 66/108.

## Feature-Grafik

**Vorhanden:** `assets/store/play-feature-graphic-1024x500.png`
(1024 × 500, 24-Bit-PNG ohne Alpha, 28,2 KB).

Bewusst ohne Text: Play beschneidet die Grafik je nach Fläche unterschiedlich,
und ein Wortbild müsste für jede Store-Sprache neu erzeugt werden. Die Marke
sitzt links im nie beschnittenen Bereich, rechts steht ein ruhiges Ringmotiv in
derselben Formsprache.

Falls später ein Claim gewünscht ist (`Fokus. Fortschritt. Gemeinsam.`), muss er
mit einer echten lizenzierten Schrift gesetzt und je Store-Sprache lokalisiert
werden.

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

Die statische Route `/datenschutz` und der deutsche Entwurf sind vorbereitet.
Nach Ausfüllen und rechtlicher Prüfung noch zu veröffentlichen und einzutragen:

```text
[https://DEINE-DOMAIN.example/datenschutz]
```

Die Seite muss Lernzeit beziehungsweise den Store-Entwicklernamen nennen und Gastdaten, Online-Konto/Supabase, Profilbilder, soziale Funktionen, Aufbewahrung, Löschung, Dienstleister und Betroffenenrechte korrekt beschreiben.

## Externe Seite zur Kontolöschung

Die statische Route `/konto-loeschen` und der sichere authentifizierte
In-App-Prozess sind vorbereitet. Nach Function-Deployment und End-to-End-Test
noch öffentlich zu hosten und einzutragen:

```text
[https://DEINE-DOMAIN.example/konto-loeschen]
```

Die Seite muss ohne installierte App erreichbar sein und leitet zum
authentifizierten Web-/App-Prozess. Sie erklärt Löschumfang, gemeinsame Inhalte
und noch zu bestätigende Aufbewahrung. Der Kontaktplatzhalter muss durch einen
funktionierenden, identitätsprüfenden Supportweg ersetzt werden.

Zusätzlich enthält die App jetzt den Bereich `Konto löschen` mit Warnung,
zweistufiger Bestätigung und serverseitiger Löschung. Das Deployment ist noch
auszuführen.

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
