# Web2APK 🚀

> **Production-ready service converting public website URLs and static website ZIP packages into real downloadable Android APKs.**

Web2APK is built on a distributed architecture where the frontend and API gateway are isolated from dedicated cloud workers running the official Android Gradle build system and Android SDK 34 compiler tools.

---

## 🏛 System Architecture

```text
[ Browser / Client (React 18 + Vite) ]
                  │
                  ▼
  [ API Gateway (Express + TypeScript) ] ────► [ PostgreSQL (Persistence) ]
       │                      │
       ▼                      ▼
  [ BullMQ Queue ] ───► [ S3 / MinIO Storage ]
       │
       ▼ (Phase 3 Worker Fleet)
  [ Isolated Android Worker (Gradle 8.5 + JDK 17) ]
```

- **Frontend (`apps/web`)**: Modern UI with Midnight navy (`#0B0F19`), violet (`#7C3AED`), and cyan (`#06B6D4`) palette.
- **Backend API (`apps/api`)**: Node.js, Express, TypeScript, Zod, PostgreSQL, Redis, BullMQ.
- **Queue & Storage**: BullMQ distributed queue on Redis 7+, S3/MinIO private object storage.

---

## 📦 Phase 2 Backend Implementation

### Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/conversions/url` | Create an Android build job from a validated public URL (SSRF protected) |
| `POST` | `/api/conversions/upload` | Create an Android build job from an uploaded website ZIP archive (100MB quota) |
| `GET` | `/api/conversions/:id` | Retrieve status, progress, stage, app configuration, and error telemetry |
| `GET` | `/api/conversions/:id/events` | Stream real-time build progress and compiler logs via Server-Sent Events (SSE) |
| `GET` | `/api/conversions/:id/download` | Download generated APK binary with signed token / ownership authorization |
| `POST` | `/api/conversions/:id/cancel` | Safely cancel a queued or running conversion job |
| `GET` | `/api/health` | Health check reporting PostgreSQL, Redis, BullMQ, and Storage status |

