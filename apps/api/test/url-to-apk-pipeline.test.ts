import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from '../src/app.js';
import { ConversionRepository } from '../src/db/repository.js';
import { processConversionJob } from '../src/jobs/build-worker.js';
import { setInProcessExecution } from '../src/jobs/queue.js';
import { getStorageService } from '../src/storage/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('URL-to-APK End-to-End Pipeline Tests', () => {
  let testHttpsServer: https.Server;
  let testServerPort: number;
  let testServerBaseUrl: string;

  beforeAll(async () => {
    // 1. Start controlled HTTPS test server using test PFX certificate
    const pfxPath = path.resolve(__dirname, 'fixtures/test-cert.pfx');
    const pfx = fs.readFileSync(pfxPath);

    testHttpsServer = https.createServer(
      {
        pfx,
        passphrase: 'password123',
      },
      (req, res) => {
        const url = req.url || '/';

        if (url === '/health' || url === '/test-app') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'X-Test-App': 'Web2APK Controlled Test Site',
          });
          res.end('<!DOCTYPE html><html><head><title>Controlled Test App</title></head><body><h1>Web2APK Ready</h1></body></html>');
          return;
        }

        if (url === '/redirect-to-blocked') {
          // Simulate malicious redirect targeting loopback / private IP
          res.writeHead(302, {
            Location: 'http://127.0.0.1:8080/admin/internal-service',
          });
          res.end();
          return;
        }

        if (url === '/redirect-to-metadata') {
          // Simulate malicious redirect targeting cloud metadata service
          res.writeHead(302, {
            Location: 'http://169.254.169.254/latest/meta-data/',
          });
          res.end();
          return;
        }

        if (url === '/service-503') {
          // Simulate target website returning HTTP 503 (e.g. Cloudflare Under Attack / Service Unavailable)
          res.writeHead(503, {
            'Content-Type': 'text/html',
            'Retry-After': '60',
          });
          res.end('<!DOCTYPE html><html><head><title>Service Temporarily Unavailable</title></head><body><h1>503 Service Unavailable</h1></body></html>');
          return;
        }

        if (url === '/head-503-get-200') {
          // Simulate web server returning 503 to HEAD, but 200 OK to GET
          if (req.method === 'HEAD') {
            res.writeHead(503, { 'Content-Type': 'text/html' });
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!DOCTYPE html><html><head><title>Recovered via GET</title></head><body><h1>Web2APK Ready</h1></body></html>');
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      }
    );

    await new Promise<void>((resolve) => {
      testHttpsServer.listen(0, '127.0.0.1', () => {
        const addr = testHttpsServer.address() as any;
        testServerPort = addr.port;
        testServerBaseUrl = `https://127.0.0.1:${testServerPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (testHttpsServer) {
      await new Promise<void>((resolve) => testHttpsServer.close(() => resolve()));
    }
  });

  beforeEach(() => {
    ConversionRepository.clearMemory();
    setInProcessExecution(false);
  });

  // ==========================================================================
  // TEST 1: CONTROLLED HTTPS TEST SITE (Full Pipeline to Real APK)
  // ==========================================================================
  describe('1. Controlled HTTPS Test Site & Real APK Generation', () => {
    it('validates syntax, reachability, enqueues job, compiles real APK with Gradle, verifies artifact, and allows authorized download', async () => {
      const targetUrl = `${testServerBaseUrl}/test-app`;

      // Step A: Submit URL to conversion pipeline
      const submitRes = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send({
          url: targetUrl,
          appConfig: {
            appName: 'Controlled Test App',
            packageName: 'com.controlled.testapp',
            versionName: '1.0.0',
            versionCode: 1,
            themeColor: '#7C3AED',
            orientation: 'portrait',
            enablePullToRefresh: true,
            enableDownloadManager: true,
            enableGeolocation: false,
            enableCamera: false,
            enablePushNotifications: false,
          },
        });

      expect(submitRes.status).toBe(202);
      expect(submitRes.body.status).toBe('queued');
      expect(submitRes.body.id).toMatch(/^conv_/);
      const conversionId = submitRes.body.id;

      // Step B: Worker processes the job through the isolated build pipeline
      const artifact = await processConversionJob(
        {
          conversionId,
          userId: 'anon_default',
          mode: 'url',
          targetUrl,
          appConfig: submitRes.body.appConfig,
        },
        {
          skipReachabilityCheck: true, // Already verified during submission
        }
      );

      expect(artifact).toBeDefined();
      expect(artifact.fileName).toMatch(/^controlled-test-app(\.apk|-debug\.apk)$/);
      expect(artifact.fileSizeBytes).toBeGreaterThan(500 * 1024); // > 500 KB
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);

      // Step C: Verify updated conversion status
      const statusRes = await request(app).get(`/api/conversions/${conversionId}`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body.progress).toBe(100);
      expect(statusRes.body.artifact).toBeDefined();
      expect(statusRes.body.artifact.sha256).toBe(artifact.sha256);

      // Step D: Authorized Download
      const downloadRes = await request(app)
        .get(`/api/conversions/${conversionId}/download?token=${artifact.downloadToken}`);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('application/vnd.android.package-archive');
      expect(downloadRes.headers['content-disposition']).toMatch(/controlled-test-app(\.apk|-debug\.apk)/);
      expect(parseInt(downloadRes.headers['content-length'], 10)).toBe(artifact.fileSizeBytes);
    }, 1200000); // Allow sufficient time for real Gradle build
  });

  // ==========================================================================
  // TEST 2: UNREACHABLE SITE
  // ==========================================================================
  describe('2. Unreachable Site Handling', () => {
    it('rejects an unreachable HTTPS endpoint before Gradle compilation', async () => {
      // Port 59199 is not listening on loopback
      const unreachableUrl = `https://127.0.0.1:59199/nonexistent`;

      const res = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send({
          url: unreachableUrl,
          appConfig: {
            appName: 'Unreachable App',
            packageName: 'com.unreachable.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SITE_UNREACHABLE');
      expect(res.body.detail).toContain('unreachable');
    });

    it('rejects an unreachable public IP before compilation via validation endpoint', async () => {
      // 192.0.2.1 is TEST-NET-1 (non-routable)
      const res = await request(app)
        .post('/api/validate/url')
        .send({
          url: 'https://192.0.2.1:8443/app',
        });

      expect(res.status).toBe(400);
      expect(res.body.valid).toBe(false);
    });
  });

  // ==========================================================================
  // TEST 3: INVALID URL SYNTAX & SCHEMES
  // ==========================================================================
  describe('3. Invalid URL & Unsupported Schemes', () => {
    it('rejects malformed URL syntax with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'not-a-valid-url-format',
          appConfig: {
            appName: 'Invalid URL App',
            packageName: 'com.invalid.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unsupported schemes (ftp://)', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'ftp://files.example.com/app',
          appConfig: {
            appName: 'FTP App',
            packageName: 'com.ftp.app',
          },
        });

      expect(res.status).toBe(400);
      expect(['UNSUPPORTED_SCHEME', 'VALIDATION_ERROR']).toContain(res.body.code);
    });

    it('requires HTTPS by default and rejects non-HTTPS public URLs', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'http://example.com/insecure',
          appConfig: {
            appName: 'Insecure HTTP App',
            packageName: 'com.insecure.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_SCHEME');
      expect(res.body.detail).toContain('HTTPS is required');
    });
  });

  // ==========================================================================
  // TEST 4: REDIRECT TO A BLOCKED ADDRESS (SSRF Egress Enforcement)
  // ==========================================================================
  describe('4. Redirect to a Blocked Address (SSRF Protection)', () => {
    it('detects and immediately blocks a redirect targeting loopback (127.0.0.1)', async () => {
      const redirectUrl = `${testServerBaseUrl}/redirect-to-blocked`;

      // Even with test server allowed as source, redirect target is rejected
      const res = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send({
          url: redirectUrl,
          appConfig: {
            appName: 'Redirect Exploit App',
            packageName: 'com.exploit.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SSRF_BLOCKED');
      expect(res.body.detail).toContain('restricted');
    });

    it('detects and immediately blocks a redirect targeting cloud metadata (169.254.169.254)', async () => {
      const redirectUrl = `${testServerBaseUrl}/redirect-to-metadata`;

      const res = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send({
          url: redirectUrl,
          appConfig: {
            appName: 'Metadata Exploit App',
            packageName: 'com.exploit.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SSRF_BLOCKED');
      expect(res.body.detail).toContain('restricted');
    });
  });

  // ==========================================================================
  // TEST 5: SIMULATED GRADLE FAILURE
  // ==========================================================================
  describe('5. Simulated Gradle Failure Handling', () => {
    it('captures compiler errors, records failure telemetry, and prevents artifact creation', async () => {
      const targetUrl = `${testServerBaseUrl}/test-app`;

      // Submit job
      const submitRes = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send({
          url: targetUrl,
          appConfig: {
            appName: 'SimulateGradleFailure',
            packageName: 'com.simulate.gradlefail',
            versionName: '1.0.0',
            versionCode: 1,
            themeColor: '#EF4444',
            orientation: 'portrait',
            enablePullToRefresh: false,
            enableDownloadManager: false,
            enableGeolocation: false,
            enableCamera: false,
            enablePushNotifications: false,
          },
        });

      expect(submitRes.status).toBe(202);
      const conversionId = submitRes.body.id;

      // Execute worker with simulated failure enabled
      await expect(
        processConversionJob(
          {
            conversionId,
            userId: 'anon_default',
            mode: 'url',
            targetUrl,
            appConfig: submitRes.body.appConfig,
          },
          {
            gradleArgs: ['nonExistentTaskForTesting'],
            skipReachabilityCheck: true,
          }
        )
      ).rejects.toThrow(/Gradle compilation failed with exit code/);

      // Verify DB record status is transitioned to 'failed'
      const record = await ConversionRepository.findById(conversionId);
      expect(record).toBeDefined();
      expect(record?.status).toBe('failed');
      expect(record?.errorCode).toBe('BUILD_FAILED');
      expect(record?.errorMessage).toContain('Gradle compilation failed');
      expect(record?.artifact).toBeNull();

      // Verify that download is properly denied (409 Artifact Not Ready)
      const downloadRes = await request(app).get(`/api/conversions/${conversionId}/download`);
      expect(downloadRes.status).toBe(409);
      expect(downloadRes.body.code).toBe('ARTIFACT_NOT_READY');
    }, 120000);
  });

  // ==========================================================================
  // TEST 6: RESILIENT REACHABILITY (HTTP 503, 403, and Fallbacks)
  // ==========================================================================
  describe('6. Resilient Reachability Handling (HTTP 503 & HEAD Fallback)', () => {
    it('gracefully accepts a website returning HTTP 503 (Cloudflare/CDN or maintenance) and permits APK build generation', async () => {
      const url503 = `${testServerBaseUrl}/service-503`;

      // 1. Validation endpoint returns 200 with valid: true, statusCode: 503 and warning
      const valRes = await request(app)
        .post('/api/validate/url')
        .set('x-allow-test-loopback', 'true')
        .send({ url: url503 });

      expect(valRes.status).toBe(200);
      expect(valRes.body.valid).toBe(true);
      expect(valRes.body.statusCode).toBe(503);
      expect(valRes.body.warning).toContain('503');

      // 2. Conversion endpoint POST /api/conversions/url succeeds with 202 and queues job
      const submitRes = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send({
          url: url503,
          appConfig: {
            appName: 'Service 503 App',
            packageName: 'com.service503.app',
            versionName: '1.0.0',
            versionCode: 1,
            themeColor: '#7C3AED',
          },
        });

      expect(submitRes.status).toBe(202);
      expect(submitRes.body.status).toBe('queued');
      expect(submitRes.body.id).toMatch(/^conv_/);
    });

    it('falls back from HEAD 503 to GET 200, successfully recovering website title and proceeding with build', async () => {
      const fallbackUrl = `${testServerBaseUrl}/head-503-get-200`;

      // Validation endpoint recovers via GET
      const valRes = await request(app)
        .post('/api/validate/url')
        .set('x-allow-test-loopback', 'true')
        .send({ url: fallbackUrl });

      expect(valRes.status).toBe(200);
      expect(valRes.body.valid).toBe(true);
      expect(valRes.body.statusCode).toBe(200);
      expect(valRes.body.title).toBe('Recovered via GET');

      // Conversion endpoint succeeds
      const submitRes = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send({
          url: fallbackUrl,
          appConfig: {
            appName: 'Fallback App',
            packageName: 'com.fallback.app',
          },
        });

      expect(submitRes.status).toBe(202);
      expect(submitRes.body.status).toBe('queued');
    });
  });
});
