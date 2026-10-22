import {
  ArtifactInfo,
  BuildJob,
  BuildLogEntry,
  BuildStatus,
  CreateUploadBuildRequest,
  CreateUrlBuildRequest,
  InitiateUploadResponse,
  UrlValidationResult,
  ZipValidationResult,
} from './types';

export interface IApiClient {
  readonly baseUrl: string;

  validateUrl(url: string): Promise<UrlValidationResult>;
  validateZipFile(file: File): Promise<ZipValidationResult>;
  validatePackageName(packageName: string): Promise<{ valid: boolean; error?: string }>;
  
  initiateUpload(fileName: string, fileSizeBytes: number): Promise<InitiateUploadResponse>;
  uploadFileToStorage(
    presignedUrl: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<void>;

  createUrlBuild(request: CreateUrlBuildRequest): Promise<{ buildId: string; status: BuildStatus }>;
  createUploadBuild(request: CreateUploadBuildRequest): Promise<{ buildId: string; status: BuildStatus }>;

  getBuild(buildId: string): Promise<BuildJob>;
  cancelBuild(buildId: string): Promise<void>;
  getDownloadUrl(buildId: string): Promise<ArtifactInfo>;

  subscribeToLogs(
    buildId: string,
    callbacks: {
      onLog: (log: BuildLogEntry) => void;
      onStatusChange: (status: BuildStatus, progress: number, stageName: string) => void;
      onComplete: (artifact: ArtifactInfo) => void;
      onError: (errorMessage: string) => void;
    }
  ): () => void; // Unsubscribe function
}
