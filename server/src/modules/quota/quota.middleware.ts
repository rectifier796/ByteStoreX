import { Request, Response, NextFunction } from 'express';
import { quotaService } from './quota.service.js';
import { QuotaExceededError } from '../../core/errors.js';

export const checkQuotaMiddleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return next();
    }

    const contentLength = req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) : 0;
    const canUpload = await quotaService.checkCanUpload(userId, contentLength);

    if (!canUpload) {
      return next(new QuotaExceededError('Upload rejected: User storage quota limit would be exceeded'));
    }

    next();
  } catch (err) {
    next(err);
  }
};
