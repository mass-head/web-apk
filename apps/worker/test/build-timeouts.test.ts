import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_GRADLE_TIMEOUT_MS,
  resolveBuildTimeoutMs,
  resolveGradleTimeoutMs,
  resolveQueueLockDurationMs,
} from '../src/config/timeouts.js';
import { classifyBuildFailure } from '../src/builder/build-diagnostics.js';

describe('Worker build timeouts', () => {
  it('defaults to a 15 minute Gradle limit and 20 minute build limit', () => {
    expect(resolveGradleTimeoutMs({})).toBe(DEFAULT_GRADLE_TIMEOUT_MS);
    expect(resolveGradleTimeoutMs({})).toBe(900_000);
    expect(resolveBuildTimeoutMs(DEFAULT_GRADLE_TIMEOUT_MS, {})).toBe(
      DEFAULT_BUILD_TIMEOUT_MS
    );
  });

  it('ignores the obsolete timeout variable and invalid values', () => {
    expect(
      resolveGradleTimeoutMs({ GRADLE_COMPILATION_TIMEOUT_MS: '300000' })
    ).toBe(DEFAULT_GRADLE_TIMEOUT_MS);
    expect(resolveGradleTimeoutMs({ GRADLE_TIMEOUT_MS: 'nope' })).toBe(
      DEFAULT_GRADLE_TIMEOUT_MS
    );
    expect(
      resolveBuildTimeoutMs(900_000, { BUILD_TIMEOUT_MS: '60000' })
    ).toBe(960_000);
  });

  it('derives a queue lock that outlives the build', () => {
    const lock = resolveQueueLockDurationMs(1_200_000, 900_000);
    expect(lock).toBeGreaterThan(1_200_000);
  });
});

describe('Worker failure classification', () => {
  it('reports timeout, OOM, dependency, and generic failures', () => {
    expect(classifyBuildFailure(new Error('timed out after 900 seconds')).code).toBe(
      'BUILD_TIMEOUT'
    );
    expect(
      classifyBuildFailure(new Error('build failed'), {
        logs: 'java.lang.OutOfMemoryError: Metaspace',
      }).code
    ).toBe('BUILD_OUT_OF_MEMORY');
    expect(
      classifyBuildFailure(new Error('build failed'), {
        logs: 'Could not GET https://dl.google.com/android/maven2/...',
      }).code
    ).toBe('BUILD_DEPENDENCY_FAILURE');
    expect(
      classifyBuildFailure(new Error('Gradle compilation failed with exit code 2')).code
    ).toBe('BUILD_FAILED');
  });
});
