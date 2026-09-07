import { Router, Request, Response, NextFunction } from 'express';
import { filesService } from './files.service.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { idempotencyMiddleware } from '../../core/idempotency.middleware.js';
import fs from 'fs';
import path from 'path';
import { db } from '../../shared/db.js';
import { config } from '../../config/index.js';
import { storageService } from '../storage/storage.service.js';

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

// GET /:id/thumbnail - Stream thumbnail image for card boxes
filesRouter.get('/:id/thumbnail', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fileId = req.params.id;
    const file = db.files.get(fileId);
    if (!file) {
      return res.status(404).send('File not found');
    }

    // 1. Try fetching stored thumbnail from MinIO S3 object storage
    try {
      const minioKey = `minio://${config.minio.bucketName}/thumb_${fileId}_thumb_${fileId}`;
      if (await storageService.fileExists(minioKey)) {
        const stream = await storageService.fetchFileStream(minioKey);
        const mime = file.mimeType.startsWith('image/') ? (file.mimeType || 'image/png') : 'image/svg+xml';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return stream.pipe(res);
      }
    } catch {
      // fallback to disk cache or dynamic generation
    }

    // 2. Try fetching from disk cache
    const thumbDir = path.join(config.storagePath, 'thumbnails');
    const thumbPng = path.join(thumbDir, `thumb_${fileId}.png`);
    const thumbJpg = path.join(thumbDir, `thumb_${fileId}.jpg`);
    const thumbSvg = path.join(thumbDir, `thumb_${fileId}.svg`);

    if (fs.existsSync(thumbPng)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(thumbPng).pipe(res);
    }

    if (fs.existsSync(thumbJpg)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(thumbJpg).pipe(res);
    }

    if (fs.existsSync(thumbSvg)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(thumbSvg).pipe(res);
    }

    // On-the-fly generation if background job hasn't completed yet
    const isImage = file.mimeType.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(file.name);
    if (isImage) {
      try {
        const streamResult = await filesService.getStreamWithRange(file.id, (req as any).user.userId, (req as any).user.role);
        res.setHeader('Content-Type', file.mimeType || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return streamResult.stream.pipe(res);
      } catch (err) {
        // fallback
      }
    }

    const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE';
    const isPdf = file.mimeType.includes('pdf') || ext === 'PDF';
    const isVideo = file.mimeType.startsWith('video/') || ['MP4','MKV','AVI','MOV','WEBM'].includes(ext);
    const isCode = ['JS','TS','PY','JSON','HTML','CSS','CPP','JAVA','MD'].includes(ext);
    const isAudio = file.mimeType.startsWith('audio/') || ['MP3','WAV','OGG','FLAC'].includes(ext);

    let themeBg = '#1e293b';
    let accentColor = '#38bdf8';
    let iconSymbol = '📄';

    if (isPdf) { themeBg = '#450a0a'; accentColor = '#f87171'; iconSymbol = '📑'; }
    else if (isVideo) { themeBg = '#451a03'; accentColor = '#fbbf24'; iconSymbol = '🎬'; }
    else if (isCode) { themeBg = '#022c22'; accentColor = '#34d399'; iconSymbol = '💻'; }
    else if (isAudio) { themeBg = '#3b0764'; accentColor = '#c084fc'; iconSymbol = '🎵'; }
    else if (isImage) { themeBg = '#831843'; accentColor = '#f472b6'; iconSymbol = '🖼️'; }

    const cleanName = file.name.replace(/[^\w\.\-]/g, '').substring(0, 20);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${themeBg}" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bgGrad)" rx="12"/>
      <circle cx="150" cy="65" r="30" fill="${accentColor}" fill-opacity="0.15"/>
      <text x="150" y="73" dominant-baseline="middle" text-anchor="middle" font-size="30">${iconSymbol}</text>
      <rect x="100" y="112" width="100" height="22" rx="11" fill="${accentColor}" fill-opacity="0.2"/>
      <text x="150" y="127" dominant-baseline="middle" text-anchor="middle" fill="${accentColor}" font-family="system-ui, sans-serif" font-weight="bold" font-size="11">${ext}</text>
      <text x="150" y="152" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="10">${cleanName}</text>
    </svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(svg);
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
const createStreamHandler = (isDownload: boolean) => async (req: Request, res: Response, next: NextFunction) => {
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

    const dispositionType = isDownload ? 'attachment' : 'inline';
    const dispositionHeader = `${dispositionType}; filename="${encodeURIComponent(file.name)}"`;

    if (isRange) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      res.setHeader('Content-Length', contentLength.toString());
      res.setHeader('Content-Disposition', dispositionHeader);
    } else {
      res.status(200);
      res.setHeader('Content-Length', file.size.toString());
      res.setHeader('Content-Disposition', dispositionHeader);
    }

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

filesRouter.get('/:id/download', requireAuth, createStreamHandler(true));
filesRouter.get('/:id/stream', requireAuth, createStreamHandler(false));

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
