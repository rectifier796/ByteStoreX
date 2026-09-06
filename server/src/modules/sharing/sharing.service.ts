import { db } from '../../shared/db.js';
import { ShareLink, FilePermission, FileMetadata, Folder } from '../../shared/types.js';
import { NotFoundError, ValidationError, UnauthorizedError, ForbiddenError } from '../../core/errors.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { auditService } from '../audit/audit.service.js';
import { assertPermission, invalidatePermissionCache } from '../../shared/permissions.js';
import { storageService } from '../storage/storage.service.js';
import { assertSafeStoragePath, hashToken } from '../../core/security.js';
import { postgresRepo } from '../../shared/postgres.repo.js';

export interface CreateShareLinkDTO {
  resourceId: string;
  resourceType: 'file' | 'folder';
  permission: 'view' | 'edit';
  password?: string;
  expiresInHours?: number;
}

export interface GrantUserPermissionDTO {
  resourceId: string;
  resourceType: 'file' | 'folder';
  granteeEmail: string;
  permissionLevel: 'VIEWER' | 'EDITOR';
}

export class SharingService {
  /**
   * Grants direct user-to-user ACL access permission (VIEWER / EDITOR)
   */
  async grantUserPermission(granterId: string, granterRole: string | undefined, dto: GrantUserPermissionDTO): Promise<FilePermission> {
    const { resourceId, resourceType, granteeEmail, permissionLevel } = dto;

    if (!granteeEmail || !granteeEmail.trim()) {
      throw new ValidationError('Grantee email is required.');
    }

    let ownerId: string;
    if (resourceType === 'file') {
      const file = db.files.get(resourceId);
      if (!file || file.isTrashed) throw new NotFoundError('File');
      ownerId = file.ownerId;
    } else {
      const folder = db.folders.get(resourceId);
      if (!folder || folder.isTrashed) throw new NotFoundError('Folder');
      ownerId = folder.ownerId;
    }

    // Must be OWNER or EDITOR to grant permission
    assertPermission(granterId, granterRole, resourceId, resourceType, ownerId, 'EDITOR');

    // Find grantee user
    const granteeUser = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === granteeEmail.trim().toLowerCase());
    if (!granteeUser) {
      throw new NotFoundError(`User with email '${granteeEmail}'`);
    }

    if (granteeUser.id === granterId) {
      throw new ValidationError('Cannot grant permission to yourself.');
    }

    // Check existing permission
    const existingPerm = Array.from(db.permissions.values()).find(
      (p) => p.granteeId === granteeUser.id && p.resourceId === resourceId && p.resourceType === resourceType
    );

    let permissionRecord: FilePermission;
    if (existingPerm) {
      existingPerm.permissionLevel = permissionLevel;
      permissionRecord = existingPerm;
      db.permissions.set(existingPerm.id, existingPerm);
    } else {
      permissionRecord = {
        id: `perm-${uuidv4().substring(0, 8)}`,
        resourceId,
        resourceType,
        granteeId: granteeUser.id,
        permissionLevel,
        grantedBy: granterId,
        createdAt: new Date().toISOString(),
      };
      db.permissions.set(permissionRecord.id, permissionRecord);
    }

    await postgresRepo.saveFilePermission(permissionRecord).catch(() => {});

    // Invalidate permission cache
    await invalidatePermissionCache(granteeUser.id, resourceId);

    await auditService.record({
      action: 'USER_SHARE_GRANT',
      category: 'share',
      actorId: granterId,
      resourceId,
      resourceType,
      details: { granteeEmail, granteeId: granteeUser.id, permissionLevel }
    });

