import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { verifyApk, readZipEntries } from '../scripts/apk-verifier.js';

/**
 * Creates a minimal valid ZIP archive buffer in memory (Store mode, no compression)
 */
function createMockZip(entries: { name: string; content?: Buffer }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const data = entry.content || Buffer.from('test content');
    const nameBuffer = Buffer.from(entry.name, 'utf8');

    // Local Header
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed
    localHeader.writeUInt16LE(0, 6);          // Flags
    localHeader.writeUInt16LE(0, 8);          // Compression: Store (0)
    localHeader.writeUInt16LE(0, 10);         // Mod time
    localHeader.writeUInt16LE(0, 12);         // Mod date
    localHeader.writeUInt32LE(0, 14);         // CRC-32 (0 for mock)
    localHeader.writeUInt32LE(data.length, 18); // Compressed size
    localHeader.writeUInt32LE(data.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuffer.copy(localHeader, 30);

    const localChunk = Buffer.concat([localHeader, data]);
    localHeaders.push(localChunk);

    // Central Directory Header
    const cdHeader = Buffer.alloc(46 + nameBuffer.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);   // Central header signature
    cdHeader.writeUInt16LE(20, 4);           // Version made by
    cdHeader.writeUInt16LE(20, 6);           // Version needed
    cdHeader.writeUInt16LE(0, 8);            // Flags
    cdHeader.writeUInt16LE(0, 10);           // Compression: Store
    cdHeader.writeUInt16LE(0, 12);           // Mod time
    cdHeader.writeUInt16LE(0, 14);           // Mod date
    cdHeader.writeUInt32LE(0, 16);           // CRC-32
    cdHeader.writeUInt32LE(data.length, 20); // Compressed size
    cdHeader.writeUInt32LE(data.length, 24); // Uncompressed size
    cdHeader.writeUInt16LE(nameBuffer.length, 28);
    cdHeader.writeUInt16LE(0, 30);           // Extra length
    cdHeader.writeUInt16LE(0, 32);           // Comment length
    cdHeader.writeUInt16LE(0, 34);           // Disk number start
    cdHeader.writeUInt16LE(0, 36);           // Internal file attributes
    cdHeader.writeUInt32LE(0, 38);           // External file attributes
    cdHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header
    nameBuffer.copy(cdHeader, 46);

    centralEntries.push(cdHeader);
    currentOffset += localChunk.length;
  }

  const centralDirBuffer = Buffer.concat(centralEntries);
  const cdOffset = currentOffset;
  const cdSize = centralDirBuffer.length;

  // End of Central Directory (EOCD)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);            // EOCD signature
  eocd.writeUInt16LE(0, 4);                     // Disk number
  eocd.writeUInt16LE(0, 6);                     // Disk with CD
  eocd.writeUInt16LE(entries.length, 8);        // Total entries on disk
  eocd.writeUInt16LE(entries.length, 10);       // Total entries
  eocd.writeUInt32LE(cdSize, 12);               // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);             // Offset of central directory
  eocd.writeUInt16LE(0, 20);                    // Comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

describe('APK Verifier', () => {
  const tmpDir = path.join(os.tmpdir(), 'web2apk-verifier-test');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails verification when file does not exist', () => {
    const res = verifyApk(path.join(tmpDir, 'non-existent.apk'));
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('does not exist');
  });

  it('fails verification when file is too small', () => {
    const tinyApk = path.join(tmpDir, 'tiny.apk');
    fs.writeFileSync(tinyApk, Buffer.alloc(100)); // 100 bytes

    const res = verifyApk(tinyApk);
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.includes('suspiciously small'))).toBe(true);
  });

  it('correctly parses zip entries from a valid zip buffer', () => {
    const zipBuf = createMockZip([
      { name: 'AndroidManifest.xml' },
      { name: 'classes.dex' },
      { name: 'resources.arsc' },
    ]);
    const entries = readZipEntries(zipBuf);
    expect(entries).toEqual(['AndroidManifest.xml', 'classes.dex', 'resources.arsc']);
  });

  it('fails verification when essential APK entries are missing', () => {
    // Large dummy zip with wrong entries
    const fakeData = Buffer.alloc(600 * 1024); // 600 KB to satisfy size check
    const zipBuf = createMockZip([
      { name: 'index.html', content: fakeData },
      { name: 'style.css' },
    ]);
    const fakeApk = path.join(tmpDir, 'fake.apk');
    fs.writeFileSync(fakeApk, zipBuf);

    const res = verifyApk(fakeApk);
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.includes('AndroidManifest.xml'))).toBe(true);
    expect(res.errors.some(e => e.includes('classes.dex'))).toBe(true);
    expect(res.errors.some(e => e.includes('resources.arsc'))).toBe(true);
  });

  it('passes verification when APK has required entries and plausible size', () => {
    const padding = Buffer.alloc(600 * 1024); // 600 KB
    const zipBuf = createMockZip([
      { name: 'AndroidManifest.xml', content: Buffer.from('<manifest/>') },
      { name: 'classes.dex', content: padding },
      { name: 'resources.arsc', content: Buffer.from('arsc') },
      { name: 'res/mipmap-mdpi/ic_launcher.png', content: Buffer.from('png') },
      { name: 'res/mipmap-anydpi-v26/ic_launcher.xml', content: Buffer.from('<adaptive-icon/>') },
      { name: 'res/drawable/ic_splash_logo.png', content: Buffer.from('logo') },
    ]);
    const validApk = path.join(tmpDir, 'valid-mock.apk');
    fs.writeFileSync(validApk, zipBuf);

    const res = verifyApk(validApk);
    expect(res.isValid).toBe(true);
    expect(res.sizeBytes).toBeGreaterThan(500 * 1024);
    expect(res.sha256).toHaveLength(64);
    expect(res.entriesFound.manifest).toBe(true);
    expect(res.entriesFound.classesDex).toBe(true);
    expect(res.entriesFound.resourcesArsc).toBe(true);
    expect(res.entriesFound.launcherIcons).toBe(true);
    expect(res.entriesFound.adaptiveIcons).toBe(true);
    expect(res.entriesFound.splashLogo).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});
