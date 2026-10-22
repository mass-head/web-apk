import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface DownloadTokenPayload {
  conversionId: string;
  userId: string;
  fileName: string;
}

export class TokenService {
  /**
   * Generates a signed, short-lived download token bound to conversionId and userId
   */
  static generateDownloadToken(payload: DownloadTokenPayload): string {
    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRY_SECONDS,
      issuer: 'web2apk-api',
      audience: 'web2apk-client',
    });
  }

  /**
   * Verifies a download token and returns the payload if valid
   */
  static verifyDownloadToken(token: string): DownloadTokenPayload | null {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        issuer: 'web2apk-api',
        audience: 'web2apk-client',
      }) as DownloadTokenPayload;
      return decoded;
    } catch {
      return null;
    }
  }
}
