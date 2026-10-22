/**
 * Production HTTP API Adapter for Web2APK
 * Communicates with backend Express API & SSE endpoints.
 */
import { IApiClient } from './client';
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
import { validatePackageName as localValidatePackageName } from '../utils/validators';

export class HttpBuildAdapter implements IApiClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async validateUrl(url: string): Promise<UrlValidationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/validate/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          valid: false,
          error: errorData.detail || errorData.message || `Validation failed (${response.status})`,
        };
      }

      return await response.json();
    } catch (err: any) {
      return {
        valid: false,
        error: err.message || 'Network error reaching validation service.',
      };
    }
  }

  async validateZipFile(file: File): Promise<ZipValidationResult> {
    // Client-side pre-validation
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return {
        valid: false,
        fileName: file.name,
        fileSizeBytes: file.size,
        entryCount: 0,
        hasIndexHtml: false,
        error: 'Only .zip archives are supported.',
      };
    }

    if (file.size > 1024 * 1024 * 1024) {
      return {
        valid: false,
        fileName: file.name,
        fileSizeBytes: file.size,
        entryCount: 0,
        hasIndexHtml: false,
        error: 'File size exceeds 1 GB limit.',
      };
    }

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${this.baseUrl}/validate/zip`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        return {
          valid: false,
          fileName: file.name,
          fileSizeBytes: file.size,
          entryCount: data.entryCount || 0,
          hasIndexHtml: data.hasIndexHtml || false,
          code: data.code,
          error: data.error || data.detail || 'Archive validation failed.',
          topLevelDirectory: data.topLevelDirectory,
        };
      }

      return {
        valid: true,
        fileName: file.name,
        fileSizeBytes: file.size,
        entryCount: data.entryCount,
        hasIndexHtml: data.hasIndexHtml,
        entryPoint: data.entryPoint || 'index.html',
        topLevelDirectory: data.topLevelDirectory,
        totalDecompressedBytes: data.totalDecompressedBytes,
        assetCounts: data.assetCounts,
        referencedAssets: data.referencedAssets,
        warnings: data.warnings,
      };
    } catch (err: any) {
      return {
        valid: false,
        fileName: file.name,
        fileSizeBytes: file.size,
        entryCount: 0,
        hasIndexHtml: false,
        error: err.message || 'Network error during ZIP archive validation.',
      };
    }
  }

  async validatePackageName(packageName: string): Promise<{ valid: boolean; error?: string }> {
    const local = localValidatePackageName(packageName);
    if (!local.valid) return local;

    try {
      const res = await fetch(`${this.baseUrl}/validate/package-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName }),
      });
      if (res.ok) {
        return await res.json();
      }
      return local;
    } catch {
      return local;
    }
  }

  async initiateUpload(fileName: string, fileSizeBytes: number): Promise<InitiateUploadResponse> {
    const res = await fetch(`${this.baseUrl}/builds/upload/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, fileSizeBytes, mimeType: 'application/zip' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || 'Failed to initiate upload');
    }

    return await res.json();
  }

  async uploadFileToStorage(
    presignedUrl: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', 'application/zip');

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with HTTP status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during file upload'));
      xhr.send(file);
    });
  }

  async createUrlBuild(
    request: CreateUrlBuildRequest
  ): Promise<{ buildId: string; status: BuildStatus }> {
    const res = await fetch(`${this.baseUrl}/conversions/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || 'Failed to trigger URL build');
    }

    const data = await res.json();
    return { buildId: data.id || data.buildId, status: data.status };
  }

  async createUploadBuild(
    request: CreateUploadBuildRequest
  ): Promise<{ buildId: string; status: BuildStatus }> {
    let res: Response;
    if (request.file) {
      const formData = new FormData();
      formData.append('file', request.file);
      formData.append('appName', request.appConfig.appName);
      formData.append('packageName', request.appConfig.packageName);
      formData.append('themeColor', request.appConfig.themeColor);
      formData.append('appConfig', JSON.stringify(request.appConfig));

      res = await fetch(`${this.baseUrl}/conversions/upload`, {
        method: 'POST',
        body: formData,
      });
    } else {
      res = await fetch(`${this.baseUrl}/conversions/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || 'Failed to trigger upload build');
    }

    const data = await res.json();
    return { buildId: data.id || data.buildId, status: data.status };
  }

  async getBuild(buildId: string): Promise<BuildJob> {
    const res = await fetch(`${this.baseUrl}/conversions/${encodeURIComponent(buildId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || `Failed to fetch build ${buildId}`);
    }
    const data = await res.json();
    return {
      buildId: data.id,
      mode: data.mode,
      status: data.status,
      targetUrl: data.targetUrl,
      uploadedFileName: data.uploadedFileName,
      appConfig: data.appConfig,
      progressPercentage: data.progress,
      stageName: data.stageName,
      createdAt: data.createdAt,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      errorMessage: data.errorMessage,
      artifact: data.artifact
        ? {
            fileName: data.artifact.fileName,
            fileSizeBytes: data.artifact.fileSizeBytes,
            sha256: data.artifact.sha256,
            downloadUrl: `${this.baseUrl}/conversions/${encodeURIComponent(data.id)}/download?token=${encodeURIComponent(data.artifact.downloadToken || '')}`,
            expiresAt: data.artifact.expiresAt,
          }
        : undefined,
    };
  }

  async cancelBuild(buildId: string): Promise<void> {
    await fetch(`${this.baseUrl}/conversions/${encodeURIComponent(buildId)}/cancel`, {
      method: 'POST',
    });
  }

  async getDownloadUrl(buildId: string): Promise<ArtifactInfo> {
    const job = await this.getBuild(buildId);
    if (!job.artifact) {
      throw new Error('Artifact not ready or not found');
    }
    return job.artifact;
  }

  subscribeToLogs(
    buildId: string,
    callbacks: {
      onLog: (log: BuildLogEntry) => void;
      onStatusChange: (status: BuildStatus, progress: number, stageName: string) => void;
      onComplete: (artifact: ArtifactInfo) => void;
      onError: (errorMessage: string) => void;
    }
  ): () => void {
    const sseUrl = `${this.baseUrl}/conversions/${encodeURIComponent(buildId)}/events`;
    const eventSource = new EventSource(sseUrl);

    eventSource.addEventListener('log', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onLog(data);
      } catch (err) {
        console.error('Failed to parse log event', err);
      }
    });

    eventSource.addEventListener('stage', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onStatusChange(data.stage, data.progress, data.stageName || data.stage);
      } catch (err) {
        console.error('Failed to parse stage event', err);
      }
    });

    eventSource.addEventListener('complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.artifact) {
          callbacks.onComplete(data.artifact);
        }
      } catch (err) {
        console.error('Failed to parse complete event', err);
      }
    });

    eventSource.addEventListener('error_event', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onError(data.message || 'Build failed with an error.');
      } catch {
        callbacks.onError('Build failed with an error.');
      }
    });

    eventSource.onerror = (e) => {
      console.warn('SSE connection transient notice (will auto-reconnect or fallback to polling):', e);
    };

    return () => {
      eventSource.close();
    };
  }
}
