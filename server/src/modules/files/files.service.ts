import { db } from '../../shared/db.js';
import { FileMetadata, FileVersion } from '../../shared/types.js';
import { NotFoundError, ConflictError, ValidationError } from '../../core/errors.js';
import { SignedUrlAction } from '../storage/storage.adapter.js';
import { storageService } from '../storage/storage.service.js';
import { auditService } from '../audit/audit.service.js';
import { blobsService } from '../blobs/blobs.service.js';
import { quotaService } from '../quota/quota.service.js';
import { redisCacheManager } from '../../shared/redis.cache.js';
import { assertPermission } from '../../shared/permissions.js';
import { v4 as uuidv4 } from 'uuid';
import { postgresRepo } from '../../shared/postgres.repo.js';

export class FilesService {
  private checkOptimisticLock(file: FileMetadata, expectedVersion?: number): void {
    if (expectedVersion !== undefined && file.version !== expectedVersion) {
      throw new ConflictError(
        `Stale update detected for file '${file.name}' (${file.id}). Current version is ${file.version}, expected version ${expectedVersion}`
      );
    }
  }

  async listFiles(userId: string, userRole: string | undefined, folderId: string | null = null): Promise<FileMetadata[]> {
    return Array.from(db.files.values()).filter((f) => {
      if (f.isTrashed || f.folderId !== folderId) return false;
      // Allow if owner, admin, or has permissions
      if (f.ownerId === userId || userRole === 'admin') return true;
      try {
        assertPermission(userId, userRole, f.id, 'file', f.ownerId, 'VIEWER');
        return true;
      } catch {
        return false;
      }
    });
  }

  async getById(fileId: string, userId: string, userRole: string | undefined): Promise<FileMetadata> {
    const cacheKey = `cache:meta:file:${fileId}`;
    const cachedFile = await redisCacheManager.get<FileMetadata>(cacheKey);

    if (cachedFile && !cachedFile.isTrashed) {
      assertPermission(userId, userRole, cachedFile.id, 'file', cachedFile.ownerId, 'VIEWER');
      return cachedFile;
    }

    const file = db.files.get(fileId);
    if (!file || file.isTrashed) {
      throw new NotFoundError('File');
    }
    assertPermission(userId, userRole, file.id, 'file', file.ownerId, 'VIEWER');
    await redisCacheManager.set(cacheKey, file, 60);
    return file;
  }

  async toggleStar(fileId: string, userId: string, userRole: string | undefined): Promise<FileMetadata> {
    const file = await this.getById(fileId, userId, userRole);
    file.isStarred = !file.isStarred;
    file.updatedAt = new Date().toISOString();
    db.files.set(fileId, file);
    await postgresRepo.saveFile(file);
    await redisCacheManager.del(`cache:meta:file:${fileId}`);
    return file;
  }

  async rename(fileId: string, userId: string, userRole: string | undefined, newName: string, expectedVersion?: number): Promise<FileMetadata> {
    const file = await this.getById(fileId, userId, userRole);
    assertPermission(userId, userRole, file.id, 'file', file.ownerId, 'EDITOR');

    this.checkOptimisticLock(file, expectedVersion);

    file.name = newName.trim();
    file.version += 1;
    file.updatedAt = new Date().toISOString();

    db.files.set(fileId, file);
    await postgresRepo.saveFile(file);
    await redisCacheManager.del(`cache:meta:file:${fileId}`);

    await auditService.record({
      action: 'FILE_RENAME',
      category: 'file',
      actorId: userId,
      resourceId: fileId,
      details: { newName: file.name, newVersion: file.version }
    });

    return file;
  }

