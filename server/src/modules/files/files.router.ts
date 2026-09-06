import { Router, Request, Response, NextFunction } from 'express';
import { filesService } from './files.service.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idempotencyMiddleware } from '../../core/idempotency.middleware.js';

export const filesRouter = Router();

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

filesRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const folderId = (req.query.folderId as string) || null;
    const files = await filesService.listFiles(user.userId, user.role, folderId);
    res.json({ success: true, files });
  } catch (err) {
    next(err);
  }
});

filesRouter.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const file = await filesService.getById(req.params.id, user.userId, user.role);
    res.setHeader('ETag', `"${file.version}"`);
    res.json({ success: true, file });
  } catch (err) {
    next(err);
  }
});

filesRouter.patch('/:id/star', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const file = await filesService.toggleStar(req.params.id, user.userId, user.role);
    res.json({ success: true, file });
  } catch (err) {
    next(err);
  }
});

filesRouter.patch('/:id/rename', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const expectedVersion = parseExpectedVersion(req);
    const file = await filesService.rename(req.params.id, user.userId, user.role, req.body.name, expectedVersion);
    res.setHeader('ETag', `"${file.version}"`);
    res.json({ success: true, file });
  } catch (err) {
    next(err);
  }
});

filesRouter.patch('/:id/move', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const expectedVersion = parseExpectedVersion(req);
    const file = await filesService.move(req.params.id, user.userId, user.role, req.body.targetFolderId || null, expectedVersion);
    res.setHeader('ETag', `"${file.version}"`);
    res.json({ success: true, file });
  } catch (err) {
    next(err);
  }
});

filesRouter.post('/:id/copy', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const targetFolderId = req.body.targetFolderId || null;
    const newName = req.body.newName;
    const file = await filesService.copy(req.params.id, user.userId, user.role, targetFolderId, newName);
    res.status(201).json({ success: true, file });
  } catch (err) {
    next(err);
  }
});

// GET /:id/download & GET /:id/stream - Stream file content with HTTP Range/206 support & disconnect handling
const streamHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const rangeHeader = req.headers.range;

    const result = await filesService.getStreamWithRange(req.params.id, user.userId, user.role, rangeHeader);
    const { file, isRange, start, end, contentLength, stream } = result;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('ETag', `"${file.version}"`);

    // Handle client disconnect gracefully without unhandled crashes
    const cleanup = () => {
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    stream.on('error', cleanup);

    if (isRange) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      res.setHeader('Content-Length', contentLength.toString());
    } else {
      res.status(200);
      res.setHeader('Content-Length', file.size.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    }

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

filesRouter.get('/:id/download', requireAuth, streamHandler);
filesRouter.get('/:id/stream', requireAuth, streamHandler);

// GET /:id/signed-url - Generate short-lived presigned URL after authorization check
filesRouter.get('/:id/signed-url', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const expirySeconds = req.query.expiresIn ? parseInt(req.query.expiresIn as string, 10) : 900;
    const action = (req.query.action as 'getObject' | 'putObject') || 'getObject';

    const result = await filesService.generateSignedUrl(req.params.id, user.userId, user.role, expirySeconds, action);
    res.json({
      success: true,
      fileId: result.file.id,
      signedUrl: result.signedUrl,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

// GET /:id/versions - List version history for a file
filesRouter.get('/:id/versions', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const versions = await filesService.listVersions(req.params.id, user.userId, user.role);
    res.json({ success: true, versions });
  } catch (err) {
    next(err);
  }
});

// POST /:id/versions/:versionId/restore - Restore a historical version
filesRouter.post('/:id/versions/:versionId/restore', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const result = await filesService.restoreVersion(req.params.id, req.params.versionId, user.userId, user.role);
    res.setHeader('ETag', `"${result.file.version}"`);
    res.json({ success: true, file: result.file, restoredVersion: result.restoredVersion });
  } catch (err) {
    next(err);
  }
});

// DELETE /:id/versions/:versionId - Delete a historical version
filesRouter.delete('/:id/versions/:versionId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    await filesService.deleteVersion(req.params.id, req.params.versionId, user.userId, user.role);
    res.json({ success: true, message: `File version '${req.params.versionId}' successfully deleted.` });
  } catch (err) {
    next(err);
  }
});
