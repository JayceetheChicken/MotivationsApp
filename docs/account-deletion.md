# Sichere Kontolöschung

Stand: 2. August 2026

## Ablauf und Autorisierung

1. Ein angemeldeter Nutzer öffnet in **Konto & Einstellungen** den Bereich
   **Konto löschen**.
2. Die App verlangt das aktuelle Passwort und den separat eingegebenen Text
   `LÖSCHEN`. Die Re-Authentifizierung muss wieder genau dieselbe Nutzer-ID
   ergeben; andernfalls wird die vorherige Sitzung wiederhergestellt und kein
   Löschaufruf ausgeführt.
3. Nur der frisch ausgestellte Access Token wird an die Edge Function
   `delete-account` gesendet. Die Function akzeptiert ausschließlich `POST`,
   verlangt die feste Bestätigung `DELETE`, validiert den Token serverseitig
   und lehnt Tokens mit einem `iat`-Alter über fünf Minuten ab.
4. Browser-Origin-Header werden nur aus `ALLOWED_BROWSER_ORIGINS` akzeptiert.
   Native Requests haben keinen Origin. Der statische Web-Build bietet keine
   Online-Authentifizierung und damit keinen browserseitigen Löschaufruf.
5. Der Service-Role-Key existiert ausschließlich in der Function-Laufzeit. Er
   wird weder an den Client noch als `EXPO_PUBLIC_*` ausgegeben.

## Serverseitige Reihenfolge

1. Alle Dateien und Unterordner unter `<user-id>/` im Bucket `avatars` werden
   begrenzt, paginiert und rekursiv aufgelistet und gelöscht.
2. Die service-role-only RPC `prepare_account_deletion(user_id)` überträgt
   erforderlichenfalls gemeinsames Eigentum.
3. Erst danach löscht `auth.admin.deleteUser` den Auth-Nutzer. Private Daten
   und personenbezogene Beziehungen kaskadieren über Foreign Keys.
4. Antworten enthalten nur `deleted: true` oder eine feste, nicht technische
   Fehlermeldung. Rohfehler, Nutzerobjekte und Tokens werden nicht geloggt.

Fehlende Avatarobjekte und bereits entfernte Daten werden toleriert. Scheitert
Storage oder Vorbereitung, bleibt der Auth-Nutzer bestehen und der Vorgang kann
wiederholt werden. Nach bereits vollständiger Auth-Löschung ist der alte Token
nicht mehr validierbar; ein erneuter Aufruf endet daher sicher mit `401`.

## Regeln für gemeinsame Inhalte

| Bereich | Regel vor der Auth-Löschung |
|---|---|
| Eigene private Fächer, Sessions/Segmente, Noten und persönliche Ziele | Keine Übertragung; vollständige Cascade-Löschung |
| Freundschaften, offene Einladungen, Blockierungen, eigene Meldungen und Presence | Personenbezogene Zeilen werden gelöscht; `invited_by` wird je nach bestehendem FK gelöscht oder auf `null` gesetzt |
| Erstellte Gruppen | Bei weiteren akzeptierten Mitgliedern geht der Besitz an das Mitglied mit dem frühesten `accepted_at`, danach `created_at`, danach Nutzer-ID. Ohne Nachfolger wird die Gruppe gelöscht. |
| Erstellte gemeinsame Ziele | Vorrangig übernimmt der neue Gruppenersteller, sonst der erste akzeptierte Teilnehmer nach derselben stabilen Sortierung. Ohne Nachfolger wird das Ziel gelöscht. |
| Erstellte gemeinsame Sessions | Vorrangig übernimmt der Gruppenersteller, sonst der erste beigetretene/aktive/pausierte/fertige Teilnehmer. Ohne Nachfolger wird die Session gelöscht. |
| Teilnehmerbeziehungen der gelöschten Person | Cascade-Löschung nach erfolgter Eigentumsübertragung |

Die funktionale pgTAP-Datei
`supabase/tests/008_privacy_moderation_deletion.sql` prüft Transfer, Auth-
Cascade und Erhalt der gemeinsamen Objekte.

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
| Avatar-Auflistung schlägt fehl | Abbruch mit 500, nichts wurde gelöscht, Wiederholung gefahrlos |
| Avatar-Löschung schlägt teilweise fehl | Abbruch mit 500. Beim nächsten Versuch werden die verbliebenen Objekte erneut aufgelistet und gelöscht |
| `prepare_account_deletion` schlägt fehl | Abbruch mit 500. Die Funktion arbeitet auf dem aktuellen Zustand; ein zweiter Aufruf findet nur noch nicht übertragene Objekte |
| `prepare_account_deletion` lief, `deleteUser` schlug fehl | Abbruch mit 500. Wiederholung überträgt nichts erneut (Eigentum liegt bereits beim Nachfolger) und löscht dann den Auth-Nutzer |
| `deleteUser` meldet „user not found“ | Wird als Erfolg gewertet; der gewünschte Endzustand ist erreicht |
| Zweiter Aufruf während der erste läuft | Beide durchlaufen dieselbe Reihenfolge. Der zweite findet keine Avatare und keine zu übertragenden Objekte mehr |
| JWT älter als fünf Minuten | 403, keine Änderung |
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

Vor Produktion zuerst in Staging:

```bash
npx supabase migration up --linked
npx supabase functions deploy delete-account --project-ref <PROJECT_REF>
npx supabase secrets set ALLOWED_BROWSER_ORIGINS=https://<ECHTE-DOMAIN>
```

Anschließend mit separaten Testkonten prüfen: frische und abgelaufene Sitzung,
falsches Passwort, manipulierte Bestätigung, fremder Browser-Origin,
Avatarunterordner, Storage-Fehler, leere und mehrgliedrige gemeinsame Inhalte,
lokale Daten zweier Konten sowie erneuter Aufruf. Die Produktivdatenbank darf
nicht für destruktive Probefälle verwendet werden.
