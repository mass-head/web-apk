/**
 * Web2APK Validation Utilities
 */

const RESERVED_JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null'
]);

/**
 * Validates Android Package ID (Application ID)
 * Must follow reverse domain name conventions:
 * - At least two segments separated by dot (e.g. com.example)
 * - Each segment must start with a letter (a-z, A-Z)
 * - Can contain letters, numbers, underscores
 * - Cannot contain Java reserved keywords
 */
export function validatePackageName(packageName: string): { valid: boolean; error?: string } {
  if (!packageName || packageName.trim().length === 0) {
    return { valid: false, error: 'Package ID cannot be empty.' };
  }

  const trimmed = packageName.trim();

  if (trimmed.length > 100) {
    return { valid: false, error: 'Package ID cannot exceed 100 characters.' };
  }

  const segments = trimmed.split('.');
  if (segments.length < 2) {
    return { valid: false, error: 'Package ID must have at least two segments (e.g., com.example.myapp).' };
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.length === 0) {
      return { valid: false, error: 'Package ID cannot contain consecutive dots or end with a dot.' };
    }
    if (!/^[a-zA-Z]/.test(seg)) {
      return { valid: false, error: `Segment "${seg}" must start with a letter.` };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(seg)) {
      return { valid: false, error: `Segment "${seg}" can only contain letters, numbers, and underscores.` };
    }
    if (RESERVED_JAVA_KEYWORDS.has(seg.toLowerCase())) {
      return { valid: false, error: `Segment "${seg}" is a reserved Java keyword.` };
    }
  }

  return { valid: true };
}

const RESERVED_BRANDS = new Set([
  'google', 'youtube', 'gmail', 'android', 'amazon', 'apple', 'facebook',
  'instagram', 'whatsapp', 'meta', 'twitter', 'tiktok',
  'netflix', 'paypal', 'github', 'linkedin', 'telegram', 'snapchat'
]);

/**
 * Generates a default Android Package ID from an app name or domain
 * Automatically avoids trademark collisions and strips www prefixes
 */
export function generatePackageName(appName: string, domain = 'app'): string {
  const sanitize = (str: string) =>
    str
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20);

  let cleanName = sanitize(appName) || 'webview';
  let cleanDomain = sanitize(domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '')) || 'app';

  // Ensure first character is alphabetic
  if (!/^[a-z]/.test(cleanDomain)) {
    cleanDomain = `site${cleanDomain}`;
  }
  if (!/^[a-z]/.test(cleanName)) {
    cleanName = `app${cleanName}`;
  }

  // Prevent brand impersonation / trademark collisions
  if (RESERVED_BRANDS.has(cleanName)) {
    cleanName = `web${cleanName}`;
  }
  if (RESERVED_BRANDS.has(cleanDomain)) {
    cleanDomain = `site${cleanDomain}`;
  }

  return `com.${cleanDomain}.${cleanName}`;
}

/**
 * Validates URL format
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url || url.trim().length === 0) {
    return { valid: false, error: 'URL is required.' };
  }

  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are supported.' };
    }
    if (!parsed.hostname.includes('.')) {
      return { valid: false, error: 'URL must contain a valid domain name.' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

/**
 * Validates HEX theme color (#RRGGBB or #RGB)
 */
export function validateHexColor(hex: string): boolean {
  return /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(hex);
}
