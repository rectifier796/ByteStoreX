import { Readable } from 'stream';

export type SignedUrlAction = 'getObject' | 'putObject';

export interface StorageAdapter {
  putObject(
    key: string,
    content: Readable | Buffer,
    size?: number,
    mimeType?: string
  ): Promise<{ storagePath: string; size: number }>;

  getObject(key: string): Promise<Readable>;

  getObjectRange?(key: string, start: number, end: number): Promise<Readable>;

  deleteObject(key: string): Promise<void>;

  objectExists(key: string): Promise<boolean>;

  getPresignedUrl(
    key: string,
    expirySeconds?: number,
    action?: SignedUrlAction
  ): Promise<string>;
}
