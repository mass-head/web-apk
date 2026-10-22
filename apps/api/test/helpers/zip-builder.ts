import zlib from 'node:zlib';

export interface MockZipFile {
  name: string;
  content: string | Buffer;
  compressionMethod?: number; // 0 = stored, 8 = deflated (default)
  externalAttributes?: number;
  crc32?: number;
}

/**
 * Builds a valid RFC 1951 / ZIP archive buffer in memory without third-party dependencies.
 * Allows simulating path traversals, symlinks, corrupted headers, and various compressions.
 */
export function buildMockZipBuffer(files: MockZipFile[]): Buffer {
  const localHeaderChunks: Buffer[] = [];
  const centralDirectoryChunks: Buffer[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const rawContent = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const method = file.compressionMethod !== undefined ? file.compressionMethod : 8;

    let compressedData: Buffer;
    if (method === 0) {
      compressedData = rawContent;
    } else {
      compressedData = zlib.deflateRawSync(rawContent);
    }

    const crc = file.crc32 !== undefined ? file.crc32 : zlib.crc32(rawContent);
    const uncompressedSize = rawContent.length;
    const compressedSize = compressedData.length;

    // 1. Local File Header (30 bytes + nameLen)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed
    localHeader.writeUInt16LE(0, 6);          // Flags
    localHeader.writeUInt16LE(method, 8);     // Compression method
    localHeader.writeUInt16LE(0, 10);         // Last mod time
    localHeader.writeUInt16LE(0, 12);         // Last mod date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuffer.copy(localHeader, 30);

    localHeaderChunks.push(localHeader, compressedData);

    // 2. Central Directory Header (46 bytes + nameLen)
    const rawAttr = file.externalAttributes !== undefined ? file.externalAttributes : (0o100644 << 16);
    const extAttr = rawAttr >>> 0;
    const cdHeader = Buffer.alloc(46 + nameBuffer.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);   // Central directory signature
    cdHeader.writeUInt16LE(0x0314, 4);       // Version made by (Unix 3.0)
    cdHeader.writeUInt16LE(20, 6);           // Version needed
    cdHeader.writeUInt16LE(0, 8);            // Flags
    cdHeader.writeUInt16LE(method, 10);      // Compression method
    cdHeader.writeUInt16LE(0, 12);           // Last mod time
    cdHeader.writeUInt16LE(0, 14);           // Last mod date
    cdHeader.writeUInt32LE(crc, 16);         // CRC-32
    cdHeader.writeUInt32LE(compressedSize, 20);
    cdHeader.writeUInt32LE(uncompressedSize, 24);
    cdHeader.writeUInt16LE(nameBuffer.length, 28);
    cdHeader.writeUInt16LE(0, 30);           // Extra length
    cdHeader.writeUInt16LE(0, 32);           // Comment length
    cdHeader.writeUInt16LE(0, 34);           // Disk number start
    cdHeader.writeUInt16LE(0, 36);           // Internal attributes
    cdHeader.writeUInt32LE(extAttr, 38);     // External attributes
    cdHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header
    nameBuffer.copy(cdHeader, 46);

    centralDirectoryChunks.push(cdHeader);
    currentOffset += localHeader.length + compressedData.length;
  }

  const localData = Buffer.concat(localHeaderChunks);
  const cdData = Buffer.concat(centralDirectoryChunks);

  // 3. End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
  eocd.writeUInt16LE(0, 4);                // Disk number
  eocd.writeUInt16LE(0, 6);                // Start disk
  eocd.writeUInt16LE(files.length, 8);     // Entries on disk
  eocd.writeUInt16LE(files.length, 10);    // Total entries
  eocd.writeUInt32LE(cdData.length, 12);   // Central directory size
  eocd.writeUInt32LE(localData.length, 16); // Central directory offset
  eocd.writeUInt16LE(0, 20);               // Comment length

  return Buffer.concat([localData, cdData, eocd]);
}
