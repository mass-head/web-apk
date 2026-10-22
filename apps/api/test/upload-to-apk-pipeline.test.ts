import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { app } from '../src/app.js';
import { ConversionRepository } from '../src/db/repository.js';
import { processConversionJob } from '../src/jobs/build-worker.js';
import { setInProcessExecution } from '../src/jobs/queue.js';
import { getStorageService } from '../src/storage/index.js';
import { buildMockZipBuffer } from './helpers/zip-builder.js';
import { validateZipArchive, extractSanitizedZipToWorkspace } from '../src/validation/zip.validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Upload-to-APK End-to-End Pipeline Tests', () => {
  beforeEach(() => {
    ConversionRepository.clearMemory();
    setInProcessExecution(false);
  });

  // ==========================================================================
  // TEST 1: VALID STATIC WEBSITE ZIP (Real Gradle Build to APK)
  // ==========================================================================
  describe('1. Valid Static Website Archive & Real Gradle APK Generation', () => {
    it('validates static assets, packages into Android assets/web/, compiles real APK via Gradle, verifies artifact, and permits authorized download', async () => {
      const validZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<!DOCTYPE html><html><head><title>My Static App</title><link rel="stylesheet" href="style.css"></head><body><h1>Hello Web2APK</h1><script src="app.js"></script></body></html>',
        },
        {
          name: 'style.css',
          content: 'body { background-color: #12372A; color: #F7F4EA; font-family: sans-serif; }',
        },
        {
          name: 'app.js',
          content: 'console.log("Static app initialized safely within WebView sandbox");',
        },
        {
          name: 'assets/logo.svg',
          content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#E9C46A"/></svg>',
        },
      ]);

      // Step A: Submit ZIP to upload conversion endpoint
      const submitRes = await request(app)
        .post('/api/conversions/upload')
        .attach('file', validZip, 'my-static-site.zip')
        .field(
          'appConfig',
          JSON.stringify({
            appName: 'Static Test App',
            packageName: 'com.mywebsite.staticapp',
            versionName: '1.0.0',
            versionCode: 1,
            themeColor: '#12372A',
            enablePullToRefresh: true,
          })
        );

      expect(submitRes.status).toBe(202);
      expect(submitRes.body.status).toBe('queued');
      expect(submitRes.body.id).toMatch(/^conv_/);
      const conversionId = submitRes.body.id;
      const downloadToken = submitRes.body.downloadToken;

      // Verify the quarantined file was placed in object storage
      const storage = getStorageService();
      const storageKey = `quarantine/${conversionId}/my-static-site.zip`;
      const uploadedBytes = await storage.downloadFile(storageKey);
      expect(uploadedBytes).toBeDefined();
      expect(uploadedBytes.length).toBe(validZip.length);

      // Step B: Worker processes the job through isolated Android build pipeline
      const artifact = await processConversionJob({
        conversionId,
        userId: 'anon_default',
        mode: 'upload',
        uploadedFileName: 'my-static-site.zip',
        storageKey,
        appConfig: submitRes.body.appConfig,
      });

      expect(artifact).toBeDefined();
      expect(artifact.fileName).toMatch(/^static-test-app(\.apk|-debug\.apk)$/);
      expect(artifact.fileSizeBytes).toBeGreaterThan(500 * 1024); // > 500 KB
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);

      // Step C: Verify updated conversion status in database
      const statusRes = await request(app).get(`/api/conversions/${conversionId}`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body.progress).toBe(100);
      expect(statusRes.body.artifact).toBeDefined();
      expect(statusRes.body.artifact.sha256).toBe(artifact.sha256);

      // Step D: Authorized Download
      const downloadRes = await request(app)
        .get(`/api/conversions/${conversionId}/download?token=${downloadToken}`);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('application/vnd.android.package-archive');
      expect(downloadRes.headers['content-disposition']).toMatch(/static-test-app(\.apk|-debug\.apk)/);
      expect(parseInt(downloadRes.headers['content-length'], 10)).toBe(artifact.fileSizeBytes);
    }, 300000);
  });

  // ==========================================================================
  // TEST 2: NESTED FOLDER / DIST WRAPPER NORMALIZATION
  // ==========================================================================
  describe('2. Nested Directory Wrapper (dist/ or build/) Normalization', () => {
    it('detects and strips single top-level directory wrapper, locating index.html at root', async () => {
      const nestedZip = buildMockZipBuffer([
        {
          name: 'dist/index.html',
          content: '<!DOCTYPE html><html><head><title>Vite SPA</title><link rel="stylesheet" href="assets/style.css"></head><body><h1>SPA Ready</h1><script src="assets/bundle.js"></script></body></html>',
        },
        {
          name: 'dist/assets/style.css',
          content: 'h1 { color: #285943; }',
        },
        {
          name: 'dist/assets/bundle.js',
          content: 'console.log("Bundled SPA assets");',
        },
        {
          name: 'dist/favicon.ico',
          content: 'icon-bytes',
        },
      ]);

      // Test validation endpoint
      const validateRes = await request(app)
        .post('/api/validate/zip')
        .attach('file', nestedZip, 'dist-build.zip');

      expect(validateRes.status).toBe(200);
      expect(validateRes.body.valid).toBe(true);
      expect(validateRes.body.topLevelDirectory).toBe('dist');
      expect(validateRes.body.hasIndexHtml).toBe(true);
      expect(validateRes.body.entryPoint).toBe('index.html');
      expect(validateRes.body.referencedAssets?.missing).toEqual([]);

      // Test isolated workspace extraction strips top-level wrapper
      const tempExtractDir = path.resolve(__dirname, '../../data/test-extract-nested');
      try {
        const result = await extractSanitizedZipToWorkspace(nestedZip, tempExtractDir);
        expect(result.extractedFileCount).toBe(4);
        expect(result.topLevelDirectory).toBe('dist');
        expect(result.entryPoint).toBe('index.html');

        // index.html must exist directly inside target directory
        expect(fs.existsSync(path.join(tempExtractDir, 'index.html'))).toBe(true);
        expect(fs.existsSync(path.join(tempExtractDir, 'assets/style.css'))).toBe(true);
        expect(fs.existsSync(path.join(tempExtractDir, 'assets/bundle.js'))).toBe(true);
      } finally {
        if (fs.existsSync(tempExtractDir)) {
          fs.rmSync(tempExtractDir, { recursive: true, force: true });
        }
      }
    });
  });

  // ==========================================================================
  // TEST 3: MISSING ENTRY POINT (index.html)
  // ==========================================================================
  describe('3. Missing Website Entry Point', () => {
    it('rejects archive without index.html or index.htm with MISSING_ENTRY_POINT error', async () => {
      const missingIndexZip = buildMockZipBuffer([
        {
          name: 'app.js',
          content: 'console.log("No entry point");',
        },
        {
          name: 'style.css',
          content: 'body { color: red; }',
        },
        {
          name: 'about.html',
          content: '<h1>About page only, no index.html</h1>',
        },
      ]);

      // Test validate route
      const validateRes = await request(app)
        .post('/api/validate/zip')
        .attach('file', missingIndexZip, 'no-index.zip');

      expect(validateRes.status).toBe(400);
      expect(validateRes.body.valid).toBe(false);
      expect(validateRes.body.code).toBe('MISSING_ENTRY_POINT');
      expect(validateRes.body.hasIndexHtml).toBe(false);

      // Test conversion upload submission
      const submitRes = await request(app)
        .post('/api/conversions/upload')
        .attach('file', missingIndexZip, 'no-index.zip')
        .field('appName', 'No Index App')
        .field('packageName', 'com.noindex.app');

      expect(submitRes.status).toBe(400);
      expect(submitRes.body.code).toBe('MISSING_ENTRY_POINT');
      expect(submitRes.body.detail).toContain('No index.html or index.htm found');
    });
  });

  // ==========================================================================
  // TEST 4: BROKEN ASSET DETECTION
  // ==========================================================================
  describe('4. Broken Asset References Inspection', () => {
    it('detects missing referenced assets in index.html without failing validation', async () => {
      const brokenAssetsZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: `<!DOCTYPE html><html><head>
            <link rel="stylesheet" href="missing-theme.css">
            <link rel="stylesheet" href="present-style.css">
          </head><body>
            <img src="missing-logo.png" />
            <script src="js/missing-bundle.js"></script>
          </body></html>`,
        },
        {
          name: 'present-style.css',
          content: 'body { margin: 0; }',
        },
      ]);

      const validateRes = await request(app)
        .post('/api/validate/zip')
        .attach('file', brokenAssetsZip, 'broken-site.zip');

      expect(validateRes.status).toBe(200);
      expect(validateRes.body.valid).toBe(true);
      expect(validateRes.body.referencedAssets).toBeDefined();
      expect(validateRes.body.referencedAssets.total).toBe(4);
      expect(validateRes.body.referencedAssets.available).toBe(1); // only present-style.css
      expect(validateRes.body.referencedAssets.missing).toEqual(
        expect.arrayContaining(['missing-theme.css', 'missing-logo.png', 'js/missing-bundle.js'])
      );
      expect(validateRes.body.warnings).toBeDefined();
      expect(validateRes.body.warnings.length).toBeGreaterThan(0);
      expect(validateRes.body.warnings[0]).toContain('missing-theme.css');
    });
  });

  // ==========================================================================
  // TEST 5: OVERSIZED ARCHIVE & ZIP BOMB DETECTION
  // ==========================================================================
  describe('5. Oversized Archive & ZIP Bomb Protection', () => {
    it('detects abnormal compression ratios (ZIP bomb) and aborts extraction', async () => {
      // Craft a 12MB buffer of zeros compressed down to a tiny payload (ratio > 1000)
      const hugeZeroBuffer = Buffer.alloc(12 * 1024 * 1024, 0);
      const zipBombBuffer = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<h1>Bomb Site</h1>',
        },
        {
          name: 'assets/payload.bin',
          content: hugeZeroBuffer,
          compressionMethod: 8,
        },
      ]);

      const result = await validateZipArchive(zipBombBuffer);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/ZIP bomb detected|Disallowed/);

      // Verify endpoint rejects with 400
      const submitRes = await request(app)
        .post('/api/conversions/upload')
        .attach('file', zipBombBuffer, 'bomb.zip')
        .field('appName', 'Bomb App')
        .field('packageName', 'com.bomb.app');

      expect(submitRes.status).toBe(400);
    });

    it('rejects archives exceeding decompressed size limit', async () => {
      // Create entries that exceed per-file limit or cumulative limit
      const oversizedFile = Buffer.alloc(55 * 1024 * 1024, 65); // 55 MB (> 50MB per-file limit)
      const oversizedZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<h1>Big Site</h1>',
        },
        {
          name: 'assets/huge-video.mp4',
          content: oversizedFile,
        },
      ]);

      const result = await validateZipArchive(oversizedZip);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds 50 MB per-file limit');
    });
  });

  // ==========================================================================
  // TEST 6: PATH TRAVERSAL ATTACKS & ABSOLUTE PATHS
  // ==========================================================================
  describe('6. Path Traversal & Absolute Path Security Defense', () => {
    it('rejects ZIP containing path traversal segments (../../etc/passwd)', async () => {
      const maliciousZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<h1>Valid entry</h1>',
        },
        {
          name: '../../etc/passwd',
          content: 'root:x:0:0:root:/root:/bin/bash',
        },
      ]);

      const validateRes = await request(app)
        .post('/api/validate/zip')
        .attach('file', maliciousZip, 'traversal.zip');

      expect(validateRes.status).toBe(400);
      expect(validateRes.body.valid).toBe(false);
      expect(validateRes.body.error).toContain('Directory traversal attack detected');

      const submitRes = await request(app)
        .post('/api/conversions/upload')
        .attach('file', maliciousZip, 'traversal.zip')
        .field('appName', 'Traversal App')
        .field('packageName', 'com.traversal.app');

      expect(submitRes.status).toBe(400);
      expect(submitRes.body.detail).toContain('Directory traversal attack detected');
    });

    it('rejects ZIP containing absolute paths (/etc/shadow or C:\\Windows)', async () => {
      const absoluteZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<h1>Valid entry</h1>',
        },
        {
          name: '/etc/shadow',
          content: 'shadow_secrets',
        },
      ]);

      const result = await validateZipArchive(absoluteZip);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Absolute file paths are prohibited');
    });
  });

  // ==========================================================================
  // TEST 7: SUSPICIOUS & PROHIBITED EXECUTABLE FILE TYPES
  // ==========================================================================
  describe('7. Disallowed Executable and Dangerous File Types', () => {
    it('rejects archives containing executable binaries or server-side scripts (.sh, .exe, .php, .apk)', async () => {
      const dangerousFiles = [
        { name: 'payload.exe', ext: '.exe' },
        { name: 'setup.sh', ext: '.sh' },
        { name: 'backdoor.php', ext: '.php' },
        { name: 'malware.apk', ext: '.apk' },
        { name: 'script.bat', ext: '.bat' },
      ];

      for (const danger of dangerousFiles) {
        const dangerZip = buildMockZipBuffer([
          { name: 'index.html', content: '<h1>Test Site</h1>' },
          { name: danger.name, content: 'executable payload content' },
        ]);

        const validateRes = await request(app)
          .post('/api/validate/zip')
          .attach('file', dangerZip, 'danger.zip');

        expect(validateRes.status).toBe(400);
        expect(validateRes.body.valid).toBe(false);
        expect(validateRes.body.error).toMatch(/Disallowed executable|Security violation/);
      }
    });
  });

  // ==========================================================================
  // TEST 8: MALFORMED ZIP ARCHIVES
  // ==========================================================================
  describe('8. Malformed & Corrupted Archives', () => {
    it('rejects non-ZIP random binary payloads with 400 Bad Request', async () => {
      const corruptedBytes = Buffer.from('THIS IS NOT A VALID ZIP ARCHIVE FILE HEADER DATA 1234567890');

      const validateRes = await request(app)
        .post('/api/validate/zip')
        .attach('file', corruptedBytes, 'corrupted.zip');

      expect(validateRes.status).toBe(400);
      expect(validateRes.body.valid).toBe(false);
      expect(validateRes.body.code).toBe('INVALID_ZIP_ARCHIVE');
      expect(validateRes.body.error).toContain('Malformed archive');
    });

    it('rejects symlink attack in ZIP entries', async () => {
      const symlinkZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<h1>Site with symlink</h1>',
        },
        {
          name: 'link-to-etc',
          content: '/etc/passwd',
          externalAttributes: 0o120777 << 16, // Unix symlink mode
        },
      ]);

      const result = await validateZipArchive(symlinkZip);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Symlinks are prohibited');
    });
  });

  // ==========================================================================
  // TEST 9: SIMULATED GRADLE FAILURE IN UPLOAD MODE
  // ==========================================================================
  describe('9. Simulated Gradle Failure Handling for Upload Pipeline', () => {
    it('updates conversion record with failed status and detailed error message if compilation fails', async () => {
      const validZip = buildMockZipBuffer([
        {
          name: 'index.html',
          content: '<h1>Fail Test Site</h1>',
        },
      ]);

      const submitRes = await request(app)
        .post('/api/conversions/upload')
        .attach('file', validZip, 'fail-test.zip')
        .field(
          'appConfig',
          JSON.stringify({
            appName: 'SimulateGradleFailure',
            packageName: 'com.fail.test',
          })
        );

      expect(submitRes.status).toBe(202);
      const conversionId = submitRes.body.id;
      const storageKey = `quarantine/${conversionId}/fail-test.zip`;

      await expect(
        processConversionJob(
          {
            conversionId,
            userId: 'anon_default',
            mode: 'upload',
            uploadedFileName: 'fail-test.zip',
            storageKey,
            appConfig: submitRes.body.appConfig,
          },
          {
            gradleArgs: ['nonExistentTaskForTesting'],
          }
        )
      ).rejects.toThrow(/Gradle compilation failed with exit code/);

      const statusRes = await request(app).get(`/api/conversions/${conversionId}`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('failed');
      expect(statusRes.body.errorMessage).toContain('Gradle compilation failed');
      expect(statusRes.body.artifact).toBeNull();
    }, 120000);
  });
});
