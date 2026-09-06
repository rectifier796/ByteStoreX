import { Router, Request, Response, NextFunction } from 'express';
import { auditService } from './audit.service.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const auditRouter = Router();

auditRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const category = req.query.category as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    // Standard users view their own audit logs, admins view all
    const actorId = user.role === 'admin' ? undefined : user.userId;

    const logs = await auditService.list({ actorId, category, limit });
    res.json({ success: true, logs });
  } catch (err) {
    next(err);
  }
});
