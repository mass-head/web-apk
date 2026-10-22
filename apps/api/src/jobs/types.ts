export type ConversionMode = 'url' | 'upload';

export type ConversionStatus =
  | 'queued'
  | 'validating'
  | 'generating'
  | 'building'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ScreenOrientation = 'unspecified' | 'portrait' | 'landscape';

export interface AppConfig {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  themeColor: string;
  orientation: ScreenOrientation;
  enablePullToRefresh: boolean;
  enableDownloadManager: boolean;
  enableGeolocation: boolean;
  enableCamera: boolean;
  enablePushNotifications: boolean;
  customUserAgent?: string;
  iconDataUrl?: string;
  iconStorageKey?: string;
  hideCustomLoadingSelector?: string;
}

export interface ArtifactMetadata {
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  storageKey: string;
  downloadToken: string;
  expiresAt: string;
}

export interface ConversionRecord {
  id: string;
  userId: string;
  mode: ConversionMode;
  status: ConversionStatus;
  progress: number;
  stageName: string;
  appConfig: AppConfig;
  targetUrl: string | null;
  uploadedFileName: string | null;
  storageKey: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  artifact: ArtifactMetadata | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface JobQueuePayload {
  conversionId: string;
  userId: string;
  mode: ConversionMode;
  appConfig: AppConfig;
  targetUrl?: string;
  uploadedFileName?: string;
  storageKey?: string;
}

export interface JobProgressEvent {
  conversionId: string;
  status: ConversionStatus;
  progress: number;
  stageName: string;
  message?: string;
  log?: {
    level: 'info' | 'warn' | 'error' | 'stdout' | 'stderr' | 'success';
    message: string;
    timestamp: string;
  };
  artifact?: ArtifactMetadata;
  error?: string;
}
