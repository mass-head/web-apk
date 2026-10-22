import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { ConversionRepository } from '../src/db/repository.js';
import { TokenService } from '../src/auth/token.service.js';
import { getStorageService } from '../src/storage/index.js';
import { buildMockZipBuffer } from './helpers/zip-builder.js';
import { setInProcessExecution } from '../src/jobs/queue.js';

describe('Web2APK API Integration Tests', () => {
  beforeEach(() => {
    ConversionRepository.clearMemory();
    setInProcessExecution(false);
  });

  describe('1. Successful Job Creation', () => {
    it('creates a URL conversion job with status 202 Accepted', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'https://example.com',
          appConfig: {
            appName: 'Example App',
            packageName: 'com.example.app',
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

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id');
      expect(res.body.id).toMatch(/^conv_/);
      expect(res.body.status).toBe('queued');
      expect(res.body.mode).toBe('url');
      expect(res.body.progress).toBe(5);
      expect(res.body.eventsUrl).toContain('/events');
      expect(res.body.statusUrl).toContain('/api/conversions/');
    });

    it('creates an Upload conversion job with multipart zip', async () => {
      // Create valid zip buffer containing index.html entry point
      const mockZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<!DOCTYPE html><html><head><title>Static Site</title></head><body><h1>Hello</h1></body></html>',
        },
      ]);

      const res = await request(app)
        .post('/api/conversions/upload')
        .field('appName', 'Static Website')
        .field('packageName', 'com.staticsite.web')
        .field('themeColor', '#06B6D4')
        .attach('file', mockZip, 'website.zip');

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id');
      expect(res.body.mode).toBe('upload');
      expect(res.body.uploadedFileName).toBe('website.zip');
      expect(res.body.status).toBe('queued');
    });

    it('supports Idempotency-Key deduplication', async () => {
      const idempotencyKey = 'test-idemp-key-12345';
      const payload = {
        url: 'https://example.com',
        appConfig: {
          appName: 'My Site',
          packageName: 'org.mysite.app',
          versionName: '1.0.0',
          versionCode: 1,
          themeColor: '#7C3AED',
          orientation: 'unspecified',
          enablePullToRefresh: true,
          enableDownloadManager: true,
          enableGeolocation: false,
          enableCamera: false,
          enablePushNotifications: false,
        },
      };

      // First call
      const res1 = await request(app)
        .post('/api/conversions/url')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(202);
      const firstId = res1.body.id;

      // Second call with same idempotency key
      const res2 = await request(app)
        .post('/api/conversions/url')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.id).toBe(firstId);
      expect(res2.body.idempotentReplay).toBe(true);
    });
  });

  describe('2. Invalid URLs & SSRF Blocking', () => {
    it('rejects malformed URLs with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'not-a-valid-url',
          appConfig: {
            appName: 'Bad URL App',
            packageName: 'com.bad.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('blocks SSRF attempts targeting private IP ranges (127.0.0.1)', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'http://127.0.0.1:8080/admin',
          appConfig: {
            appName: 'Localhost Target',
            packageName: 'com.local.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SSRF_BLOCKED');
    });

    it('blocks SSRF attempts targeting cloud metadata (169.254.169.254)', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'http://169.254.169.254/latest/meta-data/',
          appConfig: {
            appName: 'Metadata Exploit',
            packageName: 'com.exploit.app',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SSRF_BLOCKED');
    });

    it('blocks invalid package names (reserved keywords)', async () => {
      const res = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'https://example.com',
          appConfig: {
            appName: 'Keyword App',
            packageName: 'com.class.app', // 'class' is a Java keyword
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Invalid Uploads', () => {
    it('returns 400 when no file is uploaded', async () => {
      const res = await request(app)
        .post('/api/conversions/upload')
        .field('appName', 'No File App')
        .field('packageName', 'com.nofile.app');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_FILE');
    });

    it('returns 400 when non-zip file is uploaded', async () => {
      const textBuffer = Buffer.from('This is a plain text file, not a zip');

      const res = await request(app)
        .post('/api/conversions/upload')
        .field('appName', 'Text File App')
        .field('packageName', 'com.text.app')
        .attach('file', textBuffer, 'malicious.txt');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FILE_TYPE');
    });
  });

  describe('4. Missing Jobs', () => {
    it('returns 404 for nonexistent conversion ID', async () => {
      const res = await request(app).get('/api/conversions/conv_nonexistent999');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('returns 404 for nonexistent conversion events stream', async () => {
      const res = await request(app).get('/api/conversions/conv_nonexistent999/events');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('5. Job Cancellation & Lifecycle', () => {
    it('cancels an active/queued conversion job', async () => {
      // Create job
      const createRes = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'https://testsite.org',
          appConfig: {
            appName: 'Cancellable App',
            packageName: 'org.cancel.app',
          },
        });

      const conversionId = createRes.body.id;

      // Cancel job
      const cancelRes = await request(app).post(`/api/conversions/${conversionId}/cancel`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('cancelled');

      // Verify job is marked cancelled
      const getRes = await request(app).get(`/api/conversions/${conversionId}`);
      expect(getRes.body.status).toBe('cancelled');
    });

    it('rejects cancelling an already cancelled job', async () => {
      const createRes = await request(app)
        .post('/api/conversions/url')
        .send({
          url: 'https://testsite.org',
          appConfig: {
            appName: 'Double Cancel',
            packageName: 'org.doublecancel.app',
          },
        });

      const conversionId = createRes.body.id;

      // First cancel
      await request(app).post(`/api/conversions/${conversionId}/cancel`);

      // Second cancel should fail with 400
      const secondCancel = await request(app).post(`/api/conversions/${conversionId}/cancel`);
      expect(secondCancel.status).toBe(400);
      expect(secondCancel.body.code).toBe('CANNOT_CANCEL');
    });
  });

  describe('6. Download Authorization & Integrity', () => {
    it('rejects download if user is unauthorized', async () => {
      // Create job as user A
      const record = await ConversionRepository.create({
        id: 'conv_private_123',
        userId: 'usr_owner_456',
        mode: 'url',
        status: 'completed',
        progress: 100,
        stageName: 'Completed',
        appConfig: {
          appName: 'Private App',
          packageName: 'com.private.app',
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
        targetUrl: 'https://private.com',
        uploadedFileName: null,
        storageKey: null,
        idempotencyKey: null,
        errorCode: null,
        errorMessage: null,
        artifact: {
          fileName: 'private-app.apk',
          fileSizeBytes: 1024,
          sha256: 'abc123',
          storageKey: 'artifacts/private.apk',
          downloadToken: 'valid_token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Request download from anonymous unauthenticated requester without token
      const res = await request(app).get(`/api/conversions/${record.id}/download`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('UNAUTHORIZED_DOWNLOAD');
    });

    it('rejects download when conversion is not completed yet', async () => {
      const record = await ConversionRepository.create({
        id: 'conv_inprogress_999',
        userId: 'usr_test_user',
        mode: 'url',
        status: 'building',
        progress: 60,
        stageName: 'Compiling with Gradle',
        appConfig: {
          appName: 'In Progress App',
          packageName: 'com.progress.app',
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
        targetUrl: 'https://progress.com',
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
        conversionId: record.id,
        userId: record.userId,
        fileName: 'in-progress.apk',
      });

      const res = await request(app).get(`/api/conversions/${record.id}/download?token=${token}`);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ARTIFACT_NOT_READY');
    });

    it('authorizes download with a valid signed token when artifact exists', async () => {
      const storageKey = 'artifacts/conv_success_test/app-debug.apk';
      const storage = getStorageService();
      await storage.uploadFile(storageKey, Buffer.from('FAKE-APK-CONTENT-BINARY'), 'application/vnd.android.package-archive');

      const record = await ConversionRepository.create({
        id: 'conv_success_test',
        userId: 'usr_author',
        mode: 'url',
        status: 'completed',
        progress: 100,
        stageName: 'Completed',
        appConfig: {
          appName: 'Success App',
          packageName: 'com.success.app',
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
        targetUrl: 'https://success.com',
        uploadedFileName: null,
        storageKey: null,
        idempotencyKey: null,
        errorCode: null,
        errorMessage: null,
        artifact: {
          fileName: 'success-app-debug.apk',
          fileSizeBytes: 23,
          sha256: 'fedcba987654321',
          storageKey,
          downloadToken: 'mock',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const validToken = TokenService.generateDownloadToken({
        conversionId: record.id,
        userId: record.userId,
        fileName: record.artifact!.fileName,
      });

      const res = await request(app).get(`/api/conversions/${record.id}/download?token=${validToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/vnd.android.package-archive');
      expect(res.headers['content-disposition']).toContain('success-app-debug.apk');
    });
  });

  describe('7. Health Endpoint', () => {
    it('returns health diagnostic report', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('services');
      expect(res.body.services).toHaveProperty('postgres');
      expect(res.body.services).toHaveProperty('redis');
      expect(res.body.services).toHaveProperty('storage');
    });
  });
});
