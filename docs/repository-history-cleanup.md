# Bereinigung der Codex-Anhänge aus der Git-Historie

## Befund

Unter `.codex-remote-attachments/` waren seit Commit `a9dc834` zwei
Smartphone-Screenshots getrackt. Sie zeigen Lernzeit-Screens, Aufnahmezeitpunkte
und Geräte-Statusinformationen; in einem öffentlichen Repository sind sie als
personenbezogene beziehungsweise private Anhänge zu behandeln.

Der Release-Branch entfernt die Dateien und ignoriert den gesamten Ordner.
Damit sind sie jedoch noch aus älteren Commits abrufbar. Die folgende
History-Neuschreibung wurde **nicht** ausgeführt und darf erst nach
ausdrücklicher Freigabe und Koordination mit allen Mitwirkenden erfolgen.

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
