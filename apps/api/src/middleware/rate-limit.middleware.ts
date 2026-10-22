import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.id || req.ip || '127.0.0.1';
  },
  handler: (_req, res) => {
    res.status(429).json({
      type: 'https://api.web2apk.dev/errors/rate-limit-exceeded',
      title: 'Rate Limit Exceeded',
      status: 429,
      detail: 'Too many requests created from this identity. Please retry after some time.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  },
});
