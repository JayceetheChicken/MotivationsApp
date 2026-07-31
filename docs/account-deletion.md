# Sichere Kontolöschung

## Ablauf

1. Der Nutzer öffnet als angemeldetes Online-Konto in **Konto & Einstellungen**
   den eigenen Bereich **Konto löschen**.
2. Nach der ersten Warnung muss er `LÖSCHEN` eingeben und den destruktiven
   Button erneut betätigen.
3. Der Client ruft die Edge Function `delete-account` mit dem aktuellen
   Nutzer-JWT und einer serverseitig geprüften Bestätigung auf. Im App-Bundle
   befindet sich kein Service-Role-Key.
4. Die Function validiert den JWT über Supabase Auth, entfernt rekursiv alle
   Objekte unter dem Nutzerpfad im Bucket `avatars` und löscht danach den
   Auth-Nutzer über den serverseitigen Admin-Client.
5. Erst nach bestätigtem Servererfolg entfernt die App private Realtime-
   Channels, lokale Supabase-Session, Account-Snapshot, Repository-Cache,
   Sync-Cursor, Outbox, Importentscheidung, Shared-Session-Outbox und ein
   gegebenenfalls vorhandenes lokales Profil. Danach ist der Modus `none`
   (Gastmodus).

Teilweise fehlende Storage-Objekte werden toleriert. Die Storage-Löschung
findet bewusst vor der Auth-Löschung statt, damit kein kontoloser Rest im
Bucket verbleibt. Scheitert die Storage-Bereinigung, wird der Auth-Nutzer nicht
gelöscht und der Aufruf kann wiederholt werden.

## Datenbank-Cascades

| Datenbereich | Löschweg |
|---|---|
| `auth.users` | Abschließende Löschung durch `auth.admin.deleteUser` in der Edge Function |
| `public.profiles`, `private.account_sync_state` | Direkter `ON DELETE CASCADE` vom Auth-Nutzer |
| `privacy_settings`, `subjects`, `goals`, `personal_goal_details`, `shared_goal_details`, `goal_participants`, `goal_pause_intervals` | Direkt oder transitiv über Profil/Ziel kaskadiert |
| `study_sessions`, `study_session_segments`, `grades`, `grade_sessions` | Direkt oder transitiv über Profil/Session/Note kaskadiert |
| `friendships` | Beide Profil-Fremdschlüssel kaskadieren; Beziehungen zur gelöschten Person verschwinden |
| `learning_presence` | Kaskadiert über Profil |
| `study_groups`, `study_group_members` | Eigene Mitgliedschaft kaskadiert; selbst erstellte Gruppe und damit alle Mitgliedschaften werden gelöscht |
| `shared_study_sessions`, `shared_study_session_participants` | Eigene Teilnahme kaskadiert; selbst erstellte Session und ihre Teilnahmen werden gelöscht |
| `private.import_batches`, `private.import_chunks`, `private.local_id_map` | Direkt beziehungsweise über Import-Batch kaskadiert |
| `private.mutation_receipts`, `private.rpc_rate_limits` | Kaskadiert über Profil |
| Realtime-Nachrichten | Nur kurzlebige Invalidierungen; kein eigener dauerhafter App-Datensatz |
| Profilbilder in `storage.objects` | Kein Auth-Cascade; werden vor der Auth-Löschung explizit über die Storage-API entfernt |
| Lokale App-Outbox und Account-Caches | Gerätespezifisch nach Servererfolg explizit entfernt |

Die Fremdschlüssel sind in den Migrationen
`20260718000100_social_schema.sql` und
`20260722000100_social_learning_hubs.sql` definiert. Änderungen am Schema
müssen diese Tabelle und die Löschtests mit aktualisieren.

## Noch nicht ausgeführtes Deployment

Die Function ist lokal vollständig unter
`supabase/functions/delete-account/` implementiert. Supabase stellt
`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` in der Function-Laufzeit bereit;
der Service-Role-Key darf nicht als `EXPO_PUBLIC_*` gesetzt werden.

Nach Review und ausdrücklicher Freigabe:

```bash
npx supabase functions deploy delete-account --project-ref <SUPABASE_PROJECT_REF>
npx supabase migration up --linked
```

Danach sind ein Testkonto mit Testdaten sowie die Fälle ungültiger/abgelaufener
JWT, fehlende Avatarobjekte, Storage-Fehler und wiederholter Aufruf in der
verknüpften Staging-/Produktionsumgebung zu prüfen. Diese Befehle wurden in
diesem Hardening nicht ausgeführt.