### Modular Architecture
- **Routes** ([`apps/api/src/routes/`](file:///d:/web-apk/apps/api/src/routes/)): Decoupled route controllers.
- **Validation** ([`apps/api/src/validation/`](file:///d:/web-apk/apps/api/src/validation/)):
  - Zod schemas for `AppConfig`, URL format, package ID RFC rules, and download query.
  - SSRF engine resolving DNS and strictly filtering private, loopback, and cloud metadata (`169.254.169.254`) subnets.
- **Database & Persistence** ([`apps/api/src/db/`](file:///d:/web-apk/apps/api/src/db/)):
  - PostgreSQL schema and connection pool (`pg.Pool`) storing full conversion metadata, audit timestamps, and artifact hashes.
  - In-memory repository fallback for standalone testing when PostgreSQL is offline.
- **Job Management** ([`apps/api/src/jobs/`](file:///d:/web-apk/apps/api/src/jobs/)):
  - BullMQ queue producer (`android-conversions`) with a configurable 20-minute job timeout (15-minute Gradle timeout), exponential backoff retries, and job cancellation.
  - **Zero Gradle Builds in HTTP Handlers**: Compilation jobs are strictly dispatched to background workers.
  - Redis PubSub Event Broker broadcasting real-time progress and logs to SSE clients.
- **Storage** ([`apps/api/src/storage/`](file:///d:/web-apk/apps/api/src/storage/)):
  - `IStorageService` interface with AWS S3 / MinIO and Local filesystem adapters.
- **Auth & Authorization** ([`apps/api/src/auth/`](file:///d:/web-apk/apps/api/src/auth/)):
  - API Key and Bearer token identification.
  - Signed, short-lived download tokens (HMAC-SHA256 / JWT) preventing unauthorized APK downloads.
- **Middleware & Security** ([`apps/api/src/middleware/`](file:///d:/web-apk/apps/api/src/middleware/)):
  - Rate limiting via `express-rate-limit`.
  - Per-user quotas: max 5 concurrent active jobs and 20 daily conversions.
  - Idempotency deduplication via `Idempotency-Key` header.
  - Multer multipart upload with 100 MB hard limit and ZIP mime enforcement.
  - Centralized RFC 7807 Problem Details error handler.

> ⚠️ **Worker Status Notice**: Cloud builds are dispatched to the BullMQ queue. In Phase 2, the API functions as the production queue producer and job coordinator; cloud builds are dispatched to isolated Android build workers.

---

## 📱 Phase 3 Native Android Template (`packages/android-template`)

The native Android project template packages web applications into verified Android APKs using **Kotlin**, **AndroidX WebView**, and **Gradle**.

### Content Source Modes: URL Mode vs. Upload Mode

Web2APK supports two mutually exclusive content pipelines:

#### 1. URL Mode (Remote HTTPS Websites)
- **Target**: Public, production-grade HTTPS websites and server-rendered web applications (e.g., WordPress, Rails, Django, Laravel, Next.js with SSR).
- **Security & Pipeline**:
  - Pre-flight SSRF inspection verifies public IP resolution, DNS validity, and SSL certificates.
  - Strictly rejects `localhost`, loopback, private IPv4/IPv6 subnets, link-local, and cloud metadata (`169.254.169.254`).
  - Native Android app uses `ContentSource.REMOTE` in `AppConfig.kt` to load the live site with SSL validation, offline reconnect screens, and predictive back navigation.

#### 2. Upload Mode (Static Websites & Client-Side SPAs)
- **Target**: Client-side static websites and Single Page Applications (SPAs) built with plain HTML5/CSS3/JavaScript, or production exports from Vite, React, Vue, Svelte, Astro, Next.js static exports (`output: 'export'`), and WebAssembly.
- **Backend Architecture Note**:
  - **Static Websites Only**: The mobile APK runs directly on the device and does **not** bundle server-side runtimes like Node.js, Python, PHP, Ruby, or SQL databases.
  - Dynamic server-side backends must be deployed separately to cloud hosting (e.g., AWS, GCP, Vercel, Fly.io). Users can then either use **URL Mode** to load their hosted application or use **Upload Mode** for their compiled frontend and have it make standard HTTPS REST/GraphQL `fetch()` calls to their remote backend.
- **Security Controls & Sandboxing**:
  - **Pre-Extraction Limits**: Enforces 100 MB compressed upload limit, 300 MB maximum decompressed size (ZIP bomb defense), 5,000 file count limit, and 50 MB per-file limit.
  - **Attack Defense**: Rejects path traversal (`..` segments), absolute paths, null bytes, encrypted archives, and symlinks (`0o120000`).
  - **Prohibited Extensions Blocklist**: Strictly forbids executable and dangerous file types (`.exe`, `.dll`, `.bin`, `.sh`, `.bat`, `.cmd`, `.ps1`, `.apk`, `.jar`, `.php`, `.py`, `.rb`, etc.).
  - **Top-Level Wrapper Normalization**: Automatically detects and normalizes optional top-level directories (e.g., `dist/`, `build/`, `my-site/`), ensuring `index.html` is properly placed at the website root.
  - **Safe Asset Inspection**: Relative asset references (`<script src>`, `<link href>`, `<img src>`) are parsed via regular expressions without ever executing client code on the server.
  - **Isolated Extraction**: Files are extracted exclusively into isolated per-job build workspaces (`data/builds/:id/app/src/main/assets/web/`) and never into shared directories.
  - **Device Sandboxing**: Assets are served inside the Android APK via `androidx.webkit.WebViewAssetLoader` from virtual domain `https://appassets.androidplatform.net/assets/web/index.html`. Android `allowFileAccess` is strictly disabled (`false`), keeping client code securely isolated within the WebView's web origin boundaries.

- **WebView Security Hardening**:
  - `setAllowFileAccess(false)`, `setAllowContentAccess(false)`, `setAllowFileAccessFromFileURLs(false)`, `setAllowUniversalAccessFromFileURLs(false)`.
  - Global cleartext HTTP disabled in `network_security_config.xml`.
  - Minimal permission footprint (`INTERNET`, `ACCESS_NETWORK_STATE`).
- **Modern User Experience**:
  - AndroidX predictive back navigation (`OnBackPressedCallback`).
  - Pull-to-refresh (`SwipeRefreshLayout`), top progress indicator (`ProgressBar`).
  - Active network monitoring (`NetworkMonitor`) with graceful offline overlay and auto-reconnect.
- **Automated Build & Verification Toolchain**:
  - `npm run build:apk`: Injects build parameters (`applicationId`, `appName`, `mode`, `url`, `themeColor`) and executes Gradle `assembleDebug`.
  - `npm run verify:apk`: Parses ZIP central directory to verify presence of `AndroidManifest.xml`, `classes.dex`, `resources.arsc`, plausible size (> 500 KB, < 100 MB), and SHA-256 hash.

### Build Commands
```bash
# Build in REMOTE mode
npm run build:apk -- --mode REMOTE --appId com.mycompany.app --appName "My App" --url "https://mycompany.com" --themeColor "#7C3AED"

# Build in LOCAL mode (using packaged static web assets)
npm run build:apk -- --mode LOCAL --appId com.mycompany.offline --appName "Offline App" --themeColor "#06B6D4"

# Verify generated APK archive
npm run verify:apk -- packages/android-template/app/build/outputs/apk/debug/app-debug.apk
```

### Installation & Sideloading
- **Android Emulator**:
  ```bash
  adb install -r packages/android-template/app/build/outputs/apk/debug/app-debug.apk
  ```
  Or drag and drop the APK file onto an open emulator window.
- **Physical Device**:
  Enable Developer Options (tap Build Number 7 times) > Turn on USB Debugging > Connect via USB:
  ```bash
  adb install -r packages/android-template/app/build/outputs/apk/debug/app-debug.apk
  ```

### Debug vs. Production Release APKs
- **Debug APK**: Signed with SDK auto-generated debug key (`~/.android/debug.keystore`), `android:debuggable="true"` for DevTools inspection. Suitable for development and internal QA.
- **Production Release APK**: Built with `./gradlew assembleRelease`, signed with a private corporate keystore (`.jks`), R8 code shrinking and resource optimization enabled, `android:debuggable="false"`. Required for Google Play and enterprise distribution.

---

## 🚀 Quickstart & Setup

### Prerequisites
- Node.js `v18.0.0` or later (tested on Node `v24.19.0`)
- `npm` `v9.0.0` or later
- Docker & Docker Compose (optional, for local PostgreSQL, Redis, and MinIO)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/web2apk.git
cd web2apk

# Install dependencies across all workspaces
npm install
```

### Local Development Services (Docker Compose)

To start PostgreSQL, Redis, and MinIO locally:

```bash
docker compose -f infrastructure/docker-compose.yml up -d postgres redis minio
```

### Running the Services

```bash
# Start API Gateway (port 4000)
npm run dev:api

# Start Web UI (port 5173)
npm run dev:web
```

### Building for Production

```bash
# Compile both frontend and backend
npm run build
```

### Running Integration Tests

```bash
# Run API integration test suite and validation scripts
npm test
```

---

## ⚙️ Environment Variables

Copy the example configuration to set up your environment:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | API server port | `4000` |
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://web2apk:web2apk_password@localhost:5432/web2apk_db` |
| `REDIS_HOST` | Redis broker host | `localhost` |
| `REDIS_PORT` | Redis broker port | `6379` |
| `STORAGE_DRIVER` | Storage driver (`s3` or `local`) | `local` |
| `S3_ENDPOINT` | MinIO or custom S3 endpoint | `http://localhost:9000` |
| `S3_BUCKET_NAME` | Target S3 bucket for artifacts | `web2apk-artifacts` |
| `JWT_SECRET` | Secret key for signed download tokens | `placeholder` |
| `API_KEY_SECRET` | Secret key for admin API calls | `placeholder` |
| `MAX_UPLOAD_SIZE_BYTES` | Max size for ZIP uploads | `104857600` (100 MB) |
| `JOB_TIMEOUT_MS` | Job hard execution timeout | `1200000` (20 mins) |
| `GRADLE_TIMEOUT_MS` | Gradle compilation timeout | `900000` (15 mins) |

---

## 🧪 Integration Test Suite

The test suite in [`apps/api/test/conversions.integration.test.ts`](file:///d:/web-apk/apps/api/test/conversions.integration.test.ts) covers 17 automated integration tests:

1. **Successful Job Creation**:
   - `POST /api/conversions/url` returns `202 Accepted` with typed job model.
   - `POST /api/conversions/upload` with multipart ZIP returns `202 Accepted`.
   - `Idempotency-Key` deduplication returns existing job with `200 OK`.
2. **Invalid URLs & SSRF Blocking**:
   - Malformed URLs rejected with `400 Bad Request`.
   - Private IP (`127.0.0.1`) blocked with `code: 'SSRF_BLOCKED'`.
   - Cloud metadata IP (`169.254.169.254`) blocked with `code: 'SSRF_BLOCKED'`.
   - Invalid package names with Java reserved keywords (`com.class.app`) rejected.
3. **Invalid Uploads**:
   - Missing upload file rejected with `code: 'MISSING_FILE'`.
   - Non-ZIP file rejected with `code: 'INVALID_FILE_TYPE'`.
4. **Missing Jobs**:
   - Nonexistent job ID returns `404 Not Found`.
   - Nonexistent events stream returns `404 Not Found`.
5. **Job Cancellation**:
   - Active/queued job cancelled safely (`status: 'cancelled'`).
   - Already cancelled job rejected with `400 Bad Request`.
6. **Download Authorization & Integrity**:
   - Unauthorized download rejected with `403 Forbidden` (`code: 'UNAUTHORIZED_DOWNLOAD'`).
   - Download for in-progress job rejected with `409 Conflict` (`code: 'ARTIFACT_NOT_READY'`).
   - Authorized download with signed token returns binary APK.
7. **Health Endpoint**:
   - `GET /api/health` returns JSON health diagnostics for Postgres, Redis, and Storage.

---

## 📜 License
MIT License.
