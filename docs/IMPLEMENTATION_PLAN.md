# Web2APK Implementation Plan

This document outlines the step-by-step roadmap to implement the Web2APK platform. It defines the workspace layout, phase breakdown, acceptance criteria, required environment variables, external services, and actions requiring human approval.

---

## 1. Project Directory Structure

Web2APK is organized as a clean, modular TypeScript monorepo with dedicated packages for client, server, worker, and Android templates:

```text
web-apk/
├── apps/
│   ├── web/                     # React 18 + Vite + TypeScript + Tailwind CSS UI
│   │   ├── src/
│   │   │   ├── components/      # UI components, wizard, preview, terminal
│   │   │   ├── hooks/           # useBuildStatus, useSseLogs, useUrlValidation
│   │   │   ├── services/        # API client (Axios)
│   │   │   ├── types/           # Shared UI typings
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── tailwind.config.js
│   │
│   ├── api/                     # Node.js + Express + TypeScript Gateway
│   │   ├── src/
│   │   │   ├── config/          # Environment variables & constants
│   │   │   ├── controllers/     # Build, validation, and download controllers
│   │   │   ├── middleware/      # Rate-limiting, error handling, validation
│   │   │   ├── queues/          # BullMQ queue producer & event dispatcher
│   │   │   ├── routes/          # REST route definitions
│   │   │   ├── services/        # S3 storage service, SSRF validator, Zip sanitizer
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── worker/                  # Isolated Android Build Worker Runner
│       ├── src/
│       │   ├── builder/         # Gradle runner, template injector, asset unpacker
│       │   ├── consumer.ts      # BullMQ worker processor
│       │   ├── logger.ts        # Redis Pub/Sub log streamer
│       │   └── index.ts
│       ├── Dockerfile           # Ubuntu + JDK 17 + Android SDK + Gradle
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── shared/                  # Common TypeScript types, DTOs, schemas (Zod)
│   │   ├── src/
│   │   │   ├── schemas.ts       # Zod validation schemas
│   │   │   └── types.ts         # AppConfig, BuildJob, SseEvents
│   │   └── package.json
│   │
│   └── android-template/        # Production-grade Kotlin Android WebView project
│       ├── app/
│       │   ├── src/main/
│       │   │   ├── java/com/web2apk/template/
│       │   │   │   ├── MainActivity.kt
│       │   │   │   ├── WebAppInterface.kt
│       │   │   │   └── CustomWebChromeClient.kt
│       │   │   ├── res/
│       │   │   │   ├── layout/activity_main.xml
│       │   │   │   ├── values/strings.xml, colors.xml, themes.xml
│       │   │   │   └── mipmap-*/ic_launcher.png
│       │   │   └── AndroidManifest.xml
│       │   └── build.gradle.kts
│       ├── gradle/wrapper/
│       ├── build.gradle.kts
│       ├── settings.gradle.kts
│       └── gradlew, gradlew.bat
│
├── infrastructure/
│   ├── docker-compose.yml       # Local dev setup (Redis, MinIO, API, Web)
│   ├── docker-compose.worker.yml# Worker container deployment
│   └── minio-init.sh            # Bucket initialization script
│
├── docs/
│   ├── ARCHITECTURE.md          # End-to-end system architecture
│   ├── API_SPEC.md              # Complete REST & SSE API specification
│   ├── SECURITY.md              # SSRF, Zip Slip, and Sandbox threat model
│   └── IMPLEMENTATION_PLAN.md   # This document
│
├── package.json                 # Monorepo root with npm/pnpm workspaces
└── tsconfig.base.json
```

---

## 2. Phase-by-Phase Task Checklist & Acceptance Criteria

### Phase 1: Monorepo Foundation & Shared Schemas
- [ ] Initialize monorepo root with `npm` / `pnpm` workspaces.
- [ ] Configure `tsconfig.base.json` and linter/formatter configurations.
- [ ] Create `packages/shared`:
  - [ ] Implement `AppConfig` schema and validation via Zod.
  - [ ] Implement `BuildJob`, `BuildStatus`, `SseEvent` types.
  - [ ] Implement Android package name validator RFC logic.
