# Web2APK API Specification

Version: `1.0.0`  
Protocol: `HTTP/1.1`, `HTTP/2`  
Data Format: `JSON (application/json)`  
Real-time Stream: `Server-Sent Events (text/event-stream)`  

---

## 1. Authentication & Security Headers

All requests should include standard security headers:
- `X-Request-Id`: Unique UUID generated per request for end-to-end tracing.
- `Content-Type`: `application/json` (except multipart uploads).

For authenticated environments (e.g. multi-user SaaS):
- `Authorization`: `Bearer <jwt_token>` or API Key in `X-Api-Key`.

---

## 2. Common Data Types & Schemas

### 2.1 `AppConfig`
Application metadata configuration passed to the build pipeline.

```typescript
interface AppConfig {
  appName: string;               // e.g. "My Portfolio" (1-50 chars)
  packageName: string;           // e.g. "com.company.myportfolio" (Java package name regex)
  versionName: string;           // e.g. "1.0.0" (Semantic version string)
  versionCode: number;           // e.g. 1 (Integer >= 1)
  themeColor: string;            // e.g. "#1E40AF" (Hex color code)
  orientation: "unspecified" | "portrait" | "landscape";
  enablePullToRefresh: boolean;  // Default: true
  enableDownloadManager: boolean;// Enable Android native download handling
  enableGeolocation: boolean;    // Requests ACCESS_FINE_LOCATION in manifest
  enableCamera: boolean;         // Requests CAMERA in manifest & handles FileChooser
  enablePushNotifications: boolean; // Enables Firebase Cloud Messaging stub
  customUserAgent?: string;      // Optional custom suffix for WebView User-Agent
  signingMode: "debug" | "release"; // Defaults to 'debug' for instant test APKs
}
```

### 2.2 `BuildStatus`
Enumerated lifecycle states of a build job:
- `queued`: Waiting for an available worker in BullMQ queue.
- `validating`: Input, SSRF check, or ZIP sanitization in progress.
- `scaffolding`: Generating Android Kotlin template in ephemeral workspace.
- `building_gradle`: Gradle compiler execution in progress (`./gradlew assembleDebug`).
- `signing`: Keystore signature and zipalign in progress.
- `uploading`: Compiled APK being transferred to private Object Storage.
- `completed`: Build successful. Presigned download URL ready.
- `failed`: Build failed with diagnostic error details.
- `cancelled`: Build was aborted by user or timeout.

### 2.3 `ErrorResponse` (RFC 7807 Problem Details)
```json
{
  "type": "https://api.web2apk.dev/errors/validation-error",
  "title": "Validation Failed",
  "status": 400,
  "detail": "Invalid Android package name format.",
  "code": "INVALID_PACKAGE_NAME",
  "instance": "/api/v1/builds/url",
  "errors": [
    {
      "field": "packageName",
      "message": "Package name must follow reverse domain convention (e.g., com.example.app) with no reserved keywords."
    }
  ]
}
```

---

## 3. Endpoints

### 3.1 Pre-validation & Health

#### `GET /api/v1/health`
Checks API server, Redis connection, Object Storage accessibility, and worker queue backlog.

- **Response `200 OK`**:
```json
{
  "status": "healthy",
  "timestamp": "2026-10-12T14:15:30.000Z",
  "services": {
    "redis": "connected",
    "storage": "connected",
    "queue": {
      "waiting": 2,
      "active": 3,
      "completed": 1420,
      "failed": 12
    }
  }
}
```

---

#### `POST /api/v1/validate/url`
Pre-validates a web URL before starting a build. Checks HTTPS reachability, SSL certificate validity, and verifies target is not within private IP ranges (SSRF prevention).

- **Request Body**:
```json
{
  "url": "https://example.com"
}
```

- **Response `200 OK`**:
```json
{
  "valid": true,
  "normalizedUrl": "https://example.com/",
  "sslValid": true,
  "resolvedIp": "93.184.216.34",
  "title": "Example Domain",
  "favicon": "https://example.com/favicon.ico"
}
```

- **Response `400 Bad Request` (SSRF or Unreachable)**:
```json
{
  "valid": false,
  "code": "SSRF_BLOCKED_IP",
  "detail": "Target IP address 127.0.0.1 belongs to a restricted private or loopback range."
}
```

---

#### `POST /api/v1/validate/package-name`
Verifies whether a requested Android package name complies with Android SDK specifications.

- **Request Body**:
```json
{
  "packageName": "com.mycompany.app"
}
```

- **Response `200 OK`**:
```json
{
  "valid": true,
  "packageName": "com.mycompany.app"
}
```

---

### 3.2 Build Management

#### `POST /api/v1/builds/url`
Initiates an Android APK build from a public web URL.

- **Request Headers**:
  - `Content-Type: multipart/form-data` (if uploading custom app icon directly) OR `application/json` (if referencing remote icon or default icon).

- **JSON Payload Example**:
```json
{
  "url": "https://example.com",
  "appConfig": {
    "appName": "Example App",
    "packageName": "com.example.app",
    "versionName": "1.0.0",
    "versionCode": 1,
    "themeColor": "#2563EB",
    "orientation": "portrait",
    "enablePullToRefresh": true,
    "enableDownloadManager": true,
    "enableGeolocation": false,
    "enableCamera": false,
    "enablePushNotifications": false,
    "signingMode": "debug"
  },
  "iconBase64": "data:image/png;base64,iVBORw0KGgo..."
}
```

