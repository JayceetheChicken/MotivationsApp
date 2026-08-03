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
