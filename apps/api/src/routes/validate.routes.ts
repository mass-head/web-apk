import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { validateUrlReachability, validateSsrfUrl } from '../validation/ssrf.validator.js';
import { packageNameSchema } from '../validation/schemas.js';
import { validateZipArchive, ZIP_LIMITS } from '../validation/zip.validator.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ZIP_LIMITS.MAX_COMPRESSED_SIZE },
});

/**
 * POST /api/validate/url
 * Validates target URL syntax, DNS resolution, SSRF protection, and reachability.
 * Never executes arbitrary website code.
 */
router.post('/url', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { url, checkReachability = true } = req.body;

    if (!url || typeof url !== 'string') {
      res.status(400).json({
        valid: false,
        code: 'VALIDATION_ERROR',
        error: 'Target URL is required.',
      });
      return;
    }

    // SSRF and Reachability validation
    const allowLoopback = req.header('x-allow-test-loopback') === 'true';
    const validationOpts = {
      allowLoopbackForTesting: allowLoopback,
      rejectUnauthorized: !allowLoopback,
    };

    const result = checkReachability
      ? await validateUrlReachability(url, validationOpts)
      : await validateSsrfUrl(url, validationOpts);

    if (!result.valid) {
      res.status(400).json({
        valid: false,
        code: result.code || 'VALIDATION_ERROR',
        error: result.error || 'URL validation failed.',
        detail: result.error || 'URL validation failed.',
      });
      return;
    }

    res.status(200).json({
      valid: true,
      normalizedUrl: result.finalUrl || url,
      resolvedIp: result.resolvedIp,
      sslValid: (result.finalUrl || url).startsWith('https:'),
      title: result.title,
      favicon: result.favicon,
      statusCode: result.statusCode,
      warning: result.warning,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/validate/package-name
 * Validates Android package ID identifier format and Java reserved keywords
 */
router.post('/package-name', async (req: Request, res: Response): Promise<void> => {
  const { packageName } = req.body;
  if (!packageName || typeof packageName !== 'string') {
    res.status(400).json({ valid: false, error: 'Package name is required.' });
    return;
  }

  const parsed = packageNameSchema.safeParse(packageName);
  if (!parsed.success) {
    const error = parsed.error.errors[0]?.message || 'Invalid package identifier.';
    res.status(400).json({ valid: false, error });
    return;
  }

  res.status(200).json({ valid: true });
});

/**
 * POST /api/validate/zip
 * Inspects a static website ZIP archive:
 * - Checks size limits, file counts, and compression ratios
 * - Prohibits symlinks, absolute paths, and path traversal
 * - Verifies presence of index.html entry point
 * - Inspects asset references safely without script execution
 */
router.post(
  '/zip',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          valid: false,
          code: 'MISSING_FILE',
          error: 'ZIP file upload is required in multipart form data ("file").',
        });
        return;
      }

      const result = await validateZipArchive(req.file.buffer);

      if (!result.valid) {
        res.status(400).json({
          valid: false,
          code: result.code || 'INVALID_ZIP_ARCHIVE',
          error: result.error || 'ZIP archive validation failed.',
          entryCount: result.entryCount,
          totalCompressedBytes: result.totalCompressedBytes,
          totalDecompressedBytes: result.totalDecompressedBytes,
          hasIndexHtml: result.hasIndexHtml,
          topLevelDirectory: result.topLevelDirectory,
        });
        return;
      }

      res.status(200).json({
        valid: true,
        entryPoint: result.entryPoint,
        topLevelDirectory: result.topLevelDirectory,
        entryCount: result.entryCount,
        totalCompressedBytes: result.totalCompressedBytes,
        totalDecompressedBytes: result.totalDecompressedBytes,
        hasIndexHtml: result.hasIndexHtml,
        assetCounts: result.assetCounts,
        referencedAssets: result.referencedAssets,
        warnings: result.warnings,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
