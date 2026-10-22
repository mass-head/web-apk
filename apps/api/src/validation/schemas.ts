import { z } from 'zod';

const RESERVED_JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null'
]);

export const packageNameSchema = z
  .string()
  .min(3, 'Package ID must be at least 3 characters')
  .max(100, 'Package ID cannot exceed 100 characters')
  .refine(
    (val) => {
      const segments = val.split('.');
      if (segments.length < 2) return false;
      for (const seg of segments) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(seg)) return false;
        if (RESERVED_JAVA_KEYWORDS.has(seg.toLowerCase())) return false;
      }
      const lower = val.toLowerCase();
      if (lower.startsWith('com.google.') || lower.startsWith('com.android.') || lower === 'com.google' || lower === 'com.android') {
        return false;
      }
      return true;
    },
    {
      message:
        'Package ID must be a valid reverse-domain identifier without Java keywords, and cannot use reserved Android/Google namespaces (com.google, com.android).',
    }
  );

export const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color code (#RGB or #RRGGBB)');

export const appConfigSchema = z.object({
  appName: z.string().trim().min(1, 'App name cannot be empty').max(50, 'App name cannot exceed 50 characters'),
  packageName: packageNameSchema,
  versionName: z.string().trim().default('1.0.0'),
  versionCode: z.coerce.number().int().positive().default(1),
  themeColor: hexColorSchema.default('#7C3AED'),
  orientation: z.enum(['unspecified', 'portrait', 'landscape']).default('unspecified'),
  enablePullToRefresh: z.boolean().default(true),
  enableDownloadManager: z.boolean().default(true),
  enableGeolocation: z.boolean().default(false),
  enableCamera: z.boolean().default(false),
  enablePushNotifications: z.boolean().default(false),
  customUserAgent: z.string().max(100).optional(),
  iconDataUrl: z.string().optional(),
  hideCustomLoadingSelector: z.string().max(100).optional(),
});

export const createUrlConversionSchema = z.object({
  url: z.string().url('Must be a valid URL starting with http:// or https://'),
  appConfig: appConfigSchema,
});

export const createUploadConversionSchema = z.object({
  appConfig: appConfigSchema,
});

export const conversionIdParamSchema = z.object({
  id: z.string().min(1, 'Conversion ID is required'),
});

export const downloadQuerySchema = z.object({
  token: z.string().optional(),
});
