# Web2APK Production Cloud Deployment Guide

This guide details the step-by-step procedures to deploy the Web2APK platform to production environments (Kubernetes, AWS ECS Fargate, or Docker Compose). It covers container build definitions, secret management, object storage configuration, queue tuning, worker sizing, and explicit manual configuration requirements.

---

## 1. System Topology & Architecture

```text
                               ┌───────────────────────────────────────────────┐
                               │             Edge Ingress / CDN / SSL          │
                               │        (Cloudflare / AWS ALB / NGINX)         │
                               └───────────────┬───────────────────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       │                                               │
             Path: /api/*                                            Path: /*
                       ▼                                               ▼
        ┌─────────────────────────────┐                 ┌─────────────────────────────┐
        │     API Gateway Service     │                 │       Web UI Frontend       │
        │   (Node.js 20 + Express)    │                 │   (React 18 + Vite / Nginx) │
        │     Port 4000 (2+ Pods)     │                 │           Port 80           │
        └──────┬──────────────┬───────┘                 └─────────────────────────────┘
               │              │
    State &    │              │ Pub/Sub &
    Metadata   │              │ Job Queue
               ▼              ▼
     ┌────────────────┐ ┌────────────────┐
     │  PostgreSQL 16 │ │ Redis 7 Cluster│
     │  (AWS RDS /    │ │ (ElastiCache / │
     │  StatefulSet)  │ │ Valkey)        │
     └────────────────┘ └────────┬───────┘
                                 │
                   BullMQ Work   │ Pull Jobs
                                 ▼
                     ┌────────────────────────────────────────┐
                     │    Dedicated Android Worker Fleet      │
                     │  (Ubuntu 22.04 + OpenJDK 17 + SDK 34)  │
                     │   Port 4001 (Health/Metrics Probes)    │
                     │   2 vCPU, 4GB RAM per worker pod       │
                     └───────────┬────────────────────────────┘
                                 │
                                 │ Artifact Upload / Download
                                 ▼
                     ┌────────────────────────────────────────┐
                     │    Private S3-Compatible Storage       │
                     │    (AWS S3 / Cloudflare R2 / MinIO)    │
                     │  - Quarantine Uploads (24h TTL)        │
                     │  - Verified APK Artifacts (24h TTL)    │
                     └────────────────────────────────────────┘
```

---

## 2. Infrastructure Sizing & Compute Requirements

| Component | Target Runtime | Min CPU | Min Memory | Storage / Disk | Scaling Metric |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Frontend** | Nginx Alpine | 100m | 128 MiB | Ephemeral | HTTP request volume / Ingress |
| **API Gateway** | Node 20 Alpine | 250m | 512 MiB | Ephemeral | CPU Utilization > 70% (HPA) |
| **Android Worker**| Ubuntu + Temurin 17 | 1000m (req) / 2000m (lim) | 2 GiB (req) / 4 GiB (lim) | 10 GiB Ephemeral (`emptyDir`) | BullMQ Queue Length (KEDA) |
| **PostgreSQL** | PostgreSQL 16 | 250m | 512 MiB | 20 GiB Persistent SSD | Database Connection Pool |
| **Redis** | Redis 7 Alpine | 100m | 256 MiB | 5 GiB Persistent (`AOF`) | Memory usage > 75% |

> [!IMPORTANT]
> **Android Worker Memory Sizing**: Android Gradle compilation invokes both the Kotlin compiler and AAPT2 resource linkers simultaneously. Setting worker container memory limits below **4 GB** (`4096Mi`) risks unexpected OOM crashes (`exit code 137`). The build writes `GRADLE_MAX_HEAP` and `GRADLE_MAX_METASPACE` into each job's `gradle.properties` and also exports them via `GRADLE_OPTS`; increasing timeouts alone does not fix insufficient memory or CPU.

---

## 3. Environment Variables Reference

### 3.1 API Gateway (`apps/api/.env`)

