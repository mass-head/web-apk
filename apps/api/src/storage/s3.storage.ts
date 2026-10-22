import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IStorageService } from './storage.interface.js';
import { LocalStorageService } from './local.storage.js';
import { env } from '../config/env.js';

export class S3StorageService implements IStorageService {
  private s3: S3Client;
  private bucket: string;
  private localFallback: LocalStorageService;

  constructor() {
    this.bucket = env.S3_BUCKET_NAME;
    this.localFallback = new LocalStorageService();

    this.s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
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
      console.warn(`[S3 Storage] S3 upload failed (${err.name || err.message}). Saving to local storage fallback.`);
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
      if (!res.Body) throw new Error(`Object body is empty for key "${key}"`);
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

  async getDownloadUrl(key: string, expirySeconds = 1800): Promise<string> {
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

  async getUploadUrl(key: string, mimeType = 'application/zip', expirySeconds = 1800): Promise<string> {
    try {
      const cmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      });
      return await getSignedUrl(this.s3, cmd, { expiresIn: expirySeconds });
    } catch {
      return await this.localFallback.getUploadUrl(key, mimeType, expirySeconds);
    }
  }
}
