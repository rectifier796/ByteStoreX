import { Readable } from 'stream';

export interface StorageProvider {
  saveFile(fileId: string, stream: Readable | Buffer, fileName: string): Promise<{ storagePath: string; size: number }>;
  getFileStream(storagePath: string): Promise<Readable>;
  deleteFile(storagePath: string): Promise<void>;
  fileExists(storagePath: string): Promise<boolean>;
}
