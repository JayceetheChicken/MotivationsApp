# Sicherheitscheckliste vor dem Produktions-Release

Stand: 2. August 2026. Diese Checkliste ist ein Freigabe-Gate. Ein Punkt gilt
erst dann als erledigt, wenn ein reproduzierbarer Nachweis (CI-Lauf,
Dashboard-Screenshot ohne Secrets, DNS-/HTTP-Prüfung oder Testprotokoll)
vorliegt. Niemals Token, Passwörter oder vollständige Recovery-URLs in den
Nachweis kopieren.

## Automatisch durch Tests abgesichert

- [ ] App-CI ist grün: `npm ci`, TypeScript, Jest, ESLint, Expo Doctor und
  `npm audit --omit=dev --audit-level=high`.
- [ ] Supabase-CI ist grün: lokaler Start, Reset aller Migrationen, DB-Lint,
  alle pgTAP-Tests und API-E2E-Tests.
- [ ] `007_complete_access_surface.sql` bestätigt das vollständige Inventar
  aller `public`-Tabellen, aktives RLS, die erlaubten SELECT-Tabellen, fehlende
  Direkt-Schreibrechte, Funktionsrechte, sichere Views und Definer-Settings.
- [ ] Die API-E2E-Matrix bestätigt für jede öffentliche Tabelle, dass `anon`
  nicht lesen und `authenticated` nicht direkt INSERT, UPDATE oder DELETE
  ausführen kann. Owner-/Fremd-SELECTs der freigegebenen Kerntabellen sind
  getrennt geprüft.
- [ ] Gitleaks scannt bei Push, Pull Request und wöchentlich die erreichbare
  Git-Historie. CodeQL analysiert JavaScript/TypeScript.
- [ ] Dependabot ist für npm und GitHub Actions aktiv; Updates werden einzeln
  gegen die Expo-SDK-Kompatibilität getestet.

## Im Code und in Migrationen abgesichert

- [ ] Der Produktions-Build verwendet ausschließlich eine `https://`-Supabase-
  URL. HTTP ist nur in Development-Builds und nur für `localhost`, `127.0.0.1`
  oder `::1` zulässig.
- [ ] Der einzige native Recovery-Callback lautet exakt
  `lernzeit://auth/update-password`. Android filtert Scheme, Host und Pfad;
  der Parser lehnt unbekannte Routen, doppelte Parameter, Zugangsdaten,
  Traversal, unvollständige Tokenpaare und fremde Domains ab.
- [ ] `service_role`, Secret Keys und Datenbankzugänge kommen weder in
  `EXPO_PUBLIC_*` noch in App-Konfigurationen, Builds oder Repository-Dateien
  vor. Nur Publishable-/Anon-Keys dürfen im Client stehen.
- [ ] Native Auth-Sitzungen verwenden ausschließlich `expo-secure-store`.
  Web-Sitzungen sind nur im Speicher und werden nicht in `localStorage`
  persistiert.
- [ ] Android-App-Backups sind mit `android.allowBackup=false` deaktiviert;
  SecureStore behält seine generierten Ausschlussregeln als zusätzliche
  Absicherung.
- [ ] Offline-Daten sind kontospezifisch benannt, beim Kontolöschen werden
  Cache, Cursor und Queues entfernt, manipuliertes JSON wird verworfen und
  Queue-/Payload-Größen sind begrenzt.
- [ ] Profilbilder verwenden zufällige UUID-Objekte ohne Upsert. Storage prüft
  Größe, MIME-Metadaten und Endung; der Client prüft zusätzlich Dateisignatur
  und Header-Abmessungen. Das Avatar-RPC setzt nur kanonische eigene Storage-URLs,
  und Cleanup löscht weder das aktuelle noch ein konkurrierend neueres Bild.
- [ ] RPCs bestimmen den Akteur mit `auth.uid()`. Fremde Besitz-IDs,
  ungültige Zeiten/Punkte/Statuswechsel, doppelte Teilnehmer und falsche
  private/shared Bindungen werden durch RPC-Prüfungen, Foreign Keys, CHECKs,
  Uniques und Trigger abgewiesen.
