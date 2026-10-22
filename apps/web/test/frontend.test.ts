import { describe, it, expect } from 'vitest';
import { validatePackageName, generatePackageName, validateUrl, validateHexColor } from '../src/utils/validators.js';
import { HttpBuildAdapter } from '../src/api/httpAdapter.js';

describe('Web2APK Frontend Client & Validation Tests', () => {
  describe('1. Android Package Name RFC Validation', () => {
    it('accepts valid package names', () => {
      expect(validatePackageName('com.example.app').valid).toBe(true);
      expect(validatePackageName('io.github.portfolio').valid).toBe(true);
      expect(validatePackageName('net.my_company.android_app').valid).toBe(true);
      expect(validatePackageName('org.wikimedia.wikipedia').valid).toBe(true);
    });

    it('rejects invalid segment count', () => {
      const res = validatePackageName('singleword');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('at least two segments');
    });

    it('rejects segments starting with numbers or symbols', () => {
      const res = validatePackageName('com.123app.demo');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('must start with a letter');
    });

    it('rejects Java reserved keywords', () => {
      const res1 = validatePackageName('com.class.mytest');
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain('reserved Java keyword');

      const res2 = validatePackageName('com.import.service');
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('reserved Java keyword');

      const res3 = validatePackageName('com.void.app');
      expect(res3.valid).toBe(false);
      expect(res3.error).toContain('reserved Java keyword');
    });

    it('rejects consecutive or trailing dots', () => {
      expect(validatePackageName('com..example.app').valid).toBe(false);
      expect(validatePackageName('com.example.app.').valid).toBe(false);
    });

    it('auto-generates compliant package name from app name', () => {
      const pkg = generatePackageName('My Cool Store', 'coolstore.com');
      expect(pkg).toMatch(/^com\.[a-z0-9]+\.[a-z0-9]+$/);
      expect(validatePackageName(pkg).valid).toBe(true);
    });
  });

  describe('2. URL Formatting & Validation', () => {
    it('accepts valid HTTP/HTTPS URLs', () => {
      expect(validateUrl('https://example.com').valid).toBe(true);
      expect(validateUrl('https://my-app.dev/dashboard').valid).toBe(true);
      expect(validateUrl('http://insecure-site.org').valid).toBe(true);
    });

    it('rejects non-web protocols', () => {
      expect(validateUrl('ftp://files.example.com').valid).toBe(false);
      expect(validateUrl('file:///etc/passwd').valid).toBe(false);
      expect(validateUrl('javascript:alert(1)').valid).toBe(false);
    });

    it('rejects empty or missing domain URLs', () => {
      expect(validateUrl('').valid).toBe(false);
      expect(validateUrl('nodomain').valid).toBe(false);
    });
  });

  describe('3. Hex Theme Color Validation', () => {
    it('accepts 3-digit and 6-digit hex color codes', () => {
      expect(validateHexColor('#7C3AED')).toBe(true);
      expect(validateHexColor('#06B6D4')).toBe(true);
      expect(validateHexColor('#FFF')).toBe(true);
      expect(validateHexColor('#000000')).toBe(true);
    });

    it('rejects non-hex color strings', () => {
      expect(validateHexColor('red')).toBe(false);
      expect(validateHexColor('rgb(0,0,0)')).toBe(false);
      expect(validateHexColor('#12345')).toBe(false);
      expect(validateHexColor('123456')).toBe(false);
    });
  });

  describe('4. HttpBuildAdapter API Client Instance', () => {
    it('initializes with normalized base URL and provides full API contract', () => {
      const adapter = new HttpBuildAdapter('http://localhost:4000/api/');
      expect(adapter.baseUrl).toBe('http://localhost:4000/api');
      expect(typeof adapter.createUrlBuild).toBe('function');
      expect(typeof adapter.createUploadBuild).toBe('function');
      expect(typeof adapter.getBuild).toBe('function');
      expect(typeof adapter.cancelBuild).toBe('function');
      expect(typeof adapter.getDownloadUrl).toBe('function');
      expect(typeof adapter.subscribeToLogs).toBe('function');
    });
  });
});
