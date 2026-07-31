# Android-Kompatibilität und binäre Release-Prüfung

Stand: 31. Juli 2026

## Lokal belegter Stand

- Expo SDK `57.0.9`, React Native `0.86.2`, React `19.2.3`
- Expo SDK 57 verwendet laut offizieller SDK-Tabelle `compileSdkVersion 36`,
  `targetSdkVersion 36` und unterstützt Android 7 und höher.
- `de.lernzeit.app` und App-Version `1.0.0` sind im aufgelösten Expo-Config
  bestätigt.
- Das EAS-Production-Profil erzeugt ein AAB, verwendet die EAS-Umgebung
  `production`, Remote-Versionierung und `autoIncrement`.

Offizielle Quellen:

- [Expo SDK reference](https://docs.expo.dev/versions/latest/)
- [Google-Play-Target-API](https://developer.android.com/google/play/requirements/target-sdk?hl=de)
- [Android: 16-KB-Page-Sizes](https://developer.android.com/guide/practices/page-sizes)

Für neue Apps und Updates gilt ab 31. August 2026 Target API 36. Der
Framework-Stand erfüllt diese Ziel-API bereits. Seit 1. November 2025 müssen
neue Apps und Updates, die Android 15/API 35 oder höher adressieren, 16-KB-
Page-Sizes unterstützen.

## Was ohne finales Artefakt nicht bewiesen werden kann

React Native und mehrere Expo-Pakete enthalten native Bibliotheken. Obwohl der
aktuelle Expo-/React-Native-Stand für moderne Android-Toolchains ausgelegt ist,
ist die 16-KB-Kompatibilität eine Eigenschaft **aller tatsächlich im AAB/APK
enthaltenen `.so`-Dateien und ihrer Paketierung**. Da gemäß Auftrag kein EAS-
Build ausgeführt wurde, bleiben folgende Prüfungen offen:

- Play Console / App Bundle Explorer meldet keine 16-KB-Inkompatibilität.
- `bundletool dump config --bundle=<AAB>` zeigt `PAGE_ALIGNMENT_16K`.
- Jede native ELF-Library hat LOAD-Segment-Alignment mindestens `2**14`.
- Ein aus dem AAB erzeugtes APK besteht `zipalign -c -P 16 -v 4 <APK>`.
- Installation und Kernabläufe laufen in einem Android-15+-Emulator/Gerät mit
  `adb shell getconf PAGE_SIZE` = `16384`.
- 64-Bit-ABIs, min/target SDK, Berechtigungen und unterstützte Geräte stimmen
  im finalen Bundle Explorer.

Die offizielle Android-Anleitung empfiehlt AGP 8.5.1+ und bei selbst
kompiliertem NDK-Code NDK r28+; vorgefertigte Abhängigkeiten müssen ebenfalls
16-KB-kompatibel sein. Diese Werte dürfen nicht aus einem JavaScript-Dependency-
Lockfile abgeleitet, sondern müssen am Buildartefakt geprüft werden.
