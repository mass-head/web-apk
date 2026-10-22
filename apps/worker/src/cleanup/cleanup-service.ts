import fs from 'node:fs';
import path from 'node:path';
import { workerEnv } from '../config/worker-env.js';
import { workspaceManager } from '../builder/isolated-workspace.js';
import { logger } from '../monitoring/logger.js';
import { storageService } from '../storage/storage-service.js';

export class CleanupService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  async runCleanupCycle(): Promise<{
    sweptWorkspaces: number;
    sweptUploads: number;
    sweptArtifacts: number;
  }> {
    if (this.isRunning) {
      return { sweptWorkspaces: 0, sweptUploads: 0, sweptArtifacts: 0 };
    }

    this.isRunning = true;
    let sweptWorkspaces = 0;
    let sweptUploads = 0;
    let sweptArtifacts = 0;

    try {
      // 1. Sweep orphaned build workspaces
      sweptWorkspaces = workspaceManager.sweepOrphaned(workerEnv.ORPHAN_BUILD_MAX_AGE_MS);

      // 2. Sweep expired local storage files (if using local storage)
      if (workerEnv.STORAGE_DRIVER === 'local' && fs.existsSync(workerEnv.LOCAL_STORAGE_DIR)) {
        const now = Date.now();
        const maxAgeUploadsMs = 24 * 60 * 60 * 1000; // 24 hours
        const maxAgeArtifactsMs = workerEnv.ARTIFACT_TTL_HOURS * 60 * 60 * 1000;

        const sweepDir = (dirPath: string, maxAgeMs: number): number => {
          if (!fs.existsSync(dirPath)) return 0;
          let count = 0;
          const items = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            try {
              const stat = fs.statSync(fullPath);
              if (now - stat.mtimeMs > maxAgeMs) {
                if (item.isDirectory()) {
                  fs.rmSync(fullPath, { recursive: true, force: true });
                } else {
                  fs.unlinkSync(fullPath);
                }
                count++;
              }
            } catch {
              // Ignore file removal errors
            }
          }
          return count;
        };

        const quarantineDir = path.join(workerEnv.LOCAL_STORAGE_DIR, 'quarantine');
        sweptUploads = sweepDir(quarantineDir, maxAgeUploadsMs);

        const artifactsDir = path.join(workerEnv.LOCAL_STORAGE_DIR, 'artifacts');
        sweptArtifacts = sweepDir(artifactsDir, maxAgeArtifactsMs);
      }

      if (sweptWorkspaces > 0 || sweptUploads > 0 || sweptArtifacts > 0) {
        logger.info(
          `Cleanup cycle finished: swept ${sweptWorkspaces} workspaces, ${sweptUploads} uploads, ${sweptArtifacts} artifacts.`
        );
      }
    } catch (err: any) {
      logger.error(`Error during cleanup cycle: ${err.message}`);
    } finally {
      this.isRunning = false;
    }

    return { sweptWorkspaces, sweptUploads, sweptArtifacts };
  }

  startScheduler(intervalMs: number = workerEnv.CLEANUP_INTERVAL_MS): void {
    if (this.timer) return;
    logger.info(`Starting automatic cleanup scheduler (interval: ${Math.round(intervalMs / 1000)}s)`);
    this.timer = setInterval(() => {
      this.runCleanupCycle().catch((err) => {
        logger.error(`Cleanup scheduler error: ${err.message}`);
      });
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Stopped automatic cleanup scheduler.');
    }
  }
}

export const cleanupService = new CleanupService();