| Variable | Description | Production Default | Sensitivity |
| :--- | :--- | :--- | :--- |
| `PORT` | HTTP server listening port | `4000` | Public |
| `NODE_ENV` | Runtime environment | `production` | Public |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` | **Secret** |
| `REDIS_HOST` | Redis broker hostname | `redis-service` | Internal |
| `REDIS_PORT` | Redis broker port | `6379` | Internal |
| `REDIS_PASSWORD` | Redis authentication token | (from secret manager) | **Secret** |
| `STORAGE_DRIVER` | Storage driver (`s3` or `local`) | `s3` | Public |
| `S3_ENDPOINT` | Custom S3 endpoint (leave empty for AWS) | (blank or MinIO URL) | Public |
| `S3_REGION` | Target S3 bucket AWS region | `us-east-1` | Public |
| `S3_BUCKET_NAME` | S3 bucket name | `web2apk-artifacts` | Public |
| `S3_ACCESS_KEY_ID` | IAM access key with S3 Put/Get | (from secret manager) | **Secret** |
| `S3_SECRET_ACCESS_KEY`| IAM secret key | (from secret manager) | **Secret** |
| `S3_FORCE_PATH_STYLE` | Path style addressing (`false` for AWS) | `false` | Public |
| `JWT_SECRET` | Secret key for signed download tokens | (min 32 random characters) | **Secret** |
| `API_KEY_SECRET` | Master API Key for administration | (min 32 random characters) | **Secret** |
| `CORS_ORIGIN` | Allowed CORS origins | `https://web2apk.dev` | Public |
| `MAX_UPLOAD_SIZE_BYTES`| Maximum static website ZIP size | `104857600` (100 MB) | Public |
| `JOB_TIMEOUT_MS` | Job hard execution timeout | `1200000` (20 minutes) | Public |
| `GRADLE_TIMEOUT_MS` | Gradle compilation timeout | `900000` (15 minutes) | Public |
| `GRADLE_OFFLINE` | Run Gradle with `--offline` (requires pre-warmed cache) | `true` | Public |
| `BUILD_CONCURRENCY` | In-process API build concurrency | `1` | Public |

### 3.2 Android Build Worker (`apps/worker/.env`)

| Variable | Description | Production Default | Sensitivity |
| :--- | :--- | :--- | :--- |
| `WORKER_ID` | Unique worker instance identifier | `worker-${POD_NAME}` | Internal |
| `WORKER_CONCURRENCY`| Maximum concurrent Gradle jobs per pod | `2` | Public |
| `BUILD_TIMEOUT_MS` | Hard job timeout (kept above `GRADLE_TIMEOUT_MS`) | `1200000` (20 minutes) | Public |
| `QUEUE_NAME` | BullMQ queue identifier | `android-conversions` | Internal |
| `WORKSPACE_BASE_DIR` | Working directory for isolated builds | `/tmp/web2apk-builds` | Internal |
| `ANDROID_TEMPLATE_DIR`| Immutable path to trusted template | `/opt/android-template` | Internal |
| `GRADLE_MAX_HEAP` | Maximum heap for Gradle daemon | `2048m` | Public |
| `GRADLE_MAX_METASPACE`| Max Metaspace for Kotlin compiler | `512m` | Public |
| `GRADLE_TIMEOUT_MS`| Hard compile timeout (legacy alias: `GRADLE_COMPILATION_TIMEOUT_MS`) | `900000` (15 minutes) | Public |
| `GRADLE_OFFLINE`| Run Gradle with `--offline` | `true` | Public |
| `HEALTH_PORT` | Worker health/readiness probe port | `4001` | Public |
| `CLEANUP_INTERVAL_MS`| Workspace sweeper interval | `300000` (5 minutes) | Public |
| `ARTIFACT_TTL_HOURS` | Retention period before APK deletion | `24` | Public |

---

## 4. Service-by-Service Deployment Steps

