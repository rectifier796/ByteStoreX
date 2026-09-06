import express from 'express';
import cors from 'cors';
import { requestIdMiddleware } from './core/requestId.middleware.js';
import { errorHandlerMiddleware } from './core/error.middleware.js';
import { logger } from './core/logger.js';

// Import all 12 modular monolith routers
import { authRouter } from './modules/auth/auth.router.js';
import { usersRouter } from './modules/users/users.router.js';
import { filesRouter } from './modules/files/files.router.js';
import { foldersRouter } from './modules/folders/folders.router.js';
import { uploadsRouter } from './modules/uploads/uploads.router.js';
import { sharingRouter } from './modules/sharing/sharing.router.js';
import { searchRouter } from './modules/search/search.router.js';
import { trashRouter } from './modules/trash/trash.router.js';
import { jobsRouter } from './modules/jobs/jobs.router.js';
import { quotaRouter } from './modules/quota/quota.router.js';
import { auditRouter } from './modules/audit/audit.router.js';
import { blobsRouter } from './modules/blobs/blobs.router.js';

import { storageRouter } from './modules/storage/storage.router.js';
import { workerDispatcher } from './modules/jobs/worker.dispatcher.js';

export const app = express();

// Start in-process background worker daemon loop (2s polling interval)
workerDispatcher.startPolling(2000);

// Global Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Attach Request ID middleware & AsyncLocalStorage context
app.use(requestIdMiddleware);

// Structured HTTP Access Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP', `${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`, {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: duration
    });
  });
  next();
});

import { db } from './shared/db.js';

// Enriched Observability Health Check endpoint
app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'UP',
    system: 'ByteStoreX Modular Monolith',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    metrics: {
      memory: {
        rssMB: (mem.rss / 1024 / 1024).toFixed(2),
        heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
        heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
      },
      entities: {
        users: db.users.size,
        files: db.files.size,
        folders: db.folders.size,
        blobs: db.blobs.size,
        uploadSessions: db.uploadSessions.size,
        jobs: db.jobs.size,
        shareLinks: db.shareLinks.size,
      }
    }
  });
});

// Register Module Routers
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/files', filesRouter);
app.use('/api/v1/folders', foldersRouter);
app.use('/api/v1/uploads', uploadsRouter);
app.use('/api/v1/storage', storageRouter);
app.use('/api/v1/sharing', sharingRouter);
app.use('/api/v1/search', searchRouter);
app.use('/api/v1/trash', trashRouter);
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/quota', quotaRouter);
app.use('/api/v1/audit', auditRouter);
app.use('/api/v1/blobs', blobsRouter);
app.use('/api/blobs', blobsRouter);

// Centralized Error Handling Middleware
app.use(errorHandlerMiddleware);
