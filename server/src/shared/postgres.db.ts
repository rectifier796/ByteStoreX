import { Pool, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';

class PostgresDatabase {
  private pool: Pool | null = null;
  public isConnected = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.initPool();
  }

  public async ensureConnected(): Promise<boolean> {
    await this.initPromise;
    return this.isConnected;
  }

  private async initPool() {
    try {
      this.pool = new Pool({
        connectionString: config.dbUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000,
      });

      this.pool.on('error', (err) => {
        logger.warn('PostgresDatabase', `PostgreSQL pool error: ${err.message}`);
        this.isConnected = false;
      });

      // Connection sanity check
      const client = await this.pool.connect();
      this.isConnected = true;
      client.release();
      logger.info('PostgresDatabase', `PostgreSQL connected at ${config.postgres.host}:${config.postgres.port}/${config.postgres.db}`);
    } catch (err: any) {
      this.isConnected = false;
      logger.warn('PostgresDatabase', `PostgreSQL connection unavailable: ${err.message}`);
    }
  }

  async query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R> | null> {
    await this.ensureConnected();
    if (!this.isConnected || !this.pool) {
      return null;
    }
    try {
      return await this.pool.query<R>(text, params);
    } catch (err: any) {
      logger.error('PostgresDatabase', `Query error: ${err.message}`, { text, params });
      return null;
    }
  }

  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T | null> {
    if (!this.isConnected || !this.pool) {
      return null;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error('PostgresDatabase', `Transaction error: ${err.message}`);
      return null;
    } finally {
      client.release();
    }
  }
}

export const pgDb = new PostgresDatabase();
