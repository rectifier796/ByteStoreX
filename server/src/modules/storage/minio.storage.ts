import { Readable } from 'stream';
import { StorageProvider } from './storage.provider.js';
import { minioClient } from './minio.init.js';
import { config } from '../../config/index.js';
import { logger } from '../../core/logger.js';
import { localStorageProvider } from './local.storage.js';

export class MinioStorageProvider implements StorageProvider {
  private bucketName: string;

  constructor() {
    this.bucketName = config.minio.bucketName;
  }

  async saveFile(fileId: string, content: Readable | Buffer, fileName: string): Promise<{ storagePath: string; size: number }> {
    const objectName = `${fileId}_${fileName}`;

    try {
      if (Buffer.isBuffer(content)) {
        await minioClient.putObject(this.bucketName, objectName, content, content.length);
        logger.info('MinioStorageProvider', `File uploaded to MinIO bucket "${this.bucketName}/${objectName}"`, { size: content.length });
        return { storagePath: `minio://${this.bucketName}/${objectName}`, size: content.length };
      }

      // Stream upload
      const { storagePath, size } = await localStorageProvider.saveFile(fileId, content, fileName);
      const fileStream = await localStorageProvider.getFileStream(storagePath);
      await minioClient.putObject(this.bucketName, objectName, fileStream, size);
      logger.info('MinioStorageProvider', `Stream uploaded to MinIO bucket "${this.bucketName}/${objectName}"`, { size });

      return { storagePath: `minio://${this.bucketName}/${objectName}`, size };
    } catch (err: any) {
      logger.warn('MinioStorageProvider', `MinIO upload error: ${err.message}. Falling back to local disk storage.`);
      return localStorageProvider.saveFile(fileId, content, fileName);
    }
  }

  async getFileStream(storagePath: string): Promise<Readable> {
    if (storagePath.startsWith('minio://')) {
      const objectName = storagePath.replace(`minio://${this.bucketName}/`, '');
      return minioClient.getObject(this.bucketName, objectName);
    }
    return localStorageProvider.getFileStream(storagePath);
  }

  async deleteFile(storagePath: string): Promise<void> {
    if (storagePath.startsWith('minio://')) {
      const objectName = storagePath.replace(`minio://${this.bucketName}/`, '');
      await minioClient.removeObject(this.bucketName, objectName);
      logger.info('MinioStorageProvider', `Deleted object "${objectName}" from MinIO bucket "${this.bucketName}"`);
      return;
    }
    return localStorageProvider.deleteFile(storagePath);
  }

  async fileExists(storagePath: string): Promise<boolean> {
    if (storagePath.startsWith('minio://')) {
      const objectName = storagePath.replace(`minio://${this.bucketName}/`, '');
      try {
        await minioClient.statObject(this.bucketName, objectName);
        return true;
      } catch {
        return false;
      }
    }
    return localStorageProvider.fileExists(storagePath);
  }
}

export const minioStorageProvider = new MinioStorageProvider();