- [ ] Freundschaftsanfragen, Profile, Presence-Geräte, Gruppen, Teilnehmer,
  gemeinsame Ziele/Sessions und Importe besitzen serverseitige Raten- oder
  Mengenlimits.
- [ ] Produktionslogs enthalten keine Deep Links, Auth-Codes, Tokens,
  E-Mail-Adressen, Nutzerinhalte oder rohe Supabase-/PostgreSQL-Fehlerobjekte.

## Im Supabase-Dashboard zu prüfen

- [ ] **Auth / URL Configuration:** Eine echte produktive Site URL setzen.
  Redirect-Allowlist auf die tatsächlich verwendeten exakten URLs begrenzen.
  Kein `lernzeit://**`, kein allgemeines `https://**`, keine Tunnel- oder
  Vorschau-Domain. Der native Fallback ist exakt
  `lernzeit://auth/update-password`.
- [ ] **E-Mail-Bestätigung:** für Produktion aktivieren. Die lokale
  `supabase/config.toml`-Einstellung `enable_confirmations=false` ist nur für
  reproduzierbare lokale Tests bestimmt.
- [ ] **Password Policy:** mindestens 10 Zeichen konfigurieren und den Schutz
  vor geleakten/kompromittierten Passwörtern aktivieren. Keine unnötigen
  Zeichentyp-Zwangsregeln einführen.
- [ ] **Auth Rate Limits:** Limits für Signup, Login, Recovery, E-Mail-Versand
  und Token-Refresh anhand erwarteter Last setzen und mit Testkonten prüfen.
- [ ] **CAPTCHA/Turnstile:** für Signup, Login und Passwort-Reset aktivieren.
  Site Key nur öffentlich im Client; Secret ausschließlich im Dashboard.
  Die aktuelle App enthält bewusst keinen vorgetäuschten CAPTCHA-Flow ohne
  produktive Site-Konfiguration.
- [ ] **SMTP:** eigene Domain, SPF, DKIM, DMARC, Absender, Zustellbarkeit und
  generische/nicht enumerierbare Recovery-Texte prüfen.
- [ ] **E-Mail-Änderungen:** `double_confirm_changes` aktiviert lassen und den
  Ablauf mit alter und neuer Adresse testen.
- [ ] **MFA:** als nachfolgende Account-Sicherheitsstufe planen; Recovery-Codes
  und Supportprozess vor Aktivierung definieren.
- [ ] **Storage / avatars:** Bucket bleibt nur für Bilder öffentlich lesbar,
  hat 5 MiB Limit und erlaubt ausschließlich JPEG, PNG, WebP. Insert/Delete-
  Policies, aktuelle-Avatar-Schutz und verwaiste Objekte mit zwei Geräten
  testen.
- [ ] **RLS:** Security Advisor ausführen. Jede `public`-Tabelle mit dem
  Testinventar abgleichen; keine manuellen Zusatz-Grants oder Policies neben
  den Migrationen belassen. Auch Views und RPC-Rechte prüfen.
- [ ] **API-/DB-Limits:** PostgREST-Zeilenlimit, Statement-/Lock-Timeouts,
  Connection Limits und Ressourcenalarme festlegen. Rate-Limit- und
  Mutation-Receipt-Retention beobachten.
- [ ] **Legacy-Constraints:** Vorhandene Zeilen gegen alle als `NOT VALID`
  eingeführten `*_security_*`-Constraints prüfen, Altwerte bereinigen und die
  Constraints anschließend kontrolliert mit `VALIDATE CONSTRAINT` validieren.
- [ ] **Security Advisor:** nach jeder Schemaänderung erneut ohne ungeklärte
  High-/Critical-Befunde ausführen.
- [ ] **Produktions-Testkonten:** neue, unbestätigte, bestätigte, gesperrte und
  gelöschte Konten sowie abgelaufene Sessions abdecken. Testkonten danach
  entfernen.
- [ ] **Restore-/Löschtests:** Backup wiederherstellen, Account samt Storage-
  Objekten löschen und nachweisen, dass keine personenbezogenen Restdaten in
  Public/Private/Storage verbleiben.

