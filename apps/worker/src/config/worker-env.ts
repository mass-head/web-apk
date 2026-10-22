import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  WORKER_CONCURRENCY: z.coerce.number().default(2),
  QUEUE_NAME: z.string().default('android-conversions'),

  // Redis Broker
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // PostgreSQL Database (Optional for direct DB record updates)
  DATABASE_URL: z.string().optional(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default('web2apk_db'),
  POSTGRES_USER: z.string().default('web2apk'),
  POSTGRES_PASSWORD: z.string().default('web2apk_password'),

  // Object Storage (S3 / MinIO)
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_NAME: z.string().default('web2apk-artifacts'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  LOCAL_STORAGE_DIR: z.string().default(path.resolve(process.cwd(), 'data/storage')),

  // Resource & Execution Bounds
  WORKSPACE_BASE_DIR: z.string().default(
    process.platform === 'win32'
      ? path.resolve(process.cwd(), 'data/builds')
      : '/tmp/web2apk-builds'
  ),
  BUILD_TIMEOUT_MS: z.coerce.number().default(600000), // 10 minutes hard job limit
  GRADLE_COMPILATION_TIMEOUT_MS: z.coerce.number().default(300000), // 5 minutes Gradle timeout
  GRADLE_MAX_HEAP: z.string().default('2048m'),
  GRADLE_MAX_METASPACE: z.string().default('512m'),
  MIN_FREE_DISK_MB: z.coerce.number().default(500), // Require at least 500 MB free disk space

  // Health & Metrics
  HEALTH_PORT: z.coerce.number().default(4001),

  // Cleanup Policies
  CLEANUP_INTERVAL_MS: z.coerce.number().default(300000), // Sweeper runs every 5 mins
  ORPHAN_BUILD_MAX_AGE_MS: z.coerce.number().default(1800000), // 30 minutes
  ARTIFACT_TTL_HOURS: z.coerce.number().default(24), // Expire APKs after 24 hours
  PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().default(1800), // 30 minutes
});

export const workerEnv = workerEnvSchema.parse(process.env);
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
