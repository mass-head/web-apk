import fs from 'node:fs';
import path from 'node:path';
import { workerEnv } from '../config/worker-env.js';
import { logger } from '../monitoring/logger.js';

export interface WorkspaceAllocation {
  conversionId: string;
  workspacePath: string;
  createdAt: number;
}

export class IsolatedWorkspaceManager {
  private baseDir: string;

  constructor(baseDir: string = workerEnv.WORKSPACE_BASE_DIR) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Allocates an isolated, clean directory for a specific build job
   */
  allocate(conversionId: string): WorkspaceAllocation {
    // Strictly prevent path traversal or special directory characters
    if (
      !conversionId ||
      conversionId.includes('..') ||
      conversionId.includes('/') ||
      conversionId.includes('\\') ||
      conversionId.includes('\0')
    ) {
      throw new Error(`Path traversal violation in workspace allocation: "${conversionId}"`);
    }

    const safeId = conversionId.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeId || safeId.length < 3) {
      throw new Error(`Invalid conversion ID for workspace allocation: "${conversionId}"`);
    }

    const workspacePath = path.join(this.baseDir, safeId);

    // Verify workspace path is strictly a descendant of baseDir
    const relative = path.relative(this.baseDir, workspacePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path traversal violation in workspace allocation: ${workspacePath}`);
    }

    // Clean any prior remnants
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    fs.mkdirSync(workspacePath, { recursive: true });

    logger.debug(`Allocated isolated workspace: ${workspacePath}`, conversionId);

    return {
      conversionId,
      workspacePath,
      createdAt: Date.now(),
    };
  }

  /**
   * Safely deletes an isolated workspace directory
   */
  cleanup(conversionId: string): void {
    const safeId = conversionId.replace(/[^a-zA-Z0-9_\-]/g, '');
    const workspacePath = path.join(this.baseDir, safeId);

    if (fs.existsSync(workspacePath)) {
      try {
        fs.rmSync(workspacePath, { recursive: true, force: true });
        logger.debug(`Cleaned up workspace: ${workspacePath}`, conversionId);
      } catch (err: any) {
        logger.warn(`Failed to clean up workspace ${workspacePath}: ${err.message}`, conversionId);
      }
    }
  }

  /**
   * Returns list of all current workspace directories with age in milliseconds
   */
  listWorkspaces(): { id: string; path: string; ageMs: number }[] {
    if (!fs.existsSync(this.baseDir)) return [];

    const now = Date.now();
    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const fullPath = path.join(this.baseDir, e.name);
        try {
          const stats = fs.statSync(fullPath);
          return {
            id: e.name,
            path: fullPath,
            ageMs: now - stats.mtimeMs,
          };
        } catch {
          return null;
        }
      })
      .filter((w): w is { id: string; path: string; ageMs: number } => w !== null);
  }

  /**
   * Sweeps and removes orphaned workspaces older than maxAgeMs
   */
  sweepOrphaned(maxAgeMs: number = workerEnv.ORPHAN_BUILD_MAX_AGE_MS): number {
    const workspaces = this.listWorkspaces();
    let cleanedCount = 0;

    for (const ws of workspaces) {
      if (ws.ageMs > maxAgeMs) {
        try {
          fs.rmSync(ws.path, { recursive: true, force: true });
          logger.info(`Swept orphaned workspace: ${ws.path} (age: ${Math.round(ws.ageMs / 1000)}s)`);
          cleanedCount++;
        } catch (err: any) {
          logger.warn(`Could not sweep orphaned workspace ${ws.path}: ${err.message}`);
        }
      }
    }

    return cleanedCount;
  }
}

export const workspaceManager = new IsolatedWorkspaceManager();