### 4.1 Step 1: Managed Database (PostgreSQL 16)
1. **Provision RDS / Cloud SQL**:
   - Engine: PostgreSQL 16.2+
   - Instance: `db.t4g.small` or higher (2 vCPU, 2 GB RAM)
   - Enable automated backups and point-in-time recovery.
2. **Initialize Database Schema**:
   - The API Gateway runs automatic schema migration on startup (`initDatabase()` in `apps/api/src/db/client.ts`).
   - Alternatively, apply [`SCHEMA_SQL`](file:///d:/web-apk/apps/api/src/db/client.ts) manually via `psql`.

### 4.2 Step 2: Managed Queue Broker (Redis 7)
1. **Provision ElastiCache / Redis Cloud / Managed Valkey**:
   - Engine: Redis 7.0+
   - NodeType: `cache.t4g.small` (1.37 GiB RAM)
   - Maxmemory policy: `noeviction` (critical for BullMQ message durability).
   - In-transit encryption (TLS) enabled.

### 4.3 Step 3: Private Object Storage (AWS S3)
1. **Create S3 Bucket**:
   ```bash
   aws s3api create-bucket \
     --bucket web2apk-artifacts \
     --region us-east-1
   ```
2. **Block Public Access**:
   ```bash
   aws s3api put-public-access-block \
     --bucket web2apk-artifacts \
     --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
   ```
3. **Configure Lifecycle Rules (Automated Expiration)**:
   Create `lifecycle.json`:
   ```json
   {
     "Rules": [
       {
         "ID": "ExpireQuarantinedUploads",
         "Filter": { "Prefix": "quarantine/" },
         "Status": "Enabled",
         "Expiration": { "Days": 1 }
       },
       {
         "ID": "ExpireCompiledArtifacts",
         "Filter": { "Prefix": "artifacts/" },
         "Status": "Enabled",
         "Expiration": { "Days": 7 }
       }
     ]
   }
   ```
   Apply lifecycle rule:
   ```bash
   aws s3api put-bucket-lifecycle-configuration \
     --bucket web2apk-artifacts \
     --lifecycle-configuration file://lifecycle.json
   ```
4. **Least-Privilege IAM Policy**:
   Attach this policy to the Worker and API task roles:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:DeleteObject"
         ],
         "Resource": "arn:aws:s3:::web2apk-artifacts/*"
       }
     ]
   }
   ```

### 4.4 Step 4: Build & Publish Container Images

```bash
# 1. Build and push API Gateway
docker build -t ghcr.io/your-org/web2apk-api:latest -f apps/api/Dockerfile .
docker push ghcr.io/your-org/web2apk-api:latest

# 2. Build and push Dedicated Android Worker
docker build -t ghcr.io/your-org/web2apk-worker:latest -f apps/worker/Dockerfile .
docker push ghcr.io/your-org/web2apk-worker:latest

# 3. Build and push Web UI
docker build -t ghcr.io/your-org/web2apk-web:latest -f apps/web/Dockerfile .
docker push ghcr.io/your-org/web2apk-web:latest
```

---

## 5. Kubernetes Production Deployment

The complete set of declarative Kubernetes manifests is maintained in [`infrastructure/k8s/`](file:///d:/web-apk/infrastructure/k8s/):

```bash
# 1. Create Namespace
kubectl apply -f infrastructure/k8s/00-namespace.yaml

# 2. Apply ConfigMap
kubectl apply -f infrastructure/k8s/01-configmap.yaml

# 3. Apply Production Secrets (Ensure values are populated)
kubectl apply -f infrastructure/k8s/02-secrets.yaml

# 4. Deploy Infrastructure (Postgres & Redis)
kubectl apply -f infrastructure/k8s/03-postgres.yaml
kubectl apply -f infrastructure/k8s/04-redis.yaml

# 5. Deploy API Gateway (with HPA and PDB)
kubectl apply -f infrastructure/k8s/05-api.yaml

