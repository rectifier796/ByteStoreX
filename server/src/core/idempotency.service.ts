import crypto from 'crypto';
import { db } from '../shared/db.js';
import { IdempotencyKeyRecord } from '../shared/types.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

export class IdempotencyService {
  computeRequestHash(method: string, path: string, body: any): string {
    const serializedBody = body ? JSON.stringify(body) : '{}';
    const payload = `${method.toUpperCase()}:${path}:${serializedBody}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  async getRecord(key: string, userId: string): Promise<IdempotencyKeyRecord | undefined> {
    const lookupKey = `${userId}_${key}`;
    const record = db.idempotencyKeys.get(lookupKey);

    if (record) {
      if (new Date(record.expiresAt).getTime() < Date.now()) {
        db.idempotencyKeys.delete(lookupKey);
        return undefined; // Expired
      }
      return record;
    }
    return undefined;
  }

  async saveRecord(
    key: string,
    userId: string,
    requestHash: string,
    requestPath: string,
    responseCode: number,
    responseBody: any,
    ttlHours: number = 24
  ): Promise<IdempotencyKeyRecord> {
    const lookupKey = `${userId}_${key}`;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

    const record: IdempotencyKeyRecord = {
      id: `idemp-${uuidv4().substring(0, 8)}`,
      key,
      userId,
      requestHash,
      requestPath,
      responseCode,
      responseBody,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    db.idempotencyKeys.set(lookupKey, record);
    logger.info('IdempotencyService', `Saved durable idempotency record '${key}' for user '${userId}' [HTTP ${responseCode}]`);
    return record;
  }
}

export const idempotencyService = new IdempotencyService();
