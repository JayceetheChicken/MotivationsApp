# Betreiberkonfiguration und Release-Gate

Alle rechtlich und technisch verpflichtenden Betreiberangaben von Lernzeit sind
an **einer** Stelle beschrieben: [`config/operator-fields.json`](../config/operator-fields.json).
Die Werte selbst stehen ausschliesslich in Umgebungsvariablen und niemals im
Repository.

## Wie es zusammenhaengt

| Datei | Rolle |
| --- | --- |
| `config/operator-fields.json` | Feldkatalog: Schluessel, Umgebungsvariable, Label, Pflicht/optional, Format, Beschreibung. Enthaelt keine Daten. |
| `config/release-config.cjs` | Die einzige Implementierung von Aufloesung und Validierung. Wird von App-Bundle, Expo-Config und CI identisch ausgefuehrt. |
| `src/legal/operator.ts` | Typisierte App-Sicht. Loest `OPERATOR` einmalig aus `process.env` auf. |
| `app.config.js` | Bricht Production-Builds ab und leitet App-Links-Host sowie `versionCode` ab. |
| `scripts/check-release-config.mjs` | Release-Gate fuer CI und lokale Pruefung. |
| `scripts/build-public-pages.mjs` | Erzeugt `public/account-deletion/index.html` und `public/.well-known/assetlinks.json`. |

Rechtstexte (Impressum, Datenschutz, Nutzungsbedingungen, Community-Regeln,
Kontolöschseite) lesen ausschliesslich aus `OPERATOR`. Es gibt keine
Klammer-Platzhalter mehr im Quelltext.

## Verhalten je Buildtyp

**Entwicklung** (`npm start`, `eas build --profile development|preview`)
Fehlende Pflichtangaben werden durch klar gekennzeichnete Testwerte ersetzt:
`Testwert: <Label> (nur Entwicklungsbuild)`, E-Mails auf `@lernzeit.invalid`,
Domain `https://lernzeit.invalid`. `.invalid` ist nach RFC 2606 reserviert und
niemals aufloesbar. Die Rechtstexte zeigen zusaetzlich einen deutlich sichtbaren
Warnhinweis. Die App bleibt vollstaendig benutzbar.

**Produktion** (`eas build --profile production`, `LERNZEIT_RELEASE_GATE=1`)
`app.config.js` wirft eine Ausnahme und der Build bricht ab, sobald eine
Pflichtangabe fehlt, noch ein Platzhalter ist oder ein falsches Format hat.
Erkannt werden unter anderem `example.invalid`, `your-project-id`, `[NAME/FIRMA]`,
`[KONTAKT]`, `TODO`, `Platzhalter`, `Testwert`, `... einfuegen`, `... ergaenzen`
sowie das Epoch-Datum `1970-01-01`.

## Pflichtangaben

Die verbindliche Liste steht im Feldkatalog. Aktueller Stand jederzeit abrufbar:

```bash
npm run release:report
```

Gate lokal erzwingen (exakt das, was der Production-Build tut):

```bash
npm run release:gate
```

### Vom Betreiber einzusetzende reale Angaben

| Umgebungsvariable | Inhalt |
| --- | --- |
| `EXPO_PUBLIC_LEGAL_SITE_URL` | Eigene HTTPS-Domain, die `/account-deletion/` und `/.well-known/assetlinks.json` ausliefert |
| `EXPO_PUBLIC_OPERATOR_NAME` | Name beziehungsweise Firma des Verantwortlichen |
| `EXPO_PUBLIC_OPERATOR_LEGAL_FORM` | Rechtsform und vertretungsberechtigte Person |
| `EXPO_PUBLIC_OPERATOR_ADDRESS` | Ladungsfaehige Anschrift |
| `EXPO_PUBLIC_OPERATOR_CONTACT_EMAIL` | Kontakt-E-Mail fuer das Impressum |
| `EXPO_PUBLIC_OPERATOR_PHONE` | Optional, darf leer bleiben |
| `EXPO_PUBLIC_OPERATOR_REGISTER` | Register und Nummer, oder ausdruecklich „Nicht eingetragen“ |
| `EXPO_PUBLIC_OPERATOR_SUPERVISORY_AUTHORITY` | Gewerbe-/Fachaufsicht, oder „Nicht einschlaegig“ |
| `EXPO_PUBLIC_OPERATOR_VAT_ID` | USt-IdNr. oder zulaessige Nichtangabe |
| `EXPO_PUBLIC_OPERATOR_DISPUTE_RESOLUTION` | Aussage zur Verbraucherstreitbeilegung |
| `EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL` | Datenschutzkontakt, auch fuer die externe Kontolöschseite |
| `EXPO_PUBLIC_PRIVACY_OFFICER` | Datenschutzbeauftragte Person oder „Nicht bestellt“ |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Support-Adresse, auch fuer den Play-Datensatz |
| `EXPO_PUBLIC_ABUSE_CONTACT_EMAIL` | Beschwerde- und Moderationskontakt |
| `EXPO_PUBLIC_DATA_PROTECTION_AUTHORITY` | Zustaendige Datenschutzaufsichtsbehoerde |
| `EXPO_PUBLIC_LEGAL_BASIS_ACCOUNT` | Rechtsgrundlage fuer Konto und Social-Funktionen |
| `EXPO_PUBLIC_SUPABASE_CONTRACT_PARTY` | Supabase-Vertragspartner laut Vertrag |
| `EXPO_PUBLIC_SUPABASE_REGION` | Region des Produktionsprojekts |
| `EXPO_PUBLIC_SUPABASE_DPA_REFERENCE` | AVV, Unterauftragsverarbeiter, Transfermechanismus |
| `EXPO_PUBLIC_PRODUCTION_SUBPROCESSORS` | Tatsaechlich aktive Dienstleister |
| `EXPO_PUBLIC_LOG_RETENTION_POLICY` | Logquellen, Zugriff, Loeschfristen |
| `EXPO_PUBLIC_STATUTORY_RETENTION` | Aufbewahrungspflichten oder geprueftes „Keine“ |
| `EXPO_PUBLIC_TERMS_LIABILITY` | Haftung, anwendbares Recht, Aenderungsverfahren |
| `EXPO_PUBLIC_LEGAL_EFFECTIVE_DATE` | Freigabedatum `YYYY-MM-DD` |
| `EXPO_PUBLIC_SUPABASE_URL` | Produktions-Projekt-URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable Key des Produktionsprojekts |

Diese Inhalte muss der Betreiber selbst bestimmen und rechtlich verantworten.
Das Repository erfindet sie bewusst nicht.

## Werte setzen

**EAS Build** (empfohlen). Environment `production` in der EAS-Weboberflaeche
oder per CLI befuellen; `eas.json` verknuepft das Profil `production` bereits mit
dieser Umgebung:

```bash
eas env:create --environment production --name EXPO_PUBLIC_OPERATOR_NAME --value "..." --visibility plaintext
```

**Lokal.** `.env.example` nach `.env.local` kopieren und ausfuellen. Die Datei ist
gitignoriert.

Alle Werte sind bewusst `EXPO_PUBLIC_*` und damit oeffentlich. Sie stehen ohnehin
im Impressum. Geheimnisse duerfen niemals unter diesem Praefix stehen.

## Nach jeder Aenderung der Betreiberangaben

```bash
npm run release:report
npm run release:pages
npm run release:gate
```

Danach `public/` neu veroeffentlichen, damit Kontolöschseite und `assetlinks.json`
zur ausgelieferten App passen.
