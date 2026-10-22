import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Security Limits for Uploaded Static Website ZIP Archives
 */
export const ZIP_LIMITS = {
  MAX_COMPRESSED_SIZE: 1024 * 1024 * 1024,     // 1 GB max compressed archive
  MAX_DECOMPRESSED_SIZE: 3 * 1024 * 1024 * 1024, // 3 GB max total decompressed size (ZIP bomb protection)
  MAX_FILE_COUNT: 15000,                       // 15,000 files max per archive
  MAX_PER_FILE_SIZE: 50 * 1024 * 1024,         // 50 MB max per single file
  MAX_COMPRESSION_RATIO: 100,                  // Max compression ratio for files > 1MB
};

/**
 * Disallowed or dangerous file extensions prohibited from static website packages
 */
export const PROHIBITED_EXTENSIONS = new Set([
  // Executables & native binaries
  '.exe', '.dll', '.so', '.bin', '.elf', '.dylib', '.com', '.scr', '.msi', '.sys', '.drv',
  // Server-side scripts & shell scripts (never execute on server)
  '.sh', '.bash', '.bat', '.cmd', '.ps1', '.vbs', '.wsf', '.pif',
  '.php', '.php3', '.phtml', '.py', '.rb', '.pl', '.cgi',
  // Java & Android compiled binaries
  '.apk', '.aab', '.dex', '.jar', '.class', '.war', '.ear',
]);

/**
 * Permitted static website asset extensions
 */
export const PERMITTED_STATIC_EXTENSIONS = new Set([
  // Web documents
  '.html', '.htm', '.xhtml',
  // Stylesheets
  '.css', '.scss', '.sass', '.less',
  // JavaScript & Web sandboxed scripts
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.map',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif', '.bmp', '.tif', '.tiff',
  // Audio & Video
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.mp4', '.webm', '.ogv', '.mov',
  // Web Fonts
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // Web Data, Configuration & Manifests
  '.json', '.xml', '.txt', '.csv', '.tsv', '.webmanifest', '.manifest', '.yaml', '.yml', '.md',
  // WebAssembly
  '.wasm',
  // Documents
  '.pdf',
]);

export interface ZipEntryMeta {
  rawName: string;
  normalizedName: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number; // 0 = stored, 8 = deflated
  crc32: number;
  isSymlink: boolean;
  isEncrypted: boolean;
  localHeaderOffset: number;
}

export interface ZipValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
  entryCount: number;
  totalCompressedBytes: number;
  totalDecompressedBytes: number;
  entryPoint?: string;
  topLevelDirectory?: string | null;
  hasIndexHtml: boolean;
  assetCounts?: {
    html: number;
    css: number;
    js: number;
    images: number;
    fonts: number;
    audioVideo: number;
    data: number;
    other: number;
  };
  referencedAssets?: {
    total: number;
    available: number;
    missing: string[];
  };
  warnings?: string[];
  entries?: ZipEntryMeta[];
}

/**
 * Locates End of Central Directory (EOCD) in a ZIP buffer
 */
