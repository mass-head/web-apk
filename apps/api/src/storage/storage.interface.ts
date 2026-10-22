export interface IStorageService {
  uploadFile(key: string, content: Buffer | Uint8Array, mimeType: string): Promise<string>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  fileExists(key: string): Promise<boolean>;
  getDownloadUrl(key: string, expirySeconds?: number): Promise<string>;
  getUploadUrl(key: string, mimeType?: string, expirySeconds?: number): Promise<string>;
}
