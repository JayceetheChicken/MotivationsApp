# Sichere Kontolöschung

Stand: 9. August 2026

## Ablauf und Autorisierung

1. Ein angemeldeter Nutzer öffnet in **Konto & Einstellungen** den Bereich
   **Konto löschen**.
2. Die App verlangt das aktuelle Passwort und den separat eingegebenen Text
   `LÖSCHEN`. Die Re-Authentifizierung muss wieder genau dieselbe Nutzer-ID
   ergeben; andernfalls wird die vorherige Sitzung wiederhergestellt und kein
   Löschaufruf ausgeführt.
3. Nur der durch diese Passwortanmeldung ausgestellte Access Token wird an die
   Edge Function `delete-account` gesendet. Die Function akzeptiert
   ausschließlich `POST`, verlangt die feste Bestätigung `DELETE`, validiert
   den Token serverseitig und verlangt im signierten `amr`-Claim eine
   Passwortanmeldung derselben Nutzer-ID aus den letzten fünf Minuten. Ein nur
   automatisch erneuerter Access Token (`token_refresh`) genügt ausdrücklich
   nicht.
4. Browser-Origin-Header werden nur aus `ALLOWED_BROWSER_ORIGINS` akzeptiert.
   Native Requests haben keinen Origin. Der statische Web-Build bietet keine
   Online-Authentifizierung und damit keinen browserseitigen Löschaufruf.
5. Der Service-Role-Key existiert ausschließlich in der Function-Laufzeit. Er
   wird weder an den Client noch als `EXPO_PUBLIC_*` ausgegeben.

## Serverseitige Reihenfolge

1. Die service-role-only RPC `begin_account_deletion(user_id)` setzt zuerst
   eine Löschsperre. Der Avatar-Upload-Trigger serialisiert sich mit derselben
   Sperre und lehnt ab diesem Zeitpunkt neue Objekte für das Konto ab.
2. Alle Dateien und Unterordner unter `<user-id>/` im Bucket `avatars` werden
   begrenzt, paginiert und rekursiv aufgelistet und gelöscht.
3. Danach löscht `auth.admin.deleteUser` den Auth-Nutzer. Ein
   `BEFORE DELETE`-Trigger auf `auth.users` überträgt erforderlichenfalls
   gemeinsames Eigentum. Vorbereitung, Auth-Löschung und relationale Cascades
   laufen damit in **derselben Datenbanktransaktion**; ein Fehler rollt alles
   zurück.
4. Antworten enthalten nur `deleted: true` oder eine feste, nicht technische
   Fehlermeldung. Rohfehler, Nutzerobjekte und Tokens werden nicht geloggt.

Fehlende Avatarobjekte und bereits entfernte Daten werden toleriert. Scheitert
Storage oder die Auth-Löschung, bleibt der Auth-Nutzer bestehen und die Function
versucht, die Upload-Sperre wieder aufzuheben; der Vorgang kann wiederholt
werden. Bleibt die Sperre wegen eines zweiten Infrastrukturfehlers bestehen,
ist das datenschutzfreundlich fehlgeschlagen: neue Avatare bleiben blockiert,
bis die Löschung erneut ausgeführt oder die Sperre betrieblich geprüft wird.
Nach bereits vollständiger Auth-Löschung ist der alte Token nicht mehr
validierbar; ein erneuter Aufruf endet daher sicher mit `401`.

Storage und Auth sind getrennte Dienste und deshalb nicht gemeinsam
transaktional. Bei einem Fehler nach der Storage-Bereinigung kann ein noch
lebendes Konto vorübergehend ohne Avatarobjekte bleiben. Die Upload-Sperre
verhindert dabei aber, dass ein parallel hochgeladenes Objekt die erfolgreiche
Kontolöschung überlebt; alle relationalen Eigentumsänderungen sind atomar.

## Regeln für gemeinsame Inhalte

