# Web-Authentifizierung und Android App Links

## Statischer Web-Build

Online-Kontoaktionen sind auf `Platform.OS === 'web'` deaktiviert. Gastmodus
und lokale Demo bleiben nutzbar. Damit werden keine Supabase-Sitzungen in
Browser-`localStorage` persistiert, solange keine serverseitige Architektur mit
`HttpOnly`, `Secure` und geeigneten `SameSite`-Cookies existiert.

`src/app/+html.tsx` setzt Meta-Policies, und `public/_headers` enthält die
Hosting-Header für CSP, `frame-ancestors 'none'`, MIME-Sniffing-Schutz,
`no-referrer` und eine restriktive Permissions Policy. Der Zielhost muss
`public/_headers` unterstützen oder dieselben Header in seiner Plattform-
Konfiguration setzen. Vor Release mit einem externen Header-Check verifizieren.

## Recovery-Transport pro Buildprofil

Der Passwort-Recovery-Transport wird **allein vom Buildprofil** entschieden, nicht
davon, ob eine Betreiberdomain gesetzt ist. Alles leitet sich aus
`config/auth-build.cjs` ab; `app.config.js`, der Parser in
`src/auth/navigation.ts` und `resetPasswordForEmail` lesen dasselbe Objekt.

Warum nicht „Domain vorhanden → HTTPS“: ein Development- oder Preview-Build kann
legitim die echten Betreiberwerte bekommen. Er würde dann einen App Link
beanspruchen, dessen Entwicklungssignatur nicht in der `assetlinks.json` der
Betreiberdomain steht — ein App Link, der nie verifiziert werden kann, auf einem
Build, dessen Recovery damit gar nicht funktioniert.

| | Production | Development / Preview / lokal |
| --- | --- | --- |
| `recoveryTransport` | `https-app-link` | `custom-scheme` |
| `redirectTo` | `https://<DOMAIN>/update-password?type=recovery` | `lernzeit://auth/update-password?type=recovery` |
| Expo-`scheme` | **keins** | `lernzeit` |
| Android-Intent-Filter | nur `autoVerify` App Link auf `<DOMAIN>` | `lernzeit`-Scheme plus `lernzeit://auth/update-password` |
| Parser akzeptiert | ausschließlich HTTPS auf `<DOMAIN>` | ausschließlich `lernzeit://auth` |

### Wahrheitstabelle

| Profil | Domain | Ergebnis |
| --- | --- | --- |
| `production` | öffentlich | HTTPS App Link |
| `production` | fehlt | Buildabbruch |
| `production` | privat/ungültig | Buildabbruch |
| `development` | keine | Custom Scheme |
| `development` | öffentlich | **trotzdem** Custom Scheme |
| `preview` | keine | Custom Scheme |
| `preview` | öffentlich | **trotzdem** Custom Scheme |
| unbekanntes Profil | egal | Buildabbruch |
| `EAS_BUILD_PROFILE` ≠ `EXPO_PUBLIC_BUILD_PROFILE` | egal | Buildabbruch |
| lokaler Start ohne Profil | egal | Development-Verhalten (`local`) |

### Das Buildprofil

`EXPO_PUBLIC_BUILD_PROFILE` ist die maßgebliche Eingabe. Nur diese Variable kann
Metro in das JavaScript-Bundle inlinen — `EAS_BUILD_PROFILE` existiert auf der
Buildmaschine, aber nirgends im Artefakt, die laufende App könnte ihr Profil sonst
also gar nicht kennen. Sie ist kein Geheimnis: sie beschreibt den Build, nicht den
Betreiber. `eas.json` setzt sie je Profil ausdrücklich.

Beide Variablen werden gelesen, damit ein Widerspruch auffällt statt still zu
einer Seite aufgelöst zu werden: ein EAS-`production`-Build, dessen öffentliches
Profil noch `development` sagt, würde sonst unter einem Production-Signaturschlüssel
den privaten Recovery-Transport ausliefern.

### Kein `lernzeit`-Scheme in Production

`app.json` enthält **kein** `scheme` mehr. Expo registriert ein in `expo.scheme`
angegebenes Scheme als allgemeinen eingehenden Deep Link, also könnte
`lernzeit://auth/update-password` die App auch dann noch öffnen, wenn der
spezifische Recovery-Intent-Filter entfernt ist. `app.config.js` setzt das Scheme
deshalb dynamisch: `lernzeit` für Development, Preview und lokale Starts, gar
keins für Production.

Ohne eigenes Scheme fällt Expo auf den Android-Paketnamen als Standard-Scheme
zurück. Das ist zulässig, weil der Recovery-Parser es nicht als Transport
akzeptiert: der eine Zweig verlangt `lernzeit:`, der andere `https:`.

Geprüft wird das an zwei Stellen — an der aufgelösten Expo-Config und, weil
dazwischen noch `@expo/config-plugins` steht, am wirklich erzeugten Manifest:

```bash
npx expo config --type public --json > expo-config.json
node scripts/verify-expo-config.mjs expo-config.json

npx expo prebuild --platform android --clean --no-install
node scripts/verify-native-linking.mjs android/app/src/main/AndroidManifest.xml
```

Beide laufen in CI für alle drei Profile, und jedes Manifest muss die Regeln des
jeweils anderen Profils **verletzen** — sonst prüft der Check nichts.

### Attestierung des gebauten Artefakts

`app.config.js` schreibt die aufgelöste Konfiguration flach serialisiert nach
`extra.authBuildAttestation`, inklusive `profile=`. `src/auth/build-configuration.ts`
liest sie zur Laufzeit zurück und vergleicht sie mit dem im Bundle inlinierten
Wert. Manifest, Bundle und Laufzeit müssen dasselbe Profil attestieren.