- [ ] Set up local Docker Compose for dependencies (`Redis 7+`, `MinIO` S3-compatible storage).

**Acceptance Criteria**:
1. `npm run build` at monorepo root succeeds.
2. `packages/shared` exports full type safety for both API and frontend.
3. Redis and MinIO start cleanly via `docker compose up -d` with automated bucket creation.

---

### Phase 2: Android Template Engine & Gradle Build Worker
- [ ] Create `packages/android-template`:
  - [ ] Set up clean Kotlin project targeting Android SDK 34 (Android 14) with minSdk 24 (Android 7.0).
  - [ ] Implement `MainActivity.kt` with modern `WebView`, `SwipeRefreshLayout`, and `ProgressBar`.
  - [ ] Implement `WebViewAssetLoader` for local assets in Upload Mode (virtual origin `https://appassets.androidplatform.net/assets/web/index.html`).
  - [ ] Implement SSL certificate error interceptor (safe rejection).
  - [ ] Implement `WebChromeClient` with file chooser support for camera/file uploads.
  - [ ] Implement external intent filter (handling `tel:`, `mailto:`, `sms:`, `intent:` safely).
  - [ ] Configure `app/build.gradle.kts` with placeholders for dynamic replacement (`applicationId`, `versionCode`, `versionName`, `appName`).
- [ ] Create `apps/worker`:
  - [ ] Author multi-stage `Dockerfile` (Eclipse Temurin JDK 17 + Android Command-line Tools + Build Tools 34.0.0 + Gradle).
  - [ ] Implement worker job processor (`consumer.ts`) using BullMQ.
  - [ ] Implement template dynamic code injector (replaces package name, app name, URL/assets, icon drawables, manifest permissions).
  - [ ] Implement child process Gradle runner with timeout, memory limits, and log capture.
  - [ ] Implement log streamer publishing stdout/stderr to Redis Pub/Sub channels in real-time.
  - [ ] Implement APK artifact extractor & S3 uploader.

**Acceptance Criteria**:
1. Running Gradle assemble manually in template yields a valid, working `.apk`.
2. Worker successfully executes `./gradlew assembleDebug` inside container for a test job without crashes.
3. Worker streams logs to Redis Pub/Sub and uploads generated APK to MinIO/S3.
4. Ephemeral workspace is cleaned up after job completion or failure.

---

### Phase 3: Storage, Queues & Security Engines
- [ ] Implement `apps/api/src/services/storage.ts`:
  - [ ] S3 client wrapper supporting AWS S3 and MinIO.
  - [ ] Presigned PUT URL generator for client direct-uploads.
  - [ ] Presigned GET URL generator for APK downloads (15 min expiry).
- [ ] Implement `apps/api/src/services/ssrf-validator.ts`:
  - [ ] DNS resolution check against all private/loopback/cloud metadata IP ranges.
  - [ ] HTTPS reachability verification with 5-second timeout and 3-redirect limit.
- [ ] Implement `apps/api/src/services/zip-sanitizer.ts`:
  - [ ] Streaming ZIP extractor with Zip Slip defense (canonical path comparison).
  - [ ] Decompression bomb defenses (max size 100MB, max files 5000, 10:1 ratio limit).
  - [ ] Dangerous file extension filter (`.exe`, `.sh`, `.apk`, `.so`, etc.).
  - [ ] Verification of `index.html` entrypoint existence.
- [ ] Implement `apps/api/src/queues/build-queue.ts`:
  - [ ] BullMQ queue initialization, concurrency policies, and error retries.

**Acceptance Criteria**:
1. SSRF validator blocks `http://127.0.0.1`, `http://169.254.169.254`, `http://localhost`, `http://192.168.1.1` and passes public HTTPS sites.
2. Zip sanitizer safely rejects test archives with `../evil.txt`, bomb files, and archives without `index.html`.
3. Valid ZIP file successfully extracts to destination directory without path escape.

---