function findEOCD(buffer: Buffer): number {
  const minEOCDSize = 22;
  const maxCommentSize = 65535;
  const maxSearch = Math.min(buffer.length, minEOCDSize + maxCommentSize);

  for (let i = buffer.length - minEOCDSize; i >= buffer.length - maxSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}

/**
 * Reads and validates entries from the ZIP Central Directory with security checks
 */
export function inspectZipBuffer(buffer: Buffer): {
  entries: ZipEntryMeta[];
  totalDecompressedBytes: number;
  error?: string;
} {
  if (buffer.length < 22) {
    return { entries: [], totalDecompressedBytes: 0, error: 'Malformed archive: ZIP file size is too small.' };
  }

  if (buffer.length > ZIP_LIMITS.MAX_COMPRESSED_SIZE) {
    return {
      entries: [],
      totalDecompressedBytes: 0,
      error: `Compressed ZIP archive exceeds limit of ${ZIP_LIMITS.MAX_COMPRESSED_SIZE / (1024 * 1024)} MB.`,
    };
  }

  const eocdOffset = findEOCD(buffer);
  if (eocdOffset === -1) {
    return {
      entries: [],
      totalDecompressedBytes: 0,
      error: 'Malformed archive: End of Central Directory (EOCD) signature not found. Not a valid ZIP file.',
    };
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > ZIP_LIMITS.MAX_FILE_COUNT) {
    return {
      entries: [],
      totalDecompressedBytes: 0,
      error: `Archive contains ${totalEntries} files, exceeding limit of ${ZIP_LIMITS.MAX_FILE_COUNT} files.`,
    };
  }

  if (cdOffset >= buffer.length || cdOffset + cdSize > buffer.length) {
    return {
      entries: [],
      totalDecompressedBytes: 0,
      error: 'Malformed archive: Central Directory table corrupted or truncated.',
    };
  }

  const entries: ZipEntryMeta[] = [];
  let totalDecompressed = 0;
  let offset = cdOffset;

  for (let i = 0; i < totalEntries && offset < cdOffset + cdSize; i++) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `Malformed archive: Central Directory entry ${i} corrupted.`,
      };
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const crc32 = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    // 1. Encryption check
    if ((flags & 0x01) !== 0) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `Encrypted archives are not supported. File "${name}" is password-protected.`,
      };
    }

    // 2. Compression method check (0 = Stored, 8 = Deflated)
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `Unsupported compression algorithm (${compressionMethod}) for file "${name}".`,
      };
    }

    // 3. Symlink check (Unix mode stored in high 16 bits: 0o120000 = S_IFLNK)
    const unixMode = externalAttributes >>> 16;
    const isSymlink = (unixMode & 0o170000) === 0o120000;
    if (isSymlink) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `Security violation: Symlinks are prohibited ("${name}").`,
      };
    }

    // 4. Path Traversal & Absolute Path check
    if (name.includes('\0')) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `Security violation: Null byte detected in file path "${name}".`,
      };
    }

    // Check for leading slashes, Windows drive letters (C:) or UNC paths (\\)
    if (
      name.startsWith('/') ||
      name.startsWith('\\') ||
      /^[a-zA-Z]:/.test(name) ||
      name.startsWith('//') ||
      name.startsWith('\\\\')
    ) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `Security violation: Absolute file paths are prohibited ("${name}").`,
      };
    }

    // Check for directory traversal segments
    const pathSegments = name.replace(/\\/g, '/').split('/');
    if (pathSegments.some((seg) => seg === '..')) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `Security violation: Directory traversal attack detected in "${name}".`,
      };
    }

    const isDirectory = name.endsWith('/') || name.endsWith('\\');

    // 5. Per-file size check
    if (!isDirectory && uncompressedSize > ZIP_LIMITS.MAX_PER_FILE_SIZE) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `File "${name}" (${(uncompressedSize / (1024 * 1024)).toFixed(1)} MB) exceeds 50 MB per-file limit.`,
      };
    }

    // 6. ZIP Bomb Check (cumulative size & compression ratio)
    totalDecompressed += uncompressedSize;
    if (totalDecompressed > ZIP_LIMITS.MAX_DECOMPRESSED_SIZE) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `ZIP bomb detected: Total decompressed size exceeds ${ZIP_LIMITS.MAX_DECOMPRESSED_SIZE / (1024 * 1024)} MB limit.`,
      };
    }

    if (
      !isDirectory &&
      uncompressedSize > 1024 * 1024 &&
      uncompressedSize / Math.max(1, compressedSize) > ZIP_LIMITS.MAX_COMPRESSION_RATIO
    ) {
      return {
        entries: [],
        totalDecompressedBytes: 0,
        error: `ZIP bomb detected: Suspicious compression ratio for "${name}".`,
      };
    }

    // 7. Disallowed & Prohibited file extensions
    if (!isDirectory) {
      const ext = path.extname(name).toLowerCase();
      if (PROHIBITED_EXTENSIONS.has(ext)) {
        return {
          entries: [],
          totalDecompressedBytes: 0,
          error: `Security violation: Disallowed executable or dangerous file type "${ext}" in "${name}".`,
        };
      }

      // Check if file has an extension and verify it against permitted static web assets
      if (ext && !PERMITTED_STATIC_EXTENSIONS.has(ext)) {
        return {
          entries: [],
          totalDecompressedBytes: 0,
          error: `Disallowed file type "${ext}" in "${name}". Only static website assets (HTML, CSS, JS, images, fonts, media) are permitted.`,
        };
      }
    }

    const normalizedName = name.replace(/\\/g, '/').replace(/^\.\//, '');

    entries.push({
      rawName: name,
      normalizedName,
      isDirectory,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      crc32,
      isSymlink,
      isEncrypted: false,
      localHeaderOffset,
    });
  }

  return { entries, totalDecompressedBytes: totalDecompressed };
}

