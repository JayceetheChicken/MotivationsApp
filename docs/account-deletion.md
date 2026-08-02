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