| Bereich | Regel vor der Auth-Löschung |
|---|---|
| Eigene private Fächer, Sessions/Segmente, Noten und persönliche Ziele | Keine Übertragung; vollständige Cascade-Löschung |
| Freundschaften, offene Einladungen, Blockierungen, eigene Meldungen und Presence | Personenbezogene Zeilen werden gelöscht; `invited_by` wird je nach bestehendem FK gelöscht oder auf `null` gesetzt |
| Erstellte Gruppen | Bei weiteren akzeptierten Gruppenmitgliedern geht der Besitz an das Mitglied mit dem frühesten `accepted_at`, danach `created_at`, danach Nutzer-ID. Ohne Gruppennachfolger wird die Gruppe gelöscht. Gruppenbezogene Ziele und Sessions werden vorher anhand ihrer **eigenen** Teilnehmer erhalten und von der zu löschenden Gruppe gelöst. |
| Erstellte gemeinsame Ziele | Der erste akzeptierte Zielteilnehmer übernimmt nach stabiler Sortierung. Gruppenbesitz allein reicht nicht. Ohne akzeptierten Zielteilnehmer wird nur dieses Ziel gelöscht. |
| Erstellte gemeinsame Sessions | Der erste beigetretene/aktive/pausierte/fertige Sessionteilnehmer übernimmt nach stabiler Sortierung. Gruppenbesitz allein reicht nicht. Ohne geeigneten Sessionteilnehmer wird nur diese Session gelöscht. |
| Teilnehmerbeziehungen der gelöschten Person | Cascade-Löschung nach erfolgter Eigentumsübertragung |

Die funktionalen pgTAP-Dateien
`supabase/tests/008_privacy_moderation_deletion.sql` und
`supabase/tests/009_final_release_security_hardening.sql` prüfen Transfer,
Auth-Cascade, Teilnehmerzustände, Upload-Sperre und Erhalt gemeinsamer Objekte.

## Löschanfrage ohne Zugriff auf die App

Es gibt **keinen** implementierten Workflow, der ein Konto aufgrund einer
eingehenden E-Mail löscht, und keinen automatisch versendeten Bestätigungscode.
Der einzige technische Löschpfad ist der oben beschriebene, in der App
angemeldete Ablauf.

Für Menschen, die sich nicht mehr anmelden können, bleibt nur ein manueller
Supportprozess über die Datenschutzkontaktadresse:

1. Die Anfrage geht bei der Datenschutzkontaktadresse ein.
2. Der Betreiber prüft von Hand, ob die Anfrage der Kontoinhaberin oder dem
   Kontoinhaber zugeordnet werden kann, und stellt bei Bedarf Rückfragen oder
   bittet um eine Anmeldung in der App.
3. Nur bei eindeutiger Zuordnung wird gelöscht — technisch über denselben
   serverseitigen Pfad. Bleibt die Zuordnung unklar, wird nicht gelöscht.

`public/account-deletion/index.html` beschreibt genau diesen Prozess und sagt
weder eine Frist noch einen Bestätigungscode zu. Die konkrete Ausgestaltung
(Postfach, Zuständigkeit, Reaktionszeit, Dokumentation der Identitätsprüfung)
ist ein **betrieblicher, außerhalb des Codes zu erledigender Punkt** und Teil
der ausstehenden rechtlichen Prüfung.

## Lokale Bereinigung nach Servererfolg

Die App entfernt nur den Bereich der gelöschten Nutzer-ID:

- Supabase-Sitzung und SecureStore-Chunks durch lokalen Sign-out,
- Study-State, Repository-Cache, Sync-Cursor und Outbox,
- Importentscheidung und Shared-Session-Aktionsqueue,
- private Realtime-Channels,
- gecachtes Profil und temporäre Avatar-/Exportdateien, soweit sie von der App
  angelegt wurden.

Danach werden Session und lokales Profil im React-State geleert; Lernzeit
startet als leerer Gast. Schlüssel eines anderen Kontos und der getrennte
Gastbereich bleiben unberührt. Die separate Aktion **Abmelden und Daten dieses
Kontos vom Gerät löschen** verwendet dieselbe kontobezogene Schlüsselliste,
löscht aber keine Cloud-Daten.

## Idempotenz, Wiederholungen und Fehlerfälle

Der Ablauf ist so gebaut, dass jeder Teilfehler entweder gefahrlos wiederholbar
ist oder als Fehler gemeldet wird. Es gibt keinen Pfad, der Erfolg meldet, ohne
dass der Auth-Nutzer tatsächlich gelöscht wurde.

