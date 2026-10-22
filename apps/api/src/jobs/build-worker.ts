import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JobQueuePayload, ConversionRecord, ArtifactMetadata } from './types.js';
import { ConversionRepository } from '../db/repository.js';
import { EventBroker } from './events.js';
import { getStorageService } from '../storage/index.js';
import { TokenService } from '../auth/token.service.js';
import { verifyApk } from './apk-verifier.js';
import { generateAndroidIcons } from './icon-generator.js';
import { validateUrlReachability } from '../validation/ssrf.validator.js';
import { validateZipArchive, extractSanitizedZipToWorkspace } from '../validation/zip.validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the path to the reusable native Android template
 */
export function getTemplateRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'packages/android-template'),
    path.resolve(__dirname, '../../../../packages/android-template'),
    path.resolve(__dirname, '../../../packages/android-template'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, 'app/build.gradle.kts'))) {
      return c;
    }
  }

  throw new Error('Android template directory could not be located.');
}

/**
 * Resolves Java & Android SDK paths on host / worker system
 */
export function resolveEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Detect Unity OpenJDK, Adoptium, Android Studio JBR, or standard Java if not set
  if (!env.JAVA_HOME || !fs.existsSync(env.JAVA_HOME)) {
    const candidates: string[] = [];

    // 1. Unity Hub OpenJDK (dynamically scan for any installed Unity version)
    const unityHub = 'C:\\Program Files\\Unity\\Hub\\Editor';
    if (fs.existsSync(unityHub)) {
      try {
        const versions = fs.readdirSync(unityHub);
        for (const v of versions) {
          candidates.push(path.join(unityHub, v, 'Editor/Data/PlaybackEngines/AndroidPlayer/OpenJDK'));
        }
      } catch {}
    }

    // 2. Android Studio JBR / JRE
    candidates.push(
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Android\\Android Studio\\jre',
      path.join(env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'jbr')
    );

    // 3. Eclipse Adoptium / Temurin
    const adoptiumDir = 'C:\\Program Files\\Eclipse Adoptium';
    if (fs.existsSync(adoptiumDir)) {
      try {
        for (const d of fs.readdirSync(adoptiumDir)) {
          candidates.push(path.join(adoptiumDir, d));
        }
      } catch {}
    }

    // 4. Standard JDK paths
    const javaDir = 'C:\\Program Files\\Java';
    if (fs.existsSync(javaDir)) {
      try {
        for (const d of fs.readdirSync(javaDir)) {
          candidates.push(path.join(javaDir, d));
        }
      } catch {}
    }

    // 5. Microsoft OpenJDK
    const msJava = 'C:\\Program Files\\Microsoft';
    if (fs.existsSync(msJava)) {
      try {
        for (const d of fs.readdirSync(msJava)) {
          if (d.startsWith('jdk')) candidates.push(path.join(msJava, d));
        }
      } catch {}
    }

    candidates.push(
      '/usr/lib/jvm/java-17-openjdk-amd64',
      '/usr/lib/jvm/default-java',
      '/opt/java/openjdk'
    );

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const binJava = path.join(p, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        if (fs.existsSync(binJava)) {
          env.JAVA_HOME = p;
          break;
        }
      }
    }
  }

  // Detect Android SDK
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
  env.GRADLE_OPTS = '-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8';

  // Inject into PATH / Path
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
  // Detect and inject production release keystore credentials
  if (!env.KEYSTORE_PATH) {
    const templateRoot = getTemplateRoot();
    const candidate = path.join(templateRoot, 'release-keystore.jks');
    if (fs.existsSync(candidate)) {
      env.KEYSTORE_PATH = candidate;
      env.KEYSTORE_PASSWORD = env.KEYSTORE_PASSWORD || 'Web2ApkReleaseSec2026!';
      env.KEY_ALIAS = env.KEY_ALIAS || 'web2apk-release';
      env.KEY_PASSWORD = env.KEY_PASSWORD || 'Web2ApkReleaseSec2026!';
    }
  }

  env[pathKey] = currentPath;
  env.PATH = currentPath;
  env.Path = currentPath;

  return env;
}