/**
 * Extracts raw decompressed bytes for a specific ZIP entry
 */
export function extractEntryData(buffer: Buffer, entry: ZipEntryMeta): Buffer {
  if (entry.isDirectory || entry.uncompressedSize === 0) {
    return Buffer.alloc(0);
  }

  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length) {
    throw new Error(`Corrupted local file header for "${entry.rawName}"`);
  }

  const localSig = buffer.readUInt32LE(offset);
  if (localSig !== 0x04034b50) {
    throw new Error(`Invalid local file header signature for "${entry.rawName}"`);
  }

  const nameLen = buffer.readUInt16LE(offset + 26);
  const extraLen = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > buffer.length) {
    throw new Error(`Compressed payload for "${entry.rawName}" exceeds archive buffer.`);
  }

  const compressedData = buffer.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    // Uncompressed (Stored)
    return Buffer.from(compressedData);
  } else if (entry.compressionMethod === 8) {
    // Raw Deflate
    const decompressed = zlib.inflateRawSync(compressedData);
    if (decompressed.length !== entry.uncompressedSize) {
      throw new Error(`Decompressed size mismatch for "${entry.rawName}": expected ${entry.uncompressedSize}, got ${decompressed.length}`);
    }
    return decompressed;
  } else {
    throw new Error(`Unsupported compression method ${entry.compressionMethod}`);
  }
}

/**
 * Inspects index.html and checks relative references against the normalized files map
 */
