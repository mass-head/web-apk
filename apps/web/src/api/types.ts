/**
 * Web2APK Types and Interfaces
 */

export type BuildStatus = 
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
  iconDataUrl?: string; // Base64 data URL for preview and upload
  splashColor?: string;
  splashDataUrl?: string;
}

export interface ArtifactInfo {
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  downloadUrl: string;
  qrCodeUrl?: string;
  expiresAt: string;
}

export interface BuildLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'stdout' | 'stderr' | 'success';
  message: string;
  stage?: BuildStatus;
}

export interface BuildJob {
  buildId: string;
  mode: 'url' | 'upload';
  status: BuildStatus;
  targetUrl?: string;
  uploadedFileName?: string;
  appConfig: AppConfig;
  progressPercentage: number;
  stageName: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  artifact?: ArtifactInfo;
  logs?: BuildLogEntry[];
}

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  sslValid?: boolean;
  resolvedIp?: string;
  title?: string;
  favicon?: string;
  statusCode?: number;
  warning?: string;
  error?: string;
}

export interface ZipValidationResult {
  valid: boolean;
  fileName: string;
  fileSizeBytes: number;
  entryCount: number;
  hasIndexHtml: boolean;
  entryPoint?: string;
  topLevelDirectory?: string | null;
  totalDecompressedBytes?: number;
  assetCounts?: {
    html: number;
    css: number;
    js: number;
    images: number;
    fonts: number;
    audioVideo: number;
    data: number;
    other: number;
  };
  referencedAssets?: {
    total: number;
    available: number;
    missing: string[];
  };
  warnings?: string[];
  indexHtmlPath?: string;
  code?: string;
  error?: string;
  sampleFiles?: string[];
}

export interface InitiateUploadResponse {
  uploadId: string;
  s3Key: string;
  presignedPutUrl: string;
  expiresAt: string;
  maxSizeBytes: number;
}

export interface CreateUrlBuildRequest {
  url: string;
  appConfig: AppConfig;
}

export interface CreateUploadBuildRequest {
  s3Key?: string;
  uploadId?: string;
  file?: File;
  appConfig: AppConfig;
}

export interface RecentBuild {
  buildId: string;
  mode: 'url' | 'upload';
  appName: string;
  packageName: string;
  target: string; // URL or Zip name
  status: BuildStatus;
  createdAt: string;
  completedAt?: string;
  iconDataUrl?: string;
  themeColor: string;
  artifact?: ArtifactInfo;
}