**Fehlende Attestierung ist fail-closed.** In einem Production-Build gilt:

| Zustand der Attestierung | Ergebnis |
| --- | --- |
| passt zum Bundle | Recovery aktiv |
| fehlt | Recovery deaktiviert |
| unlesbar oder manipuliert | Recovery deaktiviert |
| falsches Profil | Recovery deaktiviert |
| abweichender Host oder Transport | Recovery deaktiviert |

„Deaktiviert“ heißt: `recoveryTransport === 'disabled'`, `recoveryRedirectUrl`
ist leer, `sendPasswordReset()` bricht mit einer Meldung ab und
`parsePasswordRecoveryUrl()` akzeptiert nichts mehr. Es wird kein einzelnes Flag
umgelegt, sondern eine ausdrücklich leere Konfiguration gesetzt, damit auch ein
Aufrufer, der `PASSWORD_RECOVERY_AVAILABLE` vergisst, keine plausibel aussehende
URL in die Hand bekommt.

Einzige Ausnahme: ein lokaler Start (`npx expo start`, Unit-Test) ohne
eingebettetes Manifest, dessen Profil eindeutig nicht Production ist. Dort gibt
es kein Manifest zum Prüfen, der Transport ist ohnehin das private Schema, und
eine Verweigerung würde nur die Entwicklung blockieren.

`node scripts/check-exported-bundle.mjs dist` liest denselben String aus dem
gebauten Export — also den Wert, den die App tatsächlich verwendet — statt ihn
erneut aus den Umgebungsvariablen zu berechnen.

## iOS

**iOS ist derzeit kein Release-Ziel.** `eas.json` enthält kein iOS-Build- und
kein iOS-Submit-Profil, und es ist keine `associatedDomains`-Konfiguration
hinterlegt. Ohne Universal Links (Eintrag `applinks:<DOMAIN>` in
`associatedDomains` **und** eine unter `https://<DOMAIN>/.well-known/apple-app-site-association`
ausgelieferte AASA-Datei) öffnet ein HTTPS-Recovery-Link auf iOS nur den Browser
— ein HTTPS-Link allein genügt dort ausdrücklich nicht.

Diese Seite macht deshalb keine Universal-Link-Zusage für iOS. Soll iOS später
unterstützt werden, sind `associatedDomains`, die AASA-Datei und ein iOS-Buildprofil
nachzuziehen, bevor der Recovery-Flow dort beworben wird.

## Verifizierter Recovery-Link

Die Domain wird **an genau einer Stelle** gesetzt:

```bash
EXPO_PUBLIC_LEGAL_SITE_URL=https://<DEINE-DOMAIN>
```

Daraus leiten sich automatisch ab:

| Ziel | Ableitung |
| --- | --- |
| Verifizierter Android App Link | `app.config.js` → `intentFilters[].data.host` |
| Erlaubter HTTPS-Recovery-Callback | `src/auth/navigation.ts` → `VERIFIED_RECOVERY_HOST` |
| Öffentliche Kontolöschseite | `ACCOUNT_DELETION_PUBLIC_URL` |
| `assetlinks.json` | `scripts/build-public-pages.mjs` |
| Rechtstexte | `src/legal/operator.ts` |

Es gibt keine zweite Stelle, an der eine Domain hardcodiert wäre. Ein
Production-Build ohne gesetzte Domain bricht ab.

Die Domain muss **öffentlich nutzbar** sein. `config/public-host.cjs` prüft das
zentral und numerisch — nicht per String-Präfix — und lehnt unter anderem
`localhost`, `*.localhost`, `*.local`, Single-Label-Hosts, `0.0.0.0/8`,
`10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`,
`192.168.0.0/16`, `::`, `::1`, `fe80::/10`, `fc00::/7` sowie `*.invalid`,
`*.test` und `*.example` ab. Gültige Punycode-Domains (`xn--…`) funktionieren.
Eine reine IP-Adresse wird ebenfalls abgelehnt: Android verifiziert App Links
gegen einen Hostnamen.

Manuell bleibt nur die **Supabase-Auth-Redirect-Allowlist** im Dashboard, siehe
`docs/supabase-staging-deployment.md`.

### assetlinks.json

`public/.well-known/assetlinks.json` wird erzeugt. Der Fingerprint stammt aus
der Play Console unter *Test und Release → App-Integrität → App-Signaturschlüssel*:

```bash
ANDROID_SHA256_CERT_FINGERPRINTS="AA:BB:...:99" npm run release:pages
```

Ohne gesetzten Fingerprint schreibt das Skript eine leere Fingerprint-Liste und
weist ausdrücklich darauf hin. Ergebnis:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "de.lernzeit.app",
      "sha256_cert_fingerprints": ["<SHA-256 AUS DER PLAY CONSOLE>"]
    }
  }
]
```

Die Datei muss über HTTPS als `application/json`, ohne Redirect und ohne
Authentifizierung ausgeliefert werden. `public/_headers` setzt das bereits.

Der Parser akzeptiert nur HTTPS, den exakten Host, `/update-password`, den Typ
`recovery` und eine streng begrenzte Parameterkombination. Custom Scheme und
HTTPS-Link dürfen in Supabase nicht mit Wildcards freigegeben werden. Nach dem
Release-Build prüfen:

```bash
adb shell pm get-app-links de.lernzeit.app
adb shell am start -a android.intent.action.VIEW -d "https://<DOMAIN>/update-password?code=<TESTCODE>&type=recovery"
```

Keine echte Recovery-URL oder Tokens in Testprotokolle kopieren.
