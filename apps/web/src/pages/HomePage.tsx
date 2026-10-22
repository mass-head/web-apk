import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UrlConversionForm } from '../components/forms/UrlConversionForm';
import { ZipConversionForm } from '../components/forms/ZipConversionForm';
import { AndroidDevicePreview } from '../components/preview/AndroidDevicePreview';
import { AppConfig } from '../api/types';
import { apiClient } from '../api';
import { saveRecentBuild } from '../utils/storage';
import { Globe, FileArchive, Cpu, ShieldCheck, Zap, Sparkles } from 'lucide-react';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'url' | 'upload'>('url');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live preview state
  const [previewConfig, setPreviewConfig] = useState<AppConfig>({
    appName: 'My Web App',
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
  const [previewUrl, setPreviewUrl] = useState<string>('https://example.com');

  const handleUrlSubmit = async (url: string, config: AppConfig) => {
    setIsSubmitting(true);
    try {
      const res = await apiClient.createUrlBuild({ url, appConfig: config });
      saveRecentBuild({
        buildId: res.buildId,
        mode: 'url',
        appName: config.appName,
        packageName: config.packageName,
        target: url,
        status: res.status,
        createdAt: new Date().toISOString(),
        iconDataUrl: config.iconDataUrl,
        themeColor: config.themeColor,
      });
      navigate(`/builds/${res.buildId}`);
    } catch (err: any) {
      alert(`Build trigger failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleZipSubmit = async (file: File, config: AppConfig) => {
    setIsSubmitting(true);
    try {
      const res = await apiClient.createUploadBuild({
        file,
        appConfig: config,
      });

      saveRecentBuild({
        buildId: res.buildId,
        mode: 'upload',
        appName: config.appName,
        packageName: config.packageName,
        target: file.name,
        status: res.status,
        createdAt: new Date().toISOString(),
        iconDataUrl: config.iconDataUrl,
        themeColor: config.themeColor,
      });

      navigate(`/builds/${res.buildId}`);
    } catch (err: any) {
      alert(`Upload build trigger failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#285943]/40 border border-[#285943] text-[#E9C46A] text-[11px] sm:text-xs font-mono max-w-full">
          <Sparkles className="w-3.5 h-3.5 text-[#E9C46A] shrink-0" />
          <span className="truncate">Real Android Gradle 8.5 Build System • Isolated Workers</span>
        </div>

        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#F7F4EA] leading-tight break-words">
          Turn Any Website Into a{' '}
          <span className="text-gradient-gold">Native Android APK</span>
        </h1>

        <p className="text-sm sm:text-base lg:text-lg text-[#F7F4EA]/80 max-w-2xl mx-auto leading-relaxed">
          Produce production-grade Android binaries targeting SDK 34. Convert live public URLs or package static ZIP archives with zero client-side simulation.
        </p>

        {/* Feature Highlights */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs font-medium text-[#F7F4EA]">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#12372A] border border-[#285943]">
            <Cpu className="w-3.5 h-3.5 text-[#E9C46A]" /> Headless Gradle Worker
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#12372A] border border-[#285943]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#E9C46A]" /> SSRF & Zip Slip Hardened
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#12372A] border border-[#285943]">
            <Zap className="w-3.5 h-3.5 text-[#E9C46A]" /> 100% Native WebView
          </span>
        </div>
      </div>

      {/* Main Conversion Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Form Wizard Column (Left 8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Mode Tabs */}
          <div className="p-1 sm:p-1.5 bg-[#12372A] border border-[#285943] rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2 shadow-card">
            <button
              type="button"
              onClick={() => setActiveTab('url')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 ${
                activeTab === 'url'
                  ? 'bg-[#285943] text-[#E9C46A] border border-[#E9C46A]/40 shadow-glow-gold'
                  : 'text-[#F7F4EA]/70 hover:text-[#F7F4EA] hover:bg-[#202820]/40'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>Website URL Mode</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 ${
                activeTab === 'upload'
                  ? 'bg-[#285943] text-[#E9C46A] border border-[#E9C46A]/40 shadow-glow-gold'
                  : 'text-[#F7F4EA]/70 hover:text-[#F7F4EA] hover:bg-[#202820]/40'
              }`}
            >
              <FileArchive className="w-4 h-4" />
              <span>Upload Website ZIP</span>
            </button>
          </div>

          {/* Active Mode Form */}
          {activeTab === 'url' ? (
            <UrlConversionForm
              initialUrl="https://"
              onSubmit={handleUrlSubmit}
              isSubmitting={isSubmitting}
              onConfigChange={setPreviewConfig}
              onUrlChange={setPreviewUrl}
            />
          ) : (
            <ZipConversionForm
              onSubmit={handleZipSubmit}
              isSubmitting={isSubmitting}
              onConfigChange={setPreviewConfig}
            />
          )}
        </div>

        {/* Live Device Mockup Preview Column (Right 4 cols) */}
        <div className="lg:col-span-4 lg:sticky lg:top-24 mt-4 lg:mt-0">
          <div className="p-4 sm:p-6 rounded-3xl bg-[#12372A]/80 border border-[#285943] shadow-card flex flex-col items-center w-full">
            <AndroidDevicePreview
              config={previewConfig}
              targetUrl={activeTab === 'url' ? previewUrl : undefined}
              isUploadMode={activeTab === 'upload'}
            />
            <p className="mt-4 text-[11px] text-center text-[#F7F4EA]/60 max-w-xs">
              Preview updates dynamically as you fill out app identity, custom icon, and status bar color.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
