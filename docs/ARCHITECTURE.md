# Web2APK Architecture Documentation

## 1. System Overview

Web2APK is an enterprise-grade, distributed pipeline designed to convert web properties (public web URLs or static website archives) into fully functional, production-ready Android APK packages.

The system is architected around decoupling user-facing presentation and API gateway layers from resource-intensive, isolated Android compiler workers.

```mermaid
flowchart TD
    subgraph ClientLayer["Client Layer (Browser)"]
        UI["Web2APK Frontend (React + Vite + Tailwind)"]
    end

    subgraph EdgeLayer["Ingress & Edge"]
        Ingress["Reverse Proxy / Ingress (Traefik / Nginx / Cloudflare)"]
    end

    subgraph APILayer["API & Orchestration Layer"]
        API["Node.js Express API Gateway (TypeScript)"]
        SSRF["SSRF & URL Validator"]
        ZipSanitizer["Quarantine & Zip Slip Sanitizer"]
    end

    subgraph StateStorage["State, Queue & Storage"]
        Redis[("Redis 7+ (BullMQ Jobs & PubSub)")]
        S3[("Object Storage (S3 / MinIO Private Bucket)")]
    end

    subgraph WorkerFleet["Isolated Build Worker Fleet"]
        Worker1["Android Build Worker 1 (Docker / Gradle / JDK 17)"]
        Worker2["Android Build Worker N (Docker / Gradle / JDK 17)"]
    end

    UI -->|"HTTPS / REST"| Ingress
    UI -.->|"SSE / WebSocket (Build Logs)"| Ingress
    Ingress --> API
    API --> SSRF
    API --> ZipSanitizer
    API -->|"Enqueue Build Jobs"| Redis
    API -->|"Presigned Upload/Download"| S3
    ZipSanitizer -->|"Staged Assets"| S3

    Redis -->|"Fetch Job"| Worker1
    Redis -->|"Fetch Job"| Worker2
    Worker1 -->|"Fetch Assets"| S3
    Worker1 -->|"Publish Progress/Logs"| Redis
    Worker1 -->|"Store Result APK"| S3
    Worker2 -->|"Store Result APK"| S3
    Redis -.->|"Log Events"| API
```

---

## 2. Core Subsystems

### 2.1 Frontend Client (`apps/web`)
- **Technology**: React 18+, Vite, TypeScript, Tailwind CSS, Lucide Icons, TanStack Query, Axios.
- **Role**:
  - Multi-step builder wizard for configuring application metadata (Name, Package Name, Version, Orientation, App Icon, Splash Screen, Permissions, WebView options).
  - Mode toggle: **URL Mode** (public web validation) vs. **Upload Mode** (drag-and-drop ZIP archive).
  - Real-time build monitor with terminal log streaming via Server-Sent Events (SSE).
  - Secure APK download delivery with QR code installation link.

### 2.2 API Gateway & Orchestrator (`apps/api`)
- **Technology**: Node.js, Express, TypeScript, Zod schema validation, BullMQ producer, AWS SDK v3 (S3).
- **Role**:
  - Request ingestion, rate limiting, and strict input schema validation.
  - SSRF protection engine with DNS resolution and private network IP filtering.
  - Zip quarantine, structure validation, and secure stream extraction.
  - Job dispatching to BullMQ queue `android-builds`.
  - SSE endpoint for multiplexing build logs from Redis Pub/Sub directly to the browser.
  - Presigned URL generation for secure, temporary artifact downloads (no public S3 buckets).

### 2.3 Job Queue & Event Broker (`infrastructure/redis`)
- **Technology**: Redis 7+ Alpine.
- **Role**:
  - BullMQ persistent job queues:
    - `android-builds`: Task management, priority handling, retries, and rate limits.
  - Redis Pub/Sub channels (`build-logs:<buildId>`): Low-latency real-time build stdout/stderr streaming from workers to API gateway.

### 2.4 Private Object Storage (`infrastructure/storage`)
- **Technology**: AWS S3 or MinIO (local dev / self-hosted S3-compatible storage).
- **Role**:
  - `uploads/`: Quarantined static site archives and user-uploaded icon assets.
  - `artifacts/`: Generated APK files, build manifests, and signed release packages.
  - Access model: 100% private bucket. All client interactions use short-lived presigned URLs (15-30 minute TTL).

