import { createClient } from 'redis';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';
import { v4 as uuidv4 } from 'uuid';

class RedisLockManager {
  private client: ReturnType<typeof createClient> | null = null;
  private inMemoryLocks: Map<string, { value: string; expiresAt: number }> = new Map();
  private isConnected = false;
  private lastErrorLoggedAt = 0;

  constructor() {
    this.initRedis();
  }

  private async initRedis() {
    try {
      this.client = createClient({ url: config.redisUrl });
      this.client.on('error', (err) => {
        this.isConnected = false;
        const now = Date.now();
        if (now - this.lastErrorLoggedAt > 30_000) {
          this.lastErrorLoggedAt = now;
          logger.warn('RedisLockManager', `Redis connection error: ${err.message} (Using in-memory lock fallback)`);
        }
      });
      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('RedisLockManager', `Redis lock manager connected at ${config.redisUrl}`);
      });
      await this.client.connect().catch((err) => {
        logger.warn('RedisLockManager', `Redis connection failed: ${err.message}. Using in-memory fallback.`);
      });
    } catch {
      this.isConnected = false;
    }
  }

  async acquireLock(lockKey: string, ttlSeconds: number = 30): Promise<string | null> {
    const lockValue = uuidv4();

    if (this.isConnected && this.client) {
      try {
        const reply = await this.client.set(lockKey, lockValue, {
          NX: true,
          EX: ttlSeconds,
        });
        if (reply === 'OK') {
          logger.info('RedisLockManager', `Acquired distributed Redis lock '${lockKey}' (TTL ${ttlSeconds}s)`);
          return lockValue;
        }
        logger.warn('RedisLockManager', `Failed to acquire Redis lock '${lockKey}' (Already locked)`);
        return null; // Lock already held
      } catch (err: any) {
        logger.warn('RedisLockManager', `Redis acquireLock error: ${err.message}. Falling back to in-memory lock.`);
      }
    }

    // In-memory fallback locking logic
    const now = Date.now();
    for (const [k, v] of this.inMemoryLocks.entries()) {
      if (v.expiresAt <= now) {
        this.inMemoryLocks.delete(k);
      }
    }

    const existing = this.inMemoryLocks.get(lockKey);

    if (existing && existing.expiresAt > now) {
      return null; // Lock already held
    }

    this.inMemoryLocks.set(lockKey, {
      value: lockValue,
      expiresAt: now + ttlSeconds * 1000,
    });
    logger.info('RedisLockManager', `Acquired in-memory lock '${lockKey}' (TTL ${ttlSeconds}s)`);
    return lockValue;
  }

  /**
   * Extends the TTL of an actively held distributed lock (lock heartbeating).
   * Ensures long-running operations (e.g. streaming file finalization) retain ownership.
   */
  async extendLock(lockKey: string, lockValue: string, ttlSeconds: number = 30): Promise<boolean> {
    if (this.isConnected && this.client) {
      try {
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("expire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
        const result = await this.client.eval(luaScript, {
          keys: [lockKey],
          arguments: [lockValue, ttlSeconds.toString()],
        });
        if (result === 1) {
          logger.info('RedisLockManager', `Extended Redis lock '${lockKey}' by ${ttlSeconds}s`);
          return true;
        }
        logger.warn('RedisLockManager', `Failed to extend Redis lock '${lockKey}': Lock expired or ownership lost`);
        return false;
      } catch (err: any) {
        logger.warn('RedisLockManager', `Redis extendLock error: ${err.message}`);
      }
    }

    const existing = this.inMemoryLocks.get(lockKey);
    if (existing && existing.value === lockValue) {
      existing.expiresAt = Date.now() + ttlSeconds * 1000;
      logger.info('RedisLockManager', `Extended in-memory lock '${lockKey}' by ${ttlSeconds}s`);
      return true;
    }
    return false;
  }

  async releaseLock(lockKey: string, lockValue: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        // Atomic lock release via Lua Compare-and-Delete script
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        const result = await this.client.eval(luaScript, {
          keys: [lockKey],
          arguments: [lockValue],
        });
        if (result === 1) {
          logger.info('RedisLockManager', `Released Redis lock '${lockKey}' via Lua script`);
        } else {
          logger.warn('RedisLockManager', `Failed to release Redis lock '${lockKey}': Lock value token mismatch or already expired.`);
        }
        return;
      } catch (err: any) {
        logger.warn('RedisLockManager', `Redis releaseLock error: ${err.message}`);
      }
    }

    const existing = this.inMemoryLocks.get(lockKey);
    if (existing && existing.value === lockValue) {
      this.inMemoryLocks.delete(lockKey);
      logger.info('RedisLockManager', `Released in-memory lock '${lockKey}'`);
    }
  }
}

export const redisLockManager = new RedisLockManager();