### Phase 4: Backend API & Real-time Log Streaming
- [ ] Implement REST endpoints:
  - [ ] `GET /api/v1/health`
  - [ ] `POST /api/v1/validate/url`
  - [ ] `POST /api/v1/validate/package-name`
  - [ ] `POST /api/v1/builds/url`
  - [ ] `POST /api/v1/builds/upload/initiate`
  - [ ] `POST /api/v1/builds/upload`
  - [ ] `GET /api/v1/builds/:buildId`
  - [ ] `GET /api/v1/builds/:buildId/download`
  - [ ] `POST /api/v1/builds/:buildId/cancel`
- [ ] Implement `GET /api/v1/builds/:buildId/logs`:
  - [ ] Server-Sent Events (SSE) controller subscribing to Redis channel `build-logs:<buildId>`.
  - [ ] Heartbeat / keep-alive pings every 15 seconds.
  - [ ] Clean unsubscribe when client disconnects.
- [ ] Implement Sharp image processing for custom icons (resizing to mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi).

**Acceptance Criteria**:
1. All API endpoints respond matching `docs/API_SPEC.md`.
2. SSE endpoint streams real-time logs from worker to client.
3. Unit and integration tests for validation, upload initiate, and build triggers pass.

---

### Phase 5: Modern Web UI (React + Vite + Tailwind CSS)
- [ ] Scaffold `apps/web` with Vite, React 18, TypeScript, and Tailwind CSS.
- [ ] Build wizard steps:
  - [ ] **Mode Selector**: Clean tab or card toggle between "Website URL" and "Static ZIP Upload".
  - [ ] **Target Configuration**:
    - URL mode: URL input with live "Verify & Preview" button showing favicon, title, and SSL check.
    - Upload mode: Drag-and-drop ZIP dropzone with file inspection, size validation, and `index.html` check.
  - [ ] **App Identity**: App Name, Package Name (auto-generated from domain/name with override), Version, Version Code.
  - [ ] **Customization & Permissions**: Color picker for theme/toolbar color, icon uploader with live preview, orientation toggle, toggle switches for Pull-to-Refresh, Camera, Geolocation.
- [ ] Build live build terminal:
  - [ ] Animated progress stepper (Queued -> Scaffolding -> Compiling -> Finalizing).
  - [ ] Real-time auto-scrolling log console with syntax highlights for Gradle tasks.
  - [ ] Cancel build button.
- [ ] Build completion & download screen:
  - [ ] Success banner with APK file size and SHA256 checksum.
  - [ ] Download APK button (triggers presigned URL).
  - [ ] QR code generator allowing user to scan and download the APK directly onto an Android device.

**Acceptance Criteria**:
1. Responsive, accessible UI working on desktop and mobile viewports.
2. Live URL pre-validation displays instant feedback before triggering build.
3. Build terminal streams real-time Gradle compilation logs without lag or UI freezes.
4. Download button immediately initiates APK download.

---

### Phase 6: End-to-End Integration & Docker Compose Environment
- [ ] Create unified `docker-compose.yml` orchestrating:
  - Redis 7+
  - MinIO (S3 compatible object storage)
  - API Gateway
  - Build Worker (Android SDK container)
  - Web UI (Vite dev or Nginx production build)
- [ ] Run complete E2E test for **Pipeline A (URL Mode)**:
  - Input public URL (e.g. `https://wikipedia.org`).
  - Worker compiles APK.
  - Inspect generated APK to verify valid zip structure and compiled Dex files.
- [ ] Run complete E2E test for **Pipeline B (Upload Mode)**:
  - Upload test ZIP with `index.html` + CSS + JS.
  - Worker compiles APK.
  - Verify `appassets.androidplatform.net` asset loading logic in APK.
- [ ] Document developer quickstart and production deployment instructions.

**Acceptance Criteria**:
1. `docker compose up` brings up the entire functional stack locally.
2. Both pipelines produce valid, installable Android APKs verified with Android `aapt2` or `unzip -l`.

---

## 3. Required External Services, Environment Variables & Dependencies

