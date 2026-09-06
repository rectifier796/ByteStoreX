import { Router, Request, Response, NextFunction } from 'express';
import { sharingService } from './sharing.service.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idempotencyMiddleware } from '../../core/idempotency.middleware.js';

export const sharingRouter = Router();

// POST /api/v1/sharing/links - Create public share link (supports expiration & password protection)
sharingRouter.post('/links', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const shareLink = await sharingService.createShareLink(req.body, user.userId, user.role);
    res.status(201).json({ success: true, shareLink });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sharing/my-links - List active share links created by user
sharingRouter.get('/my-links', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const createdBy = (req as any).user.userId;
    const links = await sharingService.listUserShareLinks(createdBy);
    res.json({ success: true, links });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/sharing/links/:id - Revoke a public share link
sharingRouter.delete('/links/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    await sharingService.revokeShareLink(user.userId, user.role, req.params.id);
    res.json({ success: true, message: `Share link '${req.params.id}' successfully revoked.` });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/sharing/grant - Grant direct ACL permission to another user by email
sharingRouter.post('/grant', requireAuth, idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const granter = (req as any).user;
    const permission = await sharingService.grantUserPermission(granter.userId, granter.role, req.body);
    res.status(201).json({ success: true, permission });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/sharing/permissions/:id - Revoke direct user permission grant
sharingRouter.delete('/permissions/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const granter = (req as any).user;
    await sharingService.revokeUserPermission(granter.userId, granter.role, req.params.id);
    res.json({ success: true, message: `Permission grant '${req.params.id}' revoked.` });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sharing/permissions/:resourceType/:resourceId - List direct user ACL permissions for a resource
sharingRouter.get('/permissions/:resourceType/:resourceId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const resourceType = req.params.resourceType as 'file' | 'folder';
    const permissions = await sharingService.listResourcePermissions(user.userId, user.role, resourceType, req.params.resourceId);
    res.json({ success: true, permissions });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sharing/public/:token - Resolve public share link
sharingRouter.get('/public/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const password = (req.headers['x-share-password'] as string) || (req.query.password as string);
    const result = await sharingService.resolveShareToken(req.params.token, password);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sharing/public/:token/download - Public streaming download with Range/206 & disconnect handling
sharingRouter.get('/public/:token/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const password = (req.headers['x-share-password'] as string) || (req.query.password as string);
    const rangeHeader = req.headers.range;

    const result = await sharingService.getPublicDownloadStream(req.params.token, password, rangeHeader);
    const { file, isRange, start, end, contentLength, stream } = result;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('ETag', `"${file.version}"`);

    // Handle client disconnect gracefully without crashes or resource leaks
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
});

// GET /api/v1/sharing/public/:token/signed-url - Public short-lived presigned URL generation
sharingRouter.get('/public/:token/signed-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const password = (req.headers['x-share-password'] as string) || (req.query.password as string);
    const expirySeconds = req.query.expiresIn ? parseInt(req.query.expiresIn as string, 10) : 900;

    const result = await sharingService.getPublicSignedUrl(req.params.token, password, expirySeconds);
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
