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

Der Passwort-Recovery-Transport ist **strikt nach Buildprofil getrennt**. Alles
leitet sich aus `config/auth-build.cjs` ab; `app.config.js`, der Parser in
`src/auth/navigation.ts` und `resetPasswordForEmail` lesen dasselbe Objekt.

| | Production | Development / Preview |
| --- | --- | --- |
| `recoveryTransport` | `https-app-link` | `custom-scheme` |
| `redirectTo` | `https://<DOMAIN>/update-password?type=recovery` | `lernzeit://auth/update-password?type=recovery` |
| Android-Intent-Filter | nur `autoVerify` App Link auf `<DOMAIN>` | nur `lernzeit://auth/update-password` |
| Parser akzeptiert | ausschließlich HTTPS auf `<DOMAIN>` | ausschließlich `lernzeit://auth` |

Ein Production-Build registriert **keinen** privaten Recovery-Intent-Filter und
der Parser lehnt jeden `lernzeit://`-Recovery-Link ab. Grund: das private Schema
kann jede andere installierte App beanspruchen; ein verifizierter App Link nicht.
`node scripts/verify-expo-config.mjs` prüft beide Richtungen und scheitert, wenn
ein Production-Manifest einen privaten Recovery-Filter enthält.

Das allgemeine App-Scheme `lernzeit` in `app.json` bleibt bestehen. Expo Router
und der Development-Client brauchen es, um die App überhaupt zu öffnen. Es ist
technisch vom Recovery-Transport getrennt: entfernt wird in Production nur die
Recovery-Route auf diesem Schema, nicht das Schema selbst.

### Attestierung des gebauten Artefakts

`app.config.js` schreibt die aufgelöste Konfiguration flach serialisiert nach
`extra.authBuildAttestation`. `src/auth/build-configuration.ts` liest sie zur
Laufzeit zurück und vergleicht sie mit dem im Bundle inlinierten Wert; bei
Abweichung wird Passwort-Recovery in beide Richtungen deaktiviert.
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
