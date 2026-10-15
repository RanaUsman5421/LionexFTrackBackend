# FieldTrack backend-hosted Android updater

## Current setup

- Signed updater bootstrap release: version 1.2, versionCode 3, package com.example.lionexftrack.
- Local APK uses http://127.0.0.1:3002 (USB adb reverse or emulator networking as appropriate).
- Backend stores immutable APKs in fieldtrack/apks/<release-id>.apk and release metadata in fieldtrack/catalog.json. Metadata updates use an atomic rename and cross-process directory lock. No application database collections are changed.
- New APKs are draft until explicitly published. Published versions must increase. Withdraw stops new downloads; it cannot undo installations. Ship a higher version code to correct a bad release.
- Release administration is denied to everyone by default. Per user instruction APP_RELEASE_ADMIN_IDS is empty. Dashboard App Updates stays hidden. Local CLI remains usable by the server operator.
- Automatic check: once per local calendar day, not before 12:00 noon. Network-constrained WorkManager retries offline/failed checks. Foreground entry catches a missed check after noon. Android may delay work due to Doze/battery restrictions; this is not an exact alarm. The app must be opened once to initialize scheduling. A force-stopped app cannot perform background checks until opened again.
- Settings > Check for updates is a manual check and bypasses the daily automatic limit.

## Private signing material

Private Android folder: ../LionexFTrack/.private-signing/

- fieldtrack-release.p12: permanent keystore.
- release-credentials.json: alias and passwords, in one private reference file.
- certificate-sha256.txt: public certificate fingerprint.

../LionexFTrack/signing.properties is the local Gradle configuration. Both this file and .private-signing/ are Git-ignored. Never upload the private key, passwords or signing.properties to the backend/CDN. Keep an encrypted offline backup of the private folder and signing.properties. Losing the key prevents compatible future updates. Existing installations signed with another/debug key cannot be updated with this new key. Do not uninstall an existing app with unsynced records; first arrange a safe migration/sync of its data.

## Local first installation and download test

1. Start/restart this backend: npm run dev (port 3002).
2. Connect a mobile and authorize USB debugging.
3. Run PowerShell (choose the actual device serial):

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s DEVICE_SERIAL reverse tcp:3002 tcp:3002
```

4. Install the signed bootstrap APK from fieldtrack/apks/ (or ../LionexFTrack/app/build/outputs/apk/release/app-release.apk). A differently signed old installation requires separate migration planning, not blind uninstall.
5. Open app Settings > Check for updates. With build 3 installed and build 3 published, it correctly says latest version. Publish build 4 or higher to test the actual upgrade prompt/download/install path.
6. Check local metadata: http://127.0.0.1:3002/api/app-updates/latest. Its downloadPath points to the APK endpoint. The endpoint supports HTTP range downloads.

## Next update: one helper command

From the Android project folder, after making code changes:

```powershell
.\tools\publish-app-update.ps1 -VersionCode 4 -VersionName '1.3' -BackendUrl 'http://127.0.0.1:3002/' -Notes 'Describe changes here'
```

This builds with the permanent key, verifies APK signature/package/non-debug metadata, calculates its hash and saves a DRAFT into the sibling backend storage. Use a new unused version code on every attempt that has already been registered. Without -Publish it does not offer the release to users.

After testing, from the backend folder:

```powershell
node scripts/manage-app-release.js list
node scripts/manage-app-release.js publish RELEASE_ID
```

To build, register and publish together after appropriate testing:

```powershell
.\tools\publish-app-update.ps1 -VersionCode 5 -VersionName '1.4' -BackendUrl 'https://YOUR_BACKEND_HOST/' -Notes 'Describe changes here' -Publish
```

The helper registers into the local sibling backend; it is not a remote deployment/upload command. Deploy/sync the full fieldtrack directory to the production persistent volume separately, or later grant a platform admin access and upload through the dashboard. Preserve both catalog.json and its referenced APKs together. Do not copy a live catalog while another upload/publish is in progress.

Alternative manual build/register:

```powershell
# Android folder
.\gradlew.bat :app:assembleRelease '-PAPP_VERSION_CODE=4' '-PAPP_VERSION_NAME=1.3' '-PAPP_API_BASE_URL=https://YOUR_BACKEND_HOST/'
# Backend folder
node scripts/manage-app-release.js add ../LionexFTrack/app/build/outputs/apk/release/app-release.apk 'Release notes'
node scripts/manage-app-release.js publish RELEASE_ID
node scripts/manage-app-release.js withdraw RELEASE_ID
```

## Production configuration

### Invitation download button

Employee/rider invitations (standard and custom templates) include a separate Download Android App button. The private acceptance link remains unchanged. Admin invitations do not include the mobile download button. The rider form's optional checkbox still controls only the PDF application attachment; the APK link is included independently.

Local backend .env:

```dotenv
EMPLOYEE_APP_DOWNLOAD_URL=http://127.0.0.1:3002/api/app-updates/download-latest
```

After deployment replace this value with `https://YOUR_BACKEND_HOST/api/app-updates/download-latest` and restart backend. New invitations use that host. Existing sent emails retain their original URL. The stable endpoint redirects without caching to the highest published release, so normal future APK updates do not require changing the invitation URL. With no published release it returns 404. A localhost invitation download URL is reachable only on the local computer or a correctly USB-reversed device, not remote recipients.

