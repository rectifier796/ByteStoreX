import { Router, Request, Response, NextFunction } from 'express';
import { usersService } from './users.service.js';
import { requireAuth, requireAdmin } from '../auth/auth.middleware.js';

export const usersRouter = Router();

usersRouter.get('/profile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const user = await usersService.getById(userId);
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// Admin-only: list all users. Regular users MUST NOT see other users' emails/IDs (PII + recon risk).
usersRouter.get('/', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await usersService.listAll();
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch('/profile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const updated = await usersService.updateProfile(userId, req.body);
    res.json({ success: true, user: updated });
  } catch (err) {
    next(err);
  }
});
