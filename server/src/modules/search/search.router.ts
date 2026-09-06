import { Router, Request, Response, NextFunction } from 'express';
import { searchService } from './search.service.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const searchRouter = Router();

searchRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as any).user.userId;
    const query = req.query.q as string;
    const mimeType = req.query.mimeType as string;
    const tags = req.query.tags ? (req.query.tags as string).split(',').map((t) => t.trim()) : undefined;
    const isStarred = req.query.isStarred !== undefined ? req.query.isStarred === 'true' : undefined;
    const minSizeRaw = req.query.minSize ? parseInt(req.query.minSize as string, 10) : undefined;
    const maxSizeRaw = req.query.maxSize ? parseInt(req.query.maxSize as string, 10) : undefined;
    const minSize = minSizeRaw !== undefined && !isNaN(minSizeRaw) ? minSizeRaw : undefined;
    const maxSize = maxSizeRaw !== undefined && !isNaN(maxSizeRaw) ? maxSizeRaw : undefined;
    const folderId = req.query.folderId !== undefined ? (req.query.folderId as string) || null : undefined;
    const createdAfter = req.query.createdAfter as string;
    const createdBefore = req.query.createdBefore as string;
    const sortBy = req.query.sortBy as 'name' | 'size' | 'createdAt' | 'updatedAt';
    const sortOrder = req.query.sortOrder as 'asc' | 'desc';

    const results = await searchService.search({
      query,
      mimeType,
      tags,
      isStarred,
      minSize,
      maxSize,
      folderId,
      createdAfter,
      createdBefore,
      sortBy,
      sortOrder,
      ownerId,
    });

    res.json({ success: true, ...results });
  } catch (err) {
    next(err);
  }
});
