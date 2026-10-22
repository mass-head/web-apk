import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyApk, ApkVerificationResult } from './apk-verifier.js';
import { generateAndroidIcons } from './icon-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateRoot = path.resolve(__dirname, '..');

export interface BuildConfig {
  mode?: 'REMOTE' | 'LOCAL';
  applicationId?: string;
  appName?: string;
  url?: string;
  themeColor?: string;
  iconDataUrl?: string;
  webZipPath?: string;
  clean?: boolean;
  enableCamera?: boolean;
  enableGeolocation?: boolean;
  variant?: 'release' | 'debug';
  hideCustomLoadingSelector?: string;
}

export interface BuildResult {
  success: boolean;
  apkPath: string;
  verification?: ApkVerificationResult;
  durationMs: number;
  error?: string;
}

/**
 * Injects build configuration into the native Android template
 */
export function injectConfig(config: BuildConfig, env?: NodeJS.ProcessEnv): void {
  const mode = config.mode || 'REMOTE';
  const appId = config.applicationId || 'com.web2apk.demo';
  const appName = config.appName || 'Web2APK Demo';
  const url = config.url || 'https://example.com';
  const themeColor = config.themeColor || '#7C3AED';

  // 1. Update AppConfig.kt
  const appConfigPath = path.join(
    templateRoot,
    'app/src/main/java/com/web2apk/template/AppConfig.kt'
  );
  if (fs.existsSync(appConfigPath)) {
    let appConfigCode = fs.readFileSync(appConfigPath, 'utf8');
    appConfigCode = appConfigCode.replace(
      /val contentSource: ContentSource = ContentSource\.[A-Z]+/,
      `val contentSource: ContentSource = ContentSource.${mode}`
    );
    appConfigCode = appConfigCode.replace(
      /const val REMOTE_URL: String = "[^"]*"/,
      `const val REMOTE_URL: String = "${url}"`
    );
    if (config.hideCustomLoadingSelector) {
      appConfigCode = appConfigCode.replace(
        /const val HIDE_CUSTOM_LOADING_SELECTOR: String = "[^"]*"/,
        `const val HIDE_CUSTOM_LOADING_SELECTOR: String = "${config.hideCustomLoadingSelector.replace(/"/g, '\\"')}"`
      );
    }
    fs.writeFileSync(appConfigPath, appConfigCode, 'utf8');
  }

  // 2. Update strings.xml
  const stringsPath = path.join(templateRoot, 'app/src/main/res/values/strings.xml');
  if (fs.existsSync(stringsPath)) {
    let stringsXml = fs.readFileSync(stringsPath, 'utf8');
    stringsXml = stringsXml.replace(
      /<string name="app_name">[^<]*<\/string>/,
      `<string name="app_name">${appName}</string>`
    );
    fs.writeFileSync(stringsPath, stringsXml, 'utf8');
  }

  // 3. Update colors.xml
  const colorsPath = path.join(templateRoot, 'app/src/main/res/values/colors.xml');
  if (fs.existsSync(colorsPath)) {
    let colorsXml = fs.readFileSync(colorsPath, 'utf8');
    colorsXml = colorsXml.replace(
      /<color name="primaryColor">[^<]*<\/color>/,
      `<color name="primaryColor">${themeColor}</color>`
    );
    fs.writeFileSync(colorsPath, colorsXml, 'utf8');
  }

  // 4. Update app/build.gradle.kts applicationId
  const buildGradlePath = path.join(templateRoot, 'app/build.gradle.kts');
  if (fs.existsSync(buildGradlePath)) {
    let gradleCode = fs.readFileSync(buildGradlePath, 'utf8');
    gradleCode = gradleCode.replace(
      /applicationId = "[^"]*"/,
      `applicationId = "${appId}"`
    );
    fs.writeFileSync(buildGradlePath, gradleCode, 'utf8');
  }

  // 5. Update AndroidManifest.xml (Dynamic Permission Pruning - Only include if explicitly requested)
  const manifestPath = path.join(templateRoot, 'app/src/main/AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    let dynamicPermissions = '';

    if (config.enableCamera) {
      dynamicPermissions += '    <uses-permission android:name="android.permission.CAMERA" />\n';
      dynamicPermissions += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n';
    }

    if (config.enableGeolocation) {
      dynamicPermissions += '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />\n';
      dynamicPermissions += '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />\n';
      dynamicPermissions += '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n';
    }

    manifest = manifest.replace('<!-- DYNAMIC_PERMISSIONS_ANCHOR -->', dynamicPermissions.trimEnd());
    fs.writeFileSync(manifestPath, manifest, 'utf8');
  }

  // 6. Generate Android Launcher Icons, Adaptive Foregrounds, and Splash Logo
  const resDir = path.join(templateRoot, 'app/src/main/res');
  const javaCmd = env?.JAVA_HOME
    ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  generateAndroidIcons(resDir, config.iconDataUrl, themeColor, javaCmd);

  // 7. Handle LOCAL mode static website ZIP
  if (mode === 'LOCAL' && config.webZipPath && fs.existsSync(config.webZipPath)) {
    const assetsWebDir = path.join(templateRoot, 'app/src/main/assets/web');
    if (!fs.existsSync(assetsWebDir)) {
      fs.mkdirSync(assetsWebDir, { recursive: true });
    }
    // Safely extract on Windows/POSIX
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Expand-Archive -Path '${config.webZipPath}' -DestinationPath '${assetsWebDir}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`unzip -o -q "${config.webZipPath}" -d "${assetsWebDir}"`, {
        stdio: 'inherit',
      });
    }
  }
}

