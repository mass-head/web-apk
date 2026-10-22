import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createUrlConversionSchema,
  createUploadConversionSchema,
  conversionIdParamSchema,
  appConfigSchema,
} from '../validation/schemas.js';
import { validateSsrfUrl, validateUrlReachability } from '../validation/ssrf.validator.js';
import { ConversionRepository } from '../db/repository.js';
import { enqueueConversionJob, cancelConversionJob } from '../jobs/queue.js';
import { EventBroker } from '../jobs/events.js';
import { getStorageService } from '../storage/index.js';
import { uploadZipMiddleware } from '../middleware/upload.middleware.js';
import { checkUserQuota } from '../middleware/quota.middleware.js';
import { checkIdempotency } from '../middleware/idempotency.middleware.js';
import { authorizeDownload } from '../auth/auth.middleware.js';
import { TokenService } from '../auth/token.service.js';
import { ConversionRecord } from '../jobs/types.js';
import { validateZipArchive } from '../validation/zip.validator.js';

const router = Router();

/**
 * POST /api/conversions/url
 * Creates a build job from a public web URL
 */
router.post(
  '/url',
  checkIdempotency,
  checkUserQuota,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createUrlConversionSchema.parse(req.body);

      // 1. SSRF and Reachability Validation
      const allowLoopback = req.header('x-allow-test-loopback') === 'true';
      const checkResult = await validateUrlReachability(parsed.url, {
        allowLoopbackForTesting: allowLoopback,
        rejectUnauthorized: !allowLoopback,
      });

      if (!checkResult.valid) {
        const isSsrf = checkResult.code === 'SSRF_BLOCKED';
        res.status(400).json({
          type: isSsrf
            ? 'https://api.web2apk.dev/errors/ssrf-blocked'
            : 'https://api.web2apk.dev/errors/url-validation-failed',
          title: isSsrf
            ? 'URL Target Blocked by SSRF Policy'
            : 'Target URL Validation or Reachability Failed',
          status: 400,
          detail: checkResult.error || 'Access to requested IP or hostname is restricted.',
          code: checkResult.code || (isSsrf ? 'SSRF_BLOCKED' : 'VALIDATION_ERROR'),
          instance: req.originalUrl,
        });
        return;
      }

      const conversionId = `conv_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      const userId = req.user?.id || 'anon_default';
      const idempotencyKey = req.header('Idempotency-Key') || null;

      // 2. Persist to PostgreSQL via Repository
      const record: ConversionRecord = {
        id: conversionId,
        userId,
        mode: 'url',
        status: 'queued',
        progress: 5,
        stageName: 'Queued in BullMQ worker queue',
        appConfig: parsed.appConfig,
        targetUrl: parsed.url,
        uploadedFileName: null,
        storageKey: null,
        idempotencyKey,
        errorCode: null,
        errorMessage: null,
        artifact: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString(),
      };

      await ConversionRepository.create(record);

      // 3. Dispatch to BullMQ Queue (Asynchronous - Never build inside HTTP handler!)
      await enqueueConversionJob({
        conversionId,
        userId,
        mode: 'url',
        targetUrl: parsed.url,
        appConfig: parsed.appConfig,
      });

      // 4. Generate download token preview
      const downloadToken = TokenService.generateDownloadToken({
        conversionId,
        userId,
        fileName: `${parsed.appConfig.appName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-debug.apk`,
      });

      res.status(202).json({
        id: conversionId,
        mode: 'url',
        status: 'queued',
        progress: 5,
        stageName: 'Queued in BullMQ worker queue',
        appConfig: parsed.appConfig,
        targetUrl: parsed.url,
        createdAt: record.createdAt,
        eventsUrl: `/api/conversions/${conversionId}/events`,
        statusUrl: `/api/conversions/${conversionId}`,
        downloadToken,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/conversions/upload/initiate
 * Initiates an upload session and issues presigned S3 upload metadata
 */
router.post('/upload/initiate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fileName, fileSizeBytes, mimeType = 'application/zip' } = req.body;
    if (!fileName || typeof fileName !== 'string') {
      res.status(400).json({ error: 'fileName is required.' });
      return;
    }
    const uploadId = `upl_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const s3Key = `quarantine/${uploadId}/${fileName}`;
    const storage = getStorageService();
    const presignedPutUrl = await storage.getUploadUrl(s3Key, mimeType);

    res.status(200).json({
      uploadId,
      presignedPutUrl,
      s3Key,
      maxSizeBytes: 100 * 1024 * 1024,
      expiresInSeconds: 3600,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversions/upload
 * Creates a build job from an uploaded static website ZIP
 */
router.post(
  '/upload',
  uploadZipMiddleware,
  checkIdempotency,
  checkUserQuota,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          type: 'https://api.web2apk.dev/errors/missing-file',
          title: 'Missing ZIP Archive',
          status: 400,
          detail: 'A .zip archive must be uploaded under the "file" field.',
          code: 'MISSING_FILE',
          instance: req.originalUrl,
        });
        return;
      }

      // Pre-flight validate ZIP archive strictly
      const validation = await validateZipArchive(req.file.buffer);
      if (!validation.valid) {
        res.status(400).json({
          type: 'https://api.web2apk.dev/errors/invalid-archive',
          title: 'Invalid Static Website ZIP Archive',
          status: 400,
          detail: validation.error || 'The uploaded ZIP archive is invalid or disallowed.',
          code: validation.code || 'INVALID_ARCHIVE',
          instance: req.originalUrl,
          entryCount: validation.entryCount,
          totalCompressedBytes: validation.totalCompressedBytes,
          hasIndexHtml: validation.hasIndexHtml,
        });
        return;
      }

      // Parse appConfig from form-data
      let rawConfig = req.body.appConfig;
      if (typeof rawConfig === 'string') {
        try {
          rawConfig = JSON.parse(rawConfig);
        } catch {
          // If not json string, construct from raw form fields
          rawConfig = req.body;
        }
      } else if (!rawConfig) {
        rawConfig = req.body;
      }

      const appConfig = appConfigSchema.parse(rawConfig);
      const conversionId = `conv_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      const userId = req.user?.id || 'anon_default';
      const idempotencyKey = req.header('Idempotency-Key') || null;

      // Upload quarantined ZIP to storage
      const storageKey = `quarantine/${conversionId}/${req.file.originalname}`;
      const storage = getStorageService();
      await storage.uploadFile(storageKey, req.file.buffer, 'application/zip');

      // Persist to PostgreSQL
      const record: ConversionRecord = {
        id: conversionId,
        userId,
        mode: 'upload',
        status: 'queued',
        progress: 5,
        stageName: 'Queued in BullMQ worker queue',
        appConfig,
        targetUrl: null,
        uploadedFileName: req.file.originalname,
        storageKey,
        idempotencyKey,
        errorCode: null,
        errorMessage: null,
        artifact: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString(),
      };

      await ConversionRepository.create(record);

      // Dispatch to BullMQ Queue (Asynchronous)
      await enqueueConversionJob({
        conversionId,
        userId,
        mode: 'upload',
        uploadedFileName: req.file.originalname,
        storageKey,
        appConfig,
      });

      const downloadToken = TokenService.generateDownloadToken({
        conversionId,
        userId,
        fileName: `${appConfig.appName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-debug.apk`,
      });

      res.status(202).json({
        id: conversionId,
        mode: 'upload',
        status: 'queued',
        progress: 5,
        stageName: 'Queued in BullMQ worker queue',
        appConfig,
        uploadedFileName: req.file.originalname,
        createdAt: record.createdAt,
        eventsUrl: `/api/conversions/${conversionId}/events`,
        statusUrl: `/api/conversions/${conversionId}`,
        downloadToken,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/conversions/:id
 * Retrieves conversion status and metadata
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = conversionIdParamSchema.parse(req.params);
    const record = await ConversionRepository.findById(id);

    if (!record) {
      res.status(404).json({
        type: 'https://api.web2apk.dev/errors/not-found',
        title: 'Conversion Job Not Found',
        status: 404,
        detail: `No conversion record found with ID "${id}".`,
        code: 'NOT_FOUND',
        instance: req.originalUrl,
      });
      return;
    }

    res.status(200).json(record);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conversions/:id/events
 * Streams real-time Server-Sent Events (SSE) for build progression
 */
router.get('/:id/events', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = conversionIdParamSchema.parse(req.params);
    const record = await ConversionRepository.findById(id);

    if (!record) {
      res.status(404).json({
        type: 'https://api.web2apk.dev/errors/not-found',
        title: 'Conversion Job Not Found',
        status: 404,
        detail: `Cannot stream events for nonexistent job "${id}".`,
        code: 'NOT_FOUND',
      });
      return;
    }

    EventBroker.subscribeToEvents(id, res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conversions/:id/download
 * Delivers generated APK binary with strict authorization checks
 */
router.get('/:id/download', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = conversionIdParamSchema.parse(req.params);
    const record = await ConversionRepository.findById(id);

    if (!record) {
      res.status(404).json({
        type: 'https://api.web2apk.dev/errors/not-found',
        title: 'Conversion Job Not Found',
        status: 404,
        detail: `No conversion record found with ID "${id}".`,
        code: 'NOT_FOUND',
      });
      return;
    }

    // 1. Download Authorization Check
    const authCheck = authorizeDownload(record.id, record.userId, req);
    if (!authCheck.authorized) {
      res.status(403).json({
        type: 'https://api.web2apk.dev/errors/unauthorized-download',
        title: 'Download Authorization Denied',
        status: 403,
        detail: authCheck.reason || 'You are not authorized to download this artifact.',
        code: 'UNAUTHORIZED_DOWNLOAD',
      });
      return;
    }

    // 2. Completion Check
    if (record.status !== 'completed' || !record.artifact) {
      res.status(409).json({
        type: 'https://api.web2apk.dev/errors/artifact-not-ready',
        title: 'Artifact Not Ready',
        status: 409,
        detail: `The APK binary for this build is not ready yet (Current status: ${record.status}).`,
        code: 'ARTIFACT_NOT_READY',
      });
      return;
    }

    // 3. Deliver Artifact
    const storage = getStorageService();
    const downloadUrl = await storage.getDownloadUrl(record.artifact.storageKey);

    // If presigned URL is an external link, redirect directly; otherwise stream file
    if (downloadUrl.startsWith('http://') || downloadUrl.startsWith('https://')) {
      res.redirect(downloadUrl);
      return;
    }

    const fileBuffer = await storage.downloadFile(record.artifact.storageKey);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${record.artifact.fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    res.status(200).send(fileBuffer);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversions/:id/cancel
 * Safely cancels a queued or running conversion job
 */
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = conversionIdParamSchema.parse(req.params);
    const record = await ConversionRepository.findById(id);

    if (!record) {
      res.status(404).json({
        type: 'https://api.web2apk.dev/errors/not-found',
        title: 'Conversion Job Not Found',
        status: 404,
        detail: `No conversion record found with ID "${id}".`,
        code: 'NOT_FOUND',
      });
      return;
    }

    if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled') {
      res.status(400).json({
        type: 'https://api.web2apk.dev/errors/invalid-state',
        title: 'Cannot Cancel Finished Job',
        status: 400,
        detail: `Job "${id}" has already finished with status "${record.status}".`,
        code: 'CANNOT_CANCEL',
      });
      return;
    }

    await cancelConversionJob(id);
    await ConversionRepository.updateStatus(id, {
      status: 'cancelled',
      stageName: 'Cancelled by user request',
    });

    EventBroker.publishEvent({
      conversionId: id,
      status: 'cancelled',
      progress: record.progress,
      stageName: 'Cancelled by user request',
    });

    res.status(200).json({
      id,
      status: 'cancelled',
      message: 'Conversion job cancelled successfully.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
