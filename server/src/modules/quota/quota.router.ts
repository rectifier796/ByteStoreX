import { Router, Request, Response, NextFunction } from 'express';
import { quotaService } from './quota.service.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const quotaRouter = Router();

quotaRouter.get('/usage', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const quotaInfo = await quotaService.getUserQuota(userId);
    res.json({ success: true, quota: quotaInfo });
  } catch (err) {
    next(err);
  }
});
