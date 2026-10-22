import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { ConversionRepository } from '../db/repository.js';

export async function checkUserQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.id || 'anon_default';

  try {
    // 1. Check concurrent jobs quota
    const activeCount = await ConversionRepository.countActiveByUser(userId);
    if (activeCount >= env.MAX_CONCURRENT_JOBS_PER_USER) {
      res.status(429).json({
        type: 'https://api.web2apk.dev/errors/concurrent-quota-exceeded',
        title: 'Concurrent Job Quota Exceeded',
        status: 429,
        detail: `You already have ${activeCount} active Android build jobs running. Max allowed is ${env.MAX_CONCURRENT_JOBS_PER_USER}.`,
        code: 'CONCURRENT_QUOTA_EXCEEDED',
      });
      return;
    }

    // 2. Check 24-hour daily conversions quota
    const dailyCount = await ConversionRepository.countDailyByUser(userId);
    if (dailyCount >= env.DAILY_CONVERSIONS_PER_USER) {
      res.status(429).json({
        type: 'https://api.web2apk.dev/errors/daily-quota-exceeded',
        title: 'Daily Conversion Quota Exceeded',
        status: 429,
        detail: `You have reached your daily quota of ${env.DAILY_CONVERSIONS_PER_USER} builds per 24 hours.`,
        code: 'DAILY_QUOTA_EXCEEDED',
      });
      return;
    }

    next();
  } catch (err: any) {
    // Fail-open to avoid service disruption if count fails
    console.warn('Quota check error, proceeding:', err.message);
    next();
  }
}
