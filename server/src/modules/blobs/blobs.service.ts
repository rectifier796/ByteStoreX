import { db } from '../../shared/db.js';
import { BlobRecord } from '../../shared/types.js';
import { redisLockManager } from '../../shared/redis.lock.js';
import { storageService } from '../storage/storage.service.js';
import { auditService } from '../audit/audit.service.js';
import { logger } from '../../core/logger.js';

export interface RegisterBlobDTO {
  checksum: string;
  sizeBytes: number;
  mimeType: string;
  storagePath: string;
}

export class BlobsService {
  /**
   * Register or reuse a blob based on SHA-256 content identity.
   * Employs distributed locking (lock:blob:${checksum}) to ensure safe concurrent identical uploads.
   */
  async registerOrReuseBlob(dto: RegisterBlobDTO): Promise<{ blob: BlobRecord; isExisting: boolean }> {
    const { checksum, sizeBytes, mimeType, storagePath } = dto;
    const lockKey = `lock:blob:${checksum}`;
    const lockValue = await redisLockManager.acquireLock(lockKey, 30);

    try {
      // 1. Check if blob already exists by SHA-256 content address
      const existingBlob = db.blobs.get(checksum);

      if (existingBlob) {
        // Increment reference count atomically
        existingBlob.referenceCount += 1;
        db.blobs.set(existingBlob.id, existingBlob);

        logger.info('BlobsService', `Content deduplication hit for SHA-256 '${checksum}'. Reference count incremented to ${existingBlob.referenceCount}.`);

        return { blob: existingBlob, isExisting: true };
      }

      // 2. Create new Blob Record if missing
      const newBlob: BlobRecord = {
        id: checksum,
        checksum,
        storagePath,
        sizeBytes,
        mimeType,
        referenceCount: 1,
        createdAt: new Date().toISOString(),
      };

      db.blobs.set(newBlob.id, newBlob);
      logger.info('BlobsService', `Created new unique blob record '${newBlob.id}' for SHA-256 '${checksum}'.`);

      return { blob: newBlob, isExisting: false };
    } finally {
      if (lockValue) {
        await redisLockManager.releaseLock(lockKey, lockValue);
      }
    }
  }

  /**
   * Increment reference count for a blob (e.g. on file copy or new version).
   */
  async incrementRefCount(blobId: string): Promise<BlobRecord | null> {
    const blob = db.blobs.get(blobId);
    if (!blob) return null;

    blob.referenceCount += 1;
    db.blobs.set(blob.id, blob);
    logger.info('BlobsService', `Incremented refCount for blob '${blobId}' to ${blob.referenceCount}.`);
    return blob;
  }

  /**
   * Decrement reference count for a blob (e.g. on file purge).
   * Returns whether the blob is now eligible for Garbage Collection (referenceCount <= 0).
   */
  async decrementRefCount(blobId: string): Promise<{ blob: BlobRecord | null; eligibleForGC: boolean }> {
    const blob = db.blobs.get(blobId);
    if (!blob) {
      return { blob: null, eligibleForGC: false };
    }

    blob.referenceCount = Math.max(0, blob.referenceCount - 1);
    db.blobs.set(blob.id, blob);

    const eligibleForGC = blob.referenceCount <= 0;
    logger.info('BlobsService', `Decremented refCount for blob '${blobId}' to ${blob.referenceCount}. Eligible for GC: ${eligibleForGC}`);

    return { blob, eligibleForGC };
  }

  /**
   * Execute Garbage Collection to physically remove unreferenced blobs (referenceCount <= 0).
   */
  async runGarbageCollection(actorId: string = 'system'): Promise<{ collectedCount: number; freedBytes: number; deletedBlobIds: string[] }> {
    const eligibleBlobs = Array.from(db.blobs.values()).filter((b) => b.referenceCount <= 0);
    const deletedBlobIds: string[] = [];
    let freedBytes = 0;

    for (const blob of eligibleBlobs) {
      try {
        // Physical removal from storage tier (MinIO / disk)
        await storageService.deleteFile(blob.storagePath);
        db.blobs.delete(blob.id);
        deletedBlobIds.push(blob.id);
        freedBytes += blob.sizeBytes;

        logger.info('BlobsService', `Garbage collected orphan blob '${blob.id}' (freed ${blob.sizeBytes} bytes).`);
      } catch (err: any) {
        logger.error('BlobsService', `Failed to garbage collect blob '${blob.id}': ${err.message}`);
      }
    }

    if (deletedBlobIds.length > 0) {
      await auditService.record({
        action: 'BLOB_GARBAGE_COLLECTED',
        category: 'file',
        actorId,
        details: { collectedCount: deletedBlobIds.length, freedBytes, deletedBlobIds }
      });
    }

    return {
      collectedCount: deletedBlobIds.length,
      freedBytes,
      deletedBlobIds,
    };
  }

  /**
   * Fetch storage efficiency statistics and GC eligibility metrics.
   */
  async getStats(): Promise<{
    totalBlobs: number;
    totalSizeBytes: number;
    totalLogicalReferences: number;
    eligibleForGCCount: number;
  }> {
    const allBlobs = Array.from(db.blobs.values());
    let totalSizeBytes = 0;
    let totalLogicalReferences = 0;
    let eligibleForGCCount = 0;

    for (const b of allBlobs) {
      totalSizeBytes += b.sizeBytes;
      totalLogicalReferences += b.referenceCount;
      if (b.referenceCount <= 0) {
        eligibleForGCCount += 1;
      }
    }

    return {
      totalBlobs: allBlobs.length,
      totalSizeBytes,
      totalLogicalReferences,
      eligibleForGCCount,
    };
  }
}

export const blobsService = new BlobsService();
