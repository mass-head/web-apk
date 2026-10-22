import { IStorageService } from './storage.interface.js';
import { LocalStorageService } from './local.storage.js';
import { S3StorageService } from './s3.storage.js';
import { env } from '../config/env.js';

let storageInstance: IStorageService | null = null;

export function getStorageService(): IStorageService {
  if (storageInstance) return storageInstance;

  if (env.STORAGE_DRIVER === 's3') {
    try {
      storageInstance = new S3StorageService();
    } catch (err: any) {
      console.warn('Failed to initialize S3 storage, falling back to LocalStorageService:', err.message);
      storageInstance = new LocalStorageService();
    }
  } else {
    storageInstance = new LocalStorageService();
  }

  return storageInstance;
}

export * from './storage.interface.js';
