import { Router, Request, Response, NextFunction } from 'express';
import { storageService } from './storage.service.js';
import { filesService } from '../files/files.service.js';
import { requireAuth } from '../auth/auth.middleware.js';

export const storageRouter = Router();

// Generate short-lived presigned URL for direct object download or upload
storageRouter.get('/presigned-url/:fileId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const action = (req.query.action as 'getObject' | 'putObject') || 'getObject';
    const expirySeconds = req.query.expiry ? parseInt(req.query.expiry as string, 10) : 900;

    const file = await filesService.getById(req.params.fileId, user.userId, user.role);
    const presignedUrl = await storageService.generatePresignedUrl(file.storagePath, expirySeconds, action);

    res.json({
      success: true,
      fileId: file.id,
      fileName: file.name,
      presignedUrl,
      expiresInSeconds: expirySeconds,
    });
  } catch (err) {
    next(err);
  }
});
