import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export let pool: pg.Pool | null = null;
let isConnected = false;

export function getPool(): pg.Pool | null {
  if (pool) return pool;

  try {
    const config: pg.PoolConfig = env.DATABASE_URL
      ? { connectionString: env.DATABASE_URL }
      : {
          host: env.POSTGRES_HOST,
          port: env.POSTGRES_PORT,
          database: env.POSTGRES_DB,
          user: env.POSTGRES_USER,
          password: env.POSTGRES_PASSWORD,
        };

    pool = new Pool({
      ...config,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });

    pool.on('error', (err) => {
      console.warn('Postgres pool error:', err.message);
      isConnected = false;
    });

    return pool;
  } catch (err: any) {
    console.warn('Could not initialize PostgreSQL pool:', err.message);
    return null;
  }
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  mode VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  stage_name VARCHAR(255) NOT NULL,
  app_config JSONB NOT NULL,
  target_url TEXT,
  uploaded_file_name VARCHAR(255),
  storage_key VARCHAR(512),
  idempotency_key VARCHAR(128) UNIQUE,
  error_code VARCHAR(64),
  error_message TEXT,
  artifact JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversions_user_id ON conversions(user_id);
CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(status);
CREATE INDEX IF NOT EXISTS idx_conversions_created_at ON conversions(created_at DESC);
`;

export async function initDatabase(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;

  try {
    const client = await p.connect();
    try {
      await client.query(SCHEMA_SQL);
      isConnected = true;
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn(`PostgreSQL connection not established (${err.message}). Using memory-backed fallback for tests/standalone.`);
    isConnected = false;
    return false;
  }
}

export async function checkDatabaseHealth(): Promise<{ status: 'connected' | 'disconnected'; error?: string }> {
  const p = getPool();
  if (!p) return { status: 'disconnected', error: 'Pool not initialized' };

  try {
    const res = await p.query('SELECT 1 as alive');
    if (res.rows && res.rows[0]?.alive === 1) {
      isConnected = true;
      return { status: 'connected' };
    }
    return { status: 'disconnected' };
  } catch (err: any) {
    return { status: 'disconnected', error: err.message };
  }
}

export function isDbConnected(): boolean {
  return isConnected;
}