### 3.1 External Services & Infrastructure

| Service | Purpose | Local Dev Solution | Production Solution |
| :--- | :--- | :--- | :--- |
| **Object Storage** | Store raw ZIPs, icons, and compiled APKs | MinIO container | AWS S3 / Cloudflare R2 / GCP Cloud Storage |
| **Job Queue & Cache** | BullMQ task queue and Pub/Sub log streaming | Redis 7 Alpine container | AWS ElastiCache / Redis Cloud / Managed Valkey |
| **Android Worker Fleet**| Execute Gradle compilation in headless Linux | Local Docker container with Android SDK | AWS ECS Fargate / Fly.io Machines / Kubernetes K8s Pods |
| **Edge & SSL Ingress** | Reverse proxy, SSL termination, and rate limiting | Vite Proxy / Nginx | Cloudflare / AWS ALB / Traefik |

### 3.2 Environment Variables Matrix

#### Backend API (`apps/api/.env`)
```bash
# Server Configuration
PORT=4000
NODE_ENV=development
API_BASE_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:5173

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Object Storage (S3 / MinIO)
S3_ENDPOINT=http://localhost:9000     # For MinIO; leave blank for AWS S3
S3_REGION=us-east-1
S3_BUCKET_NAME=web2apk-artifacts
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true             # Set true for MinIO, false for AWS

# Build Limits & Timeouts
MAX_ZIP_SIZE_BYTES=104857600         # 100 MB
BUILD_TIMEOUT_MS=600000              # 10 minutes
```

#### Android Build Worker (`apps/worker/.env`)
```bash
# Worker Configuration
WORKER_CONCURRENCY=1
BUILD_TIMEOUT_MS=600000
WORKSPACE_DIR=/tmp/web2apk-builds

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Object Storage (S3 / MinIO)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET_NAME=web2apk-artifacts
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true

# Android SDK & Java (Configured in Docker image)
ANDROID_HOME=/opt/android-sdk
JAVA_HOME=/opt/java/openjdk
```

#### Frontend (`apps/web/.env`)
```bash
VITE_API_URL=http://localhost:4000/api/v1
```

---

## 4. Requirements Requiring Human Approval, Credentials & Cloud Setup

The following items cannot be automated via local code generation and require human configuration, credentials, or administrative approval:

1. **Cloud Object Storage Provisioning (AWS S3 / GCP Cloud Storage / R2)**:
   - Creation of private S3 bucket (e.g. `web2apk-artifacts`).
   - Configuration of S3 Lifecycle Rules (e.g., auto-delete raw upload quarantine files after 24 hours, auto-expire generated APKs after 7 days to manage storage costs).
   - IAM credentials (`AccessKeyId`, `SecretAccessKey`) with scoped `PutObject`, `GetObject`, `DeleteObject` permissions on the bucket.
   - *Local dev note*: MinIO provides 100% S3 compatibility locally with zero cloud credentials needed.

2. **Managed Redis Provisioning**:
   - Connection credentials (host, port, TLS, auth token) for a durable Redis instance (Redis 7+ or Valkey).
   - *Local dev note*: Provided via Docker Compose.

3. **Production Android Keystore & Code Signing (For Release APKs/AABs)**:
   - Google Play publishing requires signing with a dedicated release keystore (`.jks` / `.keystore`) and key alias.
   - For public distribution via websites, apps can be signed with an organizational release key or debug key for testing.
   - Keystore files, passwords, and aliases must be secured via secret managers (AWS Secrets Manager, HashiCorp Vault) and never stored in git.

4. **Dedicated Worker Compute Provisioning**:
   - Android compilation is memory-intensive (~4 GB RAM and 2 CPUs per build).
   - In production, cloud worker nodes (e.g., AWS EC2/ECS with c6g/c6i instances, or Kubernetes node pools with high memory) must be provisioned.

5. **Domain, DNS & SSL Ingress**:
   - Production domain registration (e.g. `web2apk.dev`).
   - SSL certificates for API and frontend domains.
