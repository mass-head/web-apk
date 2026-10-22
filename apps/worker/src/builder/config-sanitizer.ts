import fs from 'node:fs';
import path from 'node:path';
import { generateAndroidIcons } from './icon-generator.js';
import { resolveEnvironment } from './gradle-runner.js';

export interface AppConfigInput {
  appName?: string;
  packageName?: string;
  themeColor?: string;
  versionCode?: number;
  versionName?: string;
  enablePullToRefresh?: boolean;
  enableCamera?: boolean;
  enableGeolocation?: boolean;
  customUserAgent?: string;
  iconDataUrl?: string;
  hideCustomLoadingSelector?: string;
}

export interface BuildPayload {
  conversionId: string;
  mode: 'url' | 'upload';
  targetUrl?: string;
  appConfig: AppConfigInput;
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeKotlinString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$');
}

export function validatePackageName(pkg: string): { valid: boolean; error?: string } {
  if (!pkg || typeof pkg !== 'string') {
    return { valid: false, error: 'Package name is required.' };
  }

  const reservedKeywords = new Set([
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
    'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final',
    'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int',
    'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public',
    'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
    'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
  ]);

  const brandImpersonations = new Set([
    'google', 'android', 'youtube', 'facebook', 'whatsapp', 'instagram', 'amazon',
    'microsoft', 'apple', 'paypal', 'netflix', 'twitter', 'tiktok', 'telegram'
  ]);

  const segments = pkg.split('.');
  if (segments.length < 2) {
    return { valid: false, error: 'Package name must contain at least two segments.' };
  }

  const segmentRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/;
  for (const seg of segments) {
    if (!seg) {
      return { valid: false, error: 'Package name segments cannot be empty.' };
    }
    if (!segmentRegex.test(seg)) {
      return { valid: false, error: `Invalid package segment "${seg}". Must begin with a letter.` };
    }
    if (reservedKeywords.has(seg.toLowerCase())) {
      return { valid: false, error: `Segment "${seg}" is a reserved Java keyword.` };
    }
  }

  // Prevent brand impersonation in top-level package namespaces (e.g. com.google, com.youtube)
  if (segments.length >= 2 && brandImpersonations.has(segments[1].toLowerCase()) && segments[0].toLowerCase() === 'com') {
    return { valid: false, error: `Package name cannot directly impersonate the official "${segments[1]}" namespace.` };
  }

  return { valid: true };
}

export class ConfigSanitizer {
  configureProject(workspace: string, payload: BuildPayload, entryPoint = 'index.html'): void {
    const { appConfig, mode, targetUrl } = payload;
    const appName = appConfig.appName || 'Web2APK App';
    const packageName = appConfig.packageName || 'com.web2apk.app';
    const url = targetUrl || 'https://example.com';
    const themeColor = appConfig.themeColor || '#7C3AED';
    const versionCode = appConfig.versionCode || 1;
    const versionName = appConfig.versionName || '1.0.0';

    // 1. AppConfig.kt
    const appConfigPath = path.join(
      workspace,
      'app/src/main/java/com/web2apk/template/AppConfig.kt'
    );
    if (fs.existsSync(appConfigPath)) {
      let code = fs.readFileSync(appConfigPath, 'utf8');
      if (mode === 'upload') {
        code = code.replace(
          /val contentSource: ContentSource = ContentSource\.[A-Z]+/,
          'val contentSource: ContentSource = ContentSource.LOCAL'
        );
        code = code.replace(
          /const val LOCAL_ASSET_PATH: String = "[^"]*"/,
          `const val LOCAL_ASSET_PATH: String = "web/${escapeKotlinString(entryPoint)}"`
        );
      } else {
        code = code.replace(
          /val contentSource: ContentSource = ContentSource\.[A-Z]+/,
          'val contentSource: ContentSource = ContentSource.REMOTE'
        );
        code = code.replace(
          /const val REMOTE_URL: String = "[^"]*"/,
          `const val REMOTE_URL: String = "${escapeKotlinString(url)}"`
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
          `const val CUSTOM_USER_AGENT_SUFFIX: String = "${escapeKotlinString(appConfig.customUserAgent)}"`
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
          `const val HIDE_CUSTOM_LOADING_SELECTOR: String = "${escapeKotlinString(appConfig.hideCustomLoadingSelector)}"`
        );
      }

      fs.writeFileSync(appConfigPath, code, 'utf8');
    }

    // 2. strings.xml
    const stringsPath = path.join(workspace, 'app/src/main/res/values/strings.xml');
    if (fs.existsSync(stringsPath)) {
      let xml = fs.readFileSync(stringsPath, 'utf8');
      xml = xml.replace(
        /<string name="app_name">[^<]*<\/string>/,
        `<string name="app_name">${escapeXml(appName)}</string>`
      );
      fs.writeFileSync(stringsPath, xml, 'utf8');
    }

    // 3. colors.xml
    const colorsPath = path.join(workspace, 'app/src/main/res/values/colors.xml');
    if (fs.existsSync(colorsPath)) {
      let xml = fs.readFileSync(colorsPath, 'utf8');
      xml = xml.replace(
        /<color name="primaryColor">[^<]*<\/color>/,
        `<color name="primaryColor">${escapeXml(themeColor)}</color>`
      );
      fs.writeFileSync(colorsPath, xml, 'utf8');
    }

    // 4. app/build.gradle.kts
    const gradlePath = path.join(workspace, 'app/build.gradle.kts');
    if (fs.existsSync(gradlePath)) {
      let gradle = fs.readFileSync(gradlePath, 'utf8');
      gradle = gradle.replace(/applicationId = "[^"]*"/, `applicationId = "${packageName}"`);
      gradle = gradle.replace(/versionCode = \d+/, `versionCode = ${versionCode}`);
      gradle = gradle.replace(/versionName = "[^"]*"/, `versionName = "${escapeKotlinString(versionName)}"`);
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

    // 5. Generate Android Launcher Icons, Adaptive Foregrounds, and Splash Logo
    const resDir = path.join(workspace, 'app/src/main/res');
    const env = resolveEnvironment();
    const javaCmd = env?.JAVA_HOME
      ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java';
    generateAndroidIcons(resDir, appConfig.iconDataUrl, themeColor, javaCmd, { fallbackOnFailure: true });
  }
}

export const configSanitizer = new ConfigSanitizer();
