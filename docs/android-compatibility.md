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

## Ergebnis des lokalen Release-Builds

Ausgeführt am 3. August 2026 mit `./gradlew :app:bundleRelease` bei vollständiger
Produktionsumgebung. `BUILD SUCCESSFUL in 56m 26s`, 591 Tasks.

Artefakt: `android/app/build/outputs/bundle/release/app-release.aab`,
**75 817 432 Byte (72,3 MiB)**.

**Wichtig:** Dieses AAB ist mit dem Debug-Keystore der React-Native-Vorlage
signiert (`signingConfigs.debug`). Es ist ein technischer Nachweis, **kein
hochladbares Play-Artefakt**. Der Upload-Schlüssel liegt in EAS beziehungsweise
Play App Signing.

### Am fertigen AAB verifiziert

| Prüfung | Ergebnis |
| --- | --- |
| Paketname | `de.lernzeit.app` |
| `versionCode` / `versionName` | `1` / `1.0.0` |
| `minSdkVersion` / `targetSdkVersion` | `24` / `36` |
| `allowBackup` | `false` |
| `usesCleartextTraffic` | `false` |
| Orientierung | `portrait` |
| ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` – beide 64-Bit-Varianten vorhanden |
| Native Bibliotheken | 100 `.so`-Dateien, 25 je ABI |
| DEX | 3 Dateien, zusammen 15,9 MB |
| Deep Links | privates Scheme `lernzeit` und `autoVerify`-App-Link auf der konfigurierten Domain |
| Secret-Scan über 1280 Dateien | 0 Treffer (service_role, `sb_secret_`, private Keys, GCP-Service-Accounts, AWS-Keys, Postgres-URIs mit Passwort) |
| Betreiberangaben im JS-Bundle | vorhanden und korrekt aufgelöst |

### 16-KB-Page-Size: bestanden

Alle LOAD-Segmente jeder nativen Bibliothek wurden direkt aus den ELF-Headern
im AAB gelesen:

| ABI | LOAD-Segment-Alignment |
| --- | --- |
| `arm64-v8a` | `0x4000` (16384) |
| `x86_64` | `0x4000` (16384) |
| `armeabi-v7a` | `0x1000` und `0x4000` |
| `x86` | `0x1000` und `0x4000` |

**Jede 64-Bit-Bibliothek ist auf mindestens 16 KB ausgerichtet.** Die
32-Bit-ABIs sind nicht betroffen: Android führt 16-KB-Page-Sizes ausschließlich
auf 64-Bit-Geräten ein.

### Angeforderte Berechtigungen im finalen Manifest

```text
android.permission.INTERNET
android.permission.VIBRATE
android.permission.ACCESS_NETWORK_STATE      (Netzstatus, Offline-Modus)
android.permission.ACCESS_WIFI_STATE         (Netzstatus, Offline-Modus)
android.permission.USE_BIOMETRIC             (expo-secure-store)
android.permission.USE_FINGERPRINT           (expo-secure-store)
android.permission.READ_EXTERNAL_STORAGE     maxSdkVersion=32
android.permission.WRITE_EXTERNAL_STORAGE    maxSdkVersion=32
de.lernzeit.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION   (app-privat)
```

`CAMERA`, `RECORD_AUDIO`, `READ_MEDIA_VIDEO` und `SYSTEM_ALERT_WINDOW` sind im
finalen Manifest **nicht** enthalten.

Der String `android.permission.DUMP` kommt im Manifest vor, wird aber **nicht
angefordert**. Er steht als `android:permission` auf
`androidx.profileinstaller.ProfileInstallReceiver` und schützt diesen Empfänger,
sodass ihn nur ein Aufrufer mit DUMP-Recht (adb/Shell) auslösen kann.

### Zwei ungenutzte Entwicklungskonstanten im String-Table

Das Hermes-Bundle enthält je einmal `lernzeit.invalid` und den Hinweistext mit
dem Wort „Testwerten“. Beide stammen aus dem nicht genommenen Zweig der
Entwicklungs-Fallbacks und werden zur Laufzeit nie ausgegeben, weil alle Werte
gesetzt sind. Die tatsächlich gerenderten Angaben im Bundle sind die
konfigurierten. Es handelt sich um tote Konstanten, nicht um ausgelieferte
Platzhalter.

## 16-KB-Page-Sizes: Hintergrund

`expo.useLegacyPackaging=false` bedeutet, dass native Bibliotheken unkomprimiert
und ausgerichtet verpackt werden. Das ist die Voraussetzung; entscheidend bleibt
die oben durchgeführte Prüfung **aller tatsächlich enthaltenen `.so`-Dateien**.

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
