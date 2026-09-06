import * as Minio from 'minio';
import { config } from '../../config/index.js';
import { logger } from '../../core/logger.js';

export const minioClient = new Minio.Client({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

export async function initMinioBucket(): Promise<void> {
  const bucketName = config.minio.bucketName;
  logger.info('MinIO', `Checking MinIO S3 bucket: ${bucketName} at ${config.minio.endpoint}:${config.minio.port}`);

  try {
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      logger.info('MinIO', `Bucket "${bucketName}" does not exist. Creating new bucket...`);
      await minioClient.makeBucket(bucketName, 'us-east-1');
      logger.info('MinIO', `Bucket "${bucketName}" created successfully.`);
    } else {
      logger.info('MinIO', `Bucket "${bucketName}" is ready.`);
    }
  } catch (err: any) {
    logger.warn('MinIO', `MinIO bucket initialization notice: ${err.message} (Will fallback to local disk storage if container is offline)`);
  }
}
