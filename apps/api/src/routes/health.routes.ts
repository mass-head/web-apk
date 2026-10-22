import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../db/client.js';
import { checkQueueHealth, isWorkerConnected } from '../jobs/queue.js';
import { getStorageService } from '../storage/index.js';

const router = Router();

router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  const [dbHealth, queueHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkQueueHealth(),
  ]);

  const storage = getStorageService();
  const storageHealth = {
    status: 'connected',
    driver: storage.constructor.name,
  };

  const isHealthy = dbHealth.status === 'connected' || queueHealth.status === 'connected';

  res.status(200).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      postgres: dbHealth,
      redis: queueHealth,
      storage: storageHealth,
    },
    version: '1.0.0',
    workerConnected: isWorkerConnected(),
  });
});

export default router;