- **Response `202 Accepted`**:
```json
{
  "buildId": "bld_9f81a7b82c",
  "mode": "url",
  "status": "queued",
  "createdAt": "2026-10-12T14:20:00.000Z",
  "statusUrl": "/api/v1/builds/bld_9f81a7b82c",
  "logsStreamUrl": "/api/v1/builds/bld_9f81a7b82c/logs"
}
```

---

#### `POST /api/v1/builds/upload/initiate`
Initiates upload of a static website ZIP archive by generating a short-lived presigned S3 PUT URL. This offloads large binary uploads from the Node.js API process.

- **Request Body**:
```json
{
  "fileName": "mysite.zip",
  "fileSizeBytes": 15420100,
  "mimeType": "application/zip"
}
```

- **Response `200 OK`**:
```json
{
  "uploadId": "upl_87c29b4ef0",
  "s3Key": "quarantine/upl_87c29b4ef0/mysite.zip",
  "presignedPutUrl": "https://s3.amazonaws.com/web2apk-artifacts/quarantine/upl_87c29b4ef0/mysite.zip?X-Amz-Signature=...",
  "expiresAt": "2026-10-12T14:35:00.000Z",
  "maxSizeBytes": 104857600
}
```

---

#### `POST /api/v1/builds/upload`
Creates the build job after the ZIP has been uploaded to the quarantine path. Triggers archive validation and enqueues compilation.

- **Request Body**:
```json
{
  "uploadId": "upl_87c29b4ef0",
  "s3Key": "quarantine/upl_87c29b4ef0/mysite.zip",
  "appConfig": {
    "appName": "Static Portfolio",
    "packageName": "com.portfolio.app",
    "versionName": "1.0.0",
    "versionCode": 1,
    "themeColor": "#0F172A",
    "orientation": "unspecified",
    "enablePullToRefresh": false,
    "enableDownloadManager": false,
    "enableGeolocation": false,
    "enableCamera": false,
    "enablePushNotifications": false,
    "signingMode": "debug"
  },
  "iconBase64": null
}
```

- **Response `202 Accepted`**:
```json
{
  "buildId": "bld_7a12b99fc1",
  "mode": "upload",
  "status": "queued",
  "createdAt": "2026-10-12T14:22:15.000Z",
  "statusUrl": "/api/v1/builds/bld_7a12b99fc1",
  "logsStreamUrl": "/api/v1/builds/bld_7a12b99fc1/logs"
}
```

---

#### `GET /api/v1/builds/:buildId`
Retrieves current state, progress percentage, and summary metadata for a build.

- **Response `200 OK`**:
```json
{
  "buildId": "bld_9f81a7b82c",
  "mode": "url",
  "status": "building_gradle",
  "progressPercentage": 65,
  "stage": "Gradle :app:assembleDebug",
  "appConfig": {
    "appName": "Example App",
    "packageName": "com.example.app",
    "versionName": "1.0.0"
  },
  "createdAt": "2026-10-12T14:20:00.000Z",
  "startedAt": "2026-10-12T14:20:03.000Z",
  "completedAt": null,
  "durationMs": 42000,
  "artifact": null
}
```

When completed:
```json
{
  "buildId": "bld_9f81a7b82c",
  "status": "completed",
  "progressPercentage": 100,
  "stage": "Finished",
  "completedAt": "2026-10-12T14:21:12.000Z",
  "durationMs": 72000,
  "artifact": {
    "fileName": "example-app-debug.apk",
    "fileSizeBytes": 4518290,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "downloadUrl": "/api/v1/builds/bld_9f81a7b82c/download"
  }
}
```

---

#### `GET /api/v1/builds/:buildId/logs` (SSE Stream)
Streams real-time compiler logs and step status to client via Server-Sent Events.

- **Headers**:
  - `Accept: text/event-stream`
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`

- **Stream Events**:
```text
event: log
data: {"timestamp":"2026-10-12T14:20:04.120Z","level":"info","message":"Allocating ephemeral build sandbox..."}

event: stage
data: {"stage":"scaffolding","progress":20}

event: log
data: {"timestamp":"2026-10-12T14:20:06.840Z","level":"info","message":"Injecting application properties and res/values/strings.xml"}

event: stage
data: {"stage":"building_gradle","progress":40}

event: log
data: {"timestamp":"2026-10-12T14:20:12.300Z","level":"stdout","message":"> Task :app:preBuild UP-TO-DATE"}

event: log
data: {"timestamp":"2026-10-12T14:20:35.700Z","level":"stdout","message":"> Task :app:compileDebugKotlin"}

event: log
data: {"timestamp":"2026-10-12T14:20:55.100Z","level":"stdout","message":"> Task :app:packageDebug"}

event: stage
data: {"stage":"uploading","progress":90}

event: complete
data: {"status":"completed","artifact":{"fileName":"example-app-debug.apk","fileSizeBytes":4518290}}
```

---

#### `GET /api/v1/builds/:buildId/download`
Generates a short-lived presigned download URL for the built APK file.

- **Response `200 OK`**:
```json
{
  "buildId": "bld_9f81a7b82c",
  "fileName": "example-app-debug.apk",
  "downloadUrl": "https://s3.amazonaws.com/web2apk-artifacts/artifacts/bld_9f81a7b82c/app-debug.apk?X-Amz-Expires=900&...",
  "expiresAt": "2026-10-12T14:36:12.000Z"
}
```

---

#### `POST /api/v1/builds/:buildId/cancel`
Cancels an active or waiting build job and stops the underlying worker task.

- **Response `200 OK`**:
```json
{
  "buildId": "bld_9f81a7b82c",
  "status": "cancelled",
  "message": "Build job cancelled."
}
```