### 2.5 Isolated Android Build Worker (`apps/worker`)
- **Technology**: Dockerized Linux (Ubuntu 22.04 LTS), Eclipse Temurin JDK 17, Android SDK Command-line Tools, Android Build Tools 34.0.0, Gradle 8.5+, Node.js (runner script).
- **Role**:
  - Consumes jobs from `android-builds` queue.
  - Scaffolds a dedicated ephemeral workspace per job.
  - Injects dynamic metadata into a clean Kotlin Android WebView template (`packages/android-template`).
  - Executes Gradle compilation (`./gradlew assembleDebug` or `./gradlew assembleRelease`).
  - Packages and signs APK with a generated or provided Keystore.
  - Streams step-by-step telemetry and Gradle build logs to Redis Pub/Sub.
  - Uploads compiled APK to private Object Storage and marks job complete.
  - Destroys ephemeral workspace on completion/failure.

---

## 3. Data Pipelines & Flow

### 3.1 Pipeline A: URL Mode

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant API as API Gateway
    participant Redis as Redis / BullMQ
    participant Worker as Android Build Worker
    participant S3 as Object Storage (S3)

    User->>API: POST /api/v1/builds/url (URL + AppConfig + Icon)
    API->>API: Validate URL (DNS check, SSRF IP filter, HTTPS probe)
    API->>API: Generate unique buildId
    API->>S3: Upload processed icon asset
    API->>Redis: Enqueue job to 'android-builds' {mode: 'url', ...}
    API-->>User: 202 Accepted {buildId, status: 'queued'}

    User->>API: GET /api/v1/builds/{buildId}/logs (SSE stream)
    API->>Redis: Subscribe to 'build-logs:{buildId}'

    Worker->>Redis: Pop job from 'android-builds'
    Worker->>Redis: Publish log: "Setting up isolated workspace"
    Worker->>Worker: Instantiate Kotlin Android template
    Worker->>Worker: Configure AndroidManifest.xml, build.gradle.kts, res/
    Worker->>Worker: Set targetUrl in WebView config (strings.xml/Config.kt)
    Worker->>Worker: Run ./gradlew assembleDebug
    Worker->>Redis: Stream compiler stdout/stderr
    Worker->>S3: Upload output-metadata.json & app-debug.apk
    Worker->>Redis: Update job status: 'completed' with artifact key
    Worker->>Worker: Clean /tmp/builds/{buildId}

    Redis-->>API: PubSub event: 'completed'
    API-->>User: SSE message: {status: 'completed', buildId}
    User->>API: GET /api/v1/builds/{buildId}/download
    API->>S3: Generate presigned GET URL (15 min TTL)
    API-->>User: 200 OK {downloadUrl}
```

#### Detailed URL Mode Steps:
1. **Pre-flight & SSRF Validation**: The target URL is parsed. Hostname is resolved to IPv4/IPv6 addresses via DNS. Address is verified against private IP blacklists (RFC 1918, RFC 3927, RFC 6890, loopback `127.0.0.1`, cloud metadata IP `169.254.169.254`).
2. **Icon & Asset Processing**: If the user provides an icon, it is resized to standard Android mipmap resolutions (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi) using Sharp before passing to S3.
3. **Template Scaffolding**: Worker mounts the base Kotlin template to an ephemeral build directory `/builds/{buildId}`.
4. **Configuration Injection**:
   - `applicationId` set in `app/build.gradle.kts`
   - `versionCode` and `versionName` injected
   - `app_name` and `target_url` injected into `app/src/main/res/values/strings.xml`
   - Permissions (Camera, Location, Notifications) dynamically inserted into `AndroidManifest.xml`
   - Orientation locked or unlocked in `AndroidManifest.xml`
5. **Gradle Build Execution**: Worker executes isolated Gradle command:
   ```bash
   ./gradlew assembleDebug --no-daemon --stacktrace -Dorg.gradle.jvmargs="-Xmx2048m -XX:MaxMetaspaceSize=512m"
   ```
6. **Artifact Upload**: Output APK at `app/build/outputs/apk/debug/app-debug.apk` is uploaded to `s3://web2apk-artifacts/{buildId}/app-debug.apk`.

---

