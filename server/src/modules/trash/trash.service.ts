import { db } from '../../shared/db.js';
import { FileMetadata, Folder } from '../../shared/types.js';
import { NotFoundError } from '../../core/errors.js';
import { auditService } from '../audit/audit.service.js';
import { blobsService } from '../blobs/blobs.service.js';
import { quotaService } from '../quota/quota.service.js';
import { redisCacheManager } from '../../shared/redis.cache.js';
import { postgresRepo } from '../../shared/postgres.repo.js';

export class TrashService {
  /**
   * Soft-deletes a file or folder (marking isTrashed = true, setting trashedAt)
   */
  async softDelete(resourceId: string, resourceType: 'file' | 'folder', ownerId: string): Promise<void> {
    const now = new Date().toISOString();

    if (resourceType === 'file') {
      const file = db.files.get(resourceId);
      if (!file || file.ownerId !== ownerId) throw new NotFoundError('File');
      file.isTrashed = true;
      file.trashedAt = now;
      db.files.set(resourceId, file);
      await postgresRepo.saveFile(file).catch(() => {});
      await redisCacheManager.del(`cache:meta:file:${resourceId}`);
    } else {
      const folder = db.folders.get(resourceId);
      if (!folder || folder.ownerId !== ownerId) throw new NotFoundError('Folder');
      folder.isTrashed = true;
      folder.trashedAt = now;
      db.folders.set(resourceId, folder);
      await postgresRepo.saveFolder(folder).catch(() => {});
    }

    await auditService.record({
      action: 'TRASH_SOFT_DELETE',
      category: 'trash',
      actorId: ownerId,
      resourceId,
      resourceType,
    });
  }

  /**
   * Restores a soft-deleted item from trash. If target parent folder is trashed, moves item to root.
   */
  async restore(resourceId: string, resourceType: 'file' | 'folder', ownerId: string): Promise<void> {
    if (resourceType === 'file') {
      const file = db.files.get(resourceId);
      if (!file || file.ownerId !== ownerId) throw new NotFoundError('File');

      // Check if parent folder is trashed
      if (file.folderId) {
        const parentFolder = db.folders.get(file.folderId);
        if (parentFolder && parentFolder.isTrashed) {
          // Move to root folder so restored file is accessible
          file.folderId = null;
        }
      }

      file.isTrashed = false;
      file.trashedAt = undefined;
      db.files.set(resourceId, file);
      await postgresRepo.saveFile(file).catch(() => {});
    } else {
      const folder = db.folders.get(resourceId);
      if (!folder || folder.ownerId !== ownerId) throw new NotFoundError('Folder');

      if (folder.parentId) {
        const parentFolder = db.folders.get(folder.parentId);
        if (parentFolder && parentFolder.isTrashed) {
          folder.parentId = null;
        }
      }

      folder.isTrashed = false;
      folder.trashedAt = undefined;
      db.folders.set(resourceId, folder);
      await postgresRepo.saveFolder(folder).catch(() => {});
    }

    await auditService.record({
      action: 'TRASH_RESTORE',
      category: 'trash',
      actorId: ownerId,
      resourceId,
      resourceType,
    });
  }

  /**
   * Restores all trashed files and folders for a user.
   */
  async restoreAll(ownerId: string): Promise<number> {
    const { files, folders } = await this.listTrash(ownerId);
    let count = 0;

    for (const f of files) {
      await this.restore(f.id, 'file', ownerId);
      count++;
    }
    for (const f of folders) {
      await this.restore(f.id, 'folder', ownerId);
      count++;
    }

    await auditService.record({
      action: 'TRASH_RESTORE_ALL',
      category: 'trash',
      actorId: ownerId,
      details: { restoredCount: count }
    });

    return count;
  }

  /**
   * Permanently purges a file or folder from trash, decrementing blob ref counts and releasing quota.
   */
  async purgePermanent(resourceId: string, resourceType: 'file' | 'folder', ownerId: string): Promise<void> {
    if (resourceType === 'file') {
      const file = db.files.get(resourceId);
      if (!file || file.ownerId !== ownerId) throw new NotFoundError('File');

      // Fetch all historical version entries for this file
      const versions = Array.from(db.fileVersions.values()).filter((v) => v.fileId === file.id);
      let anyEligibleForGC = false;

      if (versions.length > 0) {
        for (const ver of versions) {
          const { eligibleForGC } = await blobsService.decrementRefCount(ver.blobId);
          if (eligibleForGC) anyEligibleForGC = true;
          db.fileVersions.delete(ver.id);
        }
      } else {
        const blobId = file.activeBlobId || file.checksum;
        const { eligibleForGC } = await blobsService.decrementRefCount(blobId);
        if (eligibleForGC) anyEligibleForGC = true;
      }

      if (anyEligibleForGC) {
        await blobsService.runGarbageCollection(ownerId).catch(() => {});
      }

      // Release quota for purged file
      await quotaService.releaseQuota(ownerId, file.size);

      db.files.delete(resourceId);
      await postgresRepo.deleteFile(resourceId).catch(() => {});
    } else {
      const folder = db.folders.get(resourceId);
      if (!folder || folder.ownerId !== ownerId) throw new NotFoundError('Folder');
      db.folders.delete(resourceId);
      await postgresRepo.deleteFolder(resourceId).catch(() => {});
    }

    await auditService.record({
      action: 'TRASH_PERMANENT_PURGE',
      category: 'trash',
      actorId: ownerId,
      resourceId,
      resourceType,
    });
  }

  /**
   * Automated retention purge: permanently deletes items in trash older than retention threshold (e.g. 30 days).
   */
  async purgeExpiredTrash(retentionDays: number = 30): Promise<{ purgedFiles: number; purgedFolders: number }> {
    const cutoffTime = Date.now() - retentionDays * 86400000;
    let purgedFiles = 0;
    let purgedFolders = 0;

    const trashedFiles = Array.from(db.files.values()).filter(
      (f) => f.isTrashed && f.trashedAt && new Date(f.trashedAt).getTime() < cutoffTime
    );

    const trashedFolders = Array.from(db.folders.values()).filter(
      (f) => f.isTrashed && f.trashedAt && new Date(f.trashedAt).getTime() < cutoffTime
    );

    for (const file of trashedFiles) {
      await this.purgePermanent(file.id, 'file', file.ownerId);
      purgedFiles++;
    }

    for (const folder of trashedFolders) {
      await this.purgePermanent(folder.id, 'folder', folder.ownerId);
      purgedFolders++;
    }

    if (purgedFiles > 0 || purgedFolders > 0) {
      await auditService.record({
        action: 'TRASH_RETENTION_PURGE',
        category: 'trash',
        actorId: 'system',
        details: { retentionDays, purgedFiles, purgedFolders }
      });
    }

    return { purgedFiles, purgedFolders };
  }

  async listTrash(ownerId: string): Promise<{ files: FileMetadata[]; folders: Folder[] }> {
    const files = Array.from(db.files.values()).filter((f) => f.ownerId === ownerId && f.isTrashed);
    const folders = Array.from(db.folders.values()).filter((f) => f.ownerId === ownerId && f.isTrashed);
    return { files, folders };
  }

  async emptyTrash(ownerId: string): Promise<number> {
    const { files, folders } = await this.listTrash(ownerId);
    let count = 0;

    for (const f of files) {
      await this.purgePermanent(f.id, 'file', ownerId);
      count++;
    }
    for (const f of folders) {
      await this.purgePermanent(f.id, 'folder', ownerId);
      count++;
    }

    return count;
  }
}

export const trashService = new TrashService();
