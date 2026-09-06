import path from 'path';
import crypto from 'crypto';
import { ValidationError } from './errors.js';
import { config } from '../config/index.js';

/**
 * Sanitizes and validates an object key or relative storage path to prevent
 * directory traversal attacks (e.g. '../', '..\\', null bytes '\0', absolute paths).
 */
export function sanitizeObjectKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new ValidationError('Object key must be a non-empty string.');
  }

  // Reject null bytes or encoded null bytes
  if (key.includes('\0') || key.includes('%00')) {
    throw new ValidationError('Malicious object key detected: null bytes not allowed.');
  }

  // Reject path traversal patterns
  if (
    key.includes('..') ||
    key.includes('../') ||
    key.includes('..\\') ||
    key.includes('%2e%2e') ||
    key.startsWith('/') ||
    key.startsWith('\\')
  ) {
    throw new ValidationError('Malicious object key detected: directory traversal sequence found.');
  }

  // Normalize path separators to standard forward slashes
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized;
}

/**
 * Asserts that a storage path is safe and stays strictly within the allowed storage root directory
 * or safe URL scheme (e.g. minio://).
 */
export function assertSafeStoragePath(storagePath: string): void {
  if (!storagePath || typeof storagePath !== 'string') {
    throw new ValidationError('Storage path must be a valid non-empty string.');
  }

  // Reject null bytes
  if (storagePath.includes('\0') || storagePath.includes('%00')) {
    throw new ValidationError('Security violation: null bytes detected in storage path.');
  }

  // MinIO / S3 scheme path validation
  if (storagePath.startsWith('minio://') || storagePath.startsWith('s3://')) {
    const keyPart = storagePath.replace(/^(minio|s3):\/\/[^\/]+\//, '');
    sanitizeObjectKey(keyPart);
    return;
  }

  // Local filesystem path traversal validation
  const baseStorageDir = path.resolve(config.storagePath);
  const resolvedPath = path.resolve(storagePath);

  if (!resolvedPath.startsWith(baseStorageDir)) {
    throw new ValidationError(`Security violation: Storage path '${storagePath}' escapes root storage directory.`);
  }
}

/**
 * Computes SHA-256 token hash for secure database storage and lookup.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
