import { db } from '../../shared/db.js';
import { QuotaInfo } from '../../shared/types.js';
import { config } from '../../config/index.js';
import { ValidationError } from '../../core/errors.js';
import { auditService } from '../audit/audit.service.js';
import { redisLockManager } from '../../shared/redis.lock.js';

export class QuotaService {
  async getUserQuota(userId: string): Promise<QuotaInfo> {
    const userFiles = Array.from(db.files.values()).filter(
      (f) => f.ownerId === userId && !f.isTrashed
    );

    const userFolders = Array.from(db.folders.values()).filter(
      (f) => f.ownerId === userId && !f.isTrashed
    );

    let calculatedUsedBytes = 0;
    const breakdown = {
      documents: 0,
      media: 0,
      archives: 0,
      code: 0,
      other: 0,
    };

    for (const f of userFiles) {
      calculatedUsedBytes += f.size;
      const mime = f.mimeType.toLowerCase();

      if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) {
        breakdown.media += f.size;
      } else if (mime.includes('pdf') || mime.includes('document') || mime.includes('word') || mime.includes('text')) {
        breakdown.documents += f.size;
      } else if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar') || mime.includes('gz')) {
        breakdown.archives += f.size;
      } else if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript') || mime.includes('html') || mime.includes('css')) {
        breakdown.code += f.size;
      } else {
        breakdown.other += f.size;
      }
    }

    const user = db.users.get(userId);
    const totalQuotaBytes = user ? user.quotaBytes || config.defaultQuota : config.defaultQuota;
    const usedBytes = user ? Math.max(user.storageUsedBytes || 0, calculatedUsedBytes) : calculatedUsedBytes;

    return {
      userId,
      usedBytes,
      totalQuotaBytes,
      fileCount: userFiles.length,
      folderCount: userFolders.length,
      breakdown,
    };
  }

  /**
   * Atomically checks and reserves storage quota for a user before accepting upload/copy.
   */
  async reserveQuota(userId: string, incomingBytes: number): Promise<QuotaInfo> {
    if (incomingBytes < 0) {
      throw new ValidationError('Reserved bytes cannot be negative.');
    }

    const lockKey = `lock:quota:${userId}`;
    const token = await redisLockManager.acquireLock(lockKey, 10);

    try {
      const user = db.users.get(userId);
      const totalQuota = user ? user.quotaBytes || config.defaultQuota : config.defaultQuota;
      const currentUsed = user ? user.storageUsedBytes || 0 : 0;

      if (currentUsed + incomingBytes > totalQuota) {
        await auditService.record({
          action: 'QUOTA_EXCEEDED',
          category: 'quota',
          actorId: userId,
          details: {
            requestedBytes: incomingBytes,
            currentUsedBytes: currentUsed,
            totalQuotaBytes: totalQuota,
            overflowBytes: currentUsed + incomingBytes - totalQuota,
          }
        });

        const overflowMB = ((currentUsed + incomingBytes - totalQuota) / (1024 * 1024)).toFixed(2);
        throw new ValidationError(
          `Storage quota exceeded. Required: ${(incomingBytes / (1024 * 1024)).toFixed(2)} MB, Available: ${((totalQuota - currentUsed) / (1024 * 1024)).toFixed(2)} MB. (Exceeds by ${overflowMB} MB)`
        );
      }

      if (user) {
        user.storageUsedBytes = currentUsed + incomingBytes;
        user.updatedAt = new Date().toISOString();
        db.users.set(userId, user);
      }

      await auditService.record({
        action: 'QUOTA_RESERVED',
        category: 'quota',
        actorId: userId,
        details: {
          reservedBytes: incomingBytes,
          newTotalUsedBytes: currentUsed + incomingBytes,
          quotaLimitBytes: totalQuota,
        }
      });

      return this.getUserQuota(userId);
    } finally {
      if (token) {
        await redisLockManager.releaseLock(lockKey, token);
      }
    }
  }

  /**
   * Atomically releases storage quota for a user upon file purge or session cancellation.
   */
  async releaseQuota(userId: string, releasedBytes: number): Promise<QuotaInfo> {
    if (releasedBytes <= 0) return this.getUserQuota(userId);

    const lockKey = `lock:quota:${userId}`;
    const token = await redisLockManager.acquireLock(lockKey, 10);

    try {
      const user = db.users.get(userId);
      if (user) {
        const currentUsed = user.storageUsedBytes || 0;
        user.storageUsedBytes = Math.max(0, currentUsed - releasedBytes);
        user.updatedAt = new Date().toISOString();
        db.users.set(userId, user);
      }

      await auditService.record({
        action: 'QUOTA_RELEASED',
        category: 'quota',
        actorId: userId,
        details: {
          releasedBytes,
          newTotalUsedBytes: user ? user.storageUsedBytes : 0,
        }
      });

      return this.getUserQuota(userId);
    } finally {
      if (token) {
        await redisLockManager.releaseLock(lockKey, token);
      }
    }
  }

  async checkCanUpload(userId: string, incomingBytes: number): Promise<boolean> {
    const quota = await this.getUserQuota(userId);
    return quota.usedBytes + incomingBytes <= quota.totalQuotaBytes;
  }
}

export const quotaService = new QuotaService();
