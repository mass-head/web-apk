import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from '../src/app.js';
import { ConversionRepository } from '../src/db/repository.js';
import { processConversionJob } from '../src/jobs/build-worker.js';
import { buildMockZipBuffer } from './helpers/zip-builder.js';
import { TokenService } from '../src/auth/token.service.js';
import { verifyApk } from '../src/jobs/apk-verifier.js';
import { setInProcessExecution } from '../src/jobs/queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const binaryParser = (res: any, callback: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('Web2APK Comprehensive End-to-End Audit Suite', () => {
  let testHttpsServer: https.Server;
  let testServerPort: number;
  let testServerBaseUrl: string;

  beforeAll(async () => {
    setInProcessExecution(false);

    // 1. Start controlled HTTPS test server
    const pfxPath = path.resolve(__dirname, 'fixtures/test-cert.pfx');
    const pfx = fs.readFileSync(pfxPath);

    testHttpsServer = https.createServer(
      {
        pfx,
        passphrase: 'password123',
      },
      (req, res) => {
        const url = req.url || '/';

        if (url === '/health' || url === '/audit-site') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'X-Audit-Site': 'Web2APK Audit Ready',
          });
          res.end('<!DOCTYPE html><html><head><title>Audit Test App</title></head><body><h1>Audit Live Content</h1></body></html>');
          return;
        }

        if (url === '/redirect-ssrf') {
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
          res.end();
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

  // ========================================================================
  // AUDIT CRITERIA 1 & 4: Controlled Public HTTPS Website -> URL-Mode APK
  // ========================================================================
  describe('Audit 1 & 4: URL Mode Conversion Pipeline & Parameter Customization', () => {
    let urlConversionId: string;
    let downloadToken: string;
    let artifactKey: string;

    it('submits controlled HTTPS URL and receives 202 Accepted with queued state', async () => {
      const payload = {
        url: `${testServerBaseUrl}/audit-site`,
        appConfig: {
          appName: 'Audit URL App',
          packageName: 'com.audit.urlapp',
          themeColor: '#06B6D4',
          versionName: '1.2.0',
          versionCode: 42,
          enablePullToRefresh: true,
          customUserAgent: 'Web2APK-AuditEngine/1.0',
          iconDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      };

      const res = await request(app)
        .post('/api/conversions/url')
        .set('x-allow-test-loopback', 'true')
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body.id).toBeDefined();
      expect(res.body.mode).toBe('url');
      expect(res.body.status).toBe('queued');
      expect(res.body.appConfig.appName).toBe('Audit URL App');
      expect(res.body.appConfig.packageName).toBe('com.audit.urlapp');
      expect(res.body.appConfig.themeColor).toBe('#06B6D4');

      urlConversionId = res.body.id;
      downloadToken = res.body.downloadToken;
    });

    it('executes real Gradle build for URL mode and compiles verified APK binary', async () => {
      const record = await ConversionRepository.findById(urlConversionId);
      expect(record).toBeDefined();

      // Run build worker synchronously
      const artifact = await processConversionJob(
        {
          conversionId: urlConversionId,
          userId: record!.userId,
          mode: 'url',
          targetUrl: record!.targetUrl!,
          appConfig: record!.appConfig,
        },
        { skipReachabilityCheck: true }
      );

      expect(artifact).toBeDefined();
      expect(artifact.fileName).toMatch(/^audit-url-app(\.apk|-debug\.apk)$/);
      expect(artifact.fileSizeBytes).toBeGreaterThan(500 * 1024);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      artifactKey = artifact.storageKey;

      // Verify DB record status is completed
      const updated = await ConversionRepository.findById(urlConversionId);
      expect(updated?.status).toBe('completed');
      expect(updated?.progress).toBe(100);
      expect(updated?.stageName).toBe('Build completed successfully');
      expect(updated?.artifact).toBeDefined();
    }, 1200000);

    it('permits authorized APK download with signed token', async () => {
      const res = await request(app)
        .get(`/api/conversions/${urlConversionId}/download`)
        .query({ token: downloadToken })
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('application/vnd.android.package-archive');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(500 * 1024);
    });
  });

  // ========================================================================
  // AUDIT CRITERIA 2: Upload Static Website ZIP -> Local-Mode APK
  // ========================================================================
  describe('Audit 2: Upload Mode Conversion Pipeline & Asset Bundling', () => {
    let uploadConversionId: string;
    let downloadToken: string;

    it('submits valid static website ZIP archive and receives 202 Accepted', async () => {
      const websiteZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<!DOCTYPE html><html><head><title>Offline Audit App</title><link rel="stylesheet" href="style.css"></head><body><h1>Offline Content Loaded</h1><script src="app.js"></script></body></html>',
        },
        {
          name: 'style.css',
          content: 'body { background-color: #202820; color: #F7F4EA; font-family: sans-serif; }',
        },
        {
          name: 'app.js',
          content: 'console.log("Web2APK Static Assets Verified via WebViewAssetLoader");',
        },
      ]);

      const res = await request(app)
        .post('/api/conversions/upload')
        .attach('file', websiteZip, 'audit-website.zip')
        .field(
          'appConfig',
          JSON.stringify({
            appName: 'Audit Upload App',
            packageName: 'com.audit.uploadapp',
            themeColor: '#7C3AED',
            versionName: '2.0.0',
            versionCode: 2,
          })
        );

      expect(res.status).toBe(202);
      expect(res.body.id).toBeDefined();
      expect(res.body.mode).toBe('upload');
      expect(res.body.status).toBe('queued');

      uploadConversionId = res.body.id;
      downloadToken = res.body.downloadToken;
    });

    it('executes real Gradle build in LOCAL mode and packages assets into assets/web/', async () => {
      const record = await ConversionRepository.findById(uploadConversionId);
      expect(record).toBeDefined();

      const artifact = await processConversionJob({
        conversionId: uploadConversionId,
        userId: record!.userId,
        mode: 'upload',
        uploadedFileName: record!.uploadedFileName!,
        storageKey: record!.storageKey!,
        appConfig: record!.appConfig,
      });

      expect(artifact).toBeDefined();
      expect(artifact.fileName).toMatch(/^audit-upload-app(\.apk|-debug\.apk)$/);
      expect(artifact.fileSizeBytes).toBeGreaterThan(500 * 1024);

      const updated = await ConversionRepository.findById(uploadConversionId);
      expect(updated?.status).toBe('completed');
      expect(updated?.progress).toBe(100);
      expect(updated?.artifact).toBeDefined();
    }, 1200000);

    it('downloads the generated Local-mode APK and verifies internal structure', async () => {
      const res = await request(app)
        .get(`/api/conversions/${uploadConversionId}/download`)
        .query({ token: downloadToken })
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(500 * 1024);

      // Verify APK archive has Manifest, Dex, and Resources
      const tmpApkPath = path.resolve(__dirname, `fixtures/tmp-audit-${uploadConversionId}.apk`);
      fs.writeFileSync(tmpApkPath, res.body);

      try {
        const verification = verifyApk(tmpApkPath);
        expect(verification.isValid).toBe(true);
        expect(verification.entriesFound.manifest).toBe(true);
        expect(verification.entriesFound.classesDex).toBe(true);
        expect(verification.entriesFound.resourcesArsc).toBe(true);
      } finally {
        if (fs.existsSync(tmpApkPath)) {
          fs.unlinkSync(tmpApkPath);
        }
      }
    });
  });

  // ========================================================================
  // AUDIT CRITERIA 6 & 7: Security Defenses, SSRF, Malformed Inputs & Quotas
  // ========================================================================
  describe('Audit 6 & 7: Security Defenses, SSRF, Zip Slip & Authorization', () => {
    it('blocks loopback IP (127.0.0.1) under production SSRF rules', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'https://127.0.0.1:8080/admin',
          appConfig: { appName: 'SSRF Attack', packageName: 'com.ssrf.attack' },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SSRF_BLOCKED');
    });

    it('blocks cloud metadata IP (169.254.169.254)', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'http://169.254.169.254/latest/meta-data/',
          appConfig: { appName: 'Metadata Attack', packageName: 'com.metadata.attack' },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SSRF_BLOCKED');
    });

    it('rejects Zip Slip path traversal uploads (.. segments)', async () => {
      const maliciousZip = buildMockZipBuffer([
        {
          name: '../../../../etc/cron.d/malicious',
          content: '* * * * * root touch /tmp/pwned\n',
        },
      ]);

      const res = await request(app)
        .post('/api/conversions/upload')
        .attach('file', maliciousZip, 'zipslip.zip')
        .field('appConfig', JSON.stringify({ appName: 'Zip Slip', packageName: 'com.zipslip.app' }));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ZIP_ARCHIVE');
    });

    it('rejects archives containing prohibited executable files (.sh)', async () => {
      const dangerZip = buildMockZipBuffer([
        { name: 'index.html', content: '<h1>Safe</h1>' },
        { name: 'backdoor.sh', content: '#!/bin/bash\nrm -rf /\n' },
      ]);

      const res = await request(app)
        .post('/api/conversions/upload')
        .attach('file', dangerZip, 'danger.zip')
        .field('appConfig', JSON.stringify({ appName: 'Danger App', packageName: 'com.danger.app' }));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ZIP_ARCHIVE');
      expect(res.body.detail).toContain('.sh');
    });

    it('rejects unauthorized downloads without signed token', async () => {
      const unauthId = 'conv_unauthorized_audit';
      await ConversionRepository.create({
        id: unauthId,
        userId: 'usr_different_owner',
        mode: 'url',
        status: 'completed',
        progress: 100,
        stageName: 'Completed',
        appConfig: { appName: 'Owner App', packageName: 'com.owner.app' },
        targetUrl: 'https://example.com',
        uploadedFileName: null,
        storageKey: 'artifacts/conv_unauthorized_audit/app-debug.apk',
        idempotencyKey: null,
        errorCode: null,
        errorMessage: null,
        artifact: {
          fileName: 'app-debug.apk',
          fileSizeBytes: 1024,
          sha256: '0123456789abcdef',
          storageKey: 'artifacts/conv_unauthorized_audit/app-debug.apk',
          downloadToken: 'valid-token-not-provided',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const res = await request(app).get(`/api/conversions/${unauthId}/download`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('UNAUTHORIZED_DOWNLOAD');
    });

    it('rejects downloads for non-completed in-progress jobs', async () => {
      const queuedId = 'conv_queued_test';
      await ConversionRepository.create({
        id: queuedId,
        userId: 'anon_default',
        mode: 'url',
        status: 'building',
        progress: 50,
        stageName: 'Building in progress',
        appConfig: { appName: 'Queued App', packageName: 'com.queued.app' },
        targetUrl: 'https://example.com',
        uploadedFileName: null,
        storageKey: null,
        idempotencyKey: null,
        errorCode: null,
        errorMessage: null,
        artifact: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString(),
      });

      const token = TokenService.generateDownloadToken({
        conversionId: queuedId,
        userId: 'anon_default',
        fileName: 'queued.apk',
      });

      const res = await request(app)
        .get(`/api/conversions/${queuedId}/download`)
        .query({ token });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ARTIFACT_NOT_READY');
    });

    it('safely cancels an active conversion job and prevents duplicate generation', async () => {
      const cancelJobId = 'conv_cancel_test';
      await ConversionRepository.create({
        id: cancelJobId,
        userId: 'anon_default',
        mode: 'url',
        status: 'queued',
        progress: 5,
        stageName: 'Queued in BullMQ worker queue',
        appConfig: { appName: 'Cancel App', packageName: 'com.cancel.app' },
        targetUrl: 'https://example.com',
        uploadedFileName: null,
        storageKey: null,
        idempotencyKey: null,
        errorCode: null,
        errorMessage: null,
        artifact: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString(),
      });

      const cancelRes = await request(app).post(`/api/conversions/${cancelJobId}/cancel`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('cancelled');

      // Double cancellation is rejected
      const retryCancel = await request(app).post(`/api/conversions/${cancelJobId}/cancel`);
      expect(retryCancel.status).toBe(400);
    });

    it('enforces concurrency limit (max 5 active jobs per user)', async () => {
      const testApiKey = 'audit-quota-test-key-123';
      const cryptoMod = await import('node:crypto');
      const testUserId = `usr_${cryptoMod.createHash('sha256').update(testApiKey).digest('hex').substring(0, 12)}`;

      // Create 5 active jobs for this user
      for (let i = 0; i < 5; i++) {
        await ConversionRepository.create({
          id: `conv_quota_${i}`,
          userId: testUserId,
          mode: 'url',
          status: 'building',
          progress: 50,
          stageName: 'Building',
          appConfig: { appName: `App ${i}`, packageName: `com.quota.app${i}` },
          targetUrl: 'https://example.com',
          uploadedFileName: null,
          storageKey: null,
          idempotencyKey: null,
          errorCode: null,
          errorMessage: null,
          artifact: null,
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          updatedAt: new Date().toISOString(),
        });
      }

      // 6th job attempt should be rejected with 429
      const res = await request(app)
        .post('/api/conversions/url')
        .set('X-Api-Key', testApiKey)
        .set('x-allow-test-loopback', 'true')
        .send({
          url: `${testServerBaseUrl}/audit-site`,
          appConfig: { appName: 'Over Quota App', packageName: 'com.quota.over' },
        });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('CONCURRENT_QUOTA_EXCEEDED');
    });
  });
});