Verified locally: both email templates contain separate acceptance/download links, unsafe URL/HTML input is rejected/escaped, hosted configuration works, stable link returns a no-store redirect, and following it downloads the signed APK with matching SHA-256/size. No real invitation email was sent for verification.

### Move an installed local-testing app to the deployed server

The backend URL is compiled into each APK. Merely changing backend .env will not redirect an already installed localhost APK. Build version 4 or higher with APP_API_BASE_URL set to the deployed HTTPS host, register/publish it in the local backend, and deploy the same catalog/APKs to persistent production storage. While USB reverse is still connected, the local-testing app downloads that new APK from the local backend. After installation, the new app uses the deployed host for login, tracking and future update checks. Alternatively install that correctly signed production-URL APK directly over the matching-key local app.

Use HTTPS. Configure APP_RELEASE_DIR as a persistent absolute storage directory; backend restarts/redeploys must retain its contents. APKs stay outside Git. Back up the catalog and APKs together. The local setup is a shared filesystem catalog, not object storage/CDN or a multi-region release service.

Backend environment:

```dotenv
APP_RELEASE_DIR=/persistent/fieldtrack
APP_RELEASE_PACKAGE=com.example.lionexftrack
APP_RELEASE_CERT_SHA256=<public fingerprint from certificate-sha256.txt>
APP_RELEASE_BUILD_TOOLS=/opt/android-sdk/build-tools/36.0.0
JAVA_HOME=/path/to/jdk
APP_RELEASE_ADMIN_IDS=
```

Android SDK build-tools (aapt and lib/apksigner.jar) plus Java are required for server-side upload/publish verification. Replace local Windows paths when deploying to Linux. Do not disable certificate verification to work around missing tools.

Later, to enable dashboard management, enter explicit existing Admin Mongo IDs in APP_RELEASE_ADMIN_IDS, comma-separated, restart backend and log into the dashboard. Normal organization owners are not implicitly platform release administrators. Only listed admin principals can upload/publish/withdraw. Public metadata/download contain no signing secrets; release APKs are intentionally downloadable without a login.

Publish API upload accepts APK binary (application/vnd.android.package-archive), not JSON, maximum 250 MB. X-Release-Notes contains URI-encoded notes. Reverse-proxy upload limits/timeouts must permit that size. A stale fieldtrack/.catalog-lock after a crash requires operator inspection; only remove an abandoned lock after ensuring no release operation is active.

## Installation safety and limitations

The Android app validates metadata, byte length, SHA-256, package, higher version and matching signing certificate. Download uses app-private files, bounded streaming, retries and range resume. Downloaded APKs are excluded from Android cloud/device backup. No drafts, leads, pending sync rows or databases are deleted by the updater. Existing database migrations remain responsible for schema compatibility.

Official Android installer requires user confirmation and may require Allow from this source. Device policy/Advanced Protection may prohibit sideloading. The app does not bypass these restrictions. Installation can stop the app and temporarily interrupt location tracking. Reopen the updated app and verify its existing tracking state/permissions; no uninterrupted tracking guarantee is made. There is no forced update, silent install or downgrade path.

## Verification scope

Signed release build and APK verification, backend release lifecycle/authorization/integrity/download tests, dashboard build/lint, and noon schedule unit tests are performed during implementation. Actual USB device installation/update and daily background timing require a connected device. See APP_UPDATES_VERIFICATION.md for final results.

## Release build safeguards

app/proguard-rules.pro preserves unannotated Gson DTO/member names and reflective APIs so release optimization cannot silently change JSON field names. A pre-existing CustomerVerificationForm case ID reference was corrected to use the active lead session with a remembered UUID fallback, resolving the compile error. The local test-only version 2 artifact is withdrawn; the supported bootstrap is version 3.
