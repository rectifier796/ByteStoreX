import { db } from './db.js';
import { ForbiddenError } from '../core/errors.js';
import { redisCacheManager } from './redis.cache.js';

export type PermissionLevel = 'OWNER' | 'EDITOR' | 'VIEWER' | 'NONE';

const PERMISSION_WEIGHT: Record<PermissionLevel, number> = {
  OWNER: 3,
  EDITOR: 2,
  VIEWER: 1,
  NONE: 0,
};

export function evaluateRawPermission(
  userId: string,
  userRole: string | undefined,
  resourceId: string,
  resourceType: 'file' | 'folder',
  ownerId: string
): PermissionLevel {
  // System admins or resource owner have full OWNER privilege
  if (userId === ownerId || userRole === 'admin') {
    return 'OWNER';
  }

  // Check direct user ACL permission grant
  const directPermission = Array.from(db.permissions.values()).find(
    (p) => p.granteeId === userId && p.resourceId === resourceId && p.resourceType === resourceType
  );

  if (directPermission) {
    return directPermission.permissionLevel;
  }

  // If resource is inside a parent folder, check parent folder permission recursively
  if (resourceType === 'file') {
    const file = db.files.get(resourceId);
    if (file && file.folderId) {
      const parentFolder = db.folders.get(file.folderId);
      if (parentFolder) {
        return evaluateRawPermission(userId, userRole, parentFolder.id, 'folder', parentFolder.ownerId);
      }
    }
  } else {
    const folder = db.folders.get(resourceId);
    if (folder && folder.parentId) {
      const parentFolder = db.folders.get(folder.parentId);
      if (parentFolder) {
        return evaluateRawPermission(userId, userRole, parentFolder.id, 'folder', parentFolder.ownerId);
      }
    }
  }

  return 'NONE';
}

export async function resolveUserPermissionAsync(
  userId: string,
  userRole: string | undefined,
  resourceId: string,
  resourceType: 'file' | 'folder',
  ownerId: string
): Promise<PermissionLevel> {
  const cacheKey = `cache:perm:${userId}:${resourceType}:${resourceId}`;
  const cached = await redisCacheManager.get<PermissionLevel>(cacheKey);
  if (cached) {
    return cached;
  }

  const level = evaluateRawPermission(userId, userRole, resourceId, resourceType, ownerId);
  await redisCacheManager.set(cacheKey, level, 60); // 60s TTL
  return level;
}

export function resolveUserPermission(
  userId: string,
  userRole: string | undefined,
  resourceId: string,
  resourceType: 'file' | 'folder',
  ownerId: string
): PermissionLevel {
  return evaluateRawPermission(userId, userRole, resourceId, resourceType, ownerId);
}

export async function invalidatePermissionCache(userId?: string, resourceId?: string): Promise<void> {
  if (userId && resourceId) {
    await redisCacheManager.del(`cache:perm:${userId}:file:${resourceId}`);
    await redisCacheManager.del(`cache:perm:${userId}:folder:${resourceId}`);
  } else {
    await redisCacheManager.invalidatePattern('cache:perm:');
  }
}

export function assertPermission(
  userId: string,
  userRole: string | undefined,
  resourceId: string,
  resourceType: 'file' | 'folder',
  ownerId: string,
  requiredLevel: PermissionLevel
): void {
  const actualLevel = resolveUserPermission(userId, userRole, resourceId, resourceType, ownerId);

  if (PERMISSION_WEIGHT[actualLevel] < PERMISSION_WEIGHT[requiredLevel]) {
    throw new ForbiddenError(
      `Access denied: Required permission level '${requiredLevel}', but actual level is '${actualLevel}' for ${resourceType} ${resourceId}`
    );
  }
}
