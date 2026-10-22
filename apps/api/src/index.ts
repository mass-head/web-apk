import { app } from './app.js';
import { env } from './config/env.js';
import { initDatabase, pool } from './db/client.js';
import { getRedisConnection } from './jobs/queue.js';

async function bootstrap() {
  console.log(`Starting Web2APK API in ${env.NODE_ENV} mode...`);

  // Initialize PostgreSQL schema if available
  await initDatabase();

  // Initialize Redis connection if available
  getRedisConnection();

  const server = app.listen(env.PORT, () => {
    console.log(`Web2APK API Gateway listening on port ${env.PORT} (${env.API_BASE_URL})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      if (pool) {
        await pool.end();
      }
      console.log('HTTP server closed. Exiting process.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
