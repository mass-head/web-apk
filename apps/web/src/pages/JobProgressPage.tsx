import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../api';
import {
  ArtifactInfo,
  BuildJob,
  BuildLogEntry,
  BuildStatus,
} from '../api/types';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { BuildTerminal } from '../components/terminal/BuildTerminal';
import { updateRecentBuildStatus } from '../utils/storage';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  ArrowRight,
  RotateCcw,
  StopCircle,
  Cpu,
} from 'lucide-react';

const PIPELINE_STAGES: { key: BuildStatus; label: string; desc: string }[] = [
  { key: 'queued', label: 'Queued', desc: 'Waiting in BullMQ broker' },
  { key: 'validating', label: 'Validating', desc: 'SSRF & Zip inspection' },
  { key: 'generating', label: 'Scaffolding', desc: 'Android Kotlin template' },
  { key: 'building', label: 'Compiling', desc: 'Gradle 8.5 assemble' },
  { key: 'completed', label: 'Ready', desc: 'APK packaged & signed' },
];

export const JobProgressPage: React.FC = () => {
  const { buildId } = useParams<{ buildId: string }>();

  const [job, setJob] = useState<BuildJob | null>(null);
  const [logs, setLogs] = useState<BuildLogEntry[]>([]);
  const [currentStatus, setCurrentStatus] = useState<BuildStatus>('queued');
  const [progress, setProgress] = useState<number>(5);
  const [stageName, setStageName] = useState<string>('Allocating build resources');
  const [artifact, setArtifact] = useState<ArtifactInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const lastActiveStageRef = React.useRef<number>(0);

  const getStageIndex = (status: BuildStatus, currentStageName?: string, currentProg?: number): number => {
    switch (status) {
      case 'queued':
        return 0;
      case 'validating':
        return 1;
      case 'generating':
        return 2;
      case 'building':
        return 3;
      case 'completed':
        return 4;
      case 'failed':
      case 'cancelled': {
        if (lastActiveStageRef.current > 0) {
          return lastActiveStageRef.current;
        }
        const lower = (currentStageName || '').toLowerCase();
        if (
          lower.includes('compil') ||
          lower.includes('gradle') ||
          lower.includes('package') ||
          lower.includes('assemble') ||
          lower.includes('dex') ||
          lower.includes('apk') ||
          (currentProg !== undefined && currentProg >= 40)
        ) {
          return 3;
        }
        if (
          lower.includes('scaffold') ||
          lower.includes('template') ||
          lower.includes('icon') ||
          lower.includes('manifest') ||
          (currentProg !== undefined && currentProg >= 25 && currentProg < 40)
        ) {
          return 2;
        }
        if (
          lower.includes('validat') ||
          lower.includes('ssrf') ||
          lower.includes('inspect') ||
          lower.includes('reachability') ||
          (currentProg !== undefined && currentProg >= 10 && currentProg < 25)
        ) {
          return 1;
        }
        return 0;
      }
      default:
        return 0;
    }
  };

  useEffect(() => {
    if (!buildId) return;

    // Fetch initial job state
    apiClient
      .getBuild(buildId)
      .then((initial: BuildJob) => {
        if (initial.status !== 'failed' && initial.status !== 'cancelled') {
          lastActiveStageRef.current = getStageIndex(initial.status, initial.stageName, initial.progressPercentage);
        }
        setJob(initial);
        setCurrentStatus(initial.status);
        setProgress(initial.progressPercentage);
        setStageName(initial.stageName);
        if (initial.logs) setLogs(initial.logs);
        if (initial.artifact) setArtifact(initial.artifact);
        if (initial.errorMessage) setErrorMessage(initial.errorMessage);
      })
      .catch((err: any) => {
        console.warn('Initial job fetch fallback:', err);
      });

    // Subscribe to real-time build telemetry stream
    const unsubscribe = apiClient.subscribeToLogs(buildId, {
      onLog: (newLog: BuildLogEntry) => {
        setLogs((prev) => [...prev, newLog]);
      },
      onStatusChange: (status: BuildStatus, prog: number, stage: string) => {
        if (status !== 'failed' && status !== 'cancelled') {
          lastActiveStageRef.current = getStageIndex(status, stage, prog);
        }
        setCurrentStatus(status);
        setProgress(prog);
        setStageName(stage);
        updateRecentBuildStatus(buildId, { status });
      },
      onComplete: (completedArtifact: ArtifactInfo) => {
        lastActiveStageRef.current = 4;
        setCurrentStatus('completed');
        setProgress(100);
        setArtifact(completedArtifact);
        updateRecentBuildStatus(buildId, {
          status: 'completed',
          artifact: completedArtifact,
          completedAt: new Date().toISOString(),
        });
      },
      onError: (err: string) => {
        setCurrentStatus('failed');
        setErrorMessage(err);
        updateRecentBuildStatus(buildId, { status: 'failed' });
      },
    });

    // Fallback polling interval every 2.5 seconds to guarantee UI updates even if SSE hiccups
    const pollInterval = setInterval(async () => {
      try {
        const updated = await apiClient.getBuild(buildId);
        if (updated) {
          if (updated.status !== 'failed' && updated.status !== 'cancelled') {
            lastActiveStageRef.current = getStageIndex(updated.status, updated.stageName, updated.progressPercentage);
          }
          setJob(updated);
          setCurrentStatus(updated.status);
          setProgress(updated.progressPercentage);
          setStageName(updated.stageName);
          if (updated.logs && updated.logs.length > logs.length) {
            setLogs(updated.logs);
          }
          if (updated.artifact) {
            setArtifact(updated.artifact);
            updateRecentBuildStatus(buildId, {
              status: 'completed',
              artifact: updated.artifact,
              completedAt: updated.completedAt || new Date().toISOString(),
            });
            clearInterval(pollInterval);
          }
          if (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled') {
            clearInterval(pollInterval);
          }
          if (updated.errorMessage) {
            setErrorMessage(updated.errorMessage);
          }
        }
      } catch {
        // Ignore background polling errors
      }
    }, 2500);

    return () => {
      clearInterval(pollInterval);
      unsubscribe();
    };
  }, [buildId]);

  const handleCancel = async () => {
    if (!buildId) return;
    setIsCancelling(true);
    try {
      await apiClient.cancelBuild(buildId);
      setCurrentStatus('cancelled');
      setStageName('Cancelled by user');
      updateRecentBuildStatus(buildId, { status: 'cancelled' });
    } catch (e: any) {
      alert(`Could not cancel build: ${e.message}`);
    } finally {
      setIsCancelling(false);
    }
  };

  const activeIndex = getStageIndex(currentStatus, stageName, progress);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Top Header Card */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#12372A] border border-[#285943] shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-[#F7F4EA] font-mono flex items-center gap-2">
              <span>Build Job</span>
              <span className="text-[#E9C46A]">#{buildId}</span>
            </h1>
            <Badge status={currentStatus} />
          </div>

          <p className="text-xs text-[#F7F4EA]/70 mt-1 font-mono">
            {job?.appConfig.appName ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                <span className="truncate">
                  App: <strong>{job.appConfig.appName}</strong> ({job.appConfig.packageName})
                </span>
                {job.mode === 'upload' && (
                  <span className="text-[#E9C46A] truncate">
                    • Mode: Local ZIP Asset ({job.uploadedFileName || 'archive.zip'})
                  </span>
                )}
                {job.mode === 'url' && job.targetUrl && (
                  <span
                    className="text-[#E9C46A] truncate max-w-full sm:max-w-md lg:max-w-xl inline-block align-bottom"
                    title={job.targetUrl}
                  >
                    • Remote URL: {job.targetUrl}
                  </span>
                )}
              </span>
            ) : (
              <span>Processing Android compile request</span>
            )}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
          {currentStatus === 'completed' && artifact && (
            <Link to={`/builds/${buildId}/download`} className="w-full sm:w-auto">
              <Button
                variant="glow"
                size="md"
                rightIcon={<ArrowRight className="w-4 h-4 text-[#E9C46A]" />}
                className="w-full sm:w-auto"
              >
                View Generated APK
              </Button>
            </Link>
          )}

          {currentStatus === 'failed' && (
            <Link to="/" className="w-full sm:w-auto">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<RotateCcw className="w-4 h-4 text-[#E9C46A]" />}
                className="w-full sm:w-auto"
              >
                Try Again
              </Button>
            </Link>
          )}

          {currentStatus !== 'completed' && currentStatus !== 'failed' && currentStatus !== 'cancelled' && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleCancel}
              isLoading={isCancelling}
              leftIcon={<StopCircle className="w-4 h-4" />}
              className="w-full sm:w-auto"
            >
              Cancel Build
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar & Stage Stepper */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#12372A] border border-[#285943] shadow-card space-y-4 sm:space-y-6">
        <div>
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-2">
            <span className="text-[#F7F4EA]/90 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#E9C46A]" />
              <span>Current Stage: <strong className="text-[#F7F4EA] normal-case font-mono">{stageName}</strong></span>
            </span>
            <span className="font-mono text-[#E9C46A] font-bold">{progress}%</span>
          </div>

          {/* Animated Gradient Progress Bar */}
          <div className="w-full h-3 rounded-full bg-[#202820] overflow-hidden p-0.5 border border-[#285943]">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                currentStatus === 'failed'
                  ? 'bg-rose-500'
                  : currentStatus === 'completed'
                  ? 'bg-[#285943]'
                  : 'bg-gradient-to-r from-[#285943] via-[#E9C46A] to-[#E9C46A] shadow-glow-gold'
              }`}
              style={{ width: `${Math.max(progress, 5)}%` }}
            />
          </div>
        </div>

        {/* 5-Stage Visual Stepper */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3 pt-2">
          {PIPELINE_STAGES.map((stg, idx) => {
            const isFinished = currentStatus === 'completed' || idx < activeIndex;
            const isCurrent = idx === activeIndex && currentStatus !== 'completed' && currentStatus !== 'failed';
            const isFailed = currentStatus === 'failed' && idx === activeIndex;

            return (
              <div
                key={stg.key}
                className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all ${
                  idx === 4 ? 'col-span-2 sm:col-span-1 md:col-span-1' : ''
                } ${
                  isFinished
                    ? 'bg-[#285943]/40 border-[#285943] text-[#F7F4EA]'
                    : isCurrent
                    ? 'bg-[#285943] border-[#E9C46A] text-[#E9C46A] shadow-glow-gold'
                    : isFailed
                    ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                    : 'bg-[#202820] border-[#285943]/60 text-[#F7F4EA]/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] uppercase font-bold">
                    Step {idx + 1}
                  </span>
                  {isFinished ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#E9C46A]" />
                  ) : isFailed ? (
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  ) : isCurrent ? (
                    <span className="w-2 h-2 rounded-full bg-[#E9C46A] animate-ping" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#285943]" />
                  )}
                </div>
                <p className="text-xs font-bold text-[#F7F4EA]">{stg.label}</p>
                <p className="text-[10px] text-[#F7F4EA]/60 mt-0.5 truncate">{stg.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Failure Diagnostic Card */}
      {currentStatus === 'failed' && (
        <div className="p-4 sm:p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-200 shadow-card space-y-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-rose-400 shrink-0" />
            <h3 className="text-base font-bold text-rose-300">Compilation Pipeline Halted</h3>
          </div>
          <p className="text-xs text-rose-200/90 font-mono bg-[#202820] p-3 rounded-xl border border-rose-500/20 break-words">
            {errorMessage || 'Unknown error occurred in Android Gradle compilation task.'}
          </p>
          <div className="flex items-center gap-4 pt-2">
            <Link to="/" className="w-full sm:w-auto">
              <Button variant="secondary" size="sm" className="w-full sm:w-auto">
                Modify App Config & Retry
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Real-time Streaming Compiler Terminal */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-[#F7F4EA]/80 uppercase tracking-wider">
            Worker Compiler Telemetry (Live Stream)
          </h2>
          <span className="text-[11px] font-mono text-[#E9C46A] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#E9C46A] animate-pulse" />
            <span>Redis Pub/Sub</span>
          </span>
        </div>

        <BuildTerminal
          logs={logs}
          stageName={stageName}
          isCompleted={currentStatus === 'completed'}
        />
      </div>
    </div>
  );
};