## GitHub, Expo/EAS und Google Play

- [ ] GitHub Secret Scanning und Push Protection in den Repository-/Org-
  Einstellungen aktivieren. Gitleaks-Funde triagieren; echte Secrets extern
  rotieren und aus erreichbarer Historie entfernen.
- [ ] EAS-/Expo-Secrets inventarisieren, auf minimale Scopes begrenzen,
  rotieren und nur dem Production-Profil zuordnen. Keine Tokens in Logs oder
  PR-Secrets für Fork-Code bereitstellen.
- [ ] Google Play App Signing aktivieren; Upload-Key offline sichern,
  Zugriffsrechte minimieren und Verlust-/Rotationsprozess dokumentieren.
- [ ] Data-Safety-Formular und Datenschutzerklärung decken öffentlich abrufbare
  Profilbilder, Supabase-Verarbeitung, lokale Offline-Daten sowie Konto- und
  Datenlöschung ab.
- [ ] Play-Console-Link zur Kontolöschung ist öffentlich erreichbar und der
  In-App-Löschablauf wurde auf einem Release-Build getestet.
- [ ] Logging/Monitoring alarmiert auf Auth-Spikes, Rate-Limits, 5xx,
  fehlgeschlagene Deletes und Storage-Wachstum, ohne Nutzinhalte zu erfassen.
- [ ] Release-AAB auf einem echten Android-Gerät installieren; Sign-in,
  Recovery, Logout, Kontowechsel, Offline-Queue, Avatar-Race und Löschung
  testen. Zusätzlich prüfen, dass ADB/Cloud-Restore keine App-Daten übernimmt.

## Domain und verifizierte Android App Links

Es wurde bewusst keine Domain erfunden. Solange keine kontrollierte HTTPS-
Domain und keine gültige `assetlinks.json` vorliegen, verwendet Recovery das
eng begrenzte Custom Scheme. Vor dem finalen Release ist für verifizierte App
Links Folgendes extern nachzuholen:

1. Eine eigene HTTPS-Domain festlegen und unter
   `https://<domain>/.well-known/assetlinks.json` die Android-Paket-ID
   `de.lernzeit.app` sowie den SHA-256-Fingerprint des tatsächlichen Play-App-
   Signing-Zertifikats veröffentlichen.
2. Einen Android-Intent-Filter mit `https`, der exakten Domain,
   `autoVerify=true` und einem einzelnen Recovery-Pfad ergänzen.
3. Genau diese HTTPS-Recovery-URL in Supabase erlauben und den Parser erst dann
   um Scheme, Host und exakten Pfad erweitern.
4. Auf einem aus Google Play installierten Build mit `adb shell pm get-app-links
   de.lernzeit.app` und einem echten Recovery-Link die Verifikation testen.

## Verbleibendes Restrisiko Profilbilder und lokale Daten

Die Header-Dimensionsprüfung im Client erschwert Dekompressionsbomben, ist aber
keine vertrauenswürdige serverseitige Bilddekodierung. Supabase Storage prüft
Größe und MIME-Metadaten, dekodiert und re-encodiert Bilder jedoch nicht.
Vor breiter öffentlicher Nutzung sollte der Upload in einen privaten
Quarantäne-Bucket gehen; eine Edge Function oder ein dedizierter Image-Service
dekodiert mit Pixel-/Zeit-/Speicherlimits, entfernt Metadaten, re-encodiert in
JPEG/WebP und veröffentlicht erst danach das kanonische Objekt.

Die Expo-SQLite-basierte Offline-Datenbank ist nicht vollständig
anwendungsseitig verschlüsselt. Backups sind deaktiviert, Auth-Tokens liegen
nicht darin, Daten sind kontogetrennt und begrenzt; ein kompromittiertes oder
gerootetes entsperrtes Gerät kann lokale Lerninhalte dennoch auslesen. Eine
vollständige Verschlüsselung erfordert eine gesonderte Architektur- und
Schlüsselmanagement-Änderung.
