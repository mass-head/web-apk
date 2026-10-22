import { Request, Response, NextFunction } from 'express';
import { ConversionRepository } from '../db/repository.js';

export async function checkIdempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const idempotencyKey = req.header('Idempotency-Key');

  if (!idempotencyKey) {
    return next();
  }

  try {
    const existing = await ConversionRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      // Return previously generated job representation
      res.status(200).json({
        id: existing.id,
        status: existing.status,
        progress: existing.progress,
        stageName: existing.stageName,
        createdAt: existing.createdAt,
        idempotentReplay: true,
      });
      return;
    }

    next();
  } catch (err: any) {
    console.warn('Idempotency lookup error:', err.message);
    next();
  }
}
