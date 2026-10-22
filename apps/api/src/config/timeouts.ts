/**
 * Timeout parsing helpers.
 *
 * Environment variables are user-controlled. Invalid, empty, negative, or
 * unreasonably large values must never crash startup or silently disable the
 * build watchdog, so every value is validated and falls back to a safe default.
 */

export const DEFAULT_GRADLE_TIMEOUT_MS = 900_000; // 15 minutes
export const DEFAULT_JOB_TIMEOUT_MS = 1_200_000; // 20 minutes
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
 * Resolves the Gradle compilation timeout.
 *
 * GRADLE_TIMEOUT_MS is the canonical variable. GRADLE_COMPILATION_TIMEOUT_MS is
 * retained as a backwards-compatible alias for existing deployments.
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
 * The overall job/queue timeout must always exceed the Gradle watchdog,
 * otherwise BullMQ can abandon a build that is still compiling.
 */
export function resolveJobTimeoutMs(
  gradleTimeoutMs: number,
  environment: NodeJS.ProcessEnv = process.env,
  fallback: number = DEFAULT_JOB_TIMEOUT_MS
): number {
  const configured =
    tryParseTimeoutMs(environment.JOB_TIMEOUT_MS) ?? fallback;
  return Math.max(configured, gradleTimeoutMs + 60_000);
}

export function resolveQueueLockDurationMs(
  jobTimeoutMs: number,
  gradleTimeoutMs: number
): number {
  return Math.max(jobTimeoutMs + 60_000, gradleTimeoutMs + 120_000);
}

export function resolveMemoryValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^\d{1,6}[kKmMgG]?$/.test(trimmed) ? trimmed : fallback;
}