    return permissionRecord;
  }

  /**
   * Revokes direct user permission grant
   */
  async revokeUserPermission(granterId: string, granterRole: string | undefined, permissionId: string): Promise<void> {
    const perm = db.permissions.get(permissionId);
    if (!perm) {
      throw new NotFoundError('Permission Grant');
    }

    let ownerId: string;
    if (perm.resourceType === 'file') {
      const file = db.files.get(perm.resourceId);
      if (file) ownerId = file.ownerId;
      else ownerId = granterId;
    } else {
      const folder = db.folders.get(perm.resourceId);
      if (folder) ownerId = folder.ownerId;
      else ownerId = granterId;
    }

    assertPermission(granterId, granterRole, perm.resourceId, perm.resourceType, ownerId, 'EDITOR');

    db.permissions.delete(permissionId);
    await postgresRepo.deleteFilePermission(permissionId).catch(() => {});
    await invalidatePermissionCache(perm.granteeId, perm.resourceId);

    await auditService.record({
      action: 'USER_SHARE_REVOKE',
      category: 'share',
      actorId: granterId,
      resourceId: perm.resourceId,
      resourceType: perm.resourceType,
      details: { revokedPermissionId: permissionId, granteeId: perm.granteeId }
    });
  }

  /**
   * Lists active direct permission grants for a resource
   */
  async listResourcePermissions(userId: string, userRole: string | undefined, resourceType: 'file' | 'folder', resourceId: string): Promise<any[]> {
    let ownerId: string;
    if (resourceType === 'file') {
      const file = db.files.get(resourceId);
      if (!file || file.isTrashed) throw new NotFoundError('File');
      ownerId = file.ownerId;
    } else {
      const folder = db.folders.get(resourceId);
      if (!folder || folder.isTrashed) throw new NotFoundError('Folder');
      ownerId = folder.ownerId;
    }

    assertPermission(userId, userRole, resourceId, resourceType, ownerId, 'VIEWER');

    return Array.from(db.permissions.values())
      .filter((p) => p.resourceId === resourceId && p.resourceType === resourceType)
      .map((p) => {
        const grantee = db.users.get(p.granteeId);
        return {
          id: p.id,
          granteeId: p.granteeId,
          granteeEmail: grantee ? grantee.email : 'unknown',
          granteeName: grantee ? grantee.name : 'Unknown User',
          permissionLevel: p.permissionLevel,
          grantedBy: p.grantedBy,
          createdAt: p.createdAt,
        };
      });
  }

  /**
   * Creates a public, expiring, password-protected share link with hashed token
   */
  async createShareLink(dto: CreateShareLinkDTO, createdBy: string, userRole?: string): Promise<ShareLink> {
    let ownerId: string;
    if (dto.resourceType === 'file') {
      const file = db.files.get(dto.resourceId);
      if (!file || file.isTrashed) throw new NotFoundError('File');
      ownerId = file.ownerId;
    } else {
      const folder = db.folders.get(dto.resourceId);
      if (!folder || folder.isTrashed) throw new NotFoundError('Folder');
      ownerId = folder.ownerId;
    }

    assertPermission(createdBy, userRole, dto.resourceId, dto.resourceType, ownerId, 'EDITOR');

    const token = `sh-${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = hashToken(token);

    let passwordHash: string | undefined = undefined;
    if (dto.password && dto.password.trim()) {
      passwordHash = bcrypt.hashSync(dto.password.trim(), 10);
    }

    let expiresAt: string | undefined = undefined;
    if (dto.expiresInHours && dto.expiresInHours > 0) {
      expiresAt = new Date(Date.now() + dto.expiresInHours * 3600000).toISOString();
    }

    const shareLink: ShareLink = {
      id: `shl-${uuidv4().substring(0, 8)}`,
      resourceId: dto.resourceId,
      resourceType: dto.resourceType,
      token,
      tokenHash,
      permission: dto.permission || 'view',
      passwordHash,
      expiresAt,
      isRevoked: false,
      accessCount: 0,
      createdBy,
      createdAt: new Date().toISOString(),
    };

    db.shareLinks.set(shareLink.id, shareLink);
    await postgresRepo.saveShareLink(shareLink).catch(() => {});

    await auditService.record({
      action: 'SHARE_LINK_CREATE',
      category: 'share',
      actorId: createdBy,
      resourceId: dto.resourceId,
      resourceType: dto.resourceType,
      details: {
        tokenHash,
        permission: shareLink.permission,
        isPasswordProtected: !!passwordHash,
        expiresAt
      }
    });

    return shareLink;
  }

  /**
   * Revokes a share link
   */
  async revokeShareLink(userId: string, userRole: string | undefined, shareLinkId: string): Promise<void> {
    const shareLink = db.shareLinks.get(shareLinkId);
    if (!shareLink) {
      throw new NotFoundError('Share Link');
    }

    let ownerId: string;
    if (shareLink.resourceType === 'file') {
      const file = db.files.get(shareLink.resourceId);
      ownerId = file ? file.ownerId : shareLink.createdBy;
    } else {
      const folder = db.folders.get(shareLink.resourceId);
      ownerId = folder ? folder.ownerId : shareLink.createdBy;
    }

    if (userId !== shareLink.createdBy && userRole !== 'admin') {
      assertPermission(userId, userRole, shareLink.resourceId, shareLink.resourceType, ownerId, 'EDITOR');
    }

    shareLink.isRevoked = true;
    db.shareLinks.set(shareLink.id, shareLink);
    await postgresRepo.saveShareLink(shareLink).catch(() => {});

    await auditService.record({
      action: 'SHARE_LINK_REVOKE',
      category: 'share',
      actorId: userId,
      resourceId: shareLink.resourceId,
      details: { shareLinkId }
    });
  }

  /**
   * Resolves a public share token (checking revocation, expiration, and password hash)
   */
  async resolveShareToken(token: string, password?: string): Promise<{ shareLink: ShareLink; resource: any }> {
    if (!token || typeof token !== 'string') {
      throw new ValidationError('Invalid share token.');
    }

    const inputHash = hashToken(token);

    // Token lookup MUST use only the stored hash — comparing raw tokens defeats the hashing scheme.
    const shareLink = Array.from(db.shareLinks.values()).find(
      (s) => s.tokenHash === inputHash
    );

    if (!shareLink) {
      throw new NotFoundError('Share Link');
    }

    if (shareLink.isRevoked) {
      throw new ValidationError('This share link has been revoked by the owner.');
    }

    if (shareLink.expiresAt && new Date(shareLink.expiresAt).getTime() < Date.now()) {
      throw new ValidationError('This share link has expired.');
    }

    if (shareLink.passwordHash) {
      if (!password || !bcrypt.compareSync(password.trim(), shareLink.passwordHash)) {
        throw new UnauthorizedError('Incorrect or missing password for password-protected share link.');
      }
    }

    // Increment access count ONLY after all auth checks pass.
    // Incrementing before the password check leaks state (timing oracle on brute-force).
    shareLink.accessCount += 1;
    db.shareLinks.set(shareLink.id, shareLink);
    await postgresRepo.saveShareLink(shareLink).catch(() => {});

    let resource: any;
    if (shareLink.resourceType === 'file') {
      resource = db.files.get(shareLink.resourceId);
    } else {
      resource = db.folders.get(shareLink.resourceId);
    }

    if (!resource || resource.isTrashed) {
      throw new NotFoundError('Shared Resource');
    }

    // Security check: validate physical storage path for file resources
    if (shareLink.resourceType === 'file' && (resource as FileMetadata).storagePath) {
      assertSafeStoragePath((resource as FileMetadata).storagePath);
    }

    return { shareLink, resource };
  }

  /**
   * Generates a signed stream for public file download with Range/206 support
   */
  async getPublicDownloadStream(token: string, password?: string, rangeHeader?: string) {
    const { resource } = await this.resolveShareToken(token, password);
    const file = resource as FileMetadata;

    assertSafeStoragePath(file.storagePath);

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      let start = parts[0] ? parseInt(parts[0], 10) : 0;
      let end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;

      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= file.size) end = file.size - 1;

      if (start < 0 || start > end || start >= file.size) {
        throw new ValidationError(`Requested range bytes=${start}-${end}/${file.size} not satisfiable.`);
      }

      const contentLength = end - start + 1;
      const stream = await storageService.fetchFileRangeStream(file.storagePath, start, end);
      return { file, isRange: true, start, end, contentLength, stream };
    }

    const stream = await storageService.fetchFileStream(file.storagePath);
    return { file, isRange: false, start: 0, end: file.size - 1, contentLength: file.size, stream };
  }

  /**
   * Generates a signed presigned URL for public download access
   */
  async getPublicSignedUrl(token: string, password?: string, expirySeconds: number = 900) {
    const { resource } = await this.resolveShareToken(token, password);
    const file = resource as FileMetadata;

    assertSafeStoragePath(file.storagePath);

    const signedUrl = await storageService.generatePresignedUrl(file.storagePath, expirySeconds, 'getObject');
    const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

    return { file, signedUrl, expiresAt };
  }

  /**
   * Lists active share links created by a user
   */
  async listUserShareLinks(createdBy: string): Promise<ShareLink[]> {
    return Array.from(db.shareLinks.values()).filter((s) => s.createdBy === createdBy && !s.isRevoked);
  }

  /**
   * Lists active share links for a specific resource
   */
  async listResourceShareLinks(resourceId: string): Promise<ShareLink[]> {
    return Array.from(db.shareLinks.values()).filter((s) => s.resourceId === resourceId && !s.isRevoked);
  }
}

export const sharingService = new SharingService();
