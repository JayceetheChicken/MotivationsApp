# Bereinigung der Codex-Anhänge aus der Git-Historie

## Befund

Unter `.codex-remote-attachments/019f4bcf-…/7e1d6e85-…/` sind seit Commit
`a9dc834` („Update Lern-App“) zwei Dateien getrackt:

| Datei | Größe | Inhalt |
| --- | --- | --- |
| `1-Photo-1.jpg` | 44 132 B | Screenshot der Statistik-Seite, Expo Go, 576 × 1280 |
| `2-Photo-2.jpg` | 48 855 B | Screenshot der Statistik-Detailansicht, Expo Go, 576 × 1280 |

Auswertung der Dateien (Stand dieser Prüfung):

- **Keine Secrets.** Keine Tokens, Schlüssel, Zugangsdaten oder URLs mit
  Anmeldeinformationen sichtbar.
- **Keine EXIF- und keine GPS-Daten.** Die JPEG-Segmente enthalten nur `APP0`
  (JFIF) und `APP2` (ICC-Profil); ein `APP1`/EXIF-Block ist nicht vorhanden.
- **Personenbezug gering, aber vorhanden.** Sichtbar sind Aufnahmezeitpunkt und
  Datum, Geräte-Statusleiste (Mobilfunk, Akku, Bluetooth) sowie ein sehr kleines
  Profilbild-Thumbnail in der Benachrichtigungspille. Testdaten der App selbst
  („3 Min. Mathematik“) sind keine echten personenbezogenen Lerndaten Dritter.

**Bewertung:** kein Sicherheitsvorfall und kein Secret-Leak. Die Dateien gehören
aber nicht in ein öffentliches Repository. Der Release-Branch entfernt sie aus
dem Tree, `.gitignore` sperrt den Ordner und `scripts/check-sensitive-files.mjs`
verhindert ein erneutes Tracking.

**Status des Rewrites:** Die Dateien sind weiterhin über ältere Commits
abrufbar, insbesondere über `main`. Die folgende History-Neuschreibung wurde
**nicht ausgeführt**. Sie erfordert einen Force-Push, invalidiert die Commit-IDs
aller offenen Pull Requests (#2, #3, #4) und jedes vorhandenen Klons. Angesichts
des geringen Sensibilitätsgrades ist sie optional und ausschließlich nach
ausdrücklicher Freigabe des Repository-Eigentümers durchzuführen.

## Sichere Vorbereitung

1. Schreibzugriffe auf das Repository vorübergehend koordinieren und offene
   Pull Requests dokumentieren; ihre Commit-IDs ändern sich durch den Rewrite.
2. In einem neuen, separaten Verzeichnis einen Mirror-Klon erstellen:

   ```bash
   git clone --mirror https://github.com/JayceetheChicken/MotivationsApp.git MotivationsApp-cleanup.git
   cd MotivationsApp-cleanup.git
   git bundle create ../MotivationsApp-before-attachment-cleanup.bundle --all
   ```

3. `git filter-repo` aus einer vertrauenswürdigen Paketquelle installieren und
   die Version protokollieren:

   ```bash
   git filter-repo --version
   ```

## Lokale Neuschreibung und Prüfung

Im Mirror-Klon:

```bash
git filter-repo --path .codex-remote-attachments/ --invert-paths
git log --all -- .codex-remote-attachments/
git rev-list --objects --all | grep '.codex-remote-attachments/'
git fsck --full
```

Die beiden Suchbefehle dürfen keine Anhänge mehr ausgeben. Die Bundle-Datei
ist bis zur erfolgreichen Verifikation offline und zugriffsgeschützt
aufzubewahren und anschließend gemäß der eigenen Löschrichtlinie zu entfernen.

Anschließend im Mirror-Klon erneut mit Gitleaks über die vollständige Historie
prüfen:

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source=/repo --log-opts=--all --redact --verbose
```

## Remote-Aktualisierung – nur nach Freigabe

`git filter-repo` entfernt üblicherweise den Remote. Erst nach Prüfung wieder
setzen und dann die umgeschriebenen Branches und Tags veröffentlichen:

```bash
git remote add origin https://github.com/JayceetheChicken/MotivationsApp.git
git push --force --all origin
git push --force --tags origin
```

Das ist ein destruktiver Force-Push. Branch-Schutz muss gegebenenfalls
zeitlich eng begrenzt angepasst werden. Danach müssen lokale Klone neu geklont
oder sorgfältig auf die neuen Commit-IDs gesetzt und offene PRs neu erstellt
werden. GitHub-Caches/Forks können Kopien behalten; falls die Bilder als
besonders sensibel eingestuft werden, ist zusätzlich der GitHub-Support für
eine Sensitive-Data-Bereinigung zu kontaktieren.
