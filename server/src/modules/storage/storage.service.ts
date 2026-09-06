import { Readable } from 'stream';
import { StorageAdapter, SignedUrlAction } from './storage.adapter.js';
import { minioStorageAdapter } from './minio.adapter.js';
import { logger } from '../../core/logger.js';

export class StorageService {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter = minioStorageAdapter) {
    this.adapter = adapter;
  }

  async storeFile(
    fileId: string,
    content: Readable | Buffer,
    fileName: string,
    mimeType?: string,
    size?: number
  ): Promise<{ storagePath: string; size: number }> {
    const key = `${fileId}_${fileName}`;
    logger.info('StorageService', `Storing object key: ${key}`);
    return this.adapter.putObject(key, content, size, mimeType);
  }

  async fetchFileStream(storagePath: string): Promise<Readable> {
    logger.info('StorageService', `Fetching stream for storage path: ${storagePath}`);
    return this.adapter.getObject(storagePath);
  }

  async fetchFileRangeStream(storagePath: string, start: number, end: number): Promise<Readable> {
    logger.info('StorageService', `Fetching range stream (${start}-${end}) for storage path: ${storagePath}`);
    if (this.adapter.getObjectRange) {
      return this.adapter.getObjectRange(storagePath, start, end);
    }
    return this.adapter.getObject(storagePath);
  }

  async deleteFile(storagePath: string): Promise<void> {
    logger.info('StorageService', `Deleting object at storage path: ${storagePath}`);
    return this.adapter.deleteObject(storagePath);
  }

  async fileExists(storagePath: string): Promise<boolean> {
    return this.adapter.objectExists(storagePath);
  }

  async generatePresignedUrl(
    storagePath: string,
    expirySeconds: number = 900, // 15 mins
    action: SignedUrlAction = 'getObject'
  ): Promise<string> {
    logger.info('StorageService', `Generating presigned URL for action '${action}' on path: ${storagePath}`);
    return this.adapter.getPresignedUrl(storagePath, expirySeconds, action);
  }
}

export const storageService = new StorageService();
