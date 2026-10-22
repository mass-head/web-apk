import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateLogoBuffer, generateAndroidIcons } from '../scripts/icon-generator.js';

describe('Android Icon Generator & Validation Pipeline', () => {
  let tmpResDir: string;

  beforeEach(() => {
    tmpResDir = path.join(os.tmpdir(), `test-res-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    fs.mkdirSync(tmpResDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpResDir)) {
      fs.rmSync(tmpResDir, { recursive: true, force: true });
    }
  });

  // Valid 1x1 transparent PNG buffer
  const valid1x1Png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  // Minimal valid 48x48 PNG
  const valid48x48Png = (() => {
    const buf = Buffer.alloc(33);
    // PNG magic bytes
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    // IHDR length 13
    buf.writeUInt32BE(13, 8);
    // Chunk type IHDR
    buf.write('IHDR', 12);
    // Width 48, Height 48
    buf.writeUInt32BE(48, 16);
    buf.writeUInt32BE(48, 20);
    return buf;
  })();

  it('validates a valid PNG buffer and extracts dimensions', () => {
    const res = validateLogoBuffer(valid48x48Png);
    expect(res.valid).toBe(true);
    expect(res.format).toBe('png');
    expect(res.width).toBe(48);
    expect(res.height).toBe(48);
  });

  it('rejects unsupported file formats (text, html, shell scripts)', () => {
    const textBuffer = Buffer.from('console.log("hello world");');
    const res = validateLogoBuffer(textBuffer);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Unsupported image format');
  });

  it('rejects image buffers exceeding maximum allowed size (5 MB)', () => {
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024); // 6 MB
    // Pretend to be PNG header
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(largeBuffer, 0);

    const res = validateLogoBuffer(largeBuffer);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('exceeds 5 MB limit');
  });

  it('generates clean default adaptive launcher icons when no logo is supplied', () => {
    const standardJava = 'C:\\Program Files\\Unity\\Hub\\Editor\\6000.2.12f1\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\java.exe';
    const javaCmd = fs.existsSync(standardJava) ? standardJava : 'java';

    generateAndroidIcons(tmpResDir, undefined, '#7C3AED', javaCmd);

    // Verify all density mipmaps exist
    const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
    for (const d of densities) {
      expect(fs.existsSync(path.join(tmpResDir, `mipmap-${d}`, 'ic_launcher.png'))).toBe(true);
      expect(fs.existsSync(path.join(tmpResDir, `mipmap-${d}`, 'ic_launcher_round.png'))).toBe(true);
      expect(fs.existsSync(path.join(tmpResDir, `mipmap-${d}`, 'ic_launcher_foreground.png'))).toBe(true);
    }

    // Verify splash logo and adaptive XMLs
    expect(fs.existsSync(path.join(tmpResDir, 'drawable', 'ic_splash_logo.png'))).toBe(true);
    expect(fs.existsSync(path.join(tmpResDir, 'mipmap-anydpi-v26', 'ic_launcher.xml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpResDir, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'))).toBe(true);
  });

  it('generates custom launcher icon resources when valid PNG data URL is supplied', () => {
    const standardJava = 'C:\\Program Files\\Unity\\Hub\\Editor\\6000.2.12f1\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\java.exe';
    const javaCmd = fs.existsSync(standardJava) ? standardJava : 'java';

    const pngDataUrl = `data:image/png;base64,${valid1x1Png.toString('base64')}`;

    generateAndroidIcons(tmpResDir, pngDataUrl, '#06B6D4', javaCmd);

    expect(fs.existsSync(path.join(tmpResDir, 'mipmap-mdpi', 'ic_launcher.png'))).toBe(true);
    expect(fs.existsSync(path.join(tmpResDir, 'mipmap-xxhdpi', 'ic_launcher_foreground.png'))).toBe(true);
    expect(fs.existsSync(path.join(tmpResDir, 'drawable', 'ic_splash_logo.png'))).toBe(true);
  });

  it('fails with a descriptive error when supplied logo data is invalid', () => {
    const badDataUrl = 'data:image/png;base64,not-valid-base64-or-image-data';

    expect(() => {
      generateAndroidIcons(tmpResDir, badDataUrl, '#7C3AED');
    }).toThrow(/Logo validation failed|Unsupported image format/);
  });
});
