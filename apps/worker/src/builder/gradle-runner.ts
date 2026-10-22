import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { workerEnv } from '../config/worker-env.js';
import { logger } from '../monitoring/logger.js';

export interface GradleRunnerOptions {
  workspace: string;
  conversionId: string;
  variant?: 'release' | 'debug';
  tasks?: string[];
  timeoutMs?: number;
  onProgress?: (progress: number, stageName: string) => void;
  onLog?: (line: string, isError: boolean) => void;
  cancelSignal?: { cancelled: boolean };
}

export function resolveEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // 1. Locate Java JDK
  if (!env.JAVA_HOME) {
    const standardJavaPaths = [
      'C:\\Program Files\\Unity\\Hub\\Editor\\6000.2.12f1\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17',
      'C:\\Program Files\\Java\\jdk-17',
      '/opt/java/openjdk',
      '/usr/lib/jvm/java-17-openjdk-amd64',
    ];
    for (const p of standardJavaPaths) {
      if (fs.existsSync(p)) {
        env.JAVA_HOME = p;
        break;
      }
    }
  }

  // 2. Locate Android SDK
  if (!env.ANDROID_HOME) {
    const localAppData = env.LOCALAPPDATA || '';
    const standardSdkPaths = [
      path.join(localAppData, 'Android', 'Sdk'),
      'C:\\Android\\Sdk',
      '/opt/android-sdk',
    ];
    for (const p of standardSdkPaths) {
      if (fs.existsSync(p)) {
        env.ANDROID_HOME = p;
        break;
      }
    }
  }

  // Ensure ANDROID_SDK_ROOT matches ANDROID_HOME for consistency
  if (env.ANDROID_HOME) {
    env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
  } else if (env.ANDROID_SDK_ROOT) {
    env.ANDROID_HOME = env.ANDROID_SDK_ROOT;
  }

  // Set memory limits for Gradle worker daemon
  env.GRADLE_OPTS = `-Xmx${workerEnv.GRADLE_MAX_HEAP} -XX:MaxMetaspaceSize=${workerEnv.GRADLE_MAX_METASPACE} -Dfile.encoding=UTF-8`;

  // Inject into PATH
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  let currentPath = env[pathKey] || '';
  if (env.JAVA_HOME) {
    const javaBin = path.join(env.JAVA_HOME, 'bin');
    currentPath = `${javaBin}${path.delimiter}${currentPath}`;
  }
  if (env.ANDROID_HOME) {
    const cmdlineToolsBin = path.join(env.ANDROID_HOME, 'cmdline-tools', 'latest', 'bin');
    if (fs.existsSync(cmdlineToolsBin)) {
      currentPath = `${cmdlineToolsBin}${path.delimiter}${currentPath}`;
    }
    const platformTools = path.join(env.ANDROID_HOME, 'platform-tools');
    if (fs.existsSync(platformTools)) {
      currentPath = `${platformTools}${path.delimiter}${currentPath}`;
    }
    const buildTools = path.join(env.ANDROID_HOME, 'build-tools', '34.0.0');
    if (fs.existsSync(buildTools)) {
      currentPath = `${buildTools}${path.delimiter}${currentPath}`;
    }
  }
  env[pathKey] = currentPath;
  env.PATH = currentPath;
  env.Path = currentPath;

  return env;
}

export class GradleRunner {
  async executeBuild(options: GradleRunnerOptions): Promise<string> {
    const {
      workspace,
      conversionId,
      variant = 'release',
      timeoutMs = workerEnv.GRADLE_COMPILATION_TIMEOUT_MS,
      onProgress,
      onLog,
      cancelSignal,
    } = options;

    const defaultTasks = variant === 'release'
      ? ['assembleRelease', '--offline', '--no-daemon']
      : ['assembleDebug', '--offline', '--no-daemon'];
    const tasks = options.tasks || defaultTasks;

    const env = resolveEnvironment();
    const isWindows = process.platform === 'win32';
    const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';

    logger.info(`Starting Gradle compilation: ${gradleCmd} ${tasks.join(' ')}`, conversionId);

    return new Promise<string>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(gradleCmd, tasks, {
          cwd: workspace,
          env,
          shell: isWindows,
        });

        // Close standard input immediately
        child.stdin?.end();
      } catch (err: any) {
        return reject(new Error(`Failed to spawn Gradle process: ${err.message}`));
      }

      let compilerLogs = '';
      let progressVal = 40;
      let isSettled = false;

      const resolveApkPath = (): string => {
        const releasePath = path.join(workspace, 'app/build/outputs/apk/release/app-release.apk');
        const debugPath = path.join(workspace, 'app/build/outputs/apk/debug/app-debug.apk');
        return fs.existsSync(releasePath) ? releasePath : debugPath;
      };

