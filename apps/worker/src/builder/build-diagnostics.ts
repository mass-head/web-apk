export type BuildFailureCode =
  | 'BUILD_TIMEOUT'
  | 'BUILD_OUT_OF_MEMORY'
  | 'BUILD_DEPENDENCY_FAILURE'
  | 'BUILD_FAILED';

export interface BuildProcessError extends Error {
  code?: BuildFailureCode;
  exitCode?: number | null;
  logs?: string;
  timedOut?: boolean;
  durationMs?: number;
}

export interface ClassifiedBuildFailure {
  code: BuildFailureCode;
  message: string;
  retryable: boolean;
}

const OOM_PATTERNS = [
  /OutOfMemoryError/i,
  /Java heap space/i,
  /GC overhead limit exceeded/i,
  /Metaspace/i,
  /exit code 137/i,
  /Killed/i,
  /insufficient memory/i,
];

const DEPENDENCY_PATTERNS = [
  /Could not resolve/i,
  /No cached version/i,
  /Could not download/i,
  /Could not GET/i,
  /Connection timed out/i,
  /Read timed out/i,
  /UnknownHostException/i,
  /unable to resolve dependency/i,
  /offline mode/i,
];

export function sanitizeGradleOutput(
  raw: string,
  workspace?: string,
  maxLength = 1200
): string {
  let text = String(raw || '');

  if (workspace) {
    const normalizedWorkspace = workspace.replace(/\\/g, '/');
    text = text
      .split(workspace)
      .join('<workspace>')
      .split(normalizedWorkspace)
      .join('<workspace>');
  }

  text = text
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '');

  if (text.length > maxLength) {
    text = `...${text.slice(-maxLength)}`;
  }

  return text.trim();
}

export function classifyBuildFailure(
  error: unknown,
  context: { workspace?: string; logs?: string; timedOut?: boolean } = {}
): ClassifiedBuildFailure {
  const processError = error as BuildProcessError | undefined;
  const rawMessage =
    typeof processError?.message === 'string'
      ? processError.message
      : String(error ?? '');
  const logs = context.logs || processError?.logs || '';
  const combined = `${rawMessage}\n${logs}`;
  const timedOut = context.timedOut === true || processError?.timedOut === true;

  const timeoutMatch = /timed out after (\d+) seconds/i.exec(rawMessage);
  if (timedOut || timeoutMatch) {
    const seconds = timeoutMatch?.[1] ?? 'configured';
    return {
      code: 'BUILD_TIMEOUT',
      message:
        `Gradle compilation timed out after ${seconds} seconds. ` +
        'The build exceeded GRADLE_TIMEOUT_MS and was terminated. ' +
        'Retry the conversion; if it repeatedly exceeds the limit, increase GRADLE_TIMEOUT_MS or worker resources.',
      retryable: true,
    };
  }

  if (OOM_PATTERNS.some((pattern) => pattern.test(combined))) {
    return {
      code: 'BUILD_OUT_OF_MEMORY',
      message:
        'The Android build ran out of memory before completing. ' +
        'Increase the worker memory limit or reduce WORKER_CONCURRENCY / GRADLE_MAX_HEAP, then retry.',
      retryable: true,
    };
  }

  if (DEPENDENCY_PATTERNS.some((pattern) => pattern.test(combined))) {
    return {
      code: 'BUILD_DEPENDENCY_FAILURE',
      message:
        'The Android build could not resolve required Gradle dependencies. ' +
        'Check that the dependency cache is populated (or set GRADLE_OFFLINE=false to allow downloads) and retry.',
      retryable: true,
    };
  }

  const exitMatch = /exit code (\d+)/i.exec(rawMessage);
  const safeTail = sanitizeGradleOutput(logs, context.workspace, 800);
  const baseMessage = exitMatch
    ? `Gradle compilation failed with exit code ${exitMatch[1]}.`
    : 'Gradle compilation failed.';

  return {
    code: 'BUILD_FAILED',
    message: safeTail ? `${baseMessage}\n\n${safeTail}` : baseMessage,
    retryable: false,
  };
}
