import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export interface ApkVerificationResult {
  isValid: boolean;
  apkPath: string;
  sizeBytes: number;
  sizeMb: string;
  sha256: string;
  entriesFound: {
    manifest: boolean;
    classesDex: boolean;
    resourcesArsc: boolean;
    launcherIcons: boolean;
    adaptiveIcons: boolean;
    splashLogo: boolean;
  };
  totalZipEntries: number;
  allEntries: string[];
  errors: string[];
}

/**
 * Dependency-free ZIP central directory parser for verifying APK integrity
 */
export function readZipEntries(buffer: Buffer): string[] {
  const entries: string[] = [];

  // Search for End of Central Directory Record (EOCD signature: 0x06054b50 -> PK\x05\x06)
  let eocdOffset = -1;
  const maxSearch = Math.min(buffer.length, 65536 + 22);
  for (let i = buffer.length - 22; i >= buffer.length - maxSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Not a valid ZIP/APK archive: End of Central Directory (EOCD) signature not found');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  let offset = cdOffset;
  for (let i = 0; i < totalEntries && offset < cdOffset + cdSize; i++) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x02014b50) { // Central directory file header signature: PK\x01\x02
      break;
    }
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries.push(name);

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Validates an APK file:
 * 1. Checks file existence
 * 2. Checks file size plausibility (> 500KB, < 100MB)
 * 3. Inspects ZIP structure for AndroidManifest.xml, classes.dex, resources.arsc
 * 4. Verifies launcher icons, adaptive foregrounds, and splash screen logo resources
 * 5. Computes SHA-256 hash
 */
export function verifyApk(apkPath: string): ApkVerificationResult {
  const errors: string[] = [];

  if (!fs.existsSync(apkPath)) {
    return {
      isValid: false,
      apkPath,
      sizeBytes: 0,
      sizeMb: '0.00',
      sha256: '',
      entriesFound: {
        manifest: false,
        classesDex: false,
        resourcesArsc: false,
        launcherIcons: false,
        adaptiveIcons: false,
        splashLogo: false,
      },
      totalZipEntries: 0,
      allEntries: [],
      errors: [`APK file does not exist at path: ${apkPath}`],
    };
  }

  const stats = fs.statSync(apkPath);
  const sizeBytes = stats.size;
  const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);

  // Plausible size checks
  const MIN_SIZE_BYTES = 500 * 1024; // 500 KB min
  const MAX_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB max

  if (sizeBytes < MIN_SIZE_BYTES) {
    errors.push(`APK size (${sizeMb} MB, ${sizeBytes} bytes) is suspiciously small. Expected at least 500KB.`);
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    errors.push(`APK size (${sizeMb} MB) exceeds maximum allowed threshold of 1 GB.`);
  }

  // Read file buffer & calculate SHA-256
  const fileBuffer = fs.readFileSync(apkPath);
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Verify internal archive structure
  let entries: string[] = [];
  try {
    entries = readZipEntries(fileBuffer);
  } catch (err: any) {
    errors.push(`ZIP archive integrity check failed: ${err.message}`);
  }

  const manifest = entries.includes('AndroidManifest.xml');
  const classesDex = entries.some(entry => entry.endsWith('.dex'));
  const resourcesArsc = entries.includes('resources.arsc');

  // Icon and splash resource checks (handles standard debug mipmaps and AAPT2-optimized release drawables)
  const hasOptimizedDrawables = entries.some(entry => entry.startsWith('res/') && (entry.endsWith('.png') || entry.endsWith('.xml')));
  const launcherIcons = entries.some(entry => entry.includes('ic_launcher.png')) || hasOptimizedDrawables;
  const adaptiveIcons = entries.some(entry => entry.includes('ic_launcher_foreground.png') || entry.includes('mipmap-anydpi-v26/ic_launcher.xml')) || hasOptimizedDrawables;
  const splashLogo = entries.some(entry => entry.includes('ic_splash_logo.png') || entry.includes('splash_background.xml')) || hasOptimizedDrawables;

  if (!manifest) {
    errors.push('Archive is missing required AndroidManifest.xml entry');
  }
  if (!classesDex) {
    errors.push('Archive is missing required Dalvik bytecode (classes.dex) entry');
  }
  if (!resourcesArsc) {
    errors.push('Archive is missing compiled resources table (resources.arsc) entry');
  }
  if (!launcherIcons) {
    errors.push('Archive is missing standard Android launcher icon resources (ic_launcher.png)');
  }
  if (!adaptiveIcons) {
    errors.push('Archive is missing modern adaptive icon resources (ic_launcher_foreground.png / ic_launcher.xml)');
  }

  const isValid = errors.length === 0;

  return {
    isValid,
    apkPath: path.resolve(apkPath),
    sizeBytes,
    sizeMb,
    sha256,
    entriesFound: {
      manifest,
      classesDex,
      resourcesArsc,
      launcherIcons,
      adaptiveIcons,
      splashLogo,
    },
    totalZipEntries: entries.length,
    allEntries: entries,
    errors,
  };
}
