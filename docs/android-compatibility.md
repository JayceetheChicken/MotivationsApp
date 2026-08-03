# Android-Kompatibilität und binäre Release-Prüfung

Stand: 3. August 2026

## Am generierten Nativprojekt verifiziert

Erzeugt mit `npx expo prebuild --platform android --clean` bei gesetzter
Produktionsumgebung. `android/` ist bewusst nicht eingecheckt: die Werte werden
aus `app.json` plus `app.config.js` erzeugt, damit Manifest und Konfiguration
nicht auseinanderlaufen können.

| Eigenschaft | Wert | Quelle |
| --- | --- | --- |
| `applicationId` | `de.lernzeit.app` | `android/app/build.gradle` |
| `versionName` | `1.0.0` | `android/app/build.gradle` |
| `versionCode` | aus `ANDROID_VERSION_CODE`, sonst `app.json` | `app.config.js` |
| `compileSdkVersion` | `36` | `android/gradle.properties` |
| `targetSdkVersion` | `36` | `android/gradle.properties` |
| `minSdkVersion` | `24` (Android 7.0) | `android/gradle.properties` |
| `buildToolsVersion` | `36.0.0` | `android/gradle.properties` |
| ABIs | `armeabi-v7a, arm64-v8a, x86, x86_64` | `reactNativeArchitectures` |
| Neue Architektur | `newArchEnabled=true` | `android/gradle.properties` |
| Hermes | `hermesEnabled=true` | `android/gradle.properties` |
| Edge-to-Edge | `edgeToEdgeEnabled=true` | `android/gradle.properties` |
| Native Libs | `expo.useLegacyPackaging=false` | `android/gradle.properties` |
| R8 / Ressourcen | `enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds` | `expo-build-properties` |
| Backup | `android:allowBackup="false"` | `AndroidManifest.xml` |
| Cleartext | `android:usesCleartextTraffic="false"` | `AndroidManifest.xml` |
| Orientierung | `android:screenOrientation="portrait"` | `AndroidManifest.xml` |
| Updates | `expo.modules.updates.ENABLED=false` | `AndroidManifest.xml` |

### Berechtigungen im generierten Manifest

Angefordert: `INTERNET`, `VIBRATE`, `READ_EXTERNAL_STORAGE` und
`WRITE_EXTERNAL_STORAGE` jeweils mit `android:maxSdkVersion="32"`.

Aktiv entfernt über `blockedPermissions` (`tools:node="remove"`): `CAMERA`,
`RECORD_AUDIO`, `READ_MEDIA_VIDEO`, `SYSTEM_ALERT_WINDOW`.

### Deep Links im generierten Manifest

```xml
<intent-filter data-generated="true">
  <data android:scheme="lernzeit" android:host="auth" android:path="/update-password"/>
</intent-filter>
<intent-filter android:autoVerify="true" data-generated="true">
  <data android:scheme="https" android:host="<betreiberdomain>" android:path="/update-password"/>
</intent-filter>
```

Der HTTPS-Host wird aus `EXPO_PUBLIC_LEGAL_SITE_URL` abgeleitet. Ein
Production-Build ohne gesetzte Domain bricht ab, es kann also kein
Platzhalter-Host in ein Release gelangen.

## 16-KB-Page-Sizes

`expo.useLegacyPackaging=false` bedeutet, dass native Bibliotheken unkomprimiert
und ausgerichtet verpackt werden. Das ist die Voraussetzung, ersetzt aber nicht
die Prüfung am fertigen Artefakt: 16-KB-Kompatibilität ist eine Eigenschaft
**aller tatsächlich enthaltenen `.so`-Dateien**.

Offizielle Quellen:

- [Expo SDK reference](https://docs.expo.dev/versions/latest/)
- [Google-Play-Target-API](https://developer.android.com/google/play/requirements/target-sdk?hl=de)
- [Android: 16-KB-Page-Sizes](https://developer.android.com/guide/practices/page-sizes)

Für neue Apps und Updates gilt ab 31. August 2026 Target API 36; der
Framework-Stand erfüllt diese Ziel-API. Seit 1. November 2025 müssen neue Apps
und Updates ab Android 15 / API 35 die 16-KB-Page-Sizes unterstützen.

## Am fertigen AAB zu prüfen

```bash
# 1. Alignment jeder nativen Bibliothek
unzip -o app-release.aab -d aab-inhalt
find aab-inhalt -name '*.so' -exec sh -c \
  'echo "== $1"; readelf -lW "$1" | awk "/LOAD/ {print \$NF}" | sort -u' _ {} \;
# Erwartet: 0x4000 (16384) oder groesser, niemals 0x1000

# 2. Bundle-Konfiguration
bundletool dump config --bundle=app-release.aab | grep -i page
# Erwartet: PAGE_ALIGNMENT_16K

# 3. Aus dem AAB ein universelles APK erzeugen und ausrichten pruefen
bundletool build-apks --bundle=app-release.aab --output=app.apks --mode=universal
unzip -p app.apks universal.apk > universal.apk
zipalign -c -P 16 -v 4 universal.apk

# 4. Manifest und ABIs im Artefakt
aapt2 dump badging universal.apk | grep -E "package:|sdkVersion|targetSdkVersion|native-code|uses-permission"

# 5. Installation auf einem 16-KB-Geraet oder -Emulator
adb shell getconf PAGE_SIZE      # erwartet 16384
adb install -r universal.apk

# 6. App-Links-Verifikation
adb shell pm get-app-links de.lernzeit.app
```

## Der noch notwendige externe Buildschritt

Ein von Google Play akzeptiertes Artefakt muss mit dem Play-App-Signing-Schlüssel
signiert sein. Dieser Schlüssel existiert ausschließlich im EAS- beziehungsweise
Play-Console-Kontext und liegt nicht im Repository. Der einzige verbleibende
Befehl lautet:

```bash
eas build --platform android --profile production
```

Voraussetzungen: angemeldetes EAS-Konto (`eas login`), verknüpftes Projekt
(`eas init`) und die vollständige Betreiberumgebung im EAS-Environment
`production`. Ohne diese Angaben bricht `app.config.js` den Build ab, bevor
Gradle startet.
