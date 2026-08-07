# Öffentliche Datenschutz- und Kontolöschseiten

Die Expo-Router-Webausgabe enthält zwei statische, responsive Routen:

- `/datenschutz` – deutsche Entwurfsfassung der Datenschutzerklärung
- `/konto-loeschen` – Löschumfang und sicherer Weg zum authentifizierten
  In-App-/Web-Löschbereich

Die Kontolöschseite löscht niemals aufgrund einer frei eingegebenen
E-Mail-Adresse. Angemeldete Nutzer werden zum geschützten Löschbereich geleitet;
nicht angemeldete Nutzer zum Login. Der noch einzutragende Kontakt dient für
Zugriffsprobleme und eine separate Identitätsprüfung.

## Vor Hosting auszufüllen

- `[NAME/FIRMA EINFÜGEN]`
- `[LADUNGSFÄHIGE ANSCHRIFT EINFÜGEN]`
- `[KONTAKT-E-MAIL EINFÜGEN]`
- Rechtsgrundlagen nach tatsächlichem Geschäfts-/Nutzungsmodell
- Supabase-Vertragspartner, Projektregion, AVV, Unterauftragsverarbeiter und
  gegebenenfalls Transfermechanismus
- tatsächliche Logquellen und Löschfristen
- gesetzliche Aufbewahrungspflichten oder ausdrücklich „keine“ nach Prüfung
- zuständige Datenschutzaufsicht und finaler Freigabestand

Die redaktionelle Quelle der Datenschutzseite liegt in
`src/legal/privacy-content.ts`.

## Hosting – nicht ausgeführt

Nach dem Ausfüllen und rechtlicher Prüfung kann die statische Webausgabe auf
einem HTTPS-Host veröffentlicht werden. Beispiel für einen lokalen Export:

```bash
npx expo export --platform web
```

Der Inhalt von `dist/` ist anschließend auf dem gewählten HTTPS-Hosting zu
veröffentlichen. Alternativ kann EAS Hosting nach separater Freigabe verwendet
werden. Vor Eintrag in der Play Console müssen beide URLs ohne Login und ohne
App-Installation erreichbar, mobil lesbar und dauerhaft stabil sein. In
diesem Branch wurden weder Export noch Hosting noch DNS-Änderungen ausgeführt.
