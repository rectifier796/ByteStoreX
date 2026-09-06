import { Request, Response, NextFunction } from 'express';
import { idempotencyService } from './idempotency.service.js';
import { ConflictError } from './errors.js';
import { logger } from './logger.js';

export const idempotencyMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const rawKey = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as string | undefined;

  if (!rawKey || !rawKey.trim()) {
    return next(); // No idempotency key header provided
  }

  const key = rawKey.trim();
  const userId = (req as any).user?.userId || 'anonymous';
  const currentHash = idempotencyService.computeRequestHash(req.method, req.originalUrl, req.body);

  try {
    const existing = await idempotencyService.getRecord(key, userId);

    if (existing) {
      // 1. Identical Retry Check
      if (existing.requestHash === currentHash) {
        logger.info('IdempotencyMiddleware', `Identical request retry detected for key '${key}'. Serving cached response.`, {
          key,
          userId,
          status: existing.responseCode
        });

        res.setHeader('X-Cache-Lookup', 'HIT');
        res.setHeader('X-Idempotency-Key', key);
        res.status(existing.responseCode).json(existing.responseBody);
        return;
      }

      // 2. Conflicting Parameter Reuse Rejection
      logger.warn('IdempotencyMiddleware', `Idempotency key reuse mismatch for key '${key}'. Rejection issued.`, {
        key,
        userId,
        storedHash: existing.requestHash,
        incomingHash: currentHash
      });

      return next(
        new ConflictError(`Idempotency key reuse mismatch: Key '${key}' has already been used with different request parameters.`)
      );
    }

    // Capture response payload upon completion
    const originalJson = res.json.bind(res);
    res.json = (body: any): Response => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        idempotencyService.saveRecord(key, userId, currentHash, req.originalUrl, res.statusCode, body).catch((err) => {
          logger.error('IdempotencyMiddleware', `Failed to save idempotency record: ${err.message}`);
        });
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    next(err);
  }
};
