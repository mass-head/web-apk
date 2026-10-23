import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api';
import { ArtifactInfo, BuildJob } from '../api/types';
import { formatBytes } from '../utils/formatters';
import {
  Download,
  ShieldCheck,
  CheckCircle2,
  Globe,
  FileBox,
  Check,
  Sparkles,
  Smartphone,
  AlertCircle,
} from 'lucide-react';

export const MobileDownloadPage: React.FC = () => {
  const { buildId } = useParams<{ buildId: string }>();

  const [job, setJob] = useState<BuildJob | null>(null);
  const [artifact, setArtifact] = useState<ArtifactInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);

  useEffect(() => {
    if (!buildId) return;

    setIsLoading(true);
    setError(null);

    apiClient
      .getBuild(buildId)
      .then(async (fetchedJob: BuildJob) => {
        setJob(fetchedJob);

        if (fetchedJob.status !== 'completed' || !fetchedJob.artifact) {
          setError(`APK is not ready yet (Current status: ${fetchedJob.status}).`);
          return;
        }

        try {
          const verifiedArtifact = await apiClient.getDownloadUrl(buildId);
          setArtifact(verifiedArtifact);
        } catch {
          setArtifact(fetchedJob.artifact);
        }
      })
      .catch((err: any) => {
        setError(err.message || 'Could not load app details.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [buildId]);

  const handleDownload = () => {
    if (!artifact?.downloadUrl) return;

    setDownloadStarted(true);
    setTimeout(() => setDownloadStarted(false), 3500);

    // Resolve absolute download URL
    const fullUrl = artifact.downloadUrl.startsWith('http')
      ? artifact.downloadUrl
      : `${window.location.origin}${artifact.downloadUrl}`;

    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = artifact.fileName || `${(job?.appConfig.appName || 'app').toLowerCase().replace(/[^a-z0-9]/g, '-')}.apk`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Helper to extract a friendly "By" source
  const getSourceDisplay = () => {
    if (job?.targetUrl) {
      try {
        const parsed = new URL(job.targetUrl);
        return {
          type: 'url',
          text: parsed.hostname.replace(/^www\./, ''),
          full: job.targetUrl,
        };
      } catch {
        return { type: 'url', text: job.targetUrl, full: job.targetUrl };
      }
    }
    if (job?.uploadedFileName) {
      return {
        type: 'upload',
        text: job.uploadedFileName,
        full: job.uploadedFileName,
      };
    }
    return { type: 'brand', text: 'Web2APK', full: '' };
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#202820] text-[#F7F4EA] flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-full border-3 border-[#285943] border-t-[#E9C46A] animate-spin mb-4" />
        <p className="text-sm font-medium text-[#F7F4EA]/80">Loading app download...</p>
      </div>
    );
  }

  if (error || !artifact || !job) {
    return (
      <div className="min-h-screen bg-[#202820] text-[#F7F4EA] flex items-center justify-center p-4">
        <div className="w-full max-w-sm p-6 sm:p-8 rounded-3xl bg-[#12372A] border border-[#285943] text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/15 text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-[#F7F4EA]">App Not Ready</h2>
          <p className="text-xs text-[#F7F4EA]/70">{error || 'Could not locate the APK artifact for this build.'}</p>
        </div>
      </div>
    );
  }

  const appName = job.appConfig.appName || 'Android Application';
  const packageName = job.appConfig.packageName || 'com.example.app';
  const versionName = job.appConfig.versionName || '1.0.0';
  const themeColor = job.appConfig.themeColor || '#12372A';
  const source = getSourceDisplay();

  return (
    <div className="min-h-screen bg-[#202820] text-[#F7F4EA] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* Subtle ambient background glow */}
      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 w-80 h-80 bg-[#E9C46A]/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-1/4 left-1/2 -translate-x-1/2 w-80 h-80 bg-[#285943]/20 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Main Single App Download Card */}
      <div className="w-full max-w-sm rounded-3xl bg-[#12372A] border border-[#285943] p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center space-y-6 animate-fade-in relative">
        
        {/* Verified Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#285943]/40 border border-[#285943] text-[11px] font-mono text-[#E9C46A]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#E9C46A]" />
          <span>Android APK Ready</span>
        </div>

        {/* 1. App Logo */}
        <div className="relative group">
          {job.appConfig.iconDataUrl ? (
            <img
              src={job.appConfig.iconDataUrl}
              alt={appName}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover border-2 border-[#285943] shadow-xl"
            />
          ) : (
            <div
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl flex items-center justify-center text-4xl sm:text-5xl font-extrabold text-white shadow-xl border-2 border-[#285943]"
              style={{ backgroundColor: themeColor }}
            >
              {appName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#285943] border-2 border-[#12372A] flex items-center justify-center text-[#E9C46A] shadow">
            <Smartphone className="w-4 h-4" />
          </div>
        </div>

        {/* 2. App Name & 3. By Who */}
        <div className="space-y-1.5 w-full">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#F7F4EA] tracking-tight truncate px-1">
            {appName}
          </h1>

          {/* "By Who" Source / Creator */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-[#E9C46A] font-medium truncate px-2">
            {source.type === 'url' ? (
              <>
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">By {source.text}</span>
              </>
            ) : source.type === 'upload' ? (
              <>
                <FileBox className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">By {source.text}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>By Web2APK</span>
              </>
            )}
          </div>

          <p className="text-[11px] font-mono text-[#F7F4EA]/50 truncate">{packageName}</p>
        </div>

        {/* Quick Spec Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-mono">
          <span className="px-3 py-1 rounded-xl bg-[#202820] text-[#E9C46A] font-semibold border border-[#285943]">
            {formatBytes(artifact.fileSizeBytes)}
          </span>
          <span className="px-3 py-1 rounded-xl bg-[#202820] text-[#F7F4EA]/80 border border-[#285943]">
            v{versionName}
          </span>
        </div>

        {/* 4. Download APK Button */}
        <div className="w-full pt-2 space-y-3">
          <button
            type="button"
            onClick={handleDownload}
            className={`w-full py-4 px-6 rounded-2xl font-extrabold text-base transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
              downloadStarted
                ? 'bg-emerald-500 text-white shadow-emerald-500/30'
                : 'bg-gradient-to-r from-[#E9C46A] to-[#f39c12] text-[#12372A] hover:brightness-105 active:scale-[0.98] shadow-glow-gold'
            }`}
          >
            {downloadStarted ? (
              <>
                <Check className="w-5 h-5 text-white" />
                <span>Downloading APK...</span>
              </>
            ) : (
              <>
                <Download className="w-5 h-5 text-[#12372A]" />
                <span>Download APK</span>
              </>
            )}
          </button>

          <p className="text-[11px] text-[#F7F4EA]/60">
            Tap the button above to save the APK to your device.
          </p>
        </div>

        {/* Simple Android Install Tip */}
        <div className="w-full p-3 rounded-2xl bg-[#202820]/70 border border-[#285943]/60 text-[11px] text-[#F7F4EA]/70 text-left space-y-1">
          <p className="font-semibold text-[#F7F4EA] flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#E9C46A]" /> Easy Install Tip
          </p>
          <p className="leading-relaxed">
            Open the downloaded file. If prompted, allow "Install unknown apps" in settings.
          </p>
        </div>
      </div>

      {/* Clean footer attribution */}
      <div className="mt-6 text-center text-xs font-mono text-[#F7F4EA]/40">
        Powered by Web2APK
      </div>
    </div>
  );
};

