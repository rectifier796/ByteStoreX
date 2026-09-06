import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { StorageProvider } from './storage.provider.js';
import { config } from '../../config/index.js';
import { logger } from '../../core/logger.js';
import { assertSafeStoragePath, sanitizeObjectKey } from '../../core/security.js';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(config.storagePath);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async saveFile(fileId: string, content: Readable | Buffer, fileName: string): Promise<{ storagePath: string; size: number }> {
    const safeId = sanitizeObjectKey(fileId);
    const safeName = sanitizeObjectKey(fileName);
    const targetPath = path.join(this.baseDir, `${safeId}_${safeName}`);
    assertSafeStoragePath(targetPath);

    if (Buffer.isBuffer(content)) {
      await fs.promises.writeFile(targetPath, content);
      return { storagePath: targetPath, size: content.length };
    }

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(targetPath);
      let size = 0;

      content.on('data', (chunk) => {
        size += chunk.length;
      });

      content.pipe(writeStream);

      writeStream.on('finish', () => {
        logger.info('LocalStorageProvider', `File saved cleanly to ${targetPath}`, { size });
        resolve({ storagePath: targetPath, size });
      });

      writeStream.on('error', (err) => {
        logger.error('LocalStorageProvider', `Error writing file stream: ${err.message}`);
        reject(err);
      });
    });
  }

  async getFileStream(storagePath: string): Promise<Readable> {
    assertSafeStoragePath(storagePath);
    if (!fs.existsSync(storagePath)) {
      throw new Error(`File not found at storage path: ${storagePath}`);
    }
    return fs.createReadStream(storagePath);
  }

  async getFileStreamRange(storagePath: string, start: number, end: number): Promise<Readable> {
    assertSafeStoragePath(storagePath);
    if (!fs.existsSync(storagePath)) {
      throw new Error(`File not found at storage path: ${storagePath}`);
    }
    return fs.createReadStream(storagePath, { start, end });
  }

  async deleteFile(storagePath: string): Promise<void> {
    assertSafeStoragePath(storagePath);
    if (fs.existsSync(storagePath)) {
      await fs.promises.unlink(storagePath);
      logger.info('LocalStorageProvider', `Deleted physical file at ${storagePath}`);
    }
  }

  async fileExists(storagePath: string): Promise<boolean> {
    assertSafeStoragePath(storagePath);
    return fs.existsSync(storagePath);
  }
}

export const localStorageProvider = new LocalStorageProvider();
