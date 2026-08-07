# Funktions- und Gerätetestmatrix

Diese Matrix trennt streng, was im Repository automatisiert nachgewiesen ist,
von dem, was nur auf einem echten Gerät gegen ein echtes Supabase-Projekt
abgenommen werden kann. Die zweite Spalte darf erst nach einem tatsächlich
durchgeführten Test abgehakt werden.

## Legende

- **Automatisiert**: durch Jest, pgTAP oder den Supabase-API-E2E-Test abgedeckt.
  Die Angabe verweist auf die Datei, die den Fall prüft.
- **Gerät erforderlich**: benötigt einen signierten Build, ein reales Konto und
  eine echte Netzwerkstrecke.

## A. Start, Konto und Sitzung

| Fall | Automatisiert | Gerät erforderlich |
| --- | --- | --- |
| Gaststart ohne Konto | `__tests__/guest-mode.test.tsx` | Erststart nach Neuinstallation |
| Lokales Profil anlegen und ändern | `__tests__/local-profile-avatar.test.tsx` | – |
| Registrierung inklusive Regelzustimmung | `__tests__/auth-store.test.tsx`, `supabase/tests/008_privacy_moderation_deletion.sql` | Echte Bestätigungsmail zustellen |
| E-Mail-Bestätigung | – | Ja: SMTP, Spam-Ordner, Ablauf des Links |
| Anmeldung und Abmeldung | `__tests__/auth-store.test.tsx` | – |
| Abmelden mit lokaler Datenlöschung | `__tests__/account-local-cleanup.test.ts` | Prüfen, dass Daten anderer Konten bleiben |
| Passwort vergessen | `__tests__/auth-store.test.tsx` | Echte Reset-Mail |
| Recovery-Deep-Link | `__tests__/auth-navigation.test.ts` (Scheme, Host, Pfad, `type`, Replay, Session-Swap) | App-Link-Verifikation per `adb shell pm get-app-links` |
| Passwortänderung | `__tests__/auth-store.test.tsx` | – |
| Abgelaufene Sitzung | `__tests__/auth-store.test.tsx` | Token wirklich ablaufen lassen |
| Mehrere Konten auf einem Gerät | `__tests__/auth-store.test.tsx` (Storage-Scopes) | Kontowechsel mit echten Daten |

## B. Daten, Synchronisierung und Offline

| Fall | Automatisiert | Gerät erforderlich |
| --- | --- | --- |
| Import vom Gastkonto | `__tests__/study-state-transfer.test.ts`, `supabase/tests/003_import_idempotency.sql` | Import mit größerem Realbestand |
| Synchronisierung | `__tests__/supabase-repository.test.ts` | Zwei Geräte parallel |
| Offline-Betrieb | `__tests__/study-store.test.tsx` | Flugmodus während laufender Session |
| Outbox und Wiederverbindung | `__tests__/study-store-social.test.tsx` | Netzabbruch mitten in einer Mutation |
| Beschädigte lokale Daten | `__tests__/auth-storage.test.ts` | SQLite-Datei manuell beschädigen |
| Netzausfall bei kritischer Aktion | `__tests__/account-deletion.test.ts` | Löschung mit Netzabbruch wiederholen |

## C. Profilbild

| Fall | Automatisiert | Gerät erforderlich |
| --- | --- | --- |
| Hochladen, ändern, löschen | `__tests__/avatar-upload.test.ts`, `__tests__/study-store-avatar.test.tsx` | Echte Kamera-/Galeriebilder |
| Re-Encoding und Metadaten-Stripping | `__tests__/avatar-upload.test.ts` | Foto mit GPS-EXIF |
| Storage-Policies | `supabase/tests/004_avatar_storage.sql` | – |
| Bereinigung alter Objekte | `supabase/tests/004_avatar_storage.sql` | Race: zweimal schnell hintereinander ändern |

## D. Social

| Fall | Automatisiert | Gerät erforderlich |
| --- | --- | --- |
| Freund suchen und anfragen | `supabase/tests/002_social_workflows.sql` | Zwei echte Konten |
| Freund entfernen | `supabase/tests/002_social_workflows.sql` | – |
| Blockieren | `supabase/tests/008_privacy_moderation_deletion.sql` | Sichtbarkeit aus Sicht der blockierten Person |
| Inhalte melden | `supabase/tests/008_privacy_moderation_deletion.sql` | Moderationsweg des Betreibers |
| Gruppe erstellen | `supabase/tests/005_social_learning_hubs.sql` | – |
| Gemeinsames Ziel | `supabase/tests/005_social_learning_hubs.sql` | – |
| Gemeinsame Session | `supabase/tests/005_social_learning_hubs.sql` | Zwei Geräte gleichzeitig |
| Privacy-Freigaben | `supabase/tests/006_social_production_hardening.sql`, `007_access_matrix.sql` | Sichtbarkeit aus Freundessicht |
| Realtime-Invalidierung | `__tests__/realtime-service.test.ts`, `supabase/tests/007_complete_access_surface.sql` | Reale Netzwechsel |

## E. Export und Löschung

| Fall | Automatisiert | Gerät erforderlich |
| --- | --- | --- |
| Datenexport | `__tests__/account-data-export.test.ts` | Teilen-Dialog auf dem Gerät |
| Kontolöschung Erfolgsfall | `__tests__/account-deletion.test.ts`, `__tests__/account-deletion-function.test.ts` | Ja, vollständig |
| Falsches Passwort | `__tests__/account-deletion.test.ts` | – |
| JWT älter als fünf Minuten | `__tests__/account-deletion-function.test.ts` | Reale Wartezeit |
| Doppelte Anfrage / bereits gelöscht | `__tests__/account-deletion-function.test.ts` | Wiederholung nach Timeout |
| Übertragung gemeinsamer Inhalte | `supabase/tests/008_privacy_moderation_deletion.sql` | Gruppe mit mehreren Mitgliedern |
| Storage-Fehler beim Löschen | `__tests__/account-deletion-function.test.ts` | Bucket temporär sperren |
| Rückkehr in den Gastmodus | `__tests__/account-deletion.test.ts` | Nach echter Löschung |

## F. Geräteabdeckung

Mindestens abzudecken:

| Gerät | Android | Zweck |
| --- | --- | --- |
| Smartphone | aktuelle Version (API 36) | Hauptpfad, App Links, 16-KB-Page-Size |
| Smartphone | API 24–26 | Untere Grenze `minSdkVersion` |
| Tablet | aktuelle Version | Tablet-Layout und Store-Screenshots |

Auf dem aktuellen Gerät zusätzlich prüfen: `adb shell getconf PAGE_SIZE` gibt
`16384` aus, Installation aus dem AAB gelingt, `adb shell pm get-app-links
de.lernzeit.app` meldet den Status `verified`.

## Status

Die Spalte „Automatisiert“ ist vollständig grün: 367 Jest-Tests und 353
pgTAP-Tests sowie der Supabase-API-E2E-Test laufen in CI.

Die Spalte „Gerät erforderlich“ ist **offen**. Sie benötigt ein signiertes
Artefakt und ein reales Supabase-Projekt und kann aus dem Repository heraus
nicht abgeschlossen werden.
