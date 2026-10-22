import React, { useRef, useState } from 'react';
import { AppConfig, ZipValidationResult } from '../../api/types';
import { apiClient } from '../../api';
import { Button } from '../common/Button';
import { AppConfigFields } from './AppConfigFields';
import { IconUploader } from './IconUploader';
import { AdvancedOptions } from './AdvancedOptions';
import { formatBytes } from '../../utils/formatters';
import {
  UploadCloud,
  FileArchive,
  CheckCircle2,
  AlertTriangle,
  X,
  ArrowRight,
  ShieldCheck,
  Info,
} from 'lucide-react';

interface ZipConversionFormProps {
  onSubmit: (file: File, config: AppConfig) => Promise<void>;
  isSubmitting: boolean;
  onConfigChange?: (config: AppConfig) => void;
}

export const ZipConversionForm: React.FC<ZipConversionFormProps> = ({
  onSubmit,
  isSubmitting,
  onConfigChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ZipValidationResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [config, setConfig] = useState<AppConfig>({
    appName: '',
    packageName: 'com.example.app',
    versionName: '1.0.0',
    versionCode: 1,
    themeColor: '#12372A',
    orientation: 'unspecified',
    enablePullToRefresh: false,
    enableDownloadManager: false,
    enableGeolocation: false,
    enableCamera: false,
    enablePushNotifications: false,
  });

  const updateConfig = (updates: Partial<AppConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      onConfigChange?.(next);
      return next;
    });
  };

  const handleProcessFile = async (file: File) => {
    setSelectedFile(file);
    setIsValidating(true);
    setValidationResult(null);

    // Auto deduce app name from zip filename if empty
    if (!config.appName) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const capitalized = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
      updateConfig({
        appName: capitalized,
        packageName: `com.example.${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      });
    }

    try {
      const result = await apiClient.validateZipFile(file);
      setValidationResult(result);
    } catch (e: any) {
      setValidationResult({
        valid: false,
        fileName: file.name,
        fileSizeBytes: file.size,
        entryCount: 0,
        hasIndexHtml: false,
        error: e.message || 'Error validating zip package',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !validationResult?.valid) return;
    await onSubmit(selectedFile, config);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Static Website Architecture Scope Notice */}
      <div className="p-4 rounded-2xl bg-[#285943]/20 border border-[#285943] text-xs space-y-2">
        <div className="flex items-center gap-2 text-[#E9C46A] font-semibold text-xs">
          <Info className="w-4 h-4 shrink-0 text-[#E9C46A]" />
          <span>Upload Mode Scope: Static Websites & Client-Side SPAs</span>
        </div>
        <p className="text-[#F7F4EA]/80 leading-relaxed text-xs">
          Upload mode packages client-side static assets (<span className="text-[#E9C46A] font-medium">HTML, CSS, JavaScript, WebAssembly</span>, and production builds from Vite, Next static export, React, Vue, Svelte, or Astro) directly into the Android APK. Assets are sandboxed and served locally via Android's <code className="text-[#E9C46A] font-mono">WebViewAssetLoader</code> on a secure virtual origin.
        </p>
        <p className="text-[#F7F4EA]/60 text-[11px] leading-relaxed">
          <strong className="text-[#F7F4EA]/90">Dynamic server-side applications:</strong> Runtimes like Node.js, Python, PHP, or Ruby cannot execute inside the mobile APK. If your application requires a dynamic backend server, deploy the backend to a remote host and use <strong className="text-[#E9C46A]">URL Mode</strong> to point to your live HTTPS site, or connect your static frontend to your remote REST/GraphQL API.
        </p>
      </div>

      {/* ZIP Drag & Drop Upload Zone */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#12372A] border border-[#285943] shadow-card">
        <label className="block text-xs font-semibold text-[#F7F4EA]/90 uppercase tracking-wider mb-2 flex flex-wrap items-center justify-between gap-1">
          <span className="flex items-center gap-1.5">
            <FileArchive className="w-3.5 h-3.5 text-[#E9C46A]" />
            <span>Static Website ZIP Archive</span>
            <span className="text-[#E9C46A]">*</span>
          </span>
          <span className="text-[11px] text-[#F7F4EA]/60 font-normal">Must contain index.html at root (Max 1 GB)</span>
        </label>

        {!selectedFile ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-4 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ${
              isDragging
                ? 'border-[#E9C46A] bg-[#E9C46A]/10 scale-[1.01]'
                : 'border-[#285943] hover:border-[#E9C46A] bg-[#202820]/60 hover:bg-[#202820]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="w-14 h-14 rounded-2xl bg-[#12372A] border border-[#285943] flex items-center justify-center mb-3 shadow-lg group-hover:scale-105 transition-transform">
              <UploadCloud className="w-7 h-7 text-[#E9C46A]" />
            </div>
            <h4 className="text-sm font-semibold text-[#F7F4EA]">
              Drag & Drop your static site ZIP here, or <span className="text-[#E9C46A] hover:underline">browse</span>
            </h4>
            <p className="text-xs text-[#F7F4EA]/60 mt-1 max-w-sm">
              Supports HTML5, CSS3, JavaScript bundles, React, Vue, Svelte, or Astro export folders.
            </p>
            <div className="mt-4 flex items-center gap-3 text-[11px] font-mono text-[#F7F4EA]/60">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#E9C46A]" /> index.html required
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#E9C46A]" /> Zip Slip protected
              </span>
            </div>
          </div>
        ) : (
          /* Selected File Card */
          <div className="p-4 rounded-xl bg-[#202820] border border-[#285943] flex items-center justify-between">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-[#285943]/40 border border-[#285943] flex items-center justify-center shrink-0">
                <FileArchive className="w-5 h-5 text-[#E9C46A]" />
              </div>
              <div className="truncate">
                <p className="text-sm font-semibold text-[#F7F4EA] truncate">{selectedFile.name}</p>
                <p className="text-xs text-[#F7F4EA]/60 font-mono">
                  {formatBytes(selectedFile.size)} • {isValidating ? 'Inspecting archive structure...' : 'ZIP Loaded'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setValidationResult(null);
              }}
              className="p-1.5 rounded-lg text-[#F7F4EA]/60 hover:text-rose-400 hover:bg-white/5 transition-colors"
              title="Remove File"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Validation Result Inspection Card */}
        {validationResult && (
          <div
            className={`mt-4 p-4 rounded-xl border text-xs flex flex-col gap-3 transition-all duration-300 ${
              validationResult.valid
                ? 'bg-[#285943]/30 border-[#285943] text-[#F7F4EA]'
                : 'bg-rose-950/20 border-rose-500/30 text-rose-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {validationResult.valid ? (
                <CheckCircle2 className="w-4 h-4 text-[#E9C46A] shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                {validationResult.valid ? (
                  <div>
                    <p className="font-semibold text-[#E9C46A] flex items-center gap-2">
                      <span>ZIP Archive Verified</span>
                      <span className="text-[10px] bg-[#12372A] border border-[#285943] px-2 py-0.5 rounded text-[#E9C46A] font-mono">
                        entrypoint: {validationResult.entryPoint || 'index.html'}
                      </span>
                    </p>
                    <p className="text-[#F7F4EA]/70 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Entries: {validationResult.entryCount} static files</span>
                      {validationResult.topLevelDirectory && (
                        <span className="text-[#E9C46A]">
                          Root folder normalized: <code className="font-mono">{validationResult.topLevelDirectory}/</code> stripped
                        </span>
                      )}
                      <span>Virtual Origin: appassets.androidplatform.net</span>
                    </p>
                    {/* Asset Breakdown Badges */}
                    {validationResult.assetCounts && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {validationResult.assetCounts.html > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#12372A] border border-[#285943] text-[10px] text-[#F7F4EA]/80 font-mono">
                            HTML: {validationResult.assetCounts.html}
                          </span>
                        )}
                        {validationResult.assetCounts.css > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#12372A] border border-[#285943] text-[10px] text-[#F7F4EA]/80 font-mono">
                            CSS: {validationResult.assetCounts.css}
                          </span>
                        )}
                        {validationResult.assetCounts.js > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#12372A] border border-[#285943] text-[10px] text-[#F7F4EA]/80 font-mono">
                            JS: {validationResult.assetCounts.js}
                          </span>
                        )}
                        {validationResult.assetCounts.images > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#12372A] border border-[#285943] text-[10px] text-[#F7F4EA]/80 font-mono">
                            Images: {validationResult.assetCounts.images}
                          </span>
                        )}
                        {validationResult.assetCounts.fonts > 0 && (
                          <span className="px-2 py-0.5 rounded bg-[#12372A] border border-[#285943] text-[10px] text-[#F7F4EA]/80 font-mono">
                            Fonts: {validationResult.assetCounts.fonts}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="font-semibold text-rose-300">
                      {validationResult.code === 'MISSING_ENTRY_POINT'
                        ? 'Missing Website Entry Point'
                        : validationResult.code === 'INVALID_ZIP_ARCHIVE'
                        ? 'Malformed ZIP Archive'
                        : 'Package Verification Failed'}
                    </p>
                    <p className="text-rose-200/80 mt-1">{validationResult.error}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Warnings Callout */}
            {validationResult.warnings && validationResult.warnings.length > 0 && (
              <div className="mt-1 pt-2 border-t border-[#285943] text-[11px] text-[#E9C46A]/90 space-y-1">
                {validationResult.warnings.map((w, i) => (
                  <p key={i} className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#E9C46A]" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* App Configuration Fields */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#12372A] border border-[#285943] shadow-card space-y-6">
        <h3 className="text-sm font-semibold text-[#F7F4EA] border-b border-[#285943] pb-3 flex items-center gap-2">
          <span>Application Identity</span>
        </h3>

        <AppConfigFields
          config={config}
          onChange={updateConfig}
        />

        <div className="pt-4 border-t border-[#285943]">
          <IconUploader
            iconDataUrl={config.iconDataUrl}
            appName={config.appName}
            themeColor={config.themeColor}
            onChange={(iconDataUrl) => updateConfig({ iconDataUrl })}
          />
        </div>
      </div>

      {/* Advanced Options */}
      <AdvancedOptions
        config={config}
        onChange={updateConfig}
      />

      {/* Submit Action */}
      <div className="pt-2">
        <Button
          type="submit"
          variant="glow"
          size="lg"
          isLoading={isSubmitting}
          disabled={!selectedFile || !validationResult?.valid || !config.appName}
          rightIcon={<ArrowRight className="w-5 h-5 text-[#E9C46A]" />}
          className="w-full text-sm sm:text-base py-3.5 sm:py-4 font-bold"
        >
          {isSubmitting ? 'Packaging & Launching Worker...' : 'Package ZIP to Android APK'}
        </Button>
        <p className="text-center text-xs text-[#F7F4EA]/60 mt-2">
          Deploys assets into <code className="text-[#E9C46A] font-mono">app/src/main/assets/web/</code> and compiles native APK.
        </p>
      </div>
    </form>
  );
};
