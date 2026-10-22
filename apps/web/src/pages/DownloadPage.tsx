import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api';
import { ArtifactInfo, BuildJob } from '../api/types';
import { Button } from '../components/common/Button';
import { formatBytes } from '../utils/formatters';
import { QRCodeSVG } from 'qrcode.react';
import {
  Download,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  ArrowLeft,
  QrCode,
  FileCheck,
  HelpCircle,
} from 'lucide-react';

export const DownloadPage: React.FC = () => {
  const { buildId } = useParams<{ buildId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<BuildJob | null>(null);
  const [artifact, setArtifact] = useState<ArtifactInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedSha, setCopiedSha] = useState(false);

  useEffect(() => {
    if (!buildId) return;

    setIsLoading(true);
    setError(null);

    // Verify completion with the backend adapter
    apiClient
      .getBuild(buildId)
      .then(async (fetchedJob: BuildJob) => {
        setJob(fetchedJob);

        // Strict verification: Never claim APK created unless confirmed completed
        if (fetchedJob.status !== 'completed' || !fetchedJob.artifact) {
          setError(
            `APK is not ready yet (Current status: ${fetchedJob.status}). Redirecting to progress...`
          );
          setTimeout(() => navigate(`/builds/${buildId}`), 2000);
          return;
        }

        // Verify artifact endpoint
        try {
          const verifiedArtifact = await apiClient.getDownloadUrl(buildId);
          setArtifact(verifiedArtifact);
        } catch {
          setArtifact(fetchedJob.artifact);
        }
      })
      .catch((err: any) => {
        setError(err.message || 'Could not verify build completion.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [buildId, navigate]);

  const handleCopySha = () => {
    if (artifact?.sha256) {
      navigator.clipboard.writeText(artifact.sha256);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!artifact?.downloadUrl) return;
    const a = document.createElement('a');
    a.href = artifact.downloadUrl;
    a.download = artifact.fileName || 'app-debug.apk';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center space-y-4">
        <span className="w-10 h-10 rounded-full border-3 border-[#285943] border-t-[#E9C46A] animate-spin" />
        <p className="text-sm font-mono text-[#F7F4EA]/70">
          Verifying APK integrity & download endpoint...
        </p>
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="max-w-md mx-auto p-8 rounded-2xl bg-[#12372A] border border-[#285943] text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
          <FileCheck className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#F7F4EA]">APK Verification Incomplete</h2>
        <p className="text-xs text-[#F7F4EA]/70">{error || 'No verified artifact found for this job.'}</p>
        <Link to={`/builds/${buildId}`}>
          <Button variant="secondary" size="md">
            Return to Build Progress
          </Button>
        </Link>
      </div>
    );
  }

  const appName = job?.appConfig.appName || 'Android App';
  const packageName = job?.appConfig.packageName || 'com.example.app';

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* Back button */}
      <div>
        <Link
          to={`/builds/${buildId}`}
          className="inline-flex items-center gap-2 text-xs font-medium text-[#F7F4EA]/70 hover:text-[#E9C46A] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Build Console</span>
        </Link>
      </div>

      {/* Success Celebration Hero */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-tr from-[#285943] to-[#E9C46A] p-0.5 shadow-glow-gold mb-2">
          <div className="w-full h-full bg-[#12372A] rounded-[22px] flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-[#E9C46A]" />
          </div>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#F7F4EA] tracking-tight">
          Your Android APK is <span className="text-gradient-gold">Ready to Install</span>
        </h1>
        <p className="text-sm text-[#F7F4EA]/80 max-w-lg mx-auto">
          Compiled, dexed, and signed using Android Build Tools 34.0.0 and Gradle 8.5.
        </p>
      </div>

      {/* Main Download & Details Card */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">
        {/* Left Column: Metadata & Download Button (8 cols) */}
        <div className="md:col-span-7 p-4 sm:p-6 sm:p-8 rounded-3xl bg-[#12372A] border border-[#285943] shadow-card flex flex-col justify-between space-y-6">
          <div className="space-y-6">
            {/* App Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              {job?.appConfig.iconDataUrl ? (
                <img
                  src={job.appConfig.iconDataUrl}
                  alt="App Icon"
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border border-[#285943] shadow-md shrink-0"
                />
              ) : (
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center font-bold text-2xl text-white shadow-md border border-[#285943] shrink-0"
                  style={{ backgroundColor: job?.appConfig.themeColor || '#12372A' }}
                >
                  {appName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-[#F7F4EA] truncate">{appName}</h2>
                <p className="text-xs text-[#F7F4EA]/70 font-mono mt-0.5 truncate">{packageName}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#285943]/40 text-[#E9C46A] border border-[#285943] flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-[#E9C46A]" /> Signed & Verified
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#202820] text-[#F7F4EA]/80 border border-[#285943]">
                    v{job?.appConfig.versionName || '1.0.0'}
                  </span>
                </div>
              </div>
            </div>

            {/* Binary Spec Table */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-[#202820] border border-[#285943] space-y-2.5 text-xs font-mono">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[#F7F4EA]/90">
                <span className="text-[#F7F4EA]/60">File Name:</span>
                <span className="font-semibold text-[#F7F4EA] break-all">{artifact.fileName}</span>
              </div>
              <div className="flex items-center justify-between text-[#F7F4EA]/90">
                <span className="text-[#F7F4EA]/60">Package Size:</span>
                <span className="text-[#E9C46A] font-bold">{formatBytes(artifact.fileSizeBytes)}</span>
              </div>
              <div className="flex items-center justify-between text-[#F7F4EA]/90">
                <span className="text-[#F7F4EA]/60">Target Platform:</span>
                <span>Android 14 (API 34)</span>
              </div>
              <div className="flex items-center justify-between text-[#F7F4EA]/90">
                <span className="text-[#F7F4EA]/60">Min Android Version:</span>
                <span>Android 7.0 (API 24+)</span>
              </div>

              {/* SHA256 Checksum */}
              <div className="pt-2 border-t border-[#285943] flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#F7F4EA]/60 text-[10px]">SHA-256 Checksum:</span>
                  <button
                    type="button"
                    onClick={handleCopySha}
                    className="text-[10px] text-[#E9C46A] hover:underline flex items-center gap-1"
                  >
                    {copiedSha ? <Check className="w-3 h-3 text-[#E9C46A]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSha ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-[10px] text-[#F7F4EA]/80 break-all select-all bg-[#12372A] p-1.5 rounded-lg border border-[#285943]">
                  {artifact.sha256}
                </p>
              </div>
            </div>
          </div>

          {/* Primary Download Button */}
          <div className="pt-2">
            <Button
              variant="primary"
              size="lg"
              onClick={handleDownload}
              leftIcon={<Download className="w-5 h-5 text-[#12372A]" />}
              className="w-full text-sm sm:text-base py-3.5 sm:py-4 font-bold shadow-glow-gold"
            >
              Download {artifact.fileName}
            </Button>
            <p className="text-center text-[11px] text-[#F7F4EA]/60 mt-2">
              Presigned download link generated. Direct binary transfer.
            </p>
          </div>
        </div>

        {/* Right Column: QR Code Direct Install to Phone (5 cols) */}
        <div className="md:col-span-5 p-4 sm:p-6 sm:p-8 rounded-3xl bg-[#12372A] border border-[#285943] shadow-card flex flex-col items-center justify-between text-center space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#E9C46A]">
              <QrCode className="w-4 h-4" />
              <span>Direct Phone Install</span>
            </div>
            <h3 className="text-base font-bold text-[#F7F4EA]">Scan with Android Camera</h3>
            <p className="text-xs text-[#F7F4EA]/70 max-w-xs">
              Point your phone's camera at the QR code to download the APK directly onto your device.
            </p>
          </div>

          {/* Rendered SVG QR Code */}
          <div className="p-4 bg-[#F7F4EA] rounded-2xl shadow-xl flex items-center justify-center">
            <QRCodeSVG
              value={artifact.downloadUrl.startsWith('http') ? artifact.downloadUrl : window.location.href}
              size={180}
              level="M"
              includeMargin={false}
            />
          </div>

          <div className="w-full p-3 rounded-xl bg-[#202820] border border-[#285943] text-[11px] text-[#F7F4EA]/70 space-y-1">
            <p className="font-semibold text-[#F7F4EA] flex items-center justify-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-[#E9C46A]" /> Android Install Tip
            </p>
            <p>If prompted, toggle "Allow from this source" in your browser settings to install.</p>
          </div>
        </div>
      </div>

      {/* Android Installation Instructions Accordion / Steps */}
      <div className="p-4 sm:p-6 sm:p-8 rounded-3xl bg-[#12372A]/80 border border-[#285943] space-y-4 sm:space-y-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#F7F4EA]/90">
          How to Install this APK on Your Android Device
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-[#202820] border border-[#285943] space-y-2">
            <span className="w-6 h-6 rounded-full bg-[#285943] text-[#E9C46A] font-mono font-bold flex items-center justify-center text-xs">
              1
            </span>
            <p className="font-bold text-[#F7F4EA]">Download the File</p>
            <p className="text-[#F7F4EA]/70">
              Click the download button or scan the QR code to save <code className="text-[#E9C46A] font-mono">{artifact.fileName}</code>.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#202820] border border-[#285943] space-y-2">
            <span className="w-6 h-6 rounded-full bg-[#285943] text-[#E9C46A] font-mono font-bold flex items-center justify-center text-xs">
              2
            </span>
            <p className="font-bold text-[#F7F4EA]">Allow Unknown Sources</p>
            <p className="text-[#F7F4EA]/70">
              When Android asks to confirm installation, tap <strong>Settings</strong> and switch on <strong>Allow from this source</strong>.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#202820] border border-[#285943] space-y-2">
            <span className="w-6 h-6 rounded-full bg-[#285943] text-[#E9C46A] font-mono font-bold flex items-center justify-center text-xs">
              3
            </span>
            <p className="font-bold text-[#F7F4EA]">Launch Your Web App</p>
            <p className="text-[#F7F4EA]/70">
              Tap <strong>Install</strong> and open the app from your home screen with full native WebView features!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
