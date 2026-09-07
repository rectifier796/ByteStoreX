import { pgDb } from './postgres.db.js';
import { User, FileMetadata, Folder, BlobRecord, FileVersion, FilePermission, ShareLink, Job, AuditLog, RefreshToken } from './types.js';
import { logger } from '../core/logger.js';

export class PostgresRepository {
  // ================= USERS =================
  async saveUser(user: User): Promise<void> {
    await pgDb.query(
      `INSERT INTO users (id, email, name, password_hash, role, status, storage_used_bytes, quota_bytes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         storage_used_bytes = EXCLUDED.storage_used_bytes,
         quota_bytes = EXCLUDED.quota_bytes,
         updated_at = EXCLUDED.updated_at;`,
      [
        user.id,
        user.email,
        user.name,
        user.passwordHash,
        user.role,
        'active',
        user.storageUsedBytes || 0,
        user.quotaBytes || 10737418240,
        user.createdAt,
        user.updatedAt,
      ]
    );
  }

  async getAllUsers(): Promise<User[]> {
    const res = await pgDb.query(`SELECT id, email, name, password_hash as "passwordHash", role, storage_used_bytes as "storageUsedBytes", quota_bytes as "quotaBytes", created_at as "createdAt", updated_at as "updatedAt" FROM users;`);
    if (!res) return [];
    return res.rows;
  }

  // ================= FOLDERS =================
  async saveFolder(folder: Folder): Promise<void> {
    await pgDb.query(
      `INSERT INTO folders (id, name, parent_id, owner_id, is_starred, is_trashed, trashed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         parent_id = EXCLUDED.parent_id,
         is_starred = EXCLUDED.is_starred,
         is_trashed = EXCLUDED.is_trashed,
         trashed_at = EXCLUDED.trashed_at,
         updated_at = EXCLUDED.updated_at;`,
      [
        folder.id,
        folder.name,
        folder.parentId,
        folder.ownerId,
        folder.isStarred || false,
        folder.isTrashed || false,
        folder.trashedAt || null,
        folder.createdAt,
        folder.updatedAt,
      ]
    );
  }

  async getAllFolders(): Promise<Folder[]> {
    const res = await pgDb.query(`SELECT id, name, parent_id as "parentId", owner_id as "ownerId", is_starred as "isStarred", is_trashed as "isTrashed", trashed_at as "trashedAt", created_at as "createdAt", updated_at as "updatedAt" FROM folders;`);
    if (!res) return [];
    return res.rows;
  }

  async deleteFolder(folderId: string): Promise<void> {
    await pgDb.query(`DELETE FROM folders WHERE id = $1;`, [folderId]);
  }

  // ================= BLOBS =================
  async saveBlob(blob: BlobRecord): Promise<void> {
    await pgDb.query(
      `INSERT INTO blobs (id, storage_path, size_bytes, mime_type, checksum, reference_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         reference_count = EXCLUDED.reference_count;`,
      [
        blob.id,
        blob.storagePath,
        blob.sizeBytes,
        blob.mimeType,
        blob.checksum,
        blob.referenceCount,
        blob.createdAt,
      ]
    );
  }

  async getAllBlobs(): Promise<BlobRecord[]> {
    const res = await pgDb.query(`SELECT id, storage_path as "storagePath", size_bytes as "sizeBytes", mime_type as "mimeType", checksum, reference_count as "referenceCount", created_at as "createdAt" FROM blobs;`);
    if (!res) return [];
    return res.rows;
  }

