import React, { useState } from 'react';
import { AppConfig, UrlValidationResult } from '../../api/types';
import { apiClient } from '../../api';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { AppConfigFields } from './AppConfigFields';
import { IconUploader } from './IconUploader';
import { AdvancedOptions } from './AdvancedOptions';
import { Globe, CheckCircle2, AlertTriangle, ShieldCheck, ArrowRight, Lock } from 'lucide-react';
import { validateUrl } from '../../utils/validators';

interface UrlConversionFormProps {
  initialUrl?: string;
  onSubmit: (url: string, config: AppConfig) => Promise<void>;
  isSubmitting: boolean;
  onConfigChange?: (config: AppConfig) => void;
  onUrlChange?: (url: string) => void;
}

export const UrlConversionForm: React.FC<UrlConversionFormProps> = ({
  initialUrl = '',
  onSubmit,
  isSubmitting,
  onConfigChange,
  onUrlChange,
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);
  const [validationResult, setValidationResult] = useState<UrlValidationResult | null>(null);

  const [config, setConfig] = useState<AppConfig>({
    appName: '',
    packageName: 'com.example.app',
    versionName: '1.0.0',
    versionCode: 1,
    themeColor: '#12372A',
    orientation: 'unspecified',
    enablePullToRefresh: true,
    enableDownloadManager: true,
    enableGeolocation: false,
    enableCamera: false,
    enablePushNotifications: false,
  });

  const urlFormatCheck = validateUrl(url);

  const updateConfig = (updates: Partial<AppConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      onConfigChange?.(next);
      return next;
    });
  };

  const handleVerifyUrl = async () => {
    if (!url || !urlFormatCheck.valid) return;

    setIsValidatingUrl(true);
    setValidationResult(null);

    try {
      const result = await apiClient.validateUrl(url);
      setValidationResult(result);

      // If valid and title/favicon are found, auto-populate app name and icon
      if (result.valid) {
        const updates: Partial<AppConfig> = {};
        if (result.title && !config.appName) {
          updates.appName = result.title;
        }
        if (result.favicon && !config.iconDataUrl) {
          updates.iconDataUrl = result.favicon;
        }
        if (Object.keys(updates).length > 0) {
          updateConfig(updates);
        }
      }
    } catch (e: any) {
      setValidationResult({
        valid: false,
        error: e.message || 'Network error during validation',
      });
    } finally {
      setIsValidatingUrl(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !urlFormatCheck.valid) return;
    await onSubmit(url, config);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Target URL Input Bar */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#12372A] border border-[#285943] shadow-card">
        <label className="block text-xs font-semibold text-[#F7F4EA]/90 uppercase tracking-wider mb-2 flex flex-wrap items-center justify-between gap-1">
          <span className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-[#E9C46A]" />
            <span>Target Website URL</span>
            <span className="text-[#E9C46A]">*</span>
          </span>
          <span className="text-[11px] text-[#F7F4EA]/60 font-normal">Must be a public HTTPS address</span>
        </label>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="https://example.com or https://myapp.dev"
              value={url}
              onChange={(e) => {
                const val = e.target.value;
                setUrl(val);
                onUrlChange?.(val);
                setValidationResult(null);
              }}
              error={url && !urlFormatCheck.valid ? urlFormatCheck.error : undefined}
              leftIcon={<Globe className="w-4 h-4 text-[#F7F4EA]/50" />}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={handleVerifyUrl}
            isLoading={isValidatingUrl}
            disabled={!url || !urlFormatCheck.valid}
            className="w-full sm:w-36 shrink-0"
          >
            Verify & Inspect
          </Button>
        </div>

        {/* Validation Result Feedback Card */}
        {validationResult && (
          <div
            className={`mt-4 p-4 rounded-xl border text-xs flex items-start gap-3 transition-all duration-300 ${
              validationResult.valid
                ? validationResult.warning
                  ? 'bg-amber-950/25 border-amber-500/40 text-amber-100'
                  : 'bg-[#285943]/30 border-[#285943] text-[#F7F4EA]'
                : 'bg-rose-950/20 border-rose-500/30 text-rose-200'
            }`}
          >
            {validationResult.valid ? (
              validationResult.warning ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[#E9C46A] shrink-0 mt-0.5" />
              )
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              {validationResult.valid ? (
                <div>
                  <p className={`font-semibold ${validationResult.warning ? 'text-amber-300' : 'text-[#E9C46A]'}`}>
                    URL Verified & Reachable: {validationResult.title || 'Live Website'}
                  </p>
                  {validationResult.warning && (
                    <p className="text-amber-200/90 mt-1 font-medium bg-amber-900/30 p-1.5 rounded border border-amber-600/30">
                      ⚠️ {validationResult.warning}
                    </p>
                  )}
                  <p className="text-[#F7F4EA]/70 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <span>IP: {validationResult.resolvedIp}</span>
                    <span className="flex items-center gap-1">
                      <Lock className="w-3 h-3 text-[#E9C46A]" /> SSL Certificate: Valid
                    </span>
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-[#E9C46A]" /> SSRF Checked (Public)
                    </span>
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-rose-300">Validation Blocked</p>
                  <p className="text-rose-200/80 mt-1">{validationResult.error}</p>
                </div>
              )}
            </div>
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
          domainHint={(() => {
            try {
              if (!url || typeof url !== 'string' || !url.trim()) return undefined;
              const trimmed = url.trim();
              const fullUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
              const parsed = new URL(fullUrl);
              return parsed.hostname && parsed.hostname.includes('.') ? parsed.hostname : undefined;
            } catch {
              return undefined;
            }
          })()}
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
          disabled={!url || !urlFormatCheck.valid || !config.appName}
          rightIcon={<ArrowRight className="w-5 h-5 text-[#E9C46A]" />}
          className="w-full text-sm sm:text-base py-3.5 sm:py-4 font-bold"
        >
          {isSubmitting ? 'Starting Android Worker Pipeline...' : 'Convert to Android APK'}
        </Button>
        <p className="text-center text-xs text-[#F7F4EA]/60 mt-2">
          Triggers an isolated container worker executing <code className="text-[#E9C46A] font-mono">./gradlew assembleDebug</code>.
        </p>
      </div>
    </form>
  );
};
