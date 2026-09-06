import { Readable } from 'stream';
import { StorageAdapter, SignedUrlAction } from './storage.adapter.js';
import { minioClient } from './minio.init.js';
import { localStorageProvider } from './local.storage.js';
import { config } from '../../config/index.js';
import { logger } from '../../core/logger.js';
import { sanitizeObjectKey, assertSafeStoragePath } from '../../core/security.js';

export class MinioStorageAdapter implements StorageAdapter {
  private bucketName: string;

  constructor() {
    this.bucketName = config.minio.bucketName;
  }

  private cleanKey(key: string): string {
    let unescaped = key;
    if (key.startsWith('minio://')) {
      unescaped = key.replace(`minio://${this.bucketName}/`, '');
    }
    return sanitizeObjectKey(unescaped);
  }

  async putObject(
    key: string,
    content: Readable | Buffer,
    size?: number,
    mimeType?: string
  ): Promise<{ storagePath: string; size: number }> {
    const objectName = this.cleanKey(key);

    try {
      if (Buffer.isBuffer(content)) {
        await minioClient.putObject(
          this.bucketName,
          objectName,
          content,
          content.length,
          { 'Content-Type': mimeType || 'application/octet-stream' }
        );
        logger.info('MinioStorageAdapter', `Object uploaded cleanly to MinIO S3 bucket "${this.bucketName}/${objectName}"`, { size: content.length });
        return { storagePath: `minio://${this.bucketName}/${objectName}`, size: content.length };
      }

      // Stream upload
      const calculatedSize = size || 0;
      await minioClient.putObject(
        this.bucketName,
        objectName,
        content,
        calculatedSize,
        { 'Content-Type': mimeType || 'application/octet-stream' }
      );
      logger.info('MinioStorageAdapter', `Stream uploaded to MinIO S3 bucket "${this.bucketName}/${objectName}"`, { size: calculatedSize });

      return { storagePath: `minio://${this.bucketName}/${objectName}`, size: calculatedSize };
    } catch (err: any) {
      logger.warn('MinioStorageAdapter', `MinIO S3 error: ${err.message}. Falling back to local disk storage.`);
      const fileId = objectName.split('_')[0] || 'file';
      const fileName = objectName.substring(fileId.length + 1) || 'file.bin';
      return localStorageProvider.saveFile(fileId, content, fileName);
    }
  }

  async getObject(key: string): Promise<Readable> {
    const objectName = this.cleanKey(key);

    if (key.startsWith('minio://')) {
      try {
        return await minioClient.getObject(this.bucketName, objectName);
      } catch (err: any) {
        logger.warn('MinioStorageAdapter', `MinIO S3 getObject error: ${err.message}. Trying local storage fallback.`);
      }
    }
    assertSafeStoragePath(key);
    return localStorageProvider.getFileStream(key);
  }

  async getObjectRange(key: string, start: number, end: number): Promise<Readable> {
    const objectName = this.cleanKey(key);
    const length = end - start + 1;

    if (key.startsWith('minio://')) {
      try {
        return await minioClient.getPartialObject(this.bucketName, objectName, start, length);
      } catch (err: any) {
        logger.warn('MinioStorageAdapter', `MinIO getPartialObject error: ${err.message}. Trying local storage fallback.`);
      }
    }
    assertSafeStoragePath(key);
    return localStorageProvider.getFileStreamRange(key, start, end);
  }

  async deleteObject(key: string): Promise<void> {
    const objectName = this.cleanKey(key);

    if (key.startsWith('minio://')) {
      try {
        await minioClient.removeObject(this.bucketName, objectName);
        logger.info('MinioStorageAdapter', `Deleted object "${objectName}" from MinIO S3 bucket "${this.bucketName}"`);
        return;
      } catch (err: any) {
        logger.warn('MinioStorageAdapter', `MinIO deleteObject error: ${err.message}`);
      }
    }
    assertSafeStoragePath(key);
    return localStorageProvider.deleteFile(key);
  }

  async objectExists(key: string): Promise<boolean> {
    const objectName = this.cleanKey(key);

    if (key.startsWith('minio://')) {
      try {
        await minioClient.statObject(this.bucketName, objectName);
        return true;
      } catch {
        return false;
      }
    }
    assertSafeStoragePath(key);
    return localStorageProvider.fileExists(key);
  }

  async getPresignedUrl(
    key: string,
    expirySeconds: number = 900,
    action: SignedUrlAction = 'getObject'
  ): Promise<string> {
    const objectName = this.cleanKey(key);

    try {
      if (action === 'putObject') {
        const url = await minioClient.presignedPutObject(
          this.bucketName,
          objectName,
          expirySeconds
        );
        logger.info('MinioStorageAdapter', `Generated presigned PUT URL for "${objectName}" (expires in ${expirySeconds}s)`);
        return url;
      }

      const url = await minioClient.presignedGetObject(
        this.bucketName,
        objectName,
        expirySeconds
      );
      logger.info('MinioStorageAdapter', `Generated presigned GET URL for "${objectName}" (expires in ${expirySeconds}s)`);
      return url;
    } catch (err: any) {
      logger.warn('MinioStorageAdapter', `Error generating MinIO presigned URL: ${err.message}`);
      return `http://localhost:${config.port}/api/v1/files/${encodeURIComponent(objectName)}/download`;
    }
  }
}

export const minioStorageAdapter = new MinioStorageAdapter();
