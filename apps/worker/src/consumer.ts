import { Worker, Job, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';
import { workerEnv } from './config/worker-env.js';
import { resolveQueueLockDurationMs } from './config/timeouts.js';
import { logger } from './monitoring/logger.js';
import { metrics } from './monitoring/metrics.js';
import { workspaceManager } from './builder/isolated-workspace.js';
import { templateManager } from './builder/template-manager.js';
import { configSanitizer, AppConfigInput } from './builder/config-sanitizer.js';
import { validateZipBuffer, extractSanitizedZip } from './builder/zip-extractor.js';
import { gradleRunner } from './builder/gradle-runner.js';
import { verifyApk } from './builder/apk-verifier.js';
import { storageService } from './storage/storage-service.js';

export interface ConversionJobData {
  conversionId: string;
  userId: string;
  mode: 'url' | 'upload';
  targetUrl?: string;
  uploadedFileName?: string;
  storageKey?: string;
  appConfig: AppConfigInput;
}

export interface ArtifactResult {
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  storageKey: string;
  downloadUrl: string;
  expiresAt: string;
}

export class ConversionWorkerConsumer {
  private redisConnection: Redis | null = null;
  private worker: Worker | null = null;
  private isProcessing = false;

  constructor() {
    this.initRedis();
  }

  private initRedis(): Redis | null {
    if (this.redisConnection) return this.redisConnection;
    try {
      this.redisConnection = new Redis({
        host: workerEnv.REDIS_HOST,
        port: workerEnv.REDIS_PORT,
        password: workerEnv.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 1000);
        },
      });

      this.redisConnection.on('error', (err) => {
        logger.warn(`Redis connection error: ${err.message}`);
      });

      return this.redisConnection;
    } catch (err: any) {
      logger.warn(`Failed to connect Redis: ${err.message}`);
      return null;
    }
  }

  getRedis(): Redis | null {
    return this.redisConnection;
  }

  start(): Worker | null {
    const redis = this.initRedis();
    if (!redis) {
      logger.warn('Redis not available; worker listening in standalone mode.');
      return null;
    }

    try {
      const lockDuration = resolveQueueLockDurationMs(
        workerEnv.BUILD_TIMEOUT_MS,
        workerEnv.GRADLE_TIMEOUT_MS
      );

      this.worker = new Worker<ConversionJobData>(
        workerEnv.QUEUE_NAME,
        async (job: Job<ConversionJobData>) => {
          return await this.processJob(job);
        },
        {
          connection: redis,
          concurrency: workerEnv.WORKER_CONCURRENCY,
          // Do not let BullMQ treat a long-running Gradle build as stalled.
          lockDuration,
          lockRenewTime: Math.floor(lockDuration / 3),
          stalledInterval: Math.min(60_000, Math.floor(lockDuration / 4)),
        }
      );

      this.worker.on('active', (job) => {
        logger.info(`Job ${job.id} started execution`, job.data.conversionId);
      });

      this.worker.on('completed', (job) => {
        logger.info(`Job ${job.id} completed successfully`, job.data.conversionId);
      });

      this.worker.on('failed', (job, err) => {
        logger.error(`Job ${job?.id} failed: ${err.message}`, job?.data.conversionId);
      });

      logger.info(
        `BullMQ Worker listening on queue "${workerEnv.QUEUE_NAME}" with concurrency ${workerEnv.WORKER_CONCURRENCY}`
      );

      return this.worker;
    } catch (err: any) {
      logger.error(`Could not start BullMQ worker: ${err.message}`);
      return null;
    }
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.redisConnection) {
      this.redisConnection.disconnect();
      this.redisConnection = null;
    }
    logger.info('BullMQ Worker stopped.');
  }

  isActive(): boolean {
    return this.worker !== null && this.worker.isRunning();
  }

  async processJob(job: Job<ConversionJobData> | { data: ConversionJobData }): Promise<ArtifactResult> {
    const data = job.data;
    const { conversionId, mode, targetUrl, appConfig, storageKey } = data;
    const startTime = Date.now();

    metrics.recordJobStarted();
    logger.info(`Processing ${mode.toUpperCase()} conversion job`, conversionId, 'init');

    // Per-job isolated workspace
    const workspace = workspaceManager.allocate(conversionId);
    const cancelSignal = { cancelled: false };

    try {
      // 1. Validation & Pre-flight
      let entryPoint = 'index.html';

      if (mode === 'upload') {
        if (!storageKey) {
          throw new UnrecoverableError('Storage key missing for uploaded archive.');
        }
        logger.info(`Fetching uploaded archive: ${storageKey}`, conversionId, 'validating');
        const zipBuffer = await storageService.downloadFile(storageKey);
        const validation = validateZipBuffer(zipBuffer);
        if (!validation.valid) {
          throw new UnrecoverableError(`ZIP validation failed: ${validation.error}`);
        }
        entryPoint = validation.entryPoint || 'index.html';
      }

      // 2. Project Scaffolding
      logger.info('Copying template to isolated workspace', conversionId, 'generating');
      templateManager.copyTemplateTo(workspace.workspacePath);

      // If upload mode, extract sanitized static assets
      if (mode === 'upload' && storageKey) {
        const zipBuffer = await storageService.downloadFile(storageKey);
        const targetAssetsDir = path.join(workspace.workspacePath, 'app/src/main/assets/web');
        const extraction = extractSanitizedZip(zipBuffer, targetAssetsDir);
        entryPoint = extraction.entryPoint || 'index.html';
        logger.info(`Extracted ${extraction.extractedFileCount} sanitized assets`, conversionId, 'generating');
      }

      // Inject sanitized configuration
      logger.info('Injecting sanitized configuration into template', conversionId, 'generating');
      configSanitizer.configureProject(workspace.workspacePath, data, entryPoint);

      // 3. Offline Gradle 8.5 Compilation
      logger.info('Executing Gradle compilation in offline sandbox', conversionId, 'building');
      const apkPath = await gradleRunner.executeBuild({
        workspace: workspace.workspacePath,
        conversionId,
        cancelSignal,
        onProgress: (progress: number, stage: string) => {
          logger.debug(`Progress ${progress}%: ${stage}`, conversionId, 'building');
        },
        onLog: (line: string, isError: boolean) => {
          logger.debug(line, conversionId, isError ? 'stderr' : 'stdout');
        },
      });

      // 4. Artifact Verification
      logger.info('Verifying compiled APK archive integrity', conversionId, 'verifying');
      const verification = verifyApk(apkPath);
      if (!verification.isValid) {
        throw new UnrecoverableError(`APK verification failed: ${verification.errors.join('; ')}`);
      }

      // 5. Store Artifact in S3 / Object Storage
      const cleanAppName = (appConfig.appName || 'app').toLowerCase().replace(/[^a-z0-9]/g, '-') || 'app';
      const artifactFileName = `${cleanAppName}-debug.apk`;
      const artifactKey = `artifacts/${conversionId}/${artifactFileName}`;

      const apkBuffer = fs.readFileSync(apkPath);
      await storageService.uploadFile(
        artifactKey,
        apkBuffer,
        'application/vnd.android.package-archive'
      );

      const downloadUrl = await storageService.getDownloadUrl(artifactKey, workerEnv.PRESIGNED_URL_EXPIRY_SECONDS);
      const expiresAt = new Date(Date.now() + workerEnv.PRESIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

      const durationMs = Date.now() - startTime;
      metrics.recordJobCompleted(durationMs);

      logger.info(
        `Job completed successfully in ${(durationMs / 1000).toFixed(1)}s! APK size: ${verification.sizeMb} MB, SHA-256: ${verification.sha256}`,
        conversionId,
        'completed'
      );

      return {
        fileName: artifactFileName,
        fileSizeBytes: apkBuffer.length,
        sha256: verification.sha256,
        storageKey: artifactKey,
        downloadUrl,
        expiresAt,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      if (cancelSignal.cancelled || err.message?.includes('cancelled')) {
        metrics.recordJobCancelled(durationMs);
        logger.warn(`Job cancelled by user request`, conversionId);
        throw new UnrecoverableError('Job cancelled by user request');
      }

      metrics.recordJobFailed(durationMs);
      logger.error(`Job processing failed: ${err.message}`, conversionId);

      // Determine if error is non-retryable
      if (
        err instanceof UnrecoverableError ||
        err.message?.includes('validation failed') ||
        err.message?.includes('Security violation') ||
        err.message?.includes('Gradle compilation failed')
      ) {
        throw new UnrecoverableError(err.message);
      }

      throw err;
    } finally {
      // Per-job isolated directory cleanup immediately upon job end
      workspaceManager.cleanup(conversionId);
    }
  }
}

export const workerConsumer = new ConversionWorkerConsumer();