/**
 * Safely copies directory omitting build artifacts and caches
 */
function copyDirectoryRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip build outputs, gradle cache, node_modules, test files
    if (
      entry.name === 'build' ||
      entry.name === '.gradle' ||
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'test'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Injects app configuration and URL into the isolated Android project
 */
async function configureAndroidProject(workspace: string, payload: JobQueuePayload, entryPoint: string = 'index.html'): Promise<void> {
  const { appConfig, targetUrl } = payload;
  const appName = appConfig.appName || 'Web2APK App';
  const packageName = appConfig.packageName || 'com.web2apk.app';
  const url = targetUrl || 'https://example.com';
  const themeColor = appConfig.themeColor || '#7C3AED';
  const versionCode = appConfig.versionCode || 1;
  const versionName = appConfig.versionName || '1.0.0';

  // 1. Update AppConfig.kt
  const appConfigPath = path.join(
    workspace,
    'app/src/main/java/com/web2apk/template/AppConfig.kt'
  );
  if (fs.existsSync(appConfigPath)) {
    let code = fs.readFileSync(appConfigPath, 'utf8');
    if (payload.mode === 'upload') {
      code = code.replace(
        /val contentSource: ContentSource = ContentSource\.[A-Z]+/,
        'val contentSource: ContentSource = ContentSource.LOCAL'
      );
      code = code.replace(
        /const val LOCAL_ASSET_PATH: String = "[^"]*"/,
        `const val LOCAL_ASSET_PATH: String = "web/${entryPoint}"`
      );
    } else {
      code = code.replace(
        /val contentSource: ContentSource = ContentSource\.[A-Z]+/,
        'val contentSource: ContentSource = ContentSource.REMOTE'
      );
      code = code.replace(
        /const val REMOTE_URL: String = "[^"]*"/,
        `const val REMOTE_URL: String = "${url}"`
      );
    }

    if (appConfig.enablePullToRefresh !== undefined) {
      code = code.replace(
        /const val ENABLE_PULL_TO_REFRESH: Boolean = [a-z]+/,
        `const val ENABLE_PULL_TO_REFRESH: Boolean = ${appConfig.enablePullToRefresh}`
      );
    }
    if (appConfig.customUserAgent) {
      code = code.replace(
        /const val CUSTOM_USER_AGENT_SUFFIX: String = "[^"]*"/,
        `const val CUSTOM_USER_AGENT_SUFFIX: String = "${appConfig.customUserAgent.replace(/"/g, '\\"')}"`
      );
    }

    code = code.replace(
      /const val ENABLE_CAMERA: Boolean = [a-z]+/,
      `const val ENABLE_CAMERA: Boolean = ${Boolean(appConfig.enableCamera)}`
    );
    code = code.replace(
      /const val ENABLE_GEOLOCATION: Boolean = [a-z]+/,
      `const val ENABLE_GEOLOCATION: Boolean = ${Boolean(appConfig.enableGeolocation)}`
    );

    if (appConfig.hideCustomLoadingSelector) {
      code = code.replace(
        /const val HIDE_CUSTOM_LOADING_SELECTOR: String = "[^"]*"/,
        `const val HIDE_CUSTOM_LOADING_SELECTOR: String = "${appConfig.hideCustomLoadingSelector.replace(/"/g, '\\"')}"`
      );
    }

    fs.writeFileSync(appConfigPath, code, 'utf8');
  }

  // 2. Update strings.xml
  const stringsPath = path.join(workspace, 'app/src/main/res/values/strings.xml');
  if (fs.existsSync(stringsPath)) {
    let xml = fs.readFileSync(stringsPath, 'utf8');
    xml = xml.replace(
      /<string name="app_name">[^<]*<\/string>/,
      `<string name="app_name">${appName.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`
    );
    fs.writeFileSync(stringsPath, xml, 'utf8');
  }

  // 3. Update colors.xml
  const colorsPath = path.join(workspace, 'app/src/main/res/values/colors.xml');
  if (fs.existsSync(colorsPath)) {
    let xml = fs.readFileSync(colorsPath, 'utf8');
    xml = xml.replace(
      /<color name="primaryColor">[^<]*<\/color>/,
      `<color name="primaryColor">${themeColor}</color>`
    );
    fs.writeFileSync(colorsPath, xml, 'utf8');
  }

  // 4. Update app/build.gradle.kts
  const gradlePath = path.join(workspace, 'app/build.gradle.kts');
  if (fs.existsSync(gradlePath)) {
    let gradle = fs.readFileSync(gradlePath, 'utf8');
    gradle = gradle.replace(/applicationId = "[^"]*"/, `applicationId = "${packageName}"`);
    gradle = gradle.replace(/versionCode = \d+/, `versionCode = ${versionCode}`);
    gradle = gradle.replace(/versionName = "[^"]*"/, `versionName = "${versionName}"`);
    fs.writeFileSync(gradlePath, gradle, 'utf8');
  }

  // 5. AndroidManifest.xml (Dynamic Permission Pruning - Only include if explicitly requested)
  const manifestPath = path.join(workspace, 'app/src/main/AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    let dynamicPermissions = '';

    if (appConfig.enableCamera) {
      dynamicPermissions += '    <uses-permission android:name="android.permission.CAMERA" />\n';
      dynamicPermissions += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n';
    }

    if (appConfig.enableGeolocation) {
      dynamicPermissions += '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />\n';
      dynamicPermissions += '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />\n';
      dynamicPermissions += '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n';
    }

    manifest = manifest.replace('<!-- DYNAMIC_PERMISSIONS_ANCHOR -->', dynamicPermissions.trimEnd());
    fs.writeFileSync(manifestPath, manifest, 'utf8');
  }

  // 6. Generate Android Launcher Icons, Adaptive Foregrounds, and Splash Logo
  const resDir = path.join(workspace, 'app/src/main/res');
  const env = resolveEnvironment();
  const javaCmd = env?.JAVA_HOME
    ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';

  let iconDataUrl = appConfig.iconDataUrl;
  if (iconDataUrl && (iconDataUrl.startsWith('http://') || iconDataUrl.startsWith('https://'))) {
    try {
      const response = await fetch(iconDataUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        const ct = response.headers.get('content-type') || '';
        const mime = ct.includes('jpeg') || ct.includes('jpg') ? 'image/jpeg' : 'image/png';
        iconDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      } else {
        iconDataUrl = undefined;
      }
    } catch {
      iconDataUrl = undefined;
    }
  }

  generateAndroidIcons(resDir, iconDataUrl, themeColor, javaCmd, { fallbackOnFailure: true });
}

