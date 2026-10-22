import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Zod Validation Error
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    res.status(400).json({
      type: 'https://api.web2apk.dev/errors/validation-error',
      title: 'Validation Failed',
      status: 400,
      detail: err.errors[0]?.message || 'Input validation failed.',
      code: 'VALIDATION_ERROR',
      instance: req.originalUrl,
      errors: formattedErrors,
    });
    return;
  }

  // 2. Multer Upload Error
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        type: 'https://api.web2apk.dev/errors/file-too-large',
        title: 'Upload Payload Too Large',
        status: 413,
        detail: 'ZIP archive exceeds the maximum upload quota of 1 GB.',
        code: 'PAYLOAD_TOO_LARGE',
        instance: req.originalUrl,
      });
      return;
    }

    res.status(400).json({
      type: 'https://api.web2apk.dev/errors/upload-error',
      title: 'Upload Processing Failed',
      status: 400,
      detail: err.message,
      code: 'UPLOAD_ERROR',
      instance: req.originalUrl,
    });
    return;
  }

  // 3. Custom File Type Error
  if (err.message && err.message.startsWith('INVALID_FILE_TYPE')) {
    res.status(400).json({
      type: 'https://api.web2apk.dev/errors/invalid-file-type',
      title: 'Invalid File Type',
      status: 400,
      detail: err.message.replace('INVALID_FILE_TYPE: ', ''),
      code: 'INVALID_FILE_TYPE',
      instance: req.originalUrl,
    });
    return;
  }

  // 4. Default / Internal Server Error
  const statusCode = err.status || err.statusCode || 500;
  console.error('[API Unhandled Error]', err);

  res.status(statusCode).json({
    type: 'https://api.web2apk.dev/errors/internal-error',
    title: statusCode === 500 ? 'Internal Server Error' : 'Request Error',
    status: statusCode,
    detail: err.message || 'An unexpected error occurred.',
    code: err.code || 'INTERNAL_SERVER_ERROR',
    instance: req.originalUrl,
  });
}
