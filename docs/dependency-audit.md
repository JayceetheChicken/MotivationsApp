# Abhängigkeits-Audit

Stand: 2026-08-06, Branch `codex/release-ready-consolidation`.

## Baseline

```bash
npm audit --omit=dev --audit-level=moderate
```

Ergebnis: **0 Befunde** (`info 0, low 0, moderate 0, high 0, critical 0`).

CI (`.github/workflows/checks.yml`, Job *App quality*) scheitert ab
`moderate`. Vorher stand die Schwelle auf `high`, während zwölf
Moderate-Advisories offen waren – der Lauf war grün, obwohl niemand die Befunde
gesehen hatte. Es gibt bewusst **keine** Allowlist-Datei: eine leere Baseline
ist die einzige, die keinen Befund verstecken kann. Ein neuer Moderate-Befund
lässt CI ab sofort fehlschlagen.

## Behobener Befund: GHSA-w5hq-g745-h8pq (`uuid`)

| Feld | Wert |
| --- | --- |
| Advisory | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| Titel | `uuid`: Missing buffer bounds check in v3/v5/v6 when `buf` is provided |
| Schweregrad | moderate (CVSS 7.5, CWE-787, CWE-1285) |
| Verwundbare Versionen | `< 11.1.1` |
| Vorher installiert | `uuid@7.0.3` |
| Dependency-Pfad | `lernzeit-app` → `expo@57.0.10` → `@expo/local-build-cache-provider@57.0.5` → `@expo/config@57.0.6` → `@expo/config-plugins@57.0.6` → `xcode@3.0.1` → `uuid@7.0.3` |
| Betroffene Phase | ausschließlich **Build-Zeit** |
| Erreichbarkeit im App-Code | keine |

### Warum die verwundbare API hier nicht erreichbar war

`xcode@3.0.1` ist der einzige Konsument von `uuid` im gesamten Baum
(`npm explain uuid`, und eine Suche über alle `package.json` in `node_modules`
findet genau einen weiteren Eintrag: die installierte Kopie selbst). `xcode`
ruft `uuid` an genau einer Stelle auf:

```js
// node_modules/xcode/lib/pbxProject.js
uuid = require('uuid');
// ...
var id = uuid.v4()
```

Die Advisory betrifft `v3`, `v5` und `v6`, und auch dort nur den Pfad, bei dem
ein `buf`-Argument übergeben wird. `v4()` ohne Argumente ist nicht betroffen.

Zusätzlich läuft `xcode` nur, wenn `@expo/config-plugins` eine
Xcode-Projektdatei schreibt – also bei `expo prebuild --platform ios`. Der Code
wird von Metro nie gebündelt und ist in der ausgelieferten Android-App nicht
vorhanden.

### Warum trotzdem behoben

Ein dauerhaft dokumentierter Ausnahmezustand ist teurer als ein Override, der
den Befund verschwinden lässt, und er verwässert die Baseline. `package.json`
enthält deshalb:

```json
"overrides": {
  "uuid": "^11.1.1"
}
```

`npm audit fix --force` wurde **nicht** verwendet: es hätte `expo` auf `46.0.21`
zurückgestuft (`isSemVerMajor: true`, elf Major-Versionen abwärts) und damit den
gesamten SDK-Stand zerstört.

### Verifikation des Overrides

* `uuid@11.1.1` ist installiert (`node -p "require('uuid/package.json').version"`).
* `require('uuid').v4()` liefert weiterhin eine 36 Zeichen lange UUID über den
  CJS-Einstiegspunkt – das ist die einzige API, die `xcode` benutzt.
* `npm ci` läuft ohne Peer- oder Resolutionsfehler durch.
* `npx expo prebuild --platform android --clean --no-install` erzeugt weiterhin
  ein korrektes `AndroidManifest.xml` (siehe `scripts/verify-native-linking.mjs`).
* `npx expo-doctor` meldet keinen zusätzlichen Befund.

Offener Punkt: der `xcode`-Pfad wird nur bei einem **iOS**-Prebuild wirklich
ausgeführt, und iOS-Prebuild ist unter Windows nicht möglich
(„Skipping generating the iOS native project files“). Der Override ist daher
über die API-Oberfläche und den Android-Prebuild verifiziert, nicht über einen
ausgeführten iOS-Prebuild. Das Projekt liefert kein iOS-Artefakt aus.

## Install-Skripte

`preinstall`, `install` und `postinstall` laufen bei jedem `npm ci` mit vollen
Benutzerrechten, bevor irgendein Test ausgeführt wurde. Der gesamte Baum enthält
genau ein Paket mit einem solchen Hook:

| Paket | Hook | Baum | Bewertung |
| --- | --- | --- | --- |
| `unrs-resolver@1.12.2` | `postinstall: node postinstall.js` | nur `devDependencies`, über `eslint-config-expo` → `eslint-import-resolver-typescript` | erlaubt: wählt das plattformpassende napi-Binary aus; nicht im Produktionsbaum, nicht in der App |

Der Produktions-Dependency-Baum (`npm ls --omit=dev`) enthält **kein** Paket mit
Install-Hook.

`scripts/check-install-scripts.mjs` erzwingt genau diese Liste und läuft in CI.
Ein neu hinzukommendes Install-Skript lässt den Job fehlschlagen, bis es
begründet eingetragen wurde.

`prepare` und `prepublish` werden bewusst nicht geprüft: npm führt sie für
Registry-Abhängigkeiten nicht aus, nur für das Wurzelprojekt und für
Git-Abhängigkeiten. Dieses Projekt hat keine Git-Abhängigkeiten.

## GitHub-Actions

Der Runner warnte, dass die auf v4 gepinnten Actions eine Node-20-Runtime
deklarieren. Alle Actions sind jetzt auf eine offiziell unterstützte Version mit
`using: node24` aktualisiert und weiterhin auf den vollen Commit-SHA gepinnt:

| Action | vorher | jetzt | Runtime |
| --- | --- | --- | --- |
| `actions/checkout` | `11d5960…` (v4) | `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) | `node24` |
| `actions/setup-node` | `49933ea…` (v4) | `820762786026740c76f36085b0efc47a31fe5020` (v7.0.0) | `node24` |
| `github/codeql-action/init` und `/analyze` | `47be0db…` (v3) | `18420e3271f74589575af831a523c833acda327f` (codeql-bundle-v2.26.2) | `node24` |
| `denoland/setup-deno` | `e95548e…` (v2.0.3) | `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed` (v2.0.5) | `node24` |

Unverändert, weil bereits aktuell beziehungsweise ohne Node-Runtime:
`google/osv-scanner-action` (v2.3.8, wiederverwendbarer Workflow),
`gitleaks/gitleaks-action` (v2), `supabase/setup-cli` (v3.0.0).

Die minimalen Workflow-Berechtigungen (`permissions: contents: read`, erweitert
nur dort, wo CodeQL `security-events: write` braucht) und
`persist-credentials: false` bei jedem Checkout bleiben unverändert.