  // ================= FILES =================
  async saveFile(file: FileMetadata): Promise<void> {
    let blobId = file.activeBlobId;
    if (!blobId && file.checksum) {
      blobId = file.checksum;
    }

    // Ensure blob exists before setting FK
    if (blobId) {
      await pgDb.query(
        `INSERT INTO blobs (id, storage_path, size_bytes, mime_type, checksum, reference_count, created_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6)
         ON CONFLICT (id) DO NOTHING;`,
        [blobId, file.storagePath || '', file.size || 0, file.mimeType || 'application/octet-stream', file.checksum || blobId, file.createdAt || new Date().toISOString()]
      );
    }

    // Ensure owner user exists before setting FK
    if (file.ownerId) {
      await pgDb.query(
        `INSERT INTO users (id, email, name, password_hash, role, status, storage_used_bytes, quota_bytes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'user', 'active', 0, 10737418240, $5, $5)
         ON CONFLICT (id) DO NOTHING;`,
        [file.ownerId, `${file.ownerId}@bytestorex.io`, 'User', 'nopassword', file.createdAt || new Date().toISOString()]
      );
    }

    await pgDb.query(
      `INSERT INTO files (
         id, name, folder_id, owner_id, active_blob_id, is_starred, is_trashed, trashed_at,
         current_version, tags, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         folder_id = EXCLUDED.folder_id,
         active_blob_id = EXCLUDED.active_blob_id,
         is_starred = EXCLUDED.is_starred,
         is_trashed = EXCLUDED.is_trashed,
         trashed_at = EXCLUDED.trashed_at,
         current_version = EXCLUDED.current_version,
         tags = EXCLUDED.tags,
         updated_at = EXCLUDED.updated_at;`,
      [
        file.id,
        file.name,
        file.folderId || null,
        file.ownerId,
        blobId || null,
        file.isStarred || false,
        file.isTrashed || false,
        file.trashedAt || null,
        file.version || 1,
        file.tags || [],
        file.createdAt || new Date().toISOString(),
        file.updatedAt || new Date().toISOString(),
      ]
    );
  }

  async getAllFiles(): Promise<FileMetadata[]> {
    const res = await pgDb.query(
      `SELECT f.id, f.name, f.name as "originalName", f.folder_id as "folderId", f.owner_id as "ownerId", 
              f.active_blob_id as "activeBlobId", f.is_starred as "isStarred", f.is_trashed as "isTrashed", 
              f.trashed_at as "trashedAt", f.current_version as "version", f.tags, f.created_at as "createdAt", 
              f.updated_at as "updatedAt",
              COALESCE(b.storage_path, '') as "storagePath",
              COALESCE(b.size_bytes, 0) as "size",
              COALESCE(b.mime_type, 'application/octet-stream') as "mimeType",
              COALESCE(b.checksum, '') as "checksum"
       FROM files f
       LEFT JOIN blobs b ON f.active_blob_id = b.id;`
    );
    if (!res) return [];
    return res.rows.map((r: any) => ({
      ...r,
      size: Number(r.size || 0),
      version: Number(r.version || 1),
    }));
  }

  async deleteFile(fileId: string): Promise<void> {
    await pgDb.query(`DELETE FROM files WHERE id = $1;`, [fileId]);
  }

  // ================= FILE VERSIONS =================
  async saveFileVersion(version: FileVersion): Promise<void> {
    await pgDb.query(
      `INSERT INTO file_versions (id, file_id, blob_id, version_number, size_bytes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING;`,
      [
        version.id,
        version.fileId,
        version.blobId,
        version.versionNumber,
        version.sizeBytes,
        version.createdBy,
        version.createdAt,
      ]
    );
  }

  async deleteFileVersion(versionId: string): Promise<void> {
    await pgDb.query(`DELETE FROM file_versions WHERE id = $1;`, [versionId]);
  }

  // ================= SHARE LINKS =================
  async saveShareLink(link: ShareLink): Promise<void> {
    await pgDb.query(
      `INSERT INTO share_links (id, resource_id, resource_type, token, token_hash, permission_level, password_hash, is_revoked, access_count, expires_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         access_count = EXCLUDED.access_count,
         is_revoked = EXCLUDED.is_revoked;`,
      [
        link.id,
        link.resourceId,
        link.resourceType,
        link.token,
        link.tokenHash || link.token,
        link.permission || 'view',
        link.passwordHash || null,
        link.isRevoked || false,
        link.accessCount || 0,
        link.expiresAt || null,
        link.createdBy,
        link.createdAt,
      ]
    );
  }