function verifyHtmlAssetReferences(
  htmlContent: string,
  availableNormalizedPaths: Set<string>
): { total: number; available: number; missing: string[] } {
  // Regex to extract relative asset URLs from HTML attributes
  const assetRegex = /(?:href|src)=["']([^"']+)["']/gi;
  const missing: string[] = [];
  const checked = new Set<string>();
  let total = 0;
  let available = 0;

  let match: RegExpExecArray | null;
  while ((match = assetRegex.exec(htmlContent)) !== null) {
    const rawRef = match[1].trim();

    // Ignore empty or non-relative schemes
    if (
      !rawRef ||
      rawRef.startsWith('http://') ||
      rawRef.startsWith('https://') ||
      rawRef.startsWith('//') ||
      rawRef.startsWith('data:') ||
      rawRef.startsWith('blob:') ||
      rawRef.startsWith('javascript:') ||
      rawRef.startsWith('mailto:') ||
      rawRef.startsWith('tel:') ||
      rawRef.startsWith('#')
    ) {
      continue;
    }

    // Strip URL query parameters and hash anchors
    const cleanPath = rawRef.split('?')[0].split('#')[0].replace(/^\.\//, '').replace(/^\//, '');
    if (!cleanPath || checked.has(cleanPath)) {
      continue;
    }

    checked.add(cleanPath);
    total++;

    // Check if cleanPath exists in available paths
    if (availableNormalizedPaths.has(cleanPath)) {
      available++;
    } else {
      // Check case-insensitive match
      const lower = cleanPath.toLowerCase();
      const hasCaseInsensitive = Array.from(availableNormalizedPaths).some(
        (p) => p.toLowerCase() === lower
      );
      if (hasCaseInsensitive) {
        available++;
      } else {
        missing.push(cleanPath);
      }
    }
  }

  return { total, available, missing };
}

/**
 * Validates a static website ZIP archive completely:
 * - Security & size limits
 * - Detects top-level directory wrapper (e.g. dist/)
 * - Identifies entry point (index.html)
 * - Verifies relative asset references
 * - Never executes arbitrary scripts
 */
export async function validateZipArchive(buffer: Buffer): Promise<ZipValidationResult> {
  const inspect = inspectZipBuffer(buffer);
  if (inspect.error || inspect.entries.length === 0) {
    return {
      valid: false,
      code: 'INVALID_ZIP_ARCHIVE',
      error: inspect.error || 'Empty or invalid ZIP archive.',
      entryCount: 0,
      totalCompressedBytes: buffer.length,
      totalDecompressedBytes: 0,
      hasIndexHtml: false,
    };
  }

  const entries = inspect.entries;
  const nonDirEntries = entries.filter((e) => !e.isDirectory);

  if (nonDirEntries.length === 0) {
    return {
      valid: false,
      code: 'EMPTY_ARCHIVE',
      error: 'ZIP archive contains directories only, with no website files.',
      entryCount: entries.length,
      totalCompressedBytes: buffer.length,
      totalDecompressedBytes: 0,
      hasIndexHtml: false,
    };
  }

  // 1. Detect optional common top-level directory wrapper (e.g. "dist/" or "my-site/")
  let topLevelDirectory: string | null = null;
  const firstSlashIdx = nonDirEntries[0].normalizedName.indexOf('/');
  if (firstSlashIdx !== -1) {
    const candidatePrefix = nonDirEntries[0].normalizedName.substring(0, firstSlashIdx + 1);
    const allSharePrefix = nonDirEntries.every((e) => e.normalizedName.startsWith(candidatePrefix));
    if (allSharePrefix) {
      topLevelDirectory = candidatePrefix.replace(/\/$/, '');
    }
  }

  // Helper to normalize entry path relative to website root
  const stripPrefix = (name: string): string => {
    if (topLevelDirectory && name.startsWith(`${topLevelDirectory}/`)) {
      return name.substring(topLevelDirectory.length + 1);
    }
    return name;
  };

  // Build map of normalized website file paths
  const websiteFiles = new Set<string>();
  const assetCounts = {
    html: 0,
    css: 0,
    js: 0,
    images: 0,
    fonts: 0,
    audioVideo: 0,
    data: 0,
    other: 0,
  };

  for (const entry of nonDirEntries) {
    const normalized = stripPrefix(entry.normalizedName);
    websiteFiles.add(normalized);

    const ext = path.extname(normalized).toLowerCase();
    if (['.html', '.htm', '.xhtml'].includes(ext)) assetCounts.html++;
    else if (['.css', '.scss', '.sass', '.less'].includes(ext)) assetCounts.css++;
    else if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(ext)) assetCounts.js++;
    else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif'].includes(ext)) assetCounts.images++;
    else if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) assetCounts.fonts++;
    else if (['.mp3', '.wav', '.ogg', '.mp4', '.webm'].includes(ext)) assetCounts.audioVideo++;
    else if (['.json', '.xml', '.txt', '.csv', '.webmanifest'].includes(ext)) assetCounts.data++;
    else assetCounts.other++;
  }

  // 2. Identify Entry Point (index.html or index.htm at root)
  const entryPoint = websiteFiles.has('index.html')
    ? 'index.html'
    : websiteFiles.has('index.htm')
    ? 'index.htm'
    : undefined;

  if (!entryPoint) {
    return {
      valid: false,
      code: 'MISSING_ENTRY_POINT',
      error: 'Missing website entry point: No index.html or index.htm found in the website root.',
      entryCount: nonDirEntries.length,
      totalCompressedBytes: buffer.length,
      totalDecompressedBytes: inspect.totalDecompressedBytes,
      topLevelDirectory,
      hasIndexHtml: false,
      assetCounts,
    };
  }

  // 3. Inspect index.html and verify relative asset references
  const indexEntry = nonDirEntries.find((e) => stripPrefix(e.normalizedName) === entryPoint);
  let referencedAssets: { total: number; available: number; missing: string[] } | undefined;
  const warnings: string[] = [];

  if (indexEntry) {
    try {
      const indexBytes = extractEntryData(buffer, indexEntry);
      const htmlText = indexBytes.toString('utf8');
      referencedAssets = verifyHtmlAssetReferences(htmlText, websiteFiles);

      if (referencedAssets.missing.length > 0) {
        // Missing critical scripts or stylesheets
        const missingScripts = referencedAssets.missing.filter((m) =>
          ['.js', '.css'].includes(path.extname(m).toLowerCase())
        );

        if (missingScripts.length > 0) {
          warnings.push(
            `Missing local asset files referenced in ${entryPoint}: ${missingScripts.slice(0, 3).join(', ')}${
              missingScripts.length > 3 ? '...' : ''
            }`
          );
        }
      }
    } catch (e: any) {
      warnings.push(`Could not inspect asset references in ${entryPoint}: ${e.message}`);
    }
  }

  return {
    valid: true,
    entryCount: nonDirEntries.length,
    totalCompressedBytes: buffer.length,
    totalDecompressedBytes: inspect.totalDecompressedBytes,
    entryPoint,
    topLevelDirectory,
    hasIndexHtml: true,
    assetCounts,
    referencedAssets,
    warnings: warnings.length > 0 ? warnings : undefined,
    entries,
  };
}

