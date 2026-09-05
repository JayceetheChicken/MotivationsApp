# GitHub-Schutz vor dem Merge

Die folgenden Einstellungen werden außerhalb des Git-Repositorys verwaltet.
Sie werden durch diesen PR nicht automatisch geändert.

Für `main` ein aktives Ruleset mit PR-Pflicht, aktuellen Pflichtchecks,
aufgelösten Review-Konversationen, Schutz vor Force-Push und Branch-Löschung
verwenden. Eine menschliche Freigabe muss von einer berechtigten zweiten Person
kommen; keine Selbstfreigabe und keinen Bypass als Ersatz einplanen.

Pflichtchecks mit den exakt von GitHub angezeigten Namen auswählen:

- `Typecheck, tests, lint and Expo Doctor`
- `Production release gate rejects placeholders`
- `Deno format, lint and typecheck`
- `Static export per build profile`
- `Generated AndroidManifest.xml per build profile (production)`
- `Generated AndroidManifest.xml per build profile (development)`
- `Generated AndroidManifest.xml per build profile (preview)`
- `Generated AndroidManifest.xml per build profile (local)`
- `Reset, lint, pgTAP and API E2E`
- `Analyze javascript-typescript`
- `Analyze actions`
- `CodeQL`
- `Scan reachable Git history`
- `Scan the complete dependency tree / osv-scan`

Supabase läuft ohne Pfadfilter bei jedem PR. OSV scannt auch auf PRs den gesamten
Baum; der alte ausschließlich differenzielle Checkname muss in vorhandenen
Rulesets ersetzt werden. Kein Sicherheitsjob verwendet `continue-on-error`.

In den GitHub-Einstellungen außerdem Secret Scanning/Push Protection,
Dependabot und private Sicherheitsmeldungen einschalten, soweit für den
Repository-Typ verfügbar. Actions erhalten standardmäßig nur Leserechte;
Fork-PRs dürfen keine Secrets bekommen. Zugang und Wiederherstellung der
Maintainer-Konten durch MFA absichern.

Alte Fotoanhänge bleiben in der Git-Historie erreichbar. Falls deren Entfernung
gewünscht ist, den koordinierten Ablauf in `repository-history-cleanup.md`
separat durchführen. Ein History-Rewrite gehört nicht zum technischen PR-Fix.
