# GitHub-Härtung: Branch Protection, Required Checks, Secret-Hygiene

Alle Punkte sind **externe Aktionen** in den Repository-Einstellungen. Sie
lassen sich nicht aus dem Repository heraus erzwingen und wurden nicht
ausgeführt.

## 1. Branch Protection für `main`

Settings → Branches → Add branch ruleset, Ziel `main`:

| Einstellung | Wert |
| --- | --- |
| Require a pull request before merging | an |
| Required approvals | mindestens 1 (bei Einzelbetrieb: an lassen und bewusst per Bypass mergen) |
| Dismiss stale approvals on new commits | an |
| Require status checks to pass | an |
| Require branches to be up to date | an |
| Require conversation resolution | an |
| Require signed commits | empfohlen |
| Require linear history | an |
| Block force pushes | an |
| Restrict deletions | an |

## 2. Required Status Checks

Diese Checks laufen bei **jedem** Pull Request und eignen sich daher als
Pflichtchecks:

```text
Typecheck, tests, lint and Expo Doctor
Production release gate rejects placeholders
Deno format, lint and typecheck
Static production export
Analyze javascript-typescript
Analyze actions
Scan reachable Git history
Reject newly introduced vulnerable dependencies
```

**Achtung bei Supabase.** `.github/workflows/supabase.yml` ist auf
`paths: supabase/**` gefiltert und läuft daher nicht bei jedem PR. Ein
pfadgefilterter Workflow als Required Check blockiert Merges dauerhaft, weil der
Check bei nicht betroffenen PRs nie den Status `success` meldet. Zwei zulässige
Wege:

1. `Reset, lint, pgTAP and API E2E` **nicht** als Required Check eintragen und
   stattdessen organisatorisch verlangen, dass Supabase-PRs grün sind, oder
2. den Pfadfilter entfernen, sodass der Job immer läuft (kostet je PR rund vier
   Minuten Runner-Zeit).

## 3. Secret-Hygiene

Settings → Code security and analysis:

- Secret scanning: **an**
- Push protection: **an**
- Dependabot alerts und security updates: **an** (Dependabot-Konfiguration liegt
  bereits in `.github/dependabot.yml`)
- Private vulnerability reporting: **an**, danach eine echte Kontaktadresse in
  `SECURITY.md` eintragen

## 4. Actions-Berechtigungen

Settings → Actions → General:

- Workflow permissions: **Read repository contents and packages permissions**
- „Allow GitHub Actions to create and approve pull requests“: **aus**
- Fork-PRs erhalten keine Secrets (Standard beibehalten)

Alle Workflows setzen bereits `permissions: contents: read` auf Workflow-Ebene,
erhöhen nur einzelne Jobs auf `security-events: write` und verwenden
`persist-credentials: false` beim Checkout. Alle Actions sind auf einen
Commit-SHA gepinnt.

## 5. Historie

`.codex-remote-attachments/` ist im Release-Branch entfernt, per `.gitignore`
gesperrt und wird von `scripts/check-sensitive-files.mjs` blockiert. Die Dateien
sind weiterhin über ältere Commits erreichbar. Auswertung, Risikoeinschätzung
und der exakt ausführbare `git filter-repo`-Ablauf stehen in
`docs/repository-history-cleanup.md`. Der Rewrite erfordert einen Force-Push und
wurde bewusst nicht ausgeführt.