  async move(fileId: string, userId: string, userRole: string | undefined, targetFolderId: string | null, expectedVersion?: number): Promise<FileMetadata> {
    const file = await this.getById(fileId, userId, userRole);
    assertPermission(userId, userRole, file.id, 'file', file.ownerId, 'EDITOR');

    if (targetFolderId) {
      const targetFolder = db.folders.get(targetFolderId);
      if (!targetFolder || targetFolder.isTrashed) {
        throw new NotFoundError('Target Folder');
      }
      assertPermission(userId, userRole, targetFolder.id, 'folder', targetFolder.ownerId, 'EDITOR');
    }

    this.checkOptimisticLock(file, expectedVersion);

    file.folderId = targetFolderId;
    file.version += 1;
    file.updatedAt = new Date().toISOString();

    db.files.set(fileId, file);
    await postgresRepo.saveFile(file);
    await redisCacheManager.del(`cache:meta:file:${fileId}`);

    await auditService.record({
      action: 'FILE_MOVE',
      category: 'file',
      actorId: userId,
      resourceId: fileId,
      details: { targetFolderId, newVersion: file.version }
    });

    return file;
  }

  async copy(fileId: string, userId: string, userRole: string | undefined, targetFolderId: string | null, newName?: string): Promise<FileMetadata> {
    const sourceFile = await this.getById(fileId, userId, userRole);
    assertPermission(userId, userRole, sourceFile.id, 'file', sourceFile.ownerId, 'VIEWER');

    if (targetFolderId) {
      const targetFolder = db.folders.get(targetFolderId);
      if (!targetFolder || targetFolder.isTrashed) {
        throw new NotFoundError('Target Folder');
      }
      assertPermission(userId, userRole, targetFolder.id, 'folder', targetFolder.ownerId, 'EDITOR');
    }

    // Atomically reserve storage quota for the user copying the file
    await quotaService.reserveQuota(userId, sourceFile.size);

    const blobId = sourceFile.activeBlobId || sourceFile.checksum;
    await blobsService.incrementRefCount(blobId);

    const copiedFile: FileMetadata = {
      id: `fil-${uuidv4().substring(0, 8)}`,
      name: newName ? newName.trim() : `Copy of ${sourceFile.name}`,
      originalName: sourceFile.originalName,
      mimeType: sourceFile.mimeType,
      size: sourceFile.size,
      storagePath: sourceFile.storagePath, // Points to deduplicated storage object
      folderId: targetFolderId,
      ownerId: userId,
      isStarred: false,
      isTrashed: false,
      tags: [...sourceFile.tags],
      version: 1,
      checksum: sourceFile.checksum,
      activeBlobId: blobId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.files.set(copiedFile.id, copiedFile);
    await postgresRepo.saveFile(copiedFile);

    await auditService.record({
      action: 'FILE_COPY',
      category: 'file',
      actorId: userId,
      resourceId: copiedFile.id,
      details: { sourceFileId: fileId, targetFolderId }
    });

    return copiedFile;
  }

  async getDownloadStream(fileId: string, userId: string, userRole: string | undefined) {
    const file = await this.getById(fileId, userId, userRole);
    const stream = await storageService.fetchFileStream(file.storagePath);
    return { file, stream };
  }

  async listVersions(fileId: string, userId: string, userRole: string | undefined): Promise<FileVersion[]> {
    await this.getById(fileId, userId, userRole);
    return Array.from(db.fileVersions.values())
      .filter((v) => v.fileId === fileId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async restoreVersion(
    fileId: string,
    versionId: string,
    userId: string,
    userRole: string | undefined
  ): Promise<{ file: FileMetadata; restoredVersion: FileVersion }> {
    const file = await this.getById(fileId, userId, userRole);
    assertPermission(userId, userRole, file.id, 'file', file.ownerId, 'EDITOR');

    const targetVer = db.fileVersions.get(versionId);
    if (!targetVer || targetVer.fileId !== fileId) {
      throw new NotFoundError('File Version');
    }

    const targetBlob = db.blobs.get(targetVer.blobId);
    if (!targetBlob) {
      throw new NotFoundError('Version Blob Payload');
    }

    // Increment blob reference count for restored blob
    await blobsService.incrementRefCount(targetBlob.id);

    const nextVersionNumber = file.version + 1;
    const restoredVerRecord: FileVersion = {
      id: `ver-${file.id}-${nextVersionNumber}`,
      fileId: file.id,
      blobId: targetBlob.id,
      versionNumber: nextVersionNumber,
      sizeBytes: targetBlob.sizeBytes,
      mimeType: targetBlob.mimeType,
      checksum: targetBlob.checksum,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };

    db.fileVersions.set(restoredVerRecord.id, restoredVerRecord);
    await postgresRepo.saveFileVersion(restoredVerRecord);

    file.version = nextVersionNumber;
    file.activeBlobId = targetBlob.id;
    file.storagePath = targetBlob.storagePath;
    file.size = targetBlob.sizeBytes;
    file.checksum = targetBlob.checksum;
    file.mimeType = targetBlob.mimeType;
    file.updatedAt = new Date().toISOString();

    db.files.set(file.id, file);
    await postgresRepo.saveFile(file);
    await redisCacheManager.del(`cache:meta:file:${file.id}`);

    await auditService.record({
      action: 'FILE_VERSION_RESTORE',
      category: 'file',
      actorId: userId,
      resourceId: file.id,
      details: { restoredFromVersion: targetVer.versionNumber, newVersion: nextVersionNumber }
    });

    return { file, restoredVersion: restoredVerRecord };
  }

  async deleteVersion(fileId: string, versionId: string, userId: string, userRole: string | undefined): Promise<void> {
    const file = await this.getById(fileId, userId, userRole);
    assertPermission(userId, userRole, file.id, 'file', file.ownerId, 'EDITOR');

    const targetVer = db.fileVersions.get(versionId);
    if (!targetVer || targetVer.fileId !== fileId) {
      throw new NotFoundError('File Version');
    }

    if (targetVer.versionNumber === file.version || targetVer.blobId === file.activeBlobId) {
      throw new ConflictError('Cannot delete the currently active version of a file.');
    }

    db.fileVersions.delete(versionId);

    const { eligibleForGC } = await blobsService.decrementRefCount(targetVer.blobId);
    if (eligibleForGC) {
      await blobsService.runGarbageCollection(userId).catch(() => {});
    }

    await auditService.record({
      action: 'FILE_VERSION_DELETE',
      category: 'file',
      actorId: userId,
      resourceId: file.id,
      details: { deletedVersionNumber: targetVer.versionNumber, versionId }
    });
  }

  async getStreamWithRange(
    fileId: string,
    userId: string,
    userRole: string | undefined,
    rangeHeader?: string
  ) {
    const file = await this.getById(fileId, userId, userRole);

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      let start = parts[0] ? parseInt(parts[0], 10) : 0;
      let end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;

      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= file.size) end = file.size - 1;

      if (start < 0 || start > end || start >= file.size) {
        throw new ValidationError(`Requested range bytes=${start}-${end}/${file.size} not satisfiable.`);
      }

      const contentLength = end - start + 1;
      const stream = await storageService.fetchFileRangeStream(file.storagePath, start, end);

      return { file, isRange: true, start, end, contentLength, stream };
    }

    const stream = await storageService.fetchFileStream(file.storagePath);
    return { file, isRange: false, start: 0, end: file.size - 1, contentLength: file.size, stream };
  }

  async generateSignedUrl(
    fileId: string,
    userId: string,
    userRole: string | undefined,
    expirySeconds: number = 900,
    action: SignedUrlAction = 'getObject'
  ) {
    const file = await this.getById(fileId, userId, userRole);
    assertPermission(userId, userRole, file.id, 'file', file.ownerId, action === 'putObject' ? 'EDITOR' : 'VIEWER');

    const signedUrl = await storageService.generatePresignedUrl(file.storagePath, expirySeconds, action);
    const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

    await auditService.record({
      action: 'SIGNED_URL_GENERATE',
      category: 'file',
      actorId: userId,
      resourceId: file.id,
      details: { expirySeconds, action }
    });

    return { file, signedUrl, expiresAt };
  }
}

export const filesService = new FilesService();