  async getAllShareLinks(): Promise<ShareLink[]> {
    const res = await pgDb.query(
      `SELECT id, resource_id as "resourceId", resource_type as "resourceType", token, 
              token_hash as "tokenHash", permission_level as "permission", 
              password_hash as "passwordHash", is_revoked as "isRevoked", 
              access_count as "accessCount", expires_at as "expiresAt", 
              created_by as "createdBy", created_at as "createdAt" 
       FROM share_links;`
    );
    if (!res) return [];
    return res.rows;
  }

  async deleteShareLink(id: string): Promise<void> {
    await pgDb.query(`DELETE FROM share_links WHERE id = $1;`, [id]);
  }

  // ================= FILE PERMISSIONS =================
  async saveFilePermission(perm: FilePermission): Promise<void> {
    await pgDb.query(
      `INSERT INTO file_permissions (id, resource_id, resource_type, grantee_id, permission_level, granted_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         permission_level = EXCLUDED.permission_level;`,
      [
        perm.id,
        perm.resourceId,
        perm.resourceType,
        perm.granteeId,
        perm.permissionLevel || 'read',
        perm.grantedBy,
        perm.createdAt,
      ]
    );
  }

  async deleteFilePermission(permId: string): Promise<void> {
    await pgDb.query(`DELETE FROM file_permissions WHERE id = $1;`, [permId]);
  }

  async getAllFilePermissions(): Promise<FilePermission[]> {
    const res = await pgDb.query(
      `SELECT id, resource_id as "resourceId", resource_type as "resourceType", 
              grantee_id as "granteeId", permission_level as "permissionLevel", 
              granted_by as "grantedBy", created_at as "createdAt" 
       FROM file_permissions;`
    );
    if (!res) return [];
    return res.rows;
  }

  // ================= JOBS =================
  async saveJob(job: Job): Promise<void> {
    await pgDb.query(
      `INSERT INTO jobs (id, type, status, progress, payload, result, error_message, request_id, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         progress = EXCLUDED.progress,
         result = EXCLUDED.result,
         error_message = EXCLUDED.error_message,
         updated_at = EXCLUDED.updated_at;`,
      [
        job.id,
        job.type,
        job.status,
        job.progress || 0,
        JSON.stringify(job.payload || {}),
        job.result ? JSON.stringify(job.result) : null,
        job.error || null,
        job.requestId || 'req-sys',
        job.ownerId,
        job.createdAt,
        job.updatedAt || new Date().toISOString(),
      ]
    );
  }

  // ================= REFRESH TOKENS =================
  async saveRefreshToken(token: RefreshToken): Promise<void> {
    await pgDb.query(
      `INSERT INTO refresh_tokens (id, token_hash, user_id, is_revoked, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         is_revoked = EXCLUDED.is_revoked;`,
      [
        token.id,
        token.tokenHash,
        token.userId,
        token.isRevoked || false,
        token.expiresAt,
        token.createdAt,
      ]
    );
  }

  // ================= AUDIT LOGS =================
  async saveAuditLog(logEntry: AuditLog): Promise<void> {
    await pgDb.query(
      `INSERT INTO audit_logs (id, action, category, actor_id, actor_email, resource_id, resource_type, details, request_id, ip_address, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING;`,
      [
        logEntry.id,
        logEntry.action,
        logEntry.category,
        logEntry.actorId,
        logEntry.actorEmail || null,
        logEntry.resourceId || null,
        logEntry.resourceType || null,
        logEntry.details ? JSON.stringify(logEntry.details) : null,
        logEntry.requestId,
        logEntry.ip || '127.0.0.1',
        logEntry.timestamp,
      ]
    );
  }
}

export const postgresRepo = new PostgresRepository();
