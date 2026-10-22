import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ZipValidationResult {
  valid: boolean;
  error?: string;
  entryCount: number;
  totalDecompressedBytes: number;
  entryPoint?: string;
}

export interface ExtractedAssetResult {
  success: boolean;
  extractedFileCount: number;
  entryPoint: string;
}

export const PROHIBITED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bin', '.sh', '.bat', '.cmd', '.ps1', '.apk', '.jar',
  '.class', '.dex', '.so', '.dylib', '.gradle', '.kts', '.py', '.php',
  '.rb', '.pl', '.cgi', '.msi', '.vbs', '.scr',
]);

const MAX_DECOMPRESSED_SIZE_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB
const MAX_ENTRY_COUNT = 15000;
const MAX_SINGLE_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

interface RawZipEntry {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  isSymlink: boolean;
  isDirectory: boolean;
  dataOffset: number;
}

export function parseZipDirectory(buffer: Buffer): RawZipEntry[] {
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP archive: End of Central Directory record not found.');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (cdOffset + cdSize > buffer.length) {
    throw new Error('Corrupt ZIP archive: Central directory extends beyond buffer.');
  }

  const entries: RawZipEntry[] = [];
  let currentOffset = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (currentOffset + 46 > buffer.length) {
      throw new Error('Corrupt ZIP archive: Central directory entry truncated.');
    }

    const sig = buffer.readUInt32LE(currentOffset);
    if (sig !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header signature at offset ${currentOffset}`);
    }

    const versionMadeBy = buffer.readUInt16LE(currentOffset + 4);
    const uncompressedSize = buffer.readUInt32LE(currentOffset + 24);
    const compressedSize = buffer.readUInt32LE(currentOffset + 20);
    const fileNameLength = buffer.readUInt16LE(currentOffset + 28);
    const extraFieldLength = buffer.readUInt16LE(currentOffset + 30);
    const commentLength = buffer.readUInt16LE(currentOffset + 32);
    const externalFileAttributes = buffer.readUInt32LE(currentOffset + 38);
    const localHeaderOffset = buffer.readUInt32LE(currentOffset + 42);

    const fileNameStart = currentOffset + 46;
    const rawFileName = buffer.toString('utf8', fileNameStart, fileNameStart + fileNameLength);

    const isDirectory = rawFileName.endsWith('/') || rawFileName.endsWith('\\');
    const hostSystem = versionMadeBy >> 8;
    const unixPermissions = hostSystem === 3 ? (externalFileAttributes >> 16) & 0xffff : 0;
    const isSymlink = (unixPermissions & 0o170000) === 0o120000;

    entries.push({
      fileName: rawFileName,
      compressedSize,
      uncompressedSize,
      isSymlink,
      isDirectory,
      dataOffset: localHeaderOffset,
    });

    currentOffset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

export function validateZipBuffer(buffer: Buffer): ZipValidationResult {
  if (!buffer || buffer.length < 22) {
    return { valid: false, error: 'Archive is empty or corrupted.', entryCount: 0, totalDecompressedBytes: 0 };
  }

  let entries: RawZipEntry[];
  try {
    entries = parseZipDirectory(buffer);
  } catch (err: any) {
    return { valid: false, error: `Invalid ZIP format: ${err.message}`, entryCount: 0, totalDecompressedBytes: 0 };
  }

  if (entries.length === 0) {
    return { valid: false, error: 'Archive contains zero files.', entryCount: 0, totalDecompressedBytes: 0 };
  }

  if (entries.length > MAX_ENTRY_COUNT) {
    return {
      valid: false,
      error: `Archive exceeds maximum file count limit (${entries.length} > ${MAX_ENTRY_COUNT}).`,
      entryCount: entries.length,
      totalDecompressedBytes: 0,
    };
  }

  let totalDecompressedBytes = 0;
  const fileNames: string[] = [];

  for (const entry of entries) {
    const fn = entry.fileName;

    // 1. Path traversal & Zip Slip inspection
    if (fn.includes('\0') || fn.includes('..') || path.isAbsolute(fn) || fn.startsWith('/') || fn.startsWith('\\')) {
      return {
        valid: false,
        error: `Security violation: Path traversal or absolute path detected in archive: "${fn}"`,
        entryCount: entries.length,
        totalDecompressedBytes,
      };
    }

    // 2. Symlink inspection
    if (entry.isSymlink) {
      return {
        valid: false,
        error: `Security violation: Symbolic links are strictly prohibited: "${fn}"`,
        entryCount: entries.length,
        totalDecompressedBytes,
      };
    }

    // 3. Prohibited executable file types
    const ext = path.extname(fn).toLowerCase();
    if (PROHIBITED_EXTENSIONS.has(ext)) {
      return {
        valid: false,
        error: `Security violation: Prohibited executable or script extension "${ext}" detected in "${fn}".`,
        entryCount: entries.length,
        totalDecompressedBytes,
      };
    }

    // 4. Per-file and total size quotas (Zip bomb defense)
    if (entry.uncompressedSize > MAX_SINGLE_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `File "${fn}" exceeds maximum allowed individual file size (${MAX_SINGLE_FILE_SIZE_BYTES / 1024 / 1024} MB).`,
        entryCount: entries.length,
        totalDecompressedBytes,
      };
    }

    totalDecompressedBytes += entry.uncompressedSize;
    if (totalDecompressedBytes > MAX_DECOMPRESSED_SIZE_BYTES) {
      return {
        valid: false,
        error: `Archive decompressed size exceeds maximum limit of ${MAX_DECOMPRESSED_SIZE_BYTES / 1024 / 1024} MB (possible zip bomb).`,
        entryCount: entries.length,
        totalDecompressedBytes,
      };
    }

    if (!entry.isDirectory) {
      fileNames.push(fn);
    }
  }

  // 5. Entry point detection
  const hasRootIndex = fileNames.some((f) => f.toLowerCase() === 'index.html');
  const hasSubdirIndex = fileNames.some((f) => f.toLowerCase().endsWith('/index.html'));

  if (!hasRootIndex && !hasSubdirIndex) {
    return {
      valid: false,
      error: 'Archive must contain an index.html entry point file.',
      entryCount: entries.length,
      totalDecompressedBytes,
    };
  }

  const entryPoint = hasRootIndex
    ? 'index.html'
    : fileNames.find((f) => f.toLowerCase().endsWith('/index.html'))!;

  return {
    valid: true,
    entryCount: fileNames.length,
    totalDecompressedBytes,
    entryPoint,
  };
}

export function extractSanitizedZip(buffer: Buffer, destinationDir: string): ExtractedAssetResult {
  const validation = validateZipBuffer(buffer);
  if (!validation.valid) {
    throw new Error(validation.error || 'Failed ZIP archive validation.');
  }

  const entries = parseZipDirectory(buffer);
  fs.mkdirSync(destinationDir, { recursive: true });

  // Detect common top-level directory prefix (e.g., dist/, build/, my-site/)
  const nonDirEntries = entries.filter((e) => !e.isDirectory);
  let prefixToStrip = '';

  const firstEntryParts = nonDirEntries[0]?.fileName.split('/') || [];
  if (firstEntryParts.length > 1) {
    const candidatePrefix = `${firstEntryParts[0]}/`;
    const allSharePrefix = nonDirEntries.every((e) => e.fileName.startsWith(candidatePrefix));
    if (allSharePrefix) {
      prefixToStrip = candidatePrefix;
    }
  }

  let extractedCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    let relativePath = entry.fileName;
    if (prefixToStrip && relativePath.startsWith(prefixToStrip)) {
      relativePath = relativePath.slice(prefixToStrip.length);
    }

    // Normalize forward slashes to target OS
    const safeTargetPath = path.normalize(path.join(destinationDir, relativePath));

    // Confirm resolved path is inside destinationDir (Zip Slip defense)
    const relative = path.relative(destinationDir, safeTargetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path traversal attempt detected during extraction: "${entry.fileName}"`);
    }

    fs.mkdirSync(path.dirname(safeTargetPath), { recursive: true });

    // Extract file content from buffer
    const localHeaderOffset = entry.dataOffset;
    const fileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + fileNameLen + extraLen;
    const compressionMethod = buffer.readUInt16LE(localHeaderOffset + 8);

    let fileContent: Buffer;
    if (compressionMethod === 0) {
      // Stored (no compression)
      fileContent = buffer.subarray(dataStart, dataStart + entry.uncompressedSize);
    } else {
      // Inflate compressed entry
      const compressedData = buffer.subarray(dataStart, dataStart + entry.compressedSize);
      fileContent = zlib.inflateRawSync(compressedData);
    }

    fs.writeFileSync(safeTargetPath, fileContent);
    extractedCount++;
  }

  return {
    success: true,
    extractedFileCount: extractedCount,
    entryPoint: 'index.html',
  };
}
