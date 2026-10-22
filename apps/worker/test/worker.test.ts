import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatedWorkspaceManager } from '../src/builder/isolated-workspace.js';
import { configSanitizer, validatePackageName, escapeXml, escapeKotlinString } from '../src/builder/config-sanitizer.js';
import { validateZipBuffer, extractSanitizedZip, PROHIBITED_EXTENSIONS } from '../src/builder/zip-extractor.js';
import { verifyApk } from '../src/builder/apk-verifier.js';
import { LocalWorkerStorage } from '../src/storage/storage-service.js';
import { CleanupService } from '../src/cleanup/cleanup-service.js';
import { redactSensitiveData, WorkerLogger } from '../src/monitoring/logger.js';
import { metrics } from '../src/monitoring/metrics.js';
import { createHealthServer } from '../src/monitoring/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testTmpDir = path.resolve(__dirname, 'tmp-worker-test');

describe('Dedicated Android Build Worker Unit & Integration Tests', () => {
  beforeEach(() => {
    if (fs.existsSync(testTmpDir)) {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testTmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testTmpDir)) {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    }
  });

  // ========================================================================
  // 1. ISOLATED WORKSPACE MANAGEMENT
  // ========================================================================
  describe('1. Isolated Workspace Management', () => {
    it('allocates clean per-job directory isolated from other jobs', () => {
      const mgr = new IsolatedWorkspaceManager(testTmpDir);
      const ws1 = mgr.allocate('job_alpha_123');
      const ws2 = mgr.allocate('job_beta_456');

      expect(fs.existsSync(ws1.workspacePath)).toBe(true);
      expect(fs.existsSync(ws2.workspacePath)).toBe(true);
      expect(ws1.workspacePath).not.toBe(ws2.workspacePath);

      // Verify path traversal rejection
      expect(() => mgr.allocate('../../malicious_job')).toThrow();
    });

    it('cleans up per-job workspace on demand', () => {
      const mgr = new IsolatedWorkspaceManager(testTmpDir);
      const ws = mgr.allocate('job_cleanup_test');
      expect(fs.existsSync(ws.workspacePath)).toBe(true);

      mgr.cleanup('job_cleanup_test');
      expect(fs.existsSync(ws.workspacePath)).toBe(false);
    });

    it('sweeps orphaned workspaces exceeding maximum retention age', async () => {
      const mgr = new IsolatedWorkspaceManager(testTmpDir);
      const ws = mgr.allocate('job_orphaned');
      // Artificially age the directory mtime
      const oldTime = (Date.now() - 10000) / 1000;
      fs.utimesSync(ws.workspacePath, oldTime, oldTime);

      const swept = mgr.sweepOrphaned(5000); // Max age 5 seconds
      expect(swept).toBe(1);
      expect(fs.existsSync(ws.workspacePath)).toBe(false);
    });
  });

  // ========================================================================
  // 2. CONFIG SANITIZATION & LEAST-PRIVILEGE INJECTION
  // ========================================================================
  describe('2. Config Sanitization & Injection', () => {
    it('escapes XML special characters to prevent XML injection in strings.xml', () => {
      const dangerous = '<string>Test & "Quotes" \'Single\' > <</string>';
      const escaped = escapeXml(dangerous);
      expect(escaped).not.toContain('<string>');
      expect(escaped).toContain('&amp;');
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&apos;');
    });

    it('escapes Kotlin string interpolation to prevent arbitrary evaluation', () => {
      const dangerous = 'hello "${System.exit(1)}" \\ and $variable';
      const escaped = escapeKotlinString(dangerous);
      expect(escaped).toContain('\\$');
      expect(escaped).toContain('\\"');
    });

    it('strictly enforces package name validation rules and Java keywords', () => {
      expect(validatePackageName('com.example.app').valid).toBe(true);
      expect(validatePackageName('io.github.portfolio').valid).toBe(true);

      // Invalid cases
      expect(validatePackageName('singleword').valid).toBe(false);
      expect(validatePackageName('com.123bad.app').valid).toBe(false);
      expect(validatePackageName('com.class.app').valid).toBe(false); // 'class' is Java keyword
      expect(validatePackageName('com.import.myapp').valid).toBe(false); // 'import' is Java keyword
    });
  });

  // ========================================================================
  // 3. ZIP EXTRACTION DEFENSE & SECURITY LIMITS
  // ========================================================================
  describe('3. ZIP Extraction Protection & Limits', () => {
    it('blocks dangerous executable extensions', () => {
      expect(PROHIBITED_EXTENSIONS.has('.exe')).toBe(true);
      expect(PROHIBITED_EXTENSIONS.has('.sh')).toBe(true);
      expect(PROHIBITED_EXTENSIONS.has('.bat')).toBe(true);
      expect(PROHIBITED_EXTENSIONS.has('.jar')).toBe(true);
      expect(PROHIBITED_EXTENSIONS.has('.gradle')).toBe(true);
      expect(PROHIBITED_EXTENSIONS.has('.kts')).toBe(true);
      expect(PROHIBITED_EXTENSIONS.has('.py')).toBe(true);
    });

    it('rejects empty or corrupt ZIP buffer', () => {
      const shortBuf = Buffer.from('short');
      const shortRes = validateZipBuffer(shortBuf);
      expect(shortRes.valid).toBe(false);
      expect(shortRes.error).toContain('Archive is empty or corrupted');

      const corruptBuf = Buffer.alloc(50, 0xaa);
      const corruptRes = validateZipBuffer(corruptBuf);
      expect(corruptRes.valid).toBe(false);
      expect(corruptRes.error).toContain('Invalid ZIP format');
    });
  });

  // ========================================================================
  // 4. STORAGE & EXPIRING PRESIGNED DOWNLOAD URLS
  // ========================================================================
  describe('4. Storage & Expiring Download URLs', () => {
    it('uploads file and generates expiring download URL', async () => {
      const storage = new LocalWorkerStorage(testTmpDir);
      const testKey = 'artifacts/job_123/app-debug.apk';
      const content = Buffer.from('Simulated APK binary content for test');

      await storage.uploadFile(testKey, content, 'application/vnd.android.package-archive');
      expect(await storage.fileExists(testKey)).toBe(true);

      const downloadUrl = await storage.getDownloadUrl(testKey, 1800);
      expect(downloadUrl).toContain('expires=');
      expect(downloadUrl).toContain(encodeURIComponent(testKey));

      const downloaded = await storage.downloadFile(testKey);
      expect(downloaded.toString()).toBe('Simulated APK binary content for test');

      await storage.deleteFile(testKey);
      expect(await storage.fileExists(testKey)).toBe(false);
    });
  });

  // ========================================================================
  // 5. SECRET REDACTION & STRUCTURED LOGGING
  // ========================================================================
  describe('5. Secret Redaction & Structured Logging', () => {
    it('redacts passwords, tokens, and secret keys from logs', () => {
      const sensitiveMsg = 'Connecting with password=supersecret123 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID';
      const sanitized = redactSensitiveData(sensitiveMsg);

      expect(sanitized).not.toContain('supersecret123');
      expect(sanitized).toContain('[REDACTED_CREDENTIAL]');
    });

    it('emits structured JSON log entries', () => {
      const workerLogger = new WorkerLogger('test-worker-1');
      const entry = workerLogger.info('Task execution started', 'job_456', 'building');

      expect(entry.workerId).toBe('test-worker-1');
      expect(entry.jobId).toBe('job_456');
      expect(entry.stage).toBe('building');
      expect(entry.level).toBe('info');
      expect(entry.timestamp).toBeDefined();
    });
  });

  // ========================================================================
  // 6. HEALTH, READINESS & METRICS ENDPOINTS
  // ========================================================================
  describe('6. Health, Readiness & Metrics Probes', () => {
    const app = createHealthServer({
      isWorkerActive: () => true,
    });

    it('GET /health returns 200 UP for liveness probe', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
      expect(res.body.workerId).toBeDefined();
    });

    it('GET /ready returns 200 READY for readiness probe', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY');
      expect(res.body.checks.storage.status).toBe('UP');
    });

    it('GET /metrics returns Prometheus formatted telemetry text', async () => {
      metrics.recordJobStarted();
      metrics.recordJobCompleted(1250);

      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('web2apk_worker_jobs_total');
      expect(res.text).toContain('web2apk_worker_active_builds');
      expect(res.text).toContain('web2apk_worker_uptime_seconds');
    });

    it('GET /metrics returns JSON when Accept: application/json', async () => {
      const res = await request(app).get('/metrics').set('Accept', 'application/json');
      expect(res.status).toBe(200);
      expect(res.body.jobsTotal).toBeDefined();
      expect(res.body.memoryUsageMb).toBeDefined();
    });
  });
});
