# E-Mail-Bestätigung in der Android-APK

Die dynamische `app.config.js` ist maßgeblich. Der APK-Workflow baut `preview`
mit Scheme `lernzeit` und einem expliziten VIEW/BROWSABLE/DEFAULT-Filter für
`lernzeit://auth/callback`. Signup übergibt diese URL als `emailRedirectTo`.
Vorher fehlte dieser Parameter, sodass Supabase auf die Site URL
`http://localhost:3000` zurückfiel; außerdem fehlte ein Signup-Callback-Handler.

`AuthStoreProvider` verarbeitet kalte und laufende App-Starts in einer gemeinsamen
Queue. Der Supabase-Client verwendet bereits PKCE und sicheren lokalen Storage.
Der Callback tauscht ausschließlich einmalige Codes gegen Sessions und reicht
eine vorhandene `sb_flow_id` weiter. Implizite Bearer-Token-Fragmente werden
weiterhin nicht importiert. Ein angemeldetes Konto wird nicht durch einen Link
ersetzt. Der Router erhält nur `/auth/callback`, keine Codes oder Tokens.
Danach geht es mit Session in die App, andernfalls mit einer Erklärung zum Login.
Die E-Mail-Verifizierung findet bei Supabase vor dem Redirect statt. Ohne lokalen
PKCE-Verifier (anderes Handy, Neuinstallation, älterer Link) ist deshalb eine
normale Passwort-Anmeldung nach erfolgter Bestätigung möglich.

## Supabase-Dashboard

Authentication → URL Configuration → Redirect URLs, exakt ohne Wildcards:

```text
lernzeit://auth/callback
lernzeit://auth/update-password?type=recovery
```

Im verbundenen Projekt `owoifhueznnsmwbrazmq` wurden beide Einträge geprüft bzw.
ergänzt. E-Mail-Bestätigung bleibt eingeschaltet. Die bestehenden Bestätigungs-
und Recovery-Vorlagen verwenden `{{ .ConfirmationURL }}`. Diese Variable erhalten;
nicht direkt auf `{{ .SiteURL }}` oder einen Token-Link zur App verweisen.

Die Site URL muss für diesen expliziten, freigegebenen App-Redirect nicht geändert
werden. Sie ist weiterhin `http://localhost:3000`; für andere Fallback-Flows sollte
der Betreiber dort seine tatsächlich erreichbare HTTPS-Seite setzen. Keine fremde
oder erfundene Domain eintragen. Alte E-Mails ändern sich dadurch nicht: nach
Installation der neuen APK einen neuen Signup/Bestätigungslink verwenden.
Eigenes SMTP bleibt für verlässliche Zustellung an beliebige Empfänger erforderlich.
Für diese Änderung sind keine neuen GitHub-Secrets oder privaten Client-Schlüssel nötig.

## Production-Sicherheit

Der angeforderte APK-Build ist Preview. Die vorhandene PR-#5-Regel für
Store-Production bleibt vollständig erhalten: kein privates Scheme, ausschließlich
der verifizierte HTTPS-App-Link auf der Betreiber-Domain. Dort nutzt Signup
`https://<Betreiberdomain>/update-password?type=signup` als vorhandenen nativen
Einstieg; `+native-intent.tsx` leitet ihn intern auf `/auth/callback` um. Recovery
bleibt beim gleichen HTTPS-Pfad mit `type=recovery`. Für spätere Store-Production
die genaue Signup-HTTPS-URL zusätzlich zur Recovery-URL freigeben und die
bestehenden Domain-/Signatur-/Release-Gates erfüllen. Private Preview-Schemes
gehören weiterhin nur in das entsprechende Testprojekt.

## Prüfung auf zwei Handys

1. Neue APK auf beiden Handys installieren; je ein eigenes Konto registrieren.
2. Jeweils den neuen Bestätigungslink auf dem Handy öffnen, das den Signup
   gestartet hat. Einmal mit vollständig geschlossener App testen, einmal mit
   geöffneter App. Die App muss öffnen und nach PKCE direkt anmelden.
3. Bestätigungslink erneut öffnen: keine zweite Session und kein Kontowechsel.
4. Auf dem anderen Handy öffnen: bei fehlendem Verifier erklärt der Login die
   Passwort-Anmeldung; keine fremde Session darf importiert werden.
5. Abmelden, Passwort-Reset anfordern, Mail auf demselben Handy öffnen,
   Passwort ändern und mit dem neuen Passwort anmelden.
6. Zwischen den Accounts Freundschaft anfragen/annehmen und gemeinsame
   Lernziele/Sessions prüfen; private Daten bleiben durch bestehende RLS geschützt.

Automatisch laufen Jest/TypeScript, die bestehenden Security- und DB-Tests sowie
`scripts/supabase-auth-email-e2e.mjs`: echtes lokales Supabase mit Mailpit,
Signup, tatsächliche Bestätigungsmail, Redirect, PKCE-Session, Replay-Abweisung
und vollständiger Passwort-Reset. Der Test verschickt keine externe E-Mail.
