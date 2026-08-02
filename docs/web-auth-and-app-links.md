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

Die Platzhalterdomain `lernzeit.example.invalid` muss zentral durch eine echte,
kontrollierte HTTPS-Domain ersetzt werden in:

- `src/auth/navigation.ts`,
- `src/legal/configuration.ts` beziehungsweise `EXPO_PUBLIC_LEGAL_SITE_URL`,
- `app.json`,
- Supabase Auth Redirect-Allowlist,
- statischer Kontolöschseite und Rechtstexten.

Auf der echten Domain muss ohne Redirect unter
`https://<DOMAIN>/.well-known/assetlinks.json` eine Datei dieses Schemas
ausgeliefert werden:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "de.lernzeit.app",
      "sha256_cert_fingerprints": [
        "<SHA-256-FINGERPRINT-DES-GOOGLE-PLAY-APP-SIGNING-ZERTIFIKATS>"
      ]
    }
  }
]
```

Der Parser akzeptiert nur HTTPS, den exakten Host, `/update-password`, den Typ
`recovery` und eine streng begrenzte Parameterkombination. Custom Scheme und
HTTPS-Link dürfen in Supabase nicht mit Wildcards freigegeben werden. Nach dem
Release-Build prüfen:

```bash
adb shell pm get-app-links de.lernzeit.app
adb shell am start -a android.intent.action.VIEW -d "https://<DOMAIN>/update-password?code=<TESTCODE>&type=recovery"
```

Keine echte Recovery-URL oder Tokens in Testprotokolle kopieren.