| Situation | Verhalten |
| --- | --- |
| Löschsperre kann nicht gesetzt werden | Abbruch mit 500 vor Storage- oder Auth-Löschung |
| Avatar-Auflistung schlägt fehl | Abbruch mit 500; bereits entfernte Seiten bleiben entfernt, Upload-Sperre wird bestmöglich aufgehoben, Wiederholung gefahrlos |
| Avatar-Löschung schlägt teilweise fehl | Abbruch mit 500. Beim nächsten Versuch werden die verbliebenen Objekte erneut aufgelistet und gelöscht |
| Mehr als 10.000 Legacy-Avatarobjekte | Abbruch nach begrenztem Fortschritt; jeder erneute Aufruf entfernt die nächste begrenzte Menge |
| Eigentumsvorbereitung oder `deleteUser` schlägt fehl | Abbruch mit 500; die Auth-Transaktion rollt Eigentumsänderungen und Cascades vollständig zurück |
| `deleteUser` meldet „user not found“ | Wird als Erfolg gewertet; der gewünschte Endzustand ist erreicht |
| Zweiter Aufruf während der erste läuft | Sperren serialisieren Upload und Vorbereitung. Der zweite Aufruf endet nach Auth-Löschung konservativ mit 401 oder findet nur noch Restarbeit |
| Passwort-AMR älter als fünf Minuten oder nur frischer Refresh-Token | 403, keine Änderung |
| Falsches Passwort | Die Re-Authentifizierung schlägt vor dem Function-Aufruf fehl |
| Re-Authentifizierung liefert eine andere UID | Die vorherige Sitzung wird wiederhergestellt, kein Löschaufruf |

### Bekannte Kante: Antwort geht nach erfolgreicher Löschung verloren

Bricht die Verbindung genau zwischen erfolgreicher Serverlöschung und dem
Eintreffen der Antwort ab, meldet ein Wiederholungsversuch **401** mit
„Deine Anmeldung ist abgelaufen“. Ursache: `auth.getUser()` findet den Nutzer
nicht mehr, und die Function unterscheidet bewusst nicht zwischen „Token
ungültig“ und „Nutzer existiert nicht“.

Diese Wahl ist beabsichtigt. Die Alternative — bei nicht auffindbarem Nutzer
Erfolg zu melden — würde eine Fehlklassifikation eines lediglich abgelaufenen
Tokens in eine **falsche Erfolgsmeldung** verwandeln, obwohl das Konto noch
existiert. Die konservative Variante meldet im schlimmsten Fall einen Fehler,
obwohl gelöscht wurde; sie meldet niemals Erfolg, obwohl nicht gelöscht wurde.

Praktische Folge: In diesem seltenen Fall bleiben lokale, kontobezogene Caches
auf dem Gerät. Der Nutzer kann sie über **Konto & Einstellungen → Abmelden und
Daten dieses Kontos vom Gerät löschen** oder über die App-Daten in den
Geräteeinstellungen entfernen. Der Support sollte diesen Hinweis kennen.

## Deployment und manuelle Abnahme

Vor Produktion zuerst in Staging. Die Migration muss vor der neuen Edge
Function ausgerollt werden; die neue Function verlangt die erst dort
eingeführte `begin_account_deletion`-RPC und scheitert gegen ein altes Schema
sicher vor jeder Löschung. Die Kompatibilitäts-RPC hält während des kurzen
Zwischenstands auch die vorherige Function funktionsfähig.

```bash
npx supabase migration up --linked
npx supabase functions deploy delete-account --project-ref <PROJECT_REF>
npx supabase secrets set ALLOWED_BROWSER_ORIGINS=https://<ECHTE-DOMAIN>
```

Anschließend mit separaten Testkonten prüfen: echte Passwort-Reauthentifizierung,
frisch erneuerter Token ohne frische Passwort-AMR, abgelaufene AMR, falsches
Passwort, manipulierte Bestätigung, fremder Browser-Origin, paralleler
Avatar-Upload, Avatarunterordner, Storage-Fehler, leere und mehrgliedrige
gemeinsame Inhalte, lokale Daten zweier Konten sowie erneuter Aufruf. Die
Produktivdatenbank darf nicht für destruktive Probefälle verwendet werden.
