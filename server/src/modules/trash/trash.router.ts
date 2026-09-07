import { Router, Request, Response, NextFunction } from 'express';
import { trashService } from './trash.service.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idempotencyMiddleware } from '../../core/idempotency.middleware.js';
import { ForbiddenError } from '../../core/errors.js';

export const trashRouter = Router();

trashRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const items = await trashService.listTrash(user.userId, user.role);
    res.json({ success: true, ...items });
  } catch (err) {
    next(err);
  }
});

trashRouter.post('/soft-delete', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const { resourceId, resourceType } = req.body;
    await trashService.softDelete(resourceId, resourceType, user.userId, user.role);
    res.json({ success: true, message: 'Item moved to trash' });
  } catch (err) {
    next(err);
  }
});

trashRouter.post('/restore', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const { resourceId, resourceType } = req.body;
    await trashService.restore(resourceId, resourceType, user.userId, user.role);
    res.json({ success: true, message: 'Item restored from trash' });
  } catch (err) {
    next(err);
  }
});

trashRouter.post('/restore-all', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const restoredCount = await trashService.restoreAll(user.userId, user.role);
    res.json({ success: true, message: `Restored ${restoredCount} items from trash.` });
  } catch (err) {
    next(err);
  }
});

trashRouter.delete('/purge/:resourceType/:resourceId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const { resourceType, resourceId } = req.params;
    if (resourceType !== 'file' && resourceType !== 'folder') {
      throw new Error('resourceType must be file or folder');
    }
    await trashService.purgePermanent(resourceId, resourceType as 'file' | 'folder', user.userId, user.role);
    res.json({ success: true, message: 'Item permanently deleted' });
  } catch (err) {
    next(err);
  }
});

trashRouter.delete('/empty', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const purgedCount = await trashService.emptyTrash(user.userId, user.role);
    res.json({ success: true, message: `Trash emptied (${purgedCount} items removed)` });
  } catch (err) {
    next(err);
  }
});

trashRouter.post('/run-retention-purge', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user.role;
    if (userRole !== 'admin') {
      throw new ForbiddenError('Only administrators can trigger retention purge sweeps.');
    }
    const retentionDays = req.body.retentionDays ? parseInt(req.body.retentionDays, 10) : 30;
    const result = await trashService.purgeExpiredTrash(retentionDays);
    res.json({ success: true, message: `Retention purge sweep complete (${result.purgedFiles} files, ${result.purgedFolders} folders removed).`, ...result });
  } catch (err) {
    next(err);
  }
});
