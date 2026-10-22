import fs from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { workerEnv } from '../config/worker-env.js';
import { logger } from '../monitoring/logger.js';

export interface IWorkerStorage {
  uploadFile(key: string, content: Buffer | Uint8Array, mimeType: string): Promise<string>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  fileExists(key: string): Promise<boolean>;
  getDownloadUrl(key: string, expirySeconds?: number): Promise<string>;
}

export class S3WorkerStorage implements IWorkerStorage {
  private s3: S3Client;
  private bucket: string;
  private localFallback: LocalWorkerStorage;

  constructor() {
    this.bucket = workerEnv.S3_BUCKET_NAME;
    this.localFallback = new LocalWorkerStorage();
    this.s3 = new S3Client({
      region: workerEnv.S3_REGION,
      endpoint: workerEnv.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: workerEnv.S3_ACCESS_KEY_ID,
        secretAccessKey: workerEnv.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: workerEnv.S3_FORCE_PATH_STYLE,
    });
  }

  async uploadFile(key: string, content: Buffer | Uint8Array, mimeType: string): Promise<string> {
    try {
      const cmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: mimeType,
      });
      await this.s3.send(cmd);
      return key;
    } catch (err: any) {
      logger.warn(`S3 upload failed (${err.name || err.message}). Saving to local storage fallback.`);
      return await this.localFallback.uploadFile(key, content, mimeType);
    }
  }

  async downloadFile(key: string): Promise<Buffer> {
    if (await this.localFallback.fileExists(key)) {
      return await this.localFallback.downloadFile(key);
    }
    try {
      const cmd = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const res = await this.s3.send(cmd);
      if (!res.Body) throw new Error(`S3 object body is empty for key: "${key}"`);
      const byteArray = await res.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (err: any) {
      if (await this.localFallback.fileExists(key)) {
        return await this.localFallback.downloadFile(key);
      }
      throw err;
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const cmd = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3.send(cmd);
    } catch {
      // Ignore S3 error
    }
    await this.localFallback.deleteFile(key);
  }

  async fileExists(key: string): Promise<boolean> {
    if (await this.localFallback.fileExists(key)) {
      return true;
    }
    try {
      const cmd = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3.send(cmd);
      return true;
    } catch {
      return false;
    }
  }

  async getDownloadUrl(key: string, expirySeconds: number = workerEnv.PRESIGNED_URL_EXPIRY_SECONDS): Promise<string> {
    if (await this.localFallback.fileExists(key)) {
      return await this.localFallback.getDownloadUrl(key, expirySeconds);
    }
    try {
      const cmd = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return await getSignedUrl(this.s3, cmd, { expiresIn: expirySeconds });
    } catch {
      return await this.localFallback.getDownloadUrl(key, expirySeconds);
    }
  }
}

export class LocalWorkerStorage implements IWorkerStorage {
  private baseDir: string;

  constructor(baseDir: string = workerEnv.LOCAL_STORAGE_DIR) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveKeyPath(key: string): string {
    const safeKey = key.replace(/^\/+/, '');
    const fullPath = path.join(this.baseDir, safeKey);
    const relative = path.relative(this.baseDir, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path traversal violation for storage key: ${key}`);
    }
    return fullPath;
  }

  async uploadFile(key: string, content: Buffer | Uint8Array, _mimeType: string): Promise<string> {
    const fullPath = this.resolveKeyPath(key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return key;
  }

  async downloadFile(key: string): Promise<Buffer> {
    const fullPath = this.resolveKeyPath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in local storage: "${key}"`);
    }
    return fs.readFileSync(fullPath);
  }

  async deleteFile(key: string): Promise<void> {
    const fullPath = this.resolveKeyPath(key);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true });
    }
  }

  async fileExists(key: string): Promise<boolean> {
    const fullPath = this.resolveKeyPath(key);
    return fs.existsSync(fullPath);
  }

  async getDownloadUrl(key: string, expirySeconds: number = workerEnv.PRESIGNED_URL_EXPIRY_SECONDS): Promise<string> {
    // For local driver, generate tokenized local download path with expiring timestamp
    const expires = Date.now() + expirySeconds * 1000;
    return `/api/conversions/download-direct?key=${encodeURIComponent(key)}&expires=${expires}`;
  }
}

export function createStorageService(): IWorkerStorage {
  if (workerEnv.STORAGE_DRIVER === 's3' && workerEnv.S3_ENDPOINT) {
    try {
      return new S3WorkerStorage();
    } catch (err: any) {
      logger.warn(`Failed to initialize S3 storage driver (${err.message}). Using local storage fallback.`);
    }
  }
  return new LocalWorkerStorage();
}

export const storageService = createStorageService();
