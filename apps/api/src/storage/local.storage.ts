import fs from 'fs/promises';
import path from 'path';
import { IStorageService } from './storage.interface.js';
import { env } from '../config/env.js';

export class LocalStorageService implements IStorageService {
  private baseDir: string;

  constructor(baseDir = env.LOCAL_STORAGE_DIR) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolvePath(key: string): string {
    const cleanKey = key.replace(/^[/\\]+/, '');
    const fullPath = path.resolve(this.baseDir, cleanKey);
    const rel = path.relative(this.baseDir, fullPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Security Violation: Path traversal blocked for key "${key}"`);
    }
    return fullPath;
  }

  async uploadFile(key: string, content: Buffer | Uint8Array, _mimeType: string): Promise<string> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    return key;
  }

  async downloadFile(key: string): Promise<Buffer> {
    const filePath = this.resolvePath(key);
    return await fs.readFile(filePath);
  }

  async deleteFile(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file already deleted
    }
  }

  async fileExists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getDownloadUrl(key: string, _expirySeconds = 1800): Promise<string> {
    return `/api/conversions/storage/raw/${encodeURIComponent(key)}`;
  }

  async getUploadUrl(_key: string, _mimeType = 'application/zip', _expirySeconds = 1800): Promise<string> {
    return `/api/conversions/upload`;
  }
}
