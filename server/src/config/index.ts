import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config();

// Configuration Validation Schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters long').default('bytestorex-super-secret-key-2026'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  // PostgreSQL Configuration
  DATABASE_URL: z.string().default('postgresql://bytestorex_admin:bytestorex_password_2026@localhost:5432/bytestorex_db'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default('bytestorex_db'),
  POSTGRES_USER: z.string().default('bytestorex_admin'),
  POSTGRES_PASSWORD: z.string().default('bytestorex_password_2026'),

  // Redis Configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  // MinIO S3 Object Storage Configuration
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z.string().transform((val) => val === 'true').default('false'),
  MINIO_ACCESS_KEY: z.string().default('minio_admin'),
  MINIO_SECRET_KEY: z.string().default('minio_password_2026'),
  MINIO_BUCKET_NAME: z.string().default('bytestorex-bucket'),

  // Local Storage Fallback & Limits
  STORAGE_PATH: z.string().default(path.join(process.cwd(), 'data_storage')),
  MAX_FILE_SIZE_BYTES: z.coerce.number().default(5368709120), // 5GB
  DEFAULT_QUOTA_BYTES: z.coerce.number().default(10737418240), // 10GB
});

function validateConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    throw new Error('Environment configuration validation failed');
  }
  return result.data;
}

const validatedEnv = validateConfig();

export interface AppConfig {
  env: string;
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  dbUrl: string;
  postgres: {
    host: string;
    port: number;
    db: string;
    user: string;
    pass: string;
  };
  redisUrl: string;
  minio: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucketName: string;
  };
  storagePath: string;
  maxFileSize: number;
  defaultQuota: number;
}

export const config: AppConfig = {
  env: validatedEnv.NODE_ENV,
  port: validatedEnv.PORT,
  jwtSecret: validatedEnv.JWT_SECRET,
  jwtExpiresIn: validatedEnv.JWT_EXPIRES_IN,
  dbUrl: validatedEnv.DATABASE_URL,
  postgres: {
    host: validatedEnv.POSTGRES_HOST,
    port: validatedEnv.POSTGRES_PORT,
    db: validatedEnv.POSTGRES_DB,
    user: validatedEnv.POSTGRES_USER,
    pass: validatedEnv.POSTGRES_PASSWORD,
  },
  redisUrl: validatedEnv.REDIS_URL,
  minio: {
    endpoint: validatedEnv.MINIO_ENDPOINT,
    port: validatedEnv.MINIO_PORT,
    useSSL: validatedEnv.MINIO_USE_SSL,
    accessKey: validatedEnv.MINIO_ACCESS_KEY,
    secretKey: validatedEnv.MINIO_SECRET_KEY,
    bucketName: validatedEnv.MINIO_BUCKET_NAME,
  },
  storagePath: validatedEnv.STORAGE_PATH,
  maxFileSize: validatedEnv.MAX_FILE_SIZE_BYTES,
  defaultQuota: validatedEnv.DEFAULT_QUOTA_BYTES,
};
