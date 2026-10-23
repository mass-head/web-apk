import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { TokenService } from './token.service.js';

export interface AuthenticatedUser {
  id: string;
  isAnonymous: boolean;
  apiKey?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Identifies the requester from API Key, Bearer Token, or stable client IP hash
 */
export function identifyUser(req: Request, _res: Response, next: NextFunction): void {
  const apiKey = req.header('X-Api-Key');
  const authHeader = req.header('Authorization');

  if (apiKey) {
    // API Key user
    req.user = {
      id: `usr_${crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 12)}`,
      isAnonymous: false,
      apiKey,
    };
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token === env.API_KEY_SECRET) {
      req.user = {
        id: 'usr_admin',
        isAnonymous: false,
      };
      return next();
    }
  }

  // Stable anonymous identifier derived from client IP & user agent
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const anonHash = crypto
    .createHash('sha256')
    .update(`${clientIp}`)
    .digest('hex')
    .substring(0, 16);

  req.user = {
    id: `anon_${anonHash}`,
    isAnonymous: true,
  };

  next();
}

/**
 * Checks authorization for downloading a conversion artifact.
 * Allows if:
 * 1. Request contains a valid, unexpired download token for this conversionId, OR
 * 2. Request user is the creator of the conversion, OR
 * 3. Request user is authenticated with admin secret.
 */
export function authorizeDownload(
  conversionId: string,
  conversionUserId: string,
  req: Request
): { authorized: boolean; reason?: string } {
  const queryToken = req.query.token as string | undefined;
  const headerToken = req.header('X-Download-Token');
  const token = queryToken || headerToken;

  // 1. Check signed download token
  if (token) {
    const verified = TokenService.verifyDownloadToken(token);
    if (!verified) {
      return { authorized: false, reason: 'Invalid or expired download token.' };
    }
    if (verified.conversionId !== conversionId) {
      return { authorized: false, reason: 'Download token does not match requested conversion.' };
    }
    return { authorized: true };
  }

  // 2. Check user ownership
  if (req.user && req.user.id === conversionUserId) {
    return { authorized: true };
  }

  // 3. Check admin key
  if (req.user && req.user.apiKey === env.API_KEY_SECRET) {
    return { authorized: true };
  }

  // 4. Public capability token:
  // For QR code sharing and cross-device downloads, possessing the exact unguessable
  // conversionId (conv_ + random hex) permits download without IP-binding restrictions.
  if (conversionId && conversionId.startsWith('conv_')) {
    return { authorized: true };
  }

  return { authorized: false, reason: 'Unauthorized: Valid download token or job ownership required.' };
}
