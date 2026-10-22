import { workerEnv } from './config/worker-env.js';
import { logger } from './monitoring/logger.js';
import { startHealthServer } from './monitoring/health.js';
import { cleanupService } from './cleanup/cleanup-service.js';
import { workerConsumer } from './consumer.js';

async function main() {
  logger.info('====================================================');
  logger.info(`🚀 Starting Web2APK Android Build Worker (${workerEnv.WORKER_ID})`);
  logger.info(`Concurrency:     ${workerEnv.WORKER_CONCURRENCY}`);
  logger.info(`Queue:           ${workerEnv.QUEUE_NAME}`);
  logger.info(`Redis:           ${workerEnv.REDIS_HOST}:${workerEnv.REDIS_PORT}`);
  logger.info(`Storage Driver:  ${workerEnv.STORAGE_DRIVER}`);
  logger.info(`Workspace Base:  ${workerEnv.WORKSPACE_BASE_DIR}`);
  logger.info(`Health Port:     ${workerEnv.HEALTH_PORT}`);
  logger.info('====================================================');

  // 1. Start Health & Readiness Server
  const healthServer = startHealthServer(workerEnv.HEALTH_PORT, {
    redisClient: workerConsumer.getRedis(),
    isWorkerActive: () => workerConsumer.isActive(),
  });

  // 2. Start Automatic Cleanup Scheduler
  cleanupService.startScheduler();

  // 3. Start BullMQ Consumer
  workerConsumer.start();

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down worker gracefully...`);
    cleanupService.stopScheduler();
    await workerConsumer.stop();
    healthServer.close(() => {
      logger.info('Health server closed. Exiting process.');
      process.exit(0);
    });

    // Force exit if shutdown hangs
    setTimeout(() => {
      logger.error('Shutdown timed out. Forcing termination.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(`Fatal worker initialization error: ${err.message}`);
  process.exit(1);
});
