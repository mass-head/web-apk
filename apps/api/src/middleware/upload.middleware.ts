import multer from 'multer';
import { Request } from 'express';
import { env } from '../config/env.js';

// Memory storage to stream directly to S3 or Local storage
const storage = multer.memoryStorage();

export const uploadZipMiddleware = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_BYTES, // 100 MB max
    files: 1,
  },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const isZipExtension = file.originalname.toLowerCase().endsWith('.zip');
    const isZipMime =
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype === 'multipart/x-zip';

    if (isZipExtension || isZipMime) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE: Only .zip static website archives are supported.'));
    }
  },
}).single('file');
