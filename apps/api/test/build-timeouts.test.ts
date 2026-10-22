import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GRADLE_TIMEOUT_MS,
  DEFAULT_JOB_TIMEOUT_MS,
  parseTimeoutMs,
  resolveGradleTimeoutMs,
  resolveJobTimeoutMs,
  resolveQueueLockDurationMs,
  resolveMemoryValue,
  tryParseTimeoutMs,
} from '../src/config/timeouts.js';
import {
  classifyBuildFailure,
  sanitizeGradleOutput,
} from '../src/jobs/build-diagnostics.js';

describe('Build timeout configuration', () => {
  it('uses safe defaults for missing or invalid values', () => {
    expect(resolveGradleTimeoutMs({})).toBe(DEFAULT_GRADLE_TIMEOUT_MS);
    expect(resolveGradleTimeoutMs({ GRADLE_TIMEOUT_MS: 'abc' })).toBe(
      DEFAULT_GRADLE_TIMEOUT_MS
    );
    expect(resolveGradleTimeoutMs({ GRADLE_TIMEOUT_MS: '-5' })).toBe(
      DEFAULT_GRADLE_TIMEOUT_MS
    );
    expect(resolveGradleTimeoutMs({ GRADLE_TIMEOUT_MS: '999999999' })).toBe(
      DEFAULT_GRADLE_TIMEOUT_MS
    );
    expect(parseTimeoutMs('', 1234)).toBe(1234);
  });

  it('accepts canonical and legacy Gradle timeout variables', () => {
    expect(resolveGradleTimeoutMs({ GRADLE_TIMEOUT_MS: '1200000' })).toBe(
      1_200_000
    );
    expect(
      resolveGradleTimeoutMs({ GRADLE_COMPILATION_TIMEOUT_MS: '600000' })
    ).toBe(600_000);
    expect(
      resolveGradleTimeoutMs({
        GRADLE_TIMEOUT_MS: '1200000',
        GRADLE_COMPILATION_TIMEOUT_MS: '300000',
      })
    ).toBe(1_200_000);
  });

  it('keeps the job timeout above the Gradle timeout', () => {
    expect(
      resolveJobTimeoutMs(900_000, { JOB_TIMEOUT_MS: '300000' })
    ).toBe(960_000);
    expect(resolveJobTimeoutMs(900_000, {})).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(resolveQueueLockDurationMs(1_200_000, 900_000)).toBeGreaterThan(
      1_200_000
    );
  });

  it('rejects malformed memory values', () => {
    expect(resolveMemoryValue('2g', '2048m')).toBe('2g');
    expect(resolveMemoryValue('-Xmx999m', '2048m')).toBe('2048m');
    expect(resolveMemoryValue(undefined, '2048m')).toBe('2048m');
  });

  it('parses numeric strings only within bounds', () => {
    expect(tryParseTimeoutMs('60000')).toBe(60_000);
    expect(tryParseTimeoutMs('59999')).toBeNull();
    expect(tryParseTimeoutMs('1.5')).toBeNull();
    expect(tryParseTimeoutMs('900000')).toBe(900_000);
  });
});

describe('Build failure diagnostics', () => {
  it('classifies timeouts with an actionable message', () => {
    const failure = classifyBuildFailure(
      new Error('Gradle compilation timed out after 900 seconds.')
    );
    expect(failure.code).toBe('BUILD_TIMEOUT');
    expect(failure.message).toContain('GRADLE_TIMEOUT_MS');
    expect(failure.retryable).toBe(true);
  });

  it('classifies out-of-memory and dependency failures', () => {
    expect(
      classifyBuildFailure(new Error('Java heap space'), {
        logs: 'java.lang.OutOfMemoryError: Java heap space',
      }).code
    ).toBe('BUILD_OUT_OF_MEMORY');

    expect(
      classifyBuildFailure(new Error('Gradle compilation failed with exit code 1'), {
        logs: 'Could not resolve com.example:library:1.0.0',
      }).code
    ).toBe('BUILD_DEPENDENCY_FAILURE');
  });

  it('sanitizes secrets, ANSI codes, and workspace paths', () => {
    const sanitized = sanitizeGradleOutput(
      '\u001b[31mpassword=hunter2\u001b[0m at C:\\builds\\job-1',
      'C:\\builds\\job-1'
    );
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('\u001b');
    expect(sanitized).toContain('<workspace>');
  });
});
