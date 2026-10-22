/**
 * Timeout parsing helpers for the standalone Android build worker.
 *
 * Invalid environment values must never crash startup or disable the build
 * watchdog, so they fall back to conservative defaults.
 */

export const DEFAULT_GRADLE_TIMEOUT_MS = 900_000; // 15 minutes
export const DEFAULT_BUILD_TIMEOUT_MS = 1_200_000; // 20 minutes
export const MIN_TASK_TIMEOUT_MS = 60_000; // 1 minute
export const MAX_TASK_TIMEOUT_MS = 7_200_000; // 2 hours

export function tryParseTimeoutMs(
  value: unknown,
  min: number = MIN_TASK_TIMEOUT_MS,
  max: number = MAX_TASK_TIMEOUT_MS
): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const parsed = Math.floor(value);
    return parsed >= min && parsed <= max ? parsed : null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed >= min && parsed <= max ? parsed : null;
}

export function parseTimeoutMs(
  value: unknown,
  fallback: number,
  min: number = MIN_TASK_TIMEOUT_MS,
  max: number = MAX_TASK_TIMEOUT_MS
): number {
  return tryParseTimeoutMs(value, min, max) ?? fallback;
}

/**
 * GRADLE_TIMEOUT_MS is the canonical setting. The previous
 * GRADLE_COMPILATION_TIMEOUT_MS name remains supported for compatibility.
 */
export function resolveGradleTimeoutMs(
  environment: NodeJS.ProcessEnv = process.env,
  fallback: number = DEFAULT_GRADLE_TIMEOUT_MS
): number {
  return (
    tryParseTimeoutMs(environment.GRADLE_TIMEOUT_MS) ??
    tryParseTimeoutMs(environment.GRADLE_COMPILATION_TIMEOUT_MS) ??
    fallback
  );
}

/**
 * The job/queue watchdog must remain longer than the Gradle watchdog.
 */
export function resolveBuildTimeoutMs(
  gradleTimeoutMs: number,
  environment: NodeJS.ProcessEnv = process.env,
  fallback: number = DEFAULT_BUILD_TIMEOUT_MS
): number {
  const configured =
    tryParseTimeoutMs(environment.BUILD_TIMEOUT_MS) ??
    tryParseTimeoutMs(environment.JOB_TIMEOUT_MS) ??
    fallback;
  return Math.max(configured, gradleTimeoutMs + 60_000);
}

export function resolveQueueLockDurationMs(
  buildTimeoutMs: number,
  gradleTimeoutMs: number
): number {
  return Math.max(buildTimeoutMs + 60_000, gradleTimeoutMs + 120_000);
}

export function resolveMemoryValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^\d{1,6}[kKmMgG]?$/.test(trimmed) ? trimmed : fallback;
}
