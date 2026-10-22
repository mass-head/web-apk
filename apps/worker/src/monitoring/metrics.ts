export interface WorkerMetricsData {
  jobsTotal: {
    completed: number;
    failed: number;
    cancelled: number;
  };
  activeBuilds: number;
  buildDuration: {
    count: number;
    sumMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
  };
  memoryUsageMb: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  uptimeSeconds: number;
}

export class WorkerMetrics {
  private completedCount = 0;
  private failedCount = 0;
  private cancelledCount = 0;
  private activeCount = 0;
  private durations: number[] = [];
  private startTime = Date.now();

  recordJobStarted(): void {
    this.activeCount++;
  }

  recordJobCompleted(durationMs: number): void {
    if (this.activeCount > 0) this.activeCount--;
    this.completedCount++;
    this.recordDuration(durationMs);
  }

  recordJobFailed(durationMs: number): void {
    if (this.activeCount > 0) this.activeCount--;
    this.failedCount++;
    this.recordDuration(durationMs);
  }

  recordJobCancelled(durationMs: number): void {
    if (this.activeCount > 0) this.activeCount--;
    this.cancelledCount++;
    this.recordDuration(durationMs);
  }

  private recordDuration(durationMs: number): void {
    this.durations.push(durationMs);
    // Keep last 1,000 durations to bound memory
    if (this.durations.length > 1000) {
      this.durations.shift();
    }
  }

  getSnapshot(): WorkerMetricsData {
    const mem = process.memoryUsage();
    const count = this.durations.length;
    const sumMs = this.durations.reduce((acc, v) => acc + v, 0);
    const avgMs = count > 0 ? Math.round(sumMs / count) : 0;
    const minMs = count > 0 ? Math.min(...this.durations) : 0;
    const maxMs = count > 0 ? Math.max(...this.durations) : 0;

    return {
      jobsTotal: {
        completed: this.completedCount,
        failed: this.failedCount,
        cancelled: this.cancelledCount,
      },
      activeBuilds: this.activeCount,
      buildDuration: {
        count,
        sumMs,
        avgMs,
        minMs,
        maxMs,
      },
      memoryUsageMb: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      },
      uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
    };
  }

  toPrometheusFormat(): string {
    const s = this.getSnapshot();
    const lines = [
      '# HELP web2apk_worker_jobs_total Total conversion jobs processed by status',
      '# TYPE web2apk_worker_jobs_total counter',
      `web2apk_worker_jobs_total{status="completed"} ${s.jobsTotal.completed}`,
      `web2apk_worker_jobs_total{status="failed"} ${s.jobsTotal.failed}`,
      `web2apk_worker_jobs_total{status="cancelled"} ${s.jobsTotal.cancelled}`,
      '',
      '# HELP web2apk_worker_active_builds Currently running Android build jobs',
      '# TYPE web2apk_worker_active_builds gauge',
      `web2apk_worker_active_builds ${s.activeBuilds}`,
      '',
      '# HELP web2apk_worker_build_duration_ms Build duration statistics in milliseconds',
      '# TYPE web2apk_worker_build_duration_ms summary',
      `web2apk_worker_build_duration_ms_count ${s.buildDuration.count}`,
      `web2apk_worker_build_duration_ms_sum ${s.buildDuration.sumMs}`,
      `web2apk_worker_build_duration_ms_avg ${s.buildDuration.avgMs}`,
      '',
      '# HELP web2apk_worker_memory_bytes Worker process memory consumption',
      '# TYPE web2apk_worker_memory_bytes gauge',
      `web2apk_worker_memory_bytes{type="heap_used"} ${process.memoryUsage().heapUsed}`,
      `web2apk_worker_memory_bytes{type="rss"} ${process.memoryUsage().rss}`,
      '',
      '# HELP web2apk_worker_uptime_seconds Worker uptime in seconds',
      '# TYPE web2apk_worker_uptime_seconds counter',
      `web2apk_worker_uptime_seconds ${s.uptimeSeconds}`,
    ];

    return lines.join('\n') + '\n';
  }
}

export const metrics = new WorkerMetrics();