# 6. Deploy Android Build Worker Fleet
kubectl apply -f infrastructure/k8s/06-worker.yaml

# 7. Apply Ingress with TLS Termination
kubectl apply -f infrastructure/k8s/07-ingress.yaml

# 8. Deploy Periodic Storage Cleanup CronJob
kubectl apply -f infrastructure/k8s/08-cleanup-cronjob.yaml
```

### Checking Deployment Rollout:
```bash
kubectl -n web2apk rollout status deployment/api-gateway
kubectl -n web2apk rollout status deployment/android-build-worker
kubectl -n web2apk get pods -o wide
```

---

## 6. Local Production-Style Deployment (Docker Compose)

For staging or local on-premise verification where Docker is installed:

```bash
# Start full isolated stack (Postgres, Redis, MinIO, API, Worker, Web)
docker compose -f infrastructure/docker-compose.yml up --build -d

# Check service health status
docker compose -f infrastructure/docker-compose.yml ps

# View real-time worker logs
docker compose -f infrastructure/docker-compose.yml logs -f worker
```

Services exposed locally:
- **Web UI**: `http://localhost:5173` (or `http://localhost`)
- **API Gateway**: `http://localhost:4000/api`
- **Worker Health & Metrics**: `http://localhost:4001/health` and `/metrics`
- **MinIO S3 Console**: `http://localhost:9001` (User: `minioadmin`, Pass: `minioadmin`)

---

## 7. Monitoring, Health Checks & Telemetry

### 7.1 Kubernetes Probes

| Service | Probe Type | Endpoint | Interval | Expected Response |
| :--- | :--- | :--- | :--- | :--- |
| **API Gateway** | Liveness | `GET /api/health` | 15s | `200 OK`, `{"status": "healthy"}` |
| **API Gateway** | Readiness | `GET /api/health` | 10s | `200 OK` (checks Postgres + Redis) |
| **Worker** | Liveness | `GET /health` (:4001) | 15s | `200 OK`, `{"status": "UP"}` |
| **Worker** | Readiness | `GET /ready` (:4001) | 10s | `200 OK` (checks Redis + Disk space) |

### 7.2 Prometheus Metrics Scraping
The worker exposes Prometheus metrics at `http://<worker-ip>:4001/metrics`:
- `web2apk_worker_jobs_total{status="completed|failed|cancelled"}`
- `web2apk_worker_active_builds`
- `web2apk_worker_build_duration_ms_avg`
- `web2apk_worker_memory_bytes{type="heap_used|rss"}`
- `web2apk_worker_uptime_seconds`

---

## 8. Manual Cloud Configuration & Credentials Checklist

The following items cannot be automated via code generation and **require your cloud account credentials or administrative approval**:

- [ ] **Domain & DNS Registration**:
  - Point `web2apk.dev` (A/CNAME) to Ingress / CloudFront / ALB.
  - Point `api.web2apk.dev` (A/CNAME) to Ingress / ALB.
- [ ] **Production SSL / TLS Certificates**:
  - Request AWS ACM Certificate for `*.web2apk.dev`, OR configure Let's Encrypt / Cert-Manager ClusterIssuer.
- [ ] **Cloud IAM Credentials**:
  - AWS IAM user or IAM Role for Service Accounts (IRSA) with permissions for S3 bucket `web2apk-artifacts`.
  - Provide `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to `web2apk-secrets`.
- [ ] **Managed Database Credentials**:
  - Provision PostgreSQL instance and provide `DATABASE_URL` with a secure 32+ character password.
- [ ] **Production Secret Keys**:
  - Generate a secure random string for `JWT_SECRET` (`openssl rand -hex 32`).
  - Generate a secure random string for `API_KEY_SECRET` (`openssl rand -hex 32`).
- [ ] **Android Code Signing (Release Distribution)**:
  - For Google Play distribution, provide a production `.jks` keystore and inject `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD` into CI/CD secrets.
