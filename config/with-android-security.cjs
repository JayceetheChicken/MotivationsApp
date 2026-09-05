const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// Debug manifests have higher priority than main and dependency manifests.
// Keep the same network, permission and exported-component boundary in every
// variant. Development uses an HTTPS Metro tunnel and the app's launcher.
const DEBUG_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />
  <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" tools:node="remove" />
  <application android:usesCleartextTraffic="false" tools:replace="android:usesCleartextTraffic">
    <activity android:name="androidx.compose.ui.tooling.PreviewActivity" android:exported="false" tools:replace="android:exported" />
    <activity android:name="expo.modules.devlauncher.compose.AuthActivity" android:exported="false" tools:replace="android:exported" />
    <activity android:name="expo.modules.devlauncher.launcher.DevLauncherActivity" android:exported="false" tools:replace="android:exported" />
  </application>
</manifest>
`;

module.exports = function withAndroidSecurity(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    for (const variant of ['debug', 'debugOptimized']) {
      const directory = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', variant);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'AndroidManifest.xml'), DEBUG_MANIFEST, 'utf8');
    }
    return mod;
  }]);
};
