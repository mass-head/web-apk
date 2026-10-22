# Web2APK Native Android Project Template

Production-grade, secure Android project template for converting web applications into native Android APKs. Built with **Kotlin**, **AndroidX WebView**, **Gradle**, and modern Material 3 design principles.

---

## 🏗️ Architecture & Dual Pipeline

Web2APK supports two mutually exclusive content pipelines:

```
                          ┌───────────────────────────┐
                          │   Web2APK Configuration   │
                          └─────────────┬─────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
                 ▼                                             ▼
        [ REMOTE Mode ]                                [ LOCAL Mode ]
    Loads public HTTPS URL                        Loads static assets from
    (e.g., https://myapp.com)                     app/src/main/assets/web/
                 │                                             │
                 ▼                                             ▼
       AppWebViewClient                              WebViewAssetLoader
 Strict SSL certificate check                  Virtual domain HTTPS origin:
 External intent filtering (tel:, sms:, etc.)  https://appassets.androidplatform.net/
 Restricts navigation to authorized domain     Zero file:// URL vulnerabilities
```

### 1. REMOTE Mode
- Directly streams and renders a public HTTPS web application.
- **Strict SSL Security**: If an invalid or self-signed certificate is presented, `onReceivedSslError` invokes `handler.cancel()` immediately and displays a secure warning overlay.
- **Navigation Containment**: Internal links within the host domain stay inside the WebView. Outbound links open in the user's default browser.
- **Native Scheme Handlers**: Interactive schemes (`tel:`, `mailto:`, `sms:`, `geo:`) are safely routed to device intent dispatchers.

### 2. LOCAL Mode
- Packages static HTML5, CSS, and JavaScript files directly into the Android application APK (`assets/web/`).
- **WebViewAssetLoader**: Eliminates insecure `file:///` protocols. Files are intercepted and served from a virtual origin `https://appassets.androidplatform.net/assets/web/index.html`.
- **CORS & Storage Compatibility**: Web APIs (LocalStorage, IndexedDB, Fetch, Service Workers) work predictably because the page operates in a standard HTTPS origin context.
- **Complete Air-Gap Isolation**: Works completely offline without requiring network connectivity.

---

## 🔒 Security Hardening

- ❌ `setAllowFileAccess(false)`
- ❌ `setAllowContentAccess(false)`
- ❌ `setAllowFileAccessFromFileURLs(false)`
- ❌ `setAllowUniversalAccessFromFileURLs(false)`
- 🛡️ `setMixedContentMode(MIXED_CONTENT_NEVER_ALLOW)`
- 🔐 Cleartext HTTP traffic is disabled globally via `network_security_config.xml`.
- 🔑 Zero unnecessary permissions: Only `INTERNET` and `ACCESS_NETWORK_STATE` are included by default.

---

## 📦 Automated Build & Verification Toolchain

### Build an APK via CLI
```bash
# Build in REMOTE mode
npm run build:apk -- --mode REMOTE --appId com.company.app --appName "Company App" --url "https://company.com" --themeColor "#7C3AED"

# Build in LOCAL mode with packaged static assets
npm run build:apk -- --mode LOCAL --appId com.company.offline --appName "Offline App" --themeColor "#06B6D4"

# Force clean build
npm run build:apk -- --mode REMOTE --clean
```

### Verify an APK Archive
```bash
npm run verify:apk -- path/to/app-debug.apk
```

The verification tool checks:
1. **File existence** and file size plausibility (> 500 KB and < 100 MB).
2. **Internal ZIP structure**: Confirms presence of compiled `AndroidManifest.xml`, `classes.dex`, and `resources.arsc`.
3. **Cryptographic Integrity**: Calculates SHA-256 checksum.

---

## 📱 Sideloading & Installation Instructions

### 1. Android Emulator
1. Start your Android Emulator from Android Studio or command line:
   ```bash
   emulator -avd <AVD_NAME>
   ```
2. Drag and drop `app-debug.apk` directly onto the emulator window, **OR** install via ADB:
   ```bash
   adb install -r packages/android-template/app/build/outputs/apk/debug/app-debug.apk
   ```

### 2. Physical Android Device
1. On your Android phone, enable **Developer Options**:
   - Go to **Settings** > **About Phone** > Tap **Build Number** 7 times.
2. Enable **USB Debugging**:
   - Go to **Settings** > **System** > **Developer Options** > Turn on **USB Debugging**.
3. Connect device via USB cable and authorize computer on the phone prompt.
4. Verify connection:
   ```bash
   adb devices
   ```
5. Install APK:
   ```bash
   adb install -r packages/android-template/app/build/outputs/apk/debug/app-debug.apk
   ```

---

## 🔐 Debug APK vs. Production Release APK

| Dimension | Debug APK (`assembleDebug`) | Release APK (`assembleRelease`) |
| :--- | :--- | :--- |
| **Keystore** | Auto-generated standard debug keystore (`~/.android/debug.keystore`) | Private corporate `.jks` or `.keystore` kept in secure secret manager |
| **Key Alias / Passwords** | Hardcoded (`androiddebugkey` / `android`) | Custom high-entropy password & alias |
| **Debuggable Flag** | `android:debuggable="true"` (allows ADB debugger & Chrome DevTools inspection) | `android:debuggable="false"` (debugger strictly locked out) |
| **Code Shrinking & Obfuscation** | Disabled (`isMinifyEnabled = false`) for rapid compilation | Enabled (R8 / Proguard) to strip dead code and obfuscate symbols |
| **Signature Schemes** | Standard v1/v2 signature | v2, v3, and v4 APK Signature Scheme with SHA-256 digest |
| **Google Play / Distribution** | ❌ Rejected by Google Play Store | ✅ Accepted by Google Play, Samsung Galaxy Store, FDroid |

### Creating a Production Release Keystore
```bash
# 1. Generate release keystore
keytool -genkey -v -keystore release.jks -alias web2apk -keyalg RSA -keysize 2048 -validity 10000

# 2. Build release APK or AAB
./gradlew assembleRelease

# 3. Align and sign with apksigner
zipalign -v -p 4 app-release-unsigned.apk app-release-aligned.apk
apksigner sign --ks release.jks --ks-key-alias web2apk --out app-release-signed.apk app-release-aligned.apk

# 4. Verify signature
apksigner verify --verbose app-release-signed.apk
```