      const safeResolve = (apkPath: string) => {
        if (!isSettled) {
          isSettled = true;
          clearInterval(cancelInterval);
          clearTimeout(timeoutTimer);
          resolve(apkPath);
        }
      };

      const safeReject = (err: Error) => {
        if (!isSettled) {
          isSettled = true;
          clearInterval(cancelInterval);
          clearTimeout(timeoutTimer);
          reject(err);
        }
      };

      function mapTaskToStage(taskLine: string): { progress: number; name: string } | null {
        if (taskLine.includes(':app:preBuild') || taskLine.includes('preDebugBuild') || taskLine.includes('preReleaseBuild') || taskLine.includes('checkAarMetadata') || taskLine.includes('checkDebugAarMetadata') || taskLine.includes('checkReleaseAarMetadata')) {
          return { progress: 42, name: 'Preparing Android build environment' };
        }
        if ((taskLine.includes('generate') || taskLine.includes('merge')) && taskLine.includes('Resources')) {
          return { progress: 48, name: 'Merging app resources & layout XMLs' };
        }
        if (taskLine.includes('process') && taskLine.includes('Manifest')) {
          return { progress: 54, name: 'Processing AndroidManifest.xml & package ID' };
        }
        if (taskLine.includes('process') && taskLine.includes('Resources')) {
          return { progress: 60, name: 'Compiling AAPT2 Android resources' };
        }
        if (taskLine.includes('compile') && taskLine.includes('Kotlin')) {
          return { progress: 68, name: 'Compiling Kotlin native source code' };
        }
        if (taskLine.includes('compile') && taskLine.includes('JavaWithJavac')) {
          return { progress: 74, name: 'Compiling Java bytecode' };
        }
        if (taskLine.includes('dexBuilder') || taskLine.includes('mergeDex') || taskLine.includes('minifyReleaseWithR8') || taskLine.includes('r8')) {
          return { progress: 79, name: 'Converting bytecode to Dalvik executables (R8/D8 dexing)' };
        }
        if (taskLine.includes('packageRelease') || taskLine.includes('packageDebug')) {
          return { progress: 83, name: 'Packaging Android application archive (APK)' };
        }
        if (taskLine.includes('assembleRelease') || taskLine.includes('assembleDebug') || taskLine.includes('createReleaseApkListingFileRedirect') || taskLine.includes('createDebugApkListingFileRedirect')) {
          return { progress: 85, name: 'Finalizing Android signed APK' };
        }
        return null;
      }

      // Check cancellation periodically
      const cancelInterval = setInterval(() => {
        if (cancelSignal?.cancelled) {
          try {
            child.kill(isWindows ? undefined : 'SIGKILL');
          } catch {
            // Ignore kill error
          }
          safeReject(new Error('Compilation cancelled by user request.'));
        }
      }, 500);

      // Hard timeout timer
      const timeoutTimer = setTimeout(() => {
        try {
          child.kill(isWindows ? undefined : 'SIGKILL');
        } catch {
          // Ignore
        }
        safeReject(new Error(`Gradle compilation timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        compilerLogs += text;
        const lines = text.split(/\r?\n/).filter((l: string) => l.trim().length > 0);

        for (const line of lines) {
          let currentStage = 'Compiling Android APK with Gradle 8.5';
          if (line.includes('> Task :')) {
            const mapped = mapTaskToStage(line);
            if (mapped) {
              progressVal = Math.max(progressVal, mapped.progress);
              currentStage = mapped.name;
            } else {
              progressVal = Math.min(progressVal + 1, 85);
            }
            if (onProgress) {
              onProgress(progressVal, currentStage);
            }
          }
          if (onLog) {
            onLog(line, false);
          }

          if (line.includes('BUILD SUCCESSFUL')) {
            safeResolve(resolveApkPath());
          }
        }
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        compilerLogs += text;
        const lines = text.split(/\r?\n/).filter((l: string) => l.trim().length > 0);

        for (const line of lines) {
          if (onLog) {
            onLog(line, true);
          }
        }
      });

      child.on('exit', (code) => {
        if (code === 0) {
          safeResolve(resolveApkPath());
        } else if (code !== null) {
          const recentLogs = compilerLogs.slice(-1000);
          safeReject(new Error(`Gradle compilation failed with exit code ${code}.\n${recentLogs}`));
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          const apkPath = path.join(workspace, 'app/build/outputs/apk/debug/app-debug.apk');
          safeResolve(apkPath);
        } else if (code !== null) {
          const recentLogs = compilerLogs.slice(-1000);
          safeReject(new Error(`Gradle compilation failed with exit code ${code}.\n${recentLogs}`));
        }
      });

      child.on('error', (err) => {
        safeReject(err);
      });
    });
  }
}

export const gradleRunner = new GradleRunner();
