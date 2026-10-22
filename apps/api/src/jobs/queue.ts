import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { resolveQueueLockDurationMs } from '../config/timeouts.js';
import { JobQueuePayload } from './types.js';
import { processConversionJob } from './build-worker.js';

export const QUEUE_NAME = 'android-conversions';

let redisClient: Redis | null = null;
let conversionQueue: Queue | null = null;
let conversionWorker: Worker | null = null;
let isRedisAvailable = false;
let inProcessExecutionEnabled = true;

export function getRedisConnection(): Redis | null {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 3) {
          isRedisAvailable = false;
          return null; // Stop reconnecting in test/standalone environments
        }
        return Math.min(times * 200, 1000);
      },
    });

    redisClient.on('connect', () => {
      isRedisAvailable = true;
      initWorker();
    });

    redisClient.on('error', () => {
      isRedisAvailable = false;
    });

    return redisClient;
  } catch (err: any) {
    console.warn('Redis client initialization failed:', err.message);
    return null;
  }
}

export function getConversionQueue(): Queue | null {
  if (conversionQueue) return conversionQueue;

  const redis = getRedisConnection();
  if (!redis) return null;

  try {
    conversionQueue = new Queue(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 86400 * 3, count: 5000 },
      },
    });

    return conversionQueue;
  } catch (err: any) {
    console.warn('BullMQ Queue initialization failed:', err.message);
    return null;
  }
}

export function initWorker(): Worker | null {
  if (conversionWorker) return conversionWorker;
  const redis = getRedisConnection();
  if (!redis || !isRedisAvailable) return null;

  try {
    const lockDuration = resolveQueueLockDurationMs(
      env.JOB_TIMEOUT_MS,
      env.GRADLE_TIMEOUT_MS
    );

    conversionWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        return await processConversionJob(job.data as JobQueuePayload);
      },
      {
        connection: redis,
        concurrency: env.BUILD_CONCURRENCY,
        // Keep the job lock alive for the entire build instead of allowing
        // BullMQ to mark long-running Gradle compilations as stalled.
        lockDuration,
        lockRenewTime: Math.floor(lockDuration / 3),
        stalledInterval: Math.min(60_000, Math.floor(lockDuration / 4)),
      }
    );

    conversionWorker.on('completed', (job) => {
      console.log(`[Worker] Job ${job.id} completed successfully`);
    });

    conversionWorker.on('failed', (job, err) => {
      console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    });

    return conversionWorker;
  } catch (err: any) {
    console.warn('BullMQ Worker initialization skipped:', err.message);
    return null;
  }
}

export function setInProcessExecution(enabled: boolean): void {
  inProcessExecutionEnabled = enabled;
}

export async function enqueueConversionJob(
  payload: JobQueuePayload,
  options: { syncInProcess?: boolean } = {}
): Promise<string> {
  const q = getConversionQueue();

  if (q && isRedisAvailable) {
    try {
      const job = await q.add(payload.mode, payload, {
        jobId: payload.conversionId,
      });
      return job.id || payload.conversionId;
    } catch (err: any) {
      console.warn('BullMQ enqueue failed, queueing in-process worker:', err.message);
    }
  }

  // In-process fallback: Asynchronously dispatch to build worker
  if (inProcessExecutionEnabled) {
    if (options.syncInProcess) {
      await processConversionJob(payload);
    } else {
      setImmediate(async () => {
        try {
          await processConversionJob(payload);
        } catch (err: any) {
          console.warn(`[In-Process Worker] Job ${payload.conversionId} failed:`, err.message);
        }
      });
    }
  }

  return payload.conversionId;
}

export async function cancelConversionJob(conversionId: string): Promise<boolean> {
  const q = getConversionQueue();
  if (!q || !isRedisAvailable) return true;

  try {
    const job = await q.getJob(conversionId);
    if (job) {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
        return true;
      }
      if (state === 'active') {
        await job.discard();
        return true;
      }
    }
    return false;
  } catch (err: any) {
    console.warn(`Could not cancel BullMQ job ${conversionId}:`, err.message);
    return false;
  }
}

export function isWorkerConnected(): boolean {
  return conversionWorker !== null || inProcessExecutionEnabled;
}

export async function checkQueueHealth(): Promise<{ status: 'connected' | 'disconnected'; error?: string }> {
  const redis = getRedisConnection();
  if (!redis) return { status: 'disconnected', error: 'Redis client not configured' };

  try {
    const ping = await redis.ping();
    if (ping === 'PONG') {
      isRedisAvailable = true;
      return { status: 'connected' };
    }
    return { status: 'disconnected', error: 'Did not receive PONG' };
  } catch (err: any) {
    isRedisAvailable = false;
    return { status: 'disconnected', error: err.message };
  }
}
