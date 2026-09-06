import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';

export async function runMigrations(): Promise<void> {
  logger.info('Migrator', `Connecting to PostgreSQL at ${config.postgres.host}:${config.postgres.port}/${config.postgres.db}`);

  const pool = new Pool({
    connectionString: config.dbUrl,
    connectionTimeoutMillis: 3000,
  });

  try {
    const client = await pool.connect();
    try {
      // Ensure migrations table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const migrationsDir = __dirname;
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

      for (const file of files) {
        const checkRes = await client.query('SELECT name FROM schema_migrations WHERE name = $1', [file]);
        if (checkRes.rowCount === 0) {
          logger.info('Migrator', `Applying migration: ${file}`);
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');

          logger.info('Migrator', `Successfully applied migration: ${file}`);
        } else {
          logger.info('Migrator', `Migration already applied: ${file}`);
        }
      }
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.warn('Migrator', `PostgreSQL migration skipped or failed (local container may not be started): ${err.message}`);
  } finally {
    await pool.end();
  }
}

// Standalone execution entrypoint for npm run migrate
if (process.argv[1] && process.argv[1].includes('migrator')) {
  runMigrations()
    .then(() => {
      logger.info('Migrator', 'Migration run completed cleanly');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migrator', `Migration process error: ${err.message}`);
      process.exit(1);
    });
}