/**
 * Extracts and sanitizes website assets into an isolated directory.
 * Strips optional top-level directory wrapper and preserves relative file hierarchy.
 * Aborts and completely purges the directory if decompression limits or violations occur.
 */
export async function extractSanitizedZipToWorkspace(
  buffer: Buffer,
  destDir: string,
  options: { allowMissingIndex?: boolean } = {}
): Promise<{
  extractedFileCount: number;
  totalDecompressedBytes: number;
  entryPoint: string;
  topLevelDirectory: string | null;
}> {
  // Validate archive first
  const validation = await validateZipArchive(buffer);
  if (!validation.valid && (!options.allowMissingIndex || validation.code !== 'MISSING_ENTRY_POINT')) {
    throw new Error(validation.error || 'ZIP archive validation failed');
  }

  // Ensure isolated destination directory exists
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  const resolvedDest = path.resolve(destDir);
  const topLevel = validation.topLevelDirectory;
  let bytesWrittenTotal = 0;
  let fileCount = 0;

  try {
    for (const entry of validation.entries || []) {
      if (entry.isDirectory) {
        continue;
      }

      // Strip top-level directory prefix if present
      let relPath = entry.normalizedName;
      if (topLevel && relPath.startsWith(`${topLevel}/`)) {
        relPath = relPath.substring(topLevel.length + 1);
      }

      const targetFilePath = path.resolve(resolvedDest, relPath);

      // Defend against path traversal escape
      if (!targetFilePath.startsWith(resolvedDest)) {
        throw new Error(`Security violation: File path "${relPath}" resolves outside isolated workspace.`);
      }

      // Create parent directories
      const parentDir = path.dirname(targetFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Decompress and write
      const fileData = extractEntryData(buffer, entry);
      bytesWrittenTotal += fileData.length;

      if (bytesWrittenTotal > ZIP_LIMITS.MAX_DECOMPRESSED_SIZE) {
        throw new Error('ZIP bomb protection triggered: Exceeded maximum allowed decompressed bytes during extraction.');
      }

      fs.writeFileSync(targetFilePath, fileData);
      fileCount++;
    }

    return {
      extractedFileCount: fileCount,
      totalDecompressedBytes: bytesWrittenTotal,
      entryPoint: validation.entryPoint || 'index.html',
      topLevelDirectory: topLevel || null,
    };
  } catch (err: any) {
    // Immediate rollback: wipe entire extracted folder on any error
    try {
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}
