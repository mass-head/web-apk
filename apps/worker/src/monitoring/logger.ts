import { workerEnv } from '../config/worker-env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'stdout' | 'stderr' | 'success';

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  workerId: string;
  jobId?: string;
  stage?: string;
  message: string;
  metadata?: Record<string, any>;
}

// Secret patterns and sensitive substrings to redact from logs
const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*[^\s,]+/gi,
  /secret\s*[:=]\s*[^\s,]+/gi,
  /access_key_id\s*[:=]\s*[^\s,]+/gi,
  /secret_access_key\s*[:=]\s*[^\s,]+/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, // JWT tokens
];

export function redactSensitiveData(input: string): string {
  if (!input) return input;
  let sanitized = input;

  // Mask configured secrets if set
  if (workerEnv.S3_SECRET_ACCESS_KEY && workerEnv.S3_SECRET_ACCESS_KEY.length > 4) {
    sanitized = sanitized.replaceAll(workerEnv.S3_SECRET_ACCESS_KEY, '[REDACTED_S3_SECRET]');
  }
  if (workerEnv.REDIS_PASSWORD && workerEnv.REDIS_PASSWORD.length > 4) {
    sanitized = sanitized.replaceAll(workerEnv.REDIS_PASSWORD, '[REDACTED_REDIS_PASSWORD]');
  }
  if (workerEnv.POSTGRES_PASSWORD && workerEnv.POSTGRES_PASSWORD.length > 4) {
    sanitized = sanitized.replaceAll(workerEnv.POSTGRES_PASSWORD, '[REDACTED_POSTGRES_PASSWORD]');
  }

  // Apply regex maskers
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_CREDENTIAL]');
  }

  return sanitized;
}

export class WorkerLogger {
  private workerId: string;

  constructor(workerId: string = workerEnv.WORKER_ID) {
    this.workerId = workerId;
  }

  private log(
    level: LogLevel,
    message: string,
    jobId?: string,
    stage?: string,
    metadata?: Record<string, any>
  ): StructuredLog {
    const sanitizedMsg = redactSensitiveData(message);
    const logEntry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      workerId: this.workerId,
      jobId,
      stage,
      message: sanitizedMsg,
      metadata,
    };

    const jsonStr = JSON.stringify(logEntry);

    if (level === 'error' || level === 'stderr') {
      console.error(jsonStr);
    } else if (level === 'warn') {
      console.warn(jsonStr);
    } else {
      console.log(jsonStr);
    }

    return logEntry;
  }

  info(message: string, jobId?: string, stage?: string, meta?: Record<string, any>): StructuredLog {
    return this.log('info', message, jobId, stage, meta);
  }

  warn(message: string, jobId?: string, stage?: string, meta?: Record<string, any>): StructuredLog {
    return this.log('warn', message, jobId, stage, meta);
  }

  error(message: string, jobId?: string, stage?: string, meta?: Record<string, any>): StructuredLog {
    return this.log('error', message, jobId, stage, meta);
  }

  debug(message: string, jobId?: string, stage?: string, meta?: Record<string, any>): StructuredLog {
    return this.log('debug', message, jobId, stage, meta);
  }
}

export const logger = new WorkerLogger();