### 3.2 Pipeline B: Upload Mode (Static Website ZIP)

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant API as API Gateway
    participant Redis as Redis / BullMQ
    participant Worker as Android Build Worker
    participant S3 as Object Storage (S3)

    User->>API: POST /api/v1/builds/upload/initiate (filename, size)
    API-->>User: 200 OK {uploadUrl (S3 presigned PUT), s3Key}
    User->>S3: PUT /uploads/{s3Key} (Binary ZIP file)
    User->>API: POST /api/v1/builds/upload (s3Key + AppConfig)

    API->>S3: Stream ZIP head & verify size limits
    API->>API: Validate ZIP (Zip Slip protection, bomb heuristics, index.html check)
    API->>Redis: Enqueue job to 'android-builds' {mode: 'upload', s3Key, ...}
    API-->>User: 202 Accepted {buildId, status: 'queued'}

    Worker->>Redis: Pop job
    Worker->>S3: Download ZIP archive
    Worker->>Worker: Safe unpack into app/src/main/assets/web/
    Worker->>Worker: Configure WebViewAssetLoader in Kotlin MainActivity
    Worker->>Worker: Run ./gradlew assembleDebug
    Worker->>S3: Upload app-debug.apk
    Worker->>Redis: Update job status: 'completed'
    Worker->>Worker: Purge ephemeral workspace
```

#### Detailed Upload Mode Steps:
1. **Direct-to-S3 Presigned Upload**: To avoid overloading the Node.js API with large file transfers, client uploads the ZIP directly to an S3 quarantine path using a presigned PUT URL with restricted Content-Length.
2. **Archive Sanitization**:
   - Total uncompressed size limit enforced (max 100 MB).
   - Compression ratio limit enforced (max 10:1 ratio to thwart decompression bombs).
   - File entry validation: disallow entries starting with `/` or containing `..` or null bytes.
   - Entry count limit (max 5,000 files).
   - File type blacklist: rejects any `.exe`, `.sh`, `.bat`, `.apk`, `.dex`, `.so`, `.elf`.
   - Entrypoint verification: confirms existence of `index.html` either at root or inside a single top-level folder.
3. **Local Android Asset Loader**:
   - Extracted files are placed in `app/src/main/assets/web/`.
   - Android app uses `androidx.webkit.WebViewAssetLoader` with domain `https://appassets.androidplatform.net/assets/web/index.html`.
   - **Crucial Security Rule**: Never enables `setAllowFileAccessFromFileURLs(true)`. Asset loader guarantees assets are served over a secure virtual origin, enabling modern web features (CORS, Fetch API, LocalStorage) without exposing the Android filesystem.

---

## 4. Worker Isolation & Resource Management

Android builds consume significant CPU and memory. In production, workers must be strictly contained:

| Resource Constraint | Value | Rationale |
| :--- | :--- | :--- |
| **Worker Concurrency** | 1 build per worker container | Prevents Gradle OOM and CPU thrashing |
| **Worker Container Memory** | 4.0 GB RAM limit | Android Gradle daemon requires ~2GB; OS & tools need ~1GB |
| **Worker Container CPU** | 2.0 vCPU | Prevents thread saturation on multi-tenant nodes |
| **Hard Build Timeout** | 10 minutes | Kills stuck Gradle daemons, deadlocks, or long downloads |
| **Workspace Cleanup** | Ephemeral volume per build | `/tmp/builds/{buildId}` is deleted in a `finally` block |
| **User Privileges** | Non-root (`gradleuser` UID 1001) | Hardens container against Gradle breakout vulnerabilities |
| **Docker Base Image** | `eclipse-temurin:17-jdk-jammy` | Official OpenJDK LTS base image with Android CLI tools pre-cached |

---

## 5. Deployment Topology

```mermaid
graph TB
    subgraph PublicCloud["Cloud Environment (AWS / GCP / Self-Hosted)"]
        subgraph WebSubnet["Public / Ingress Subnet"]
            ALB["Application Load Balancer"]
        end

        subgraph AppSubnet["Private Application Subnet"]
            FE["Web Frontend (Vite Static / Nginx Pods)"]
            API_Svc["API Gateway Service (Node.js Cluster)"]
            Redis_Cluster["Managed Redis / Valkey 7+"]
        end

        subgraph WorkerSubnet["Dedicated Worker Subnet (Auto-scaling)"]
            Worker_Node1["Build Worker Pod 1"]
            Worker_Node2["Build Worker Pod 2"]
        end

        subgraph StorageLayer["Managed Storage"]
            S3_Bucket[("Private S3 Bucket (SSE-S3 Encryption)")]
        end
    end

    ALB --> FE
    ALB --> API_Svc
    API_Svc --> Redis_Cluster
    API_Svc --> S3_Bucket
    Worker_Node1 --> Redis_Cluster
    Worker_Node1 --> S3_Bucket
    Worker_Node2 --> Redis_Cluster
    Worker_Node2 --> S3_Bucket
```

- **API & Frontend**: Lightweight, horizontally auto-scaled based on HTTP request volume.
- **Workers**: Scaled based on BullMQ `waiting` queue depth (e.g., using Kubernetes KEDA or AWS ECS target tracking based on queue length metrics).
