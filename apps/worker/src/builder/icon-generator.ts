import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LogoValidationResult {
  valid: boolean;
  format?: 'png' | 'jpeg';
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Validates PNG and JPEG image buffers by inspecting magic numbers and header chunks
 */
export function validateLogoBuffer(buffer: Buffer): LogoValidationResult {
  const MAX_SIZE = 5 * 1024 * 1024; // 5 MB max
  const MIN_DIMENSION = 1; // Allows 1x1 test fixtures and standard icons up to 4096px
  const MAX_DIMENSION = 4096;

  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Logo buffer is empty.' };
  }

  if (buffer.length > MAX_SIZE) {
    return {
      valid: false,
      error: `Logo file size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds 5 MB limit.`,
    };
  }

  // Check PNG magic bytes: \x89PNG\r\n\x1a\n
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  // Check JPEG magic bytes: \xFF\xD8\xFF
  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  if (!isPng && !isJpeg) {
    return {
      valid: false,
      error: 'Unsupported image format. Logo must be a valid PNG or JPEG image.',
    };
  }

  let width = 0;
  let height = 0;

  if (isPng) {
    if (buffer.length < 24) {
      return { valid: false, error: 'Corrupted PNG header.' };
    }
    // IHDR chunk: width at 16..20, height at 20..24 (Big Endian)
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (isJpeg) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // Baseline SOF0 (0xC0) or Progressive SOF2 (0xC2)
      if (marker === 0xc0 || marker === 0xc2) {
        height = buffer.readUInt16BE(offset + 5);
        width = buffer.readUInt16BE(offset + 7);
        break;
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }

    if (width === 0 || height === 0) {
      return { valid: false, error: 'Could not extract dimensions from JPEG image.' };
    }
  }

  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return {
      valid: false,
      width,
      height,
      error: `Logo dimensions (${width}x${height}) are too small. Minimum size is ${MIN_DIMENSION}x${MIN_DIMENSION} pixels.`,
    };
  }

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return {
      valid: false,
      width,
      height,
      error: `Logo dimensions (${width}x${height}) exceed maximum allowed size of ${MAX_DIMENSION}x${MAX_DIMENSION} pixels.`,
    };
  }

  return {
    valid: true,
    format: isPng ? 'png' : 'jpeg',
    width,
    height,
  };
}

function findIconProcessorJava(): string {
  const candidates = [
    process.env.ICON_PROCESSOR_JAVA,
    path.resolve(process.cwd(), 'packages/android-template/scripts/IconProcessor.java'),
    path.resolve(__dirname, '../../../../packages/android-template/scripts/IconProcessor.java'),
    path.resolve(__dirname, '../../../packages/android-template/scripts/IconProcessor.java'),
    '/opt/android-template/scripts/IconProcessor.java',
  ].filter((c): c is string => typeof c === 'string' && fs.existsSync(c));

  if (candidates.length > 0) {
    return candidates[0];
  }

  throw new Error('IconProcessor.java could not be located.');
}

export interface GenerateIconOptions {
  fallbackOnFailure?: boolean;
}

/**
 * Executes IconProcessor.java to generate all Android mipmap densities, adaptive foregrounds, and splash logo
 */
export function generateAndroidIcons(
  resDir: string,
  iconDataUrl: string | undefined,
  themeColor: string = '#7C3AED',
  javaCmd: string = 'java',
  options: GenerateIconOptions = {}
): void {
  const iconProcessorJava = findIconProcessorJava();

  const generateDefault = () => {
    try {
      execSync(`"${javaCmd}" "${iconProcessorJava}" DEFAULT "${resDir}" "${themeColor}"`, {
        stdio: 'pipe',
      });
    } catch (err: any) {
      const stderr = (err.stderr && err.stderr.length > 0)
        ? err.stderr.toString().trim()
        : (err.message || String(err));
      throw new Error(`Failed to generate default Android icons: ${stderr}`);
    }
  };

  if (!iconDataUrl || iconDataUrl.trim() === '') {
    generateDefault();
    return;
  }

  try {
    // Parse and validate base64 Data URL
    const match = iconDataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    if (!match || !match[2]) {
      throw new Error('Invalid logo Data URL format. Expected data:image/png;base64,... or data:image/jpeg;base64,...');
    }

    const format = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');

    const validation = validateLogoBuffer(buffer);
    if (!validation.valid) {
      throw new Error(`Logo validation failed: ${validation.error}`);
    }

    // Store in private temporary workspace location
    const tempLogoPath = path.join(resDir, `..`, `.temp_logo_${Date.now()}.${format === 'png' ? 'png' : 'jpg'}`);
    fs.writeFileSync(tempLogoPath, buffer);

    try {
      execSync(`"${javaCmd}" "${iconProcessorJava}" "${tempLogoPath}" "${resDir}" "${themeColor}"`, {
        stdio: 'pipe',
      });
    } catch (err: any) {
      const stderr = (err.stderr && err.stderr.length > 0)
        ? err.stderr.toString().trim()
        : (err.message || String(err));
      throw new Error(`Failed to process custom Android icons: ${stderr}`);
    } finally {
      if (fs.existsSync(tempLogoPath)) {
        try {
          fs.unlinkSync(tempLogoPath);
        } catch (_: any) {}
      }
    }
  } catch (err: any) {
    if (options.fallbackOnFailure) {
      console.warn(`[Icon Generator] Custom icon processing failed (${err.message}). Generating default adaptive icons as fallback.`);
      generateDefault();
    } else {
      throw err;
    }
  }
}
