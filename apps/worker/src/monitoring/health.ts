import express, { Request, Response } from 'express';
import { Server } from 'http';
import fs from 'node:fs';
import { workerEnv } from '../config/worker-env.js';
import { resolveQueueLockDurationMs } from '../config/timeouts.js';
import { metrics } from './metrics.js';
import { logger } from './logger.js';
import { Redis } from 'ioredis';

export interface HealthCheckOptions {
  redisClient?: Redis | null;
  isWorkerActive?: () => boolean;
}

export function createHealthServer(options: HealthCheckOptions = {}): express.Express {
  const app = express();

  // 1. Liveness Probe (Kubernetes livenessProbe)
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'UP',
      workerId: workerEnv.WORKER_ID,
      commit:
        process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown',
      timestamp: new Date().toISOString(),
      uptimeSeconds: metrics.getSnapshot().uptimeSeconds,
      timeouts: {
        gradleMs: workerEnv.GRADLE_TIMEOUT_MS,
        buildMs: workerEnv.BUILD_TIMEOUT_MS,
        queueLockMs: resolveQueueLockDurationMs(
          workerEnv.BUILD_TIMEOUT_MS,
          workerEnv.GRADLE_TIMEOUT_MS
        ),
      },
    });
  });

  // 2. Readiness Probe (Kubernetes readinessProbe)
  app.get('/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, { status: 'UP' | 'DOWN'; detail?: string }> = {};
    let isReady = true;

    // Check Redis connectivity if provided
    if (options.redisClient) {
      try {
        const ping = await options.redisClient.ping();
        checks.redis = {
          status: ping === 'PONG' ? 'UP' : 'DOWN',
        };
        if (ping !== 'PONG') isReady = false;
      } catch (err: any) {
        checks.redis = { status: 'DOWN', detail: err.message };
        isReady = false;
      }
    } else {
      checks.redis = { status: 'UP', detail: 'Standalone / In-process' };
    }

    // Check Worker State
    if (options.isWorkerActive) {
      const active = options.isWorkerActive();
      checks.worker = {
        status: active ? 'UP' : 'DOWN',
      };
      if (!active) isReady = false;
    }

    // Check Workspace Directory Availability
    try {
      if (!fs.existsSync(workerEnv.WORKSPACE_BASE_DIR)) {
        fs.mkdirSync(workerEnv.WORKSPACE_BASE_DIR, { recursive: true });
      }
      checks.storage = { status: 'UP' };
    } catch (err: any) {
      checks.storage = { status: 'DOWN', detail: err.message };
      isReady = false;
    }

    const statusCode = isReady ? 200 : 503;
    res.status(statusCode).json({
      status: isReady ? 'READY' : 'NOT_READY',
      workerId: workerEnv.WORKER_ID,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // 3. Prometheus / Metrics Endpoint
  app.get('/metrics', (req: Request, res: Response) => {
    const accept = req.headers.accept || '';
    if (accept.includes('application/json')) {
      res.status(200).json(metrics.getSnapshot());
    } else {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.status(200).send(metrics.toPrometheusFormat());
    }
  });

  return app;
}

export function startHealthServer(
  port: number = workerEnv.HEALTH_PORT,
  options: HealthCheckOptions = {}
): Server {
  const app = createHealthServer(options);
  const server = app.listen(port, () => {
    logger.info(`Health & metrics server listening on port ${port}`);
  });
  return server;
}