/**
 * Resolves Java & Android SDK paths on host / worker system
 */
function resolveEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Detect Unity OpenJDK or standard Java if not set
  if (!env.JAVA_HOME) {
    const standardPaths = [
      'C:\\Program Files\\Unity\\Hub\\Editor\\6000.2.12f1\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17',
      'C:\\Program Files\\Java\\jdk-17',
      '/usr/lib/jvm/java-17-openjdk-amd64',
    ];
    for (const p of standardPaths) {
      if (fs.existsSync(p)) {
        env.JAVA_HOME = p;
        break;
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

  // Inject into PATH / Path (Windows case sensitivity)
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
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

/**
 * Builds the Android APK by executing Gradle assembleDebug
 */
export async function buildApk(config: BuildConfig = {}): Promise<BuildResult> {
  const startTime = Date.now();
  console.log('----------------------------------------------------');
  console.log('🚀 Web2APK Native Android Project Builder');
  console.log('----------------------------------------------------');
  console.log(`Mode:           ${config.mode || 'REMOTE'}`);
  console.log(`Application ID: ${config.applicationId || 'com.web2apk.demo'}`);
  console.log(`App Name:       ${config.appName || 'Web2APK Demo'}`);
  console.log(`Target URL:     ${config.url || 'https://example.com'}`);
  console.log(`Theme Color:    ${config.themeColor || '#7C3AED'}`);
  console.log('----------------------------------------------------');

  try {
    // 1. Prepare environment and Gradle command
    const env = resolveEnvironment();

    // 2. Inject configurations and generate icons
    console.log('⚙️  Injecting build configuration into Android template...');
    injectConfig(config, env);

    const isWindows = process.platform === 'win32';
    const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';

    const variant = config.variant || 'release';
    const taskName = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
    const tasks = config.clean ? `clean ${taskName}` : taskName;
    console.log(`🔨 Executing Gradle task: ${gradleCmd} ${tasks}`);

    execSync(`${gradleCmd} ${tasks} --no-daemon`, {
      cwd: templateRoot,
      env,
      stdio: 'inherit',
    });

    // 3. Locate generated APK
    const expectedApkPath = path.join(
      templateRoot,
      `app/build/outputs/apk/${variant}/app-${variant}.apk`
    );

    if (!fs.existsSync(expectedApkPath)) {
      throw new Error(`Build finished but APK was not found at expected location: ${expectedApkPath}`);
    }

    console.log('🔍 Running automated APK verification...');
    const verification = verifyApk(expectedApkPath);
    const durationMs = Date.now() - startTime;

    if (!verification.isValid) {
      console.error('❌ APK Verification Failed:');
      verification.errors.forEach((err) => console.error(`  - ${err}`));
      return {
        success: false,
        apkPath: expectedApkPath,
        verification,
        durationMs,
        error: verification.errors.join('; '),
      };
    }

    console.log('✅ APK Verification Passed!');
    console.log(`📦 Artifact Path: ${verification.apkPath}`);
    console.log(`📊 Size:          ${verification.sizeMb} MB (${verification.sizeBytes} bytes)`);
    console.log(`🔑 SHA-256:       ${verification.sha256}`);
    console.log(`📋 Total Entries: ${verification.totalZipEntries} archive entries`);
    console.log(`⏱️  Build Time:    ${(durationMs / 1000).toFixed(1)}s`);
    console.log('----------------------------------------------------');

    return {
      success: true,
      apkPath: expectedApkPath,
      verification,
      durationMs,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('💥 Build failed with exception:', error.message);
    return {
      success: false,
      apkPath: '',
      durationMs,
      error: error.message,
    };
  }
}

// Support CLI invocation
if (process.argv[1] && process.argv[1].endsWith('build-apk.ts')) {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  const config: BuildConfig = {
    mode: (getArg('mode') as 'REMOTE' | 'LOCAL') || 'REMOTE',
    applicationId: getArg('appId') || 'com.web2apk.demo',
    appName: getArg('appName') || 'Web2APK Demo',
    url: getArg('url') || 'https://example.com',
    themeColor: getArg('themeColor') || '#7C3AED',
    iconDataUrl: getArg('icon'),
    webZipPath: getArg('webZip'),
    clean: args.includes('--clean'),
    enableCamera: args.includes('--camera'),
    enableGeolocation: args.includes('--geo'),
    variant: (getArg('variant') as 'release' | 'debug') || (args.includes('--debug') ? 'debug' : 'release'),
    hideCustomLoadingSelector: getArg('hideCustomLoadingSelector') || getArg('hide-loader'),
  };

  buildApk(config).then((res) => {
    if (!res.success) {
      process.exit(1);
    }
  });
}
