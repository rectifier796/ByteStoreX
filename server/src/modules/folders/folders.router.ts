import { Router, Request, Response, NextFunction } from 'express';
import { foldersService } from './folders.service.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idempotencyMiddleware } from '../../core/idempotency.middleware.js';

export const foldersRouter = Router();

function parseExpectedVersion(req: Request): number | undefined {
  if (req.body && req.body.expectedVersion !== undefined) {
    return parseInt(req.body.expectedVersion, 10);
  }
  const ifMatch = req.headers['if-match'];
  if (ifMatch) {
    const cleaned = ifMatch.replace(/"/g, '').trim();
    const parsed = parseInt(cleaned, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

foldersRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const parentId = (req.query.parentId as string) || null;
    const result = await foldersService.listContents(user.userId, user.role, parentId);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

foldersRouter.post('/', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const folder = await foldersService.create({ ...req.body, ownerId: user.userId }, user.role);
    res.status(201).json({ success: true, folder });
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch('/:id/star', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const folder = await foldersService.toggleStar(req.params.id, user.userId, user.role);
    res.json({ success: true, folder });
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch('/:id/rename', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const expectedVersion = parseExpectedVersion(req);
    const folder = await foldersService.rename(req.params.id, user.userId, user.role, req.body.name, expectedVersion);
    res.setHeader('ETag', `"${folder.version}"`);
    res.json({ success: true, folder });
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch('/:id/move', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const expectedVersion = parseExpectedVersion(req);
    const folder = await foldersService.move(req.params.id, user.userId, user.role, req.body.targetParentId || null, expectedVersion);
    res.setHeader('ETag', `"${folder.version}"`);
    res.json({ success: true, folder });
  } catch (err) {
    next(err);
  }
});

foldersRouter.post('/:id/copy', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const targetParentId = req.body.targetParentId || null;
    const newName = req.body.newName;
    const folder = await foldersService.copy(req.params.id, user.userId, user.role, targetParentId, newName);
    res.status(201).json({ success: true, folder });
  } catch (err) {
    next(err);
  }
});
