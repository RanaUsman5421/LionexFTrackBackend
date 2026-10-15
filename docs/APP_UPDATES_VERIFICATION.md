# App updater verification

- Final signed release: 1.2 / versionCode 3.
- APK: fieldtrack/apks/26fd953c-6ca9-47e1-acd0-d85a14da9407.apk (6931398 bytes).
- SHA-256: 81a849196b03f1fb7792dd188f38e0f44be7a905bad8acabbe7fa69f212e9187.
- Final Android assembleRelease succeeds, with serialization keep rules. Release mapping preserves ApiMessageResponse/PharmaOrdersResponse class names. Signed APK verified with apksigner and aapt against the pinned certificate/package/non-debug requirements.
- Two JUnit scheduler tests pass (before noon, noon, once per successful local day, next day, missed offline dates and local timezone). Run with isolated cached Kotlin/JUnit compiler; this project's AGP does not expose testReleaseUnitTest.
- Backend existing regression suite: 95 passed, 0 failed.
- Real APK release tests pass: default-deny allowlist permissions, correct admin/user principal isolation, wrong certificate rejection, concurrent duplicate rejection, draft/publish/withdraw, APK SHA-256, byte-range resume, tamper rejection and unauthorized administration.
- Actual http://127.0.0.1:3002 latest endpoint serves build 3. Full HTTP APK download matches size/hash; Range request returns 206 with expected bytes.
- Dashboard targeted ESLint and production build pass. Binary Blob upload remains binary; existing JSON/FormData/auth payload behavior tested unchanged. Existing bundle-size warning remains.
- Platform release admin access is empty/disabled as requested. Initial publish was local CLI only. No application business data was modified by updater tests. Temporary release test catalogs/APKs are removed.
- Private signing files have owner/SYSTEM/Administrators access rules; no passwords/private key material printed in logs or included in APK storage. Android .gitignore excludes signing.properties and .private-signing/. APK/catalog storage excluded by backend .gitignore.
- No connected-device APK installation, actual upgrade, offline reconnect timing or battery/background timing was tested. Official Android user-confirmed installer and unknown-source permission must be exercised on a device. Different-key old apps cannot be updated with this new key; do not uninstall unsynced data.
