import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './core/logger.js';
import { initMinioBucket } from './modules/storage/minio.init.js';
import { runMigrations } from './migrations/migrator.js';
import { db } from './shared/db.js';

async function bootstrap() {
  logger.info('Bootstrap', 'Initializing ByteStoreX Monolith Infrastructure...');

  // 1. Run database migrations (PostgreSQL)
  await runMigrations();

  // 2. Sync in-memory database cache from PostgreSQL after schema migrations complete
  await db.initPostgresSync();

  // 3. Initialize MinIO S3 bucket
  await initMinioBucket();

  // 3. Start Express server listener
  app.listen(config.port, () => {
    logger.info('Server', `🚀 ByteStoreX Monolith Server running on port ${config.port} [${config.env}]`);
    logger.info('Server', `PostgreSQL connected at ${config.postgres.host}:${config.postgres.port}`);
    logger.info('Server', `Redis Cache ready at ${config.redisUrl}`);
    logger.info('Server', `MinIO S3 Bucket "${config.minio.bucketName}" listening at ${config.minio.endpoint}:${config.minio.port}`);
  });
}

bootstrap().catch((err) => {
  logger.error('Bootstrap', `Fatal server startup exception: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
