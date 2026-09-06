import { createClient } from 'redis';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';

class RedisCacheManager {
  private client: ReturnType<typeof createClient> | null = null;
  private inMemoryCache: Map<string, { value: string; expiresAt: number }> = new Map();
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
          logger.warn('RedisCacheManager', `Redis connection error: ${err.message} (Using in-memory cache fallback)`);
        }
      });
      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('RedisCacheManager', `Redis cache manager connected at ${config.redisUrl}`);
      });
      await this.client.connect().catch((err) => {
        logger.warn('RedisCacheManager', `Redis connection failed: ${err.message}. Using in-memory fallback.`);
      });
    } catch {
      this.isConnected = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (raw) {
          logger.info('RedisCacheManager', `Cache HIT for key '${key}'`);
          return JSON.parse(raw) as T;
        }
        logger.info('RedisCacheManager', `Cache MISS for key '${key}'`);
        return null;
      } catch (err: any) {
        logger.warn('RedisCacheManager', `Redis get error for key '${key}': ${err.message}`);
      }
    }

    // In-memory fallback lookup
    const now = Date.now();
    const entry = this.inMemoryCache.get(key);
    if (entry) {
      if (entry.expiresAt < now) {
        this.inMemoryCache.delete(key);
        return null;
      }
      return JSON.parse(entry.value) as T;
    }
    return null;
  }

  async set(key: string, value: any, ttlSeconds: number = 60): Promise<void> {
    const serialized = JSON.stringify(value);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, serialized, { EX: ttlSeconds });
        logger.info('RedisCacheManager', `Cached key '${key}' with TTL ${ttlSeconds}s`);
        return;
      } catch (err: any) {
        logger.warn('RedisCacheManager', `Redis set error for key '${key}': ${err.message}`);
      }
    }

    // In-memory fallback storage
    this.inMemoryCache.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
        logger.info('RedisCacheManager', `Invalidated cache key '${key}'`);
      } catch (err: any) {
        logger.warn('RedisCacheManager', `Redis del error for key '${key}': ${err.message}`);
      }
    }
    this.inMemoryCache.delete(key);
  }

  async invalidatePattern(prefix: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys(`${prefix}*`);
        if (keys.length > 0) {
          await this.client.del(keys);
          logger.info('RedisCacheManager', `Invalidated ${keys.length} keys matching pattern '${prefix}*'`);
        }
      } catch (err: any) {
        logger.warn('RedisCacheManager', `Redis invalidatePattern error: ${err.message}`);
      }
    }

    // Clear matching in-memory fallback keys
    for (const key of this.inMemoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.inMemoryCache.delete(key);
      }
    }
  }
}

export const redisCacheManager = new RedisCacheManager();
