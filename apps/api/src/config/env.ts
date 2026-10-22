import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_BASE_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGIN: z.string().default('*'),

  // Auth & Token Security
  API_KEY_SECRET: z.string().default('dev-api-key-secret-32-chars-long-abc'),
  JWT_SECRET: z.string().default('dev-jwt-download-secret-32-chars-long'),
  JWT_EXPIRY_SECONDS: z.coerce.number().default(1800), // 30 minutes

  // Database (PostgreSQL)
  DATABASE_URL: z.string().optional(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default('web2apk_db'),
  POSTGRES_USER: z.string().default('web2apk'),
  POSTGRES_PASSWORD: z.string().default('web2apk_password'),

  // Redis & BullMQ
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Object Storage
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_NAME: z.string().default('web2apk-artifacts'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  LOCAL_STORAGE_DIR: z.string().default(path.resolve(process.cwd(), 'data/storage')),

  // Rate Limiting & Quotas
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000), // 15 mins
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  MAX_CONCURRENT_JOBS_PER_USER: z.coerce.number().default(5),
  DAILY_CONVERSIONS_PER_USER: z.coerce.number().default(20),

  // File Upload Limits & Job Timeout
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().default(1073741824), // 1 GB
  JOB_TIMEOUT_MS: z.coerce.number().default(600000), // 10 minutes
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