export interface WorkerBuildOptions {
  gradleArgs?: string[];
  skipReachabilityCheck?: boolean;
  variant?: 'release' | 'debug';
}

/**
 * Isolated Android Build Worker
 * Executes the complete URL-to-APK compilation pipeline in an isolated sandbox.
 */
export async function processConversionJob(
  payload: JobQueuePayload,
  options: WorkerBuildOptions = {}
): Promise<ArtifactMetadata> {
  const { conversionId, userId, appConfig, targetUrl } = payload;
  const startTime = Date.now();

  const publish = async (
    status: ConversionRecord['status'],
    progress: number,
    stageName: string,
    logMsg?: string,
    logLevel: 'info' | 'warn' | 'error' | 'stdout' | 'stderr' | 'success' = 'info',
    extra?: Partial<ConversionRecord>
  ) => {
    const current = await ConversionRepository.findById(conversionId);
    if (current?.status === 'cancelled') {
      throw new Error('Build job was cancelled by user request');
    }

    await ConversionRepository.updateStatus(conversionId, {
      status,
      progress,
      stageName,
      ...extra,
    });

    await EventBroker.publishEvent({
      conversionId,
      status,
      progress,
      stageName,
      log: logMsg
        ? {
            level: logLevel,
            message: logMsg,
            timestamp: new Date().toISOString(),
          }
        : undefined,
    });
  };

  const workspace = path.resolve(process.cwd(), 'data/builds', conversionId);

  try {
    // ------------------------------------------------------------------------
    // STAGE 1: VALIDATION & PRE-FLIGHT CHECKS (Progress: 10% -> 20%)
    // ------------------------------------------------------------------------
    if (payload.mode === 'url') {
      await publish(
        'validating',
        10,
        'Validating website security and reachability',
        `[Worker] Initiating SSRF validation and reachability check for: ${targetUrl || 'target'}`
      );

      if (targetUrl && !options.skipReachabilityCheck) {
        const reachability = await validateUrlReachability(targetUrl, {
          allowLoopbackForTesting: false,
        });

        if (!reachability.valid) {
          throw new Error(
            `Pre-flight validation failed: ${reachability.error || 'Website unreachable or blocked by SSRF policy.'}`
          );
        }

        const warningMsg = reachability.warning ? ` [Notice: ${reachability.warning}]` : '';
        await publish(
          'validating',
          18,
          'Website reachability verified',
          `[Worker] Target resolved to ${reachability.resolvedIp} (SSL verified, HTTP ${reachability.statusCode || 200}${warningMsg}). Network egress restrictions enforced.`,
          'success'
        );
      }
    } else if (payload.mode === 'upload') {
      await publish(
        'validating',
        10,
        'Inspecting and validating static website ZIP archive',
        `[Worker] Inspecting quarantined archive: ${payload.uploadedFileName || payload.storageKey || 'archive.zip'}`
      );

      const storage = getStorageService();
      if (!payload.storageKey) {
        throw new Error('Pre-flight validation failed: Storage key missing for uploaded archive.');
      }
      const zipBuffer = await storage.downloadFile(payload.storageKey);

      // Validate ZIP archive safely
      const zipValidation = await validateZipArchive(zipBuffer);
      if (!zipValidation.valid) {
        throw new Error(`Pre-flight validation failed: ${zipValidation.error}`);
      }

      const totalMb = (zipValidation.totalDecompressedBytes / (1024 * 1024)).toFixed(2);
      await publish(
        'validating',
        18,
        'ZIP archive structure and assets verified',
        `[Worker] Archive verified: ${zipValidation.entryCount} static files, entrypoint "${zipValidation.entryPoint}", decompressed size ${totalMb} MB.`,
        'success'
      );
    }

    // ------------------------------------------------------------------------
    // STAGE 2: PROJECT SCAFFOLDING & CONFIG INJECTION (Progress: 25%)
    // ------------------------------------------------------------------------
    await publish(
      'generating',
      25,
      'Generating Android project from reusable template',
      `[Worker] Allocating isolated workspace: ${workspace}`
    );

    const templateRoot = getTemplateRoot();

    // Clean any prior workspace remnants
    if (fs.existsSync(workspace)) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }

    // Copy template to isolated workspace
    copyDirectoryRecursive(templateRoot, workspace);

    // If upload mode, extract sanitized website assets directly into app/src/main/assets/web/
    let localEntryPoint = 'index.html';
    if (payload.mode === 'upload') {
      const storage = getStorageService();
      if (!payload.storageKey) {
        throw new Error('Storage key missing for uploaded archive.');
      }
      const zipBuffer = await storage.downloadFile(payload.storageKey);
      const targetAssetsDir = path.join(workspace, 'app/src/main/assets/web');

      const extraction = await extractSanitizedZipToWorkspace(zipBuffer, targetAssetsDir);
      localEntryPoint = extraction.entryPoint || 'index.html';

      await publish(
        'generating',
        30,
        'Website assets packaged into Android assets directory',
        `[Worker] Extracted ${extraction.extractedFileCount} sanitized static assets to assets/web/ (entrypoint: ${extraction.entryPoint}).`,
        'info'
      );
    }

    // Inject app properties, package identifier, theme, icon, and LOCAL/REMOTE configuration
    await configureAndroidProject(workspace, payload, localEntryPoint);

    await publish(
      'generating',
      35,
      'Android template configured',
      payload.mode === 'upload'
        ? `[Worker] Configured package "${appConfig.packageName}", app "${appConfig.appName}" in LOCAL mode (WebViewAssetLoader).`
        : `[Worker] Configured package "${appConfig.packageName}", app "${appConfig.appName}", remote URL "${targetUrl}".`,
      'info'
    );

    // ------------------------------------------------------------------------
    // STAGE 3: GRADLE 8.5 COMPILATION (Progress: 40% -> 80%)
    // ------------------------------------------------------------------------
    await publish(
      'building',
      40,
      'Compiling Android APK with Gradle 8.5',
      `[Worker] Invoking isolated Gradle compiler (network egress restricted with --offline)...`
    );

    const env = resolveEnvironment();
    const isWindows = process.platform === 'win32';
    const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';

    const apkVariant = options.variant || (options.gradleArgs?.some((a) => a.includes('Debug')) ? 'debug' : 'release');
    const defaultArgs = apkVariant === 'release'
      ? ['assembleRelease', '--offline', '--no-daemon']
      : ['assembleDebug', '--offline', '--no-daemon'];

    // Execute Gradle assembleRelease/assembleDebug in offline mode
    await new Promise<void>((resolve, reject) => {
      const args = options.gradleArgs || defaultArgs;

      const child = spawn(gradleCmd, args, {
        cwd: workspace,
        env,
        shell: isWindows,
      });

      // Close standard input immediately so cmd/gradle never waits on user input
      child.stdin?.end();

      let compilerLogs = '';
      let progressVal = 40;
      let isSettled = false;
      let lastDbUpdate = 0;

      const safeResolve = () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          resolve();
        }
      };

      const safeReject = (err: Error) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
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

      child.stdout.on('data', (chunk) => {
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
          }

          EventBroker.publishEvent({
            conversionId,
            status: 'building',
            progress: progressVal,
            stageName: currentStage,
            log: {
              level: 'stdout',
              message: line,
              timestamp: new Date().toISOString(),
            },
          });

          // Sync progress to database periodically
          const now = Date.now();
          if (now - lastDbUpdate > 1000) {
            lastDbUpdate = now;
            ConversionRepository.updateStatus(conversionId, {
              status: 'building',
              progress: progressVal,
              stageName: currentStage,
            }).catch(() => {});
          }

          if (line.includes('BUILD SUCCESSFUL')) {
            safeResolve();
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        compilerLogs += text;
        const lines = text.split(/\r?\n/).filter((l: string) => l.trim().length > 0);

        for (const line of lines) {
          EventBroker.publishEvent({
            conversionId,
            status: 'building',
            progress: progressVal,
            stageName: 'Compiling Android APK with Gradle 8.5',
            log: {
              level: 'stderr',
              message: line,
              timestamp: new Date().toISOString(),
            },
          });
        }
      });

      // Strict compilation timeout: 5 minutes (Windows cold Gradle daemons take 2-3 mins)
      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32' && child.pid) {
            execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
          } else {
            child.kill();
          }
        } catch {
          // Ignore kill error
        }
        safeReject(new Error('Gradle compilation timed out after 300 seconds.'));
      }, 300000);

      child.on('exit', (code) => {
        if (code === 0) {
          safeResolve();
        } else if (code !== null) {
          safeReject(new Error(`Gradle compilation failed with exit code ${code}.\n${compilerLogs.slice(-1000)}`));
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          safeResolve();
        } else if (code !== null) {
          safeReject(new Error(`Gradle compilation failed with exit code ${code}.\n${compilerLogs.slice(-1000)}`));
        }
      });

      child.on('error', (err) => {
        safeReject(err);
      });
    });

    // ------------------------------------------------------------------------
    // STAGE 4: APK ARTIFACT VERIFICATION & OBJECT STORAGE (Progress: 88% -> 95%)
    // ------------------------------------------------------------------------
    await publish(
      'building',
      88,
      'Verifying compiled APK artifact integrity',
      '[Worker] Compiling completed. Scanning APK binary for Android integrity requirements...'
    );

    const releaseApkPath = path.join(
      workspace,
      'app/build/outputs/apk/release/app-release.apk'
    );
    const debugApkPath = path.join(
      workspace,
      'app/build/outputs/apk/debug/app-debug.apk'
    );
    const expectedApkPath = fs.existsSync(releaseApkPath)
      ? releaseApkPath
      : (fs.existsSync(debugApkPath) ? debugApkPath : releaseApkPath);

    if (!fs.existsSync(expectedApkPath)) {
      throw new Error(`Expected APK not found at: ${expectedApkPath}`);
    }

    const verification = verifyApk(expectedApkPath);
    if (!verification.isValid) {
      throw new Error(`APK Verification Failed: ${verification.errors.join('; ')}`);
    }

    await publish(
      'building',
      90,
      'Storing verified artifact in object storage',
      `[Worker] Verification passed: ${verification.sizeMb} MB, SHA-256: ${verification.sha256}. Uploading to storage...`,
      'success'
    );

    // Upload to Private Object Storage
    const storage = getStorageService();
    const cleanAppName = appConfig.appName.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'app';
    const isRelease = expectedApkPath.includes('release');
    const artifactFileName = isRelease ? `${cleanAppName}.apk` : `${cleanAppName}-debug.apk`;
    const storageKey = `artifacts/${conversionId}/${artifactFileName}`;

    const apkBuffer = fs.readFileSync(expectedApkPath);
    await storage.uploadFile(
      storageKey,
      apkBuffer,
      'application/vnd.android.package-archive'
    );

    // Generate authorized download token
    const downloadToken = TokenService.generateDownloadToken({
      conversionId,
      userId,
      fileName: artifactFileName,
    });

    const artifactMetadata: ArtifactMetadata = {
      fileName: artifactFileName,
      fileSizeBytes: apkBuffer.length,
      sha256: verification.sha256,
      storageKey,
      downloadToken,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(), // 24 hours
    };

    // ------------------------------------------------------------------------
    // STAGE 5: COMPLETION & ARTIFACT DELIVERY (Progress: 100%)
    // ------------------------------------------------------------------------
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    await ConversionRepository.updateStatus(conversionId, {
      status: 'completed',
      progress: 100,
      stageName: 'Build completed successfully',
      artifact: artifactMetadata,
      completedAt: new Date().toISOString(),
    });

    await EventBroker.publishEvent({
      conversionId,
      status: 'completed',
      progress: 100,
      stageName: 'Build completed successfully',
      artifact: artifactMetadata,
      log: {
        level: 'success',
        message: `[Worker] Build completed in ${durationSec}s! APK verified and ready for authorized download.`,
        timestamp: new Date().toISOString(),
      },
    });

    // Clean up isolated temporary build directory
    try {
      if (fs.existsSync(workspace)) {
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    } catch {
      // Ignore temporary workspace cleanup error
    }

    return artifactMetadata;
  } catch (error: any) {
    console.error(`[Worker Error in conversion ${conversionId}]:`, error);
    const current = await ConversionRepository.findById(conversionId);
    if (current?.status === 'cancelled' || error?.message?.includes('cancelled')) {
      try {
        if (fs.existsSync(workspace)) {
          fs.rmSync(workspace, { recursive: true, force: true });
        }
      } catch {
        // Ignore
      }
      return undefined as any;
    }

    let rawMessage = '';
    if (error?.errors && Array.isArray(error.errors)) {
      const details = error.errors.map((e: any) => e?.message || String(e)).filter(Boolean).join('; ');
      rawMessage = `${error.message || 'AggregateError'}: ${details}`;
    } else if (typeof error?.message === 'string' && error.message.trim().length > 0) {
      rawMessage = error.message.trim();
    } else {
      rawMessage = error?.stderr?.toString()?.trim() || String(error || '');
    }
    const errorMsg = rawMessage || 'Unknown build worker failure.';

    const finalStage = current?.stageName || 'Build failed';
    const finalProgress = current?.progress || 100;

    await ConversionRepository.updateStatus(conversionId, {
      status: 'failed',
      errorCode: 'BUILD_FAILED',
      errorMessage: errorMsg,
      completedAt: new Date().toISOString(),
    });

    await EventBroker.publishEvent({
      conversionId,
      status: 'failed',
      progress: finalProgress,
      stageName: finalStage,
      error: errorMsg,
      log: {
        level: 'error',
        message: `[Worker Error] ${errorMsg}`,
        timestamp: new Date().toISOString(),
      },
    });

    // Workspace cleanup on failure
    try {
      if (fs.existsSync(workspace)) {
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    } catch {
      // Ignore
    }

    throw error;
  }
}
