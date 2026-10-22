import { ConversionRecord, ConversionStatus } from '../jobs/types.js';
import { getPool, isDbConnected } from './client.js';

export class ConversionRepository {
  // In-memory fallback map for offline/testing mode
  private static memoryStore: Map<string, ConversionRecord> = new Map();
  private static idempotencyStore: Map<string, string> = new Map(); // key -> id

  static async create(record: ConversionRecord): Promise<ConversionRecord> {
    const pool = getPool();

    if (isDbConnected() && pool) {
      try {
        const query = `
          INSERT INTO conversions (
            id, user_id, mode, status, progress, stage_name, app_config,
            target_url, uploaded_file_name, storage_key, idempotency_key,
            error_code, error_message, artifact, created_at, started_at, completed_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18
          )
          RETURNING *;
        `;

        const values = [
          record.id,
          record.userId,
          record.mode,
          record.status,
          record.progress,
          record.stageName,
          JSON.stringify(record.appConfig),
          record.targetUrl,
          record.uploadedFileName,
          record.storageKey,
          record.idempotencyKey,
          record.errorCode,
          record.errorMessage,
          record.artifact ? JSON.stringify(record.artifact) : null,
          record.createdAt,
          record.startedAt,
          record.completedAt,
          record.updatedAt,
        ];

        await pool.query(query, values);
        return record;
      } catch (err: any) {
        console.warn('Postgres insert failed, saving to memory fallback:', err.message);
      }
    }

    // Memory store fallback
    this.memoryStore.set(record.id, { ...record });
    if (record.idempotencyKey) {
      this.idempotencyStore.set(record.idempotencyKey, record.id);
    }
    return record;
  }

  static async findById(id: string): Promise<ConversionRecord | null> {
    const pool = getPool();

    if (isDbConnected() && pool) {
      try {
        const res = await pool.query('SELECT * FROM conversions WHERE id = $1 LIMIT 1', [id]);
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            id: row.id,
            userId: row.user_id,
            mode: row.mode,
            status: row.status,
            progress: row.progress,
            stageName: row.stage_name,
            appConfig: typeof row.app_config === 'string' ? JSON.parse(row.app_config) : row.app_config,
            targetUrl: row.target_url,
            uploadedFileName: row.uploaded_file_name,
            storageKey: row.storage_key,
            idempotencyKey: row.idempotency_key,
            errorCode: row.error_code,
            errorMessage: row.error_message,
            artifact: row.artifact ? (typeof row.artifact === 'string' ? JSON.parse(row.artifact) : row.artifact) : null,
            createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
            startedAt: row.started_at?.toISOString ? row.started_at.toISOString() : row.started_at,
            completedAt: row.completed_at?.toISOString ? row.completed_at.toISOString() : row.completed_at,
            updatedAt: row.updated_at?.toISOString ? row.updated_at.toISOString() : row.updated_at,
          };
        }
      } catch (err: any) {
        console.warn('Postgres findById failed, checking memory fallback:', err.message);
      }
    }

    return this.memoryStore.get(id) || null;
  }

  static async findByIdempotencyKey(key: string): Promise<ConversionRecord | null> {
    const pool = getPool();

    if (isDbConnected() && pool) {
      try {
        const res = await pool.query('SELECT * FROM conversions WHERE idempotency_key = $1 LIMIT 1', [key]);
        if (res.rows.length > 0) {
          return this.findById(res.rows[0].id);
        }
      } catch (err: any) {
        console.warn('Postgres findByIdempotencyKey failed:', err.message);
      }
    }

    const id = this.idempotencyStore.get(key);
    return id ? this.memoryStore.get(id) || null : null;
  }

  static async updateStatus(
    id: string,
    updates: Partial<ConversionRecord>
  ): Promise<ConversionRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const updated: ConversionRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const pool = getPool();
    if (isDbConnected() && pool) {
      try {
        const query = `
          UPDATE conversions SET
            status = $1,
            progress = $2,
            stage_name = $3,
            error_code = $4,
            error_message = $5,
            artifact = $6,
            started_at = $7,
            completed_at = $8,
            updated_at = $9
          WHERE id = $10;
        `;

        await pool.query(query, [
          updated.status,
          updated.progress,
          updated.stageName,
          updated.errorCode,
          updated.errorMessage,
          updated.artifact ? JSON.stringify(updated.artifact) : null,
          updated.startedAt,
          updated.completedAt,
          updated.updatedAt,
          id,
        ]);
      } catch (err: any) {
        console.warn('Postgres update failed, updating memory store:', err.message);
      }
    }

    this.memoryStore.set(id, updated);
    return updated;
  }

  static async countActiveByUser(userId: string): Promise<number> {
    const pool = getPool();
    const activeStatuses: ConversionStatus[] = ['queued', 'validating', 'generating', 'building'];

    if (isDbConnected() && pool) {
      try {
        const res = await pool.query(
          'SELECT COUNT(*) as cnt FROM conversions WHERE user_id = $1 AND status = ANY($2)',
          [userId, activeStatuses]
        );
        return parseInt(res.rows[0]?.cnt || '0', 10);
      } catch (err: any) {
        console.warn('Postgres countActiveByUser failed:', err.message);
      }
    }

    let count = 0;
    for (const record of this.memoryStore.values()) {
      if (record.userId === userId && activeStatuses.includes(record.status)) {
        count++;
      }
    }
    return count;
  }

  static async countDailyByUser(userId: string): Promise<number> {
    const pool = getPool();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    if (isDbConnected() && pool) {
      try {
        const res = await pool.query(
          'SELECT COUNT(*) as cnt FROM conversions WHERE user_id = $1 AND created_at >= $2',
          [userId, oneDayAgo]
        );
        return parseInt(res.rows[0]?.cnt || '0', 10);
      } catch (err: any) {
        console.warn('Postgres countDailyByUser failed:', err.message);
      }
    }

    let count = 0;
    for (const record of this.memoryStore.values()) {
      if (record.userId === userId && record.createdAt >= oneDayAgo) {
        count++;
      }
    }
    return count;
  }

  static clearMemory(): void {
    this.memoryStore.clear();
    this.idempotencyStore.clear();
  }
}
