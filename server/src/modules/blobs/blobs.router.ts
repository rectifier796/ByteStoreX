import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { blobsService } from './blobs.service.js';
import { ForbiddenError } from '../../core/errors.js';

export const blobsRouter = Router();

// GET /api/blobs/stats - Retrieve deduplication and blob statistics
blobsRouter.get('/stats', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user?.role;
    if (userRole !== 'admin') {
      throw new ForbiddenError('Only system administrators can inspect blob storage statistics.');
    }

    const stats = await blobsService.getStats();
    res.json({ status: 'success', data: stats });
  } catch (err) {
    next(err);
  }
});

// POST /api/blobs/gc - Execute manual garbage collection of unreferenced blobs
blobsRouter.post('/gc', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;

    if (userRole !== 'admin') {
      throw new ForbiddenError('Only system administrators can execute garbage collection.');
    }

    const result = await blobsService.runGarbageCollection(userId);
    res.json({
      status: 'success',
      message: `Garbage collection completed. Freed ${result.freedBytes} bytes across ${result.collectedCount} blob(s).`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});
