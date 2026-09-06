import { db } from '../../shared/db.js';
import { Folder } from '../../shared/types.js';
import { NotFoundError, ValidationError, ConflictError } from '../../core/errors.js';
import { v4 as uuidv4 } from 'uuid';
import { auditService } from '../audit/audit.service.js';
import { assertPermission } from '../../shared/permissions.js';
import { redisCacheManager } from '../../shared/redis.cache.js';
import { postgresRepo } from '../../shared/postgres.repo.js';

export interface CreateFolderDTO {
  name: string;
  parentId?: string | null;
  ownerId: string;
}

export class FoldersService {
  private checkOptimisticLock(folder: Folder, expectedVersion?: number): void {
    if (expectedVersion !== undefined && folder.version !== expectedVersion) {
      throw new ConflictError(
        `Stale update detected for folder '${folder.name}' (${folder.id}). Current version is ${folder.version}, expected version ${expectedVersion}`
      );
    }
  }

  async getById(folderId: string, userId: string, userRole: string | undefined): Promise<Folder> {
    const cacheKey = `cache:meta:folder:${folderId}`;
    const cachedFolder = await redisCacheManager.get<Folder>(cacheKey);

    if (cachedFolder && !cachedFolder.isTrashed) {
      assertPermission(userId, userRole, cachedFolder.id, 'folder', cachedFolder.ownerId, 'VIEWER');
      return cachedFolder;
    }

    const folder = db.folders.get(folderId);
    if (!folder || folder.isTrashed) {
      throw new NotFoundError('Folder');
    }
    assertPermission(userId, userRole, folder.id, 'folder', folder.ownerId, 'VIEWER');
    await redisCacheManager.set(cacheKey, folder, 60);
    return folder;
  }

  async create(dto: CreateFolderDTO, userRole?: string): Promise<Folder> {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Folder name cannot be empty');
    }

    const parentId = dto.parentId || null;
    if (parentId) {
      const parentFolder = db.folders.get(parentId);
      if (!parentFolder || parentFolder.isTrashed) {
        throw new NotFoundError('Parent folder');
      }
      assertPermission(dto.ownerId, userRole, parentFolder.id, 'folder', parentFolder.ownerId, 'EDITOR');
    }

    const newFolder: Folder = {
      id: `fld-${uuidv4().substring(0, 8)}`,
      name: dto.name.trim(),
      parentId,
      ownerId: dto.ownerId,
      isStarred: false,
      isTrashed: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.folders.set(newFolder.id, newFolder);
    await postgresRepo.saveFolder(newFolder);

    await auditService.record({
      action: 'FOLDER_CREATE',
      category: 'folder',
      actorId: dto.ownerId,
      resourceId: newFolder.id,
      resourceType: 'folder',
      details: { name: newFolder.name, parentId }
    });

    return newFolder;
  }

  async listContents(userId: string, userRole: string | undefined, parentId: string | null = null): Promise<{ folders: Folder[]; breadcrumbs: Array<{ id: string | null; name: string }> }> {
    const folders = Array.from(db.folders.values()).filter((f) => {
      if (f.isTrashed || f.parentId !== parentId) return false;
      if (f.ownerId === userId || userRole === 'admin') return true;
      try {
        assertPermission(userId, userRole, f.id, 'folder', f.ownerId, 'VIEWER');
        return true;
      } catch {
        return false;
      }
    });

    // Calculate breadcrumbs
    const breadcrumbs: Array<{ id: string | null; name: string }> = [{ id: null, name: 'Home' }];
    let currentId = parentId;
    const visited = new Set<string>();
    const chain: Folder[] = [];

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const folder = db.folders.get(currentId);
      if (folder) {
        chain.unshift(folder);
        currentId = folder.parentId;
      } else {
        break;
      }
    }

    chain.forEach((f) => breadcrumbs.push({ id: f.id, name: f.name }));

    return { folders, breadcrumbs };
  }

  async toggleStar(folderId: string, userId: string, userRole: string | undefined): Promise<Folder> {
    const folder = await this.getById(folderId, userId, userRole);
    folder.isStarred = !folder.isStarred;
    folder.updatedAt = new Date().toISOString();
    db.folders.set(folderId, folder);
    await postgresRepo.saveFolder(folder);
    await redisCacheManager.del(`cache:meta:folder:${folderId}`);
    return folder;
  }

  async rename(folderId: string, userId: string, userRole: string | undefined, newName: string, expectedVersion?: number): Promise<Folder> {
    const folder = await this.getById(folderId, userId, userRole);
    assertPermission(userId, userRole, folder.id, 'folder', folder.ownerId, 'EDITOR');

    this.checkOptimisticLock(folder, expectedVersion);

    folder.name = newName.trim();
    folder.version += 1;
    folder.updatedAt = new Date().toISOString();

    db.folders.set(folderId, folder);
    await postgresRepo.saveFolder(folder);
    await redisCacheManager.del(`cache:meta:folder:${folderId}`);
    return folder;
  }

  async move(folderId: string, userId: string, userRole: string | undefined, targetParentId: string | null, expectedVersion?: number): Promise<Folder> {
    const folder = await this.getById(folderId, userId, userRole);
    assertPermission(userId, userRole, folder.id, 'folder', folder.ownerId, 'EDITOR');

    if (targetParentId) {
      const targetParent = db.folders.get(targetParentId);
      if (!targetParent || targetParent.isTrashed) {
        throw new NotFoundError('Target Parent Folder');
      }
      assertPermission(userId, userRole, targetParent.id, 'folder', targetParent.ownerId, 'EDITOR');

      // Cycle detection: walk from targetParentId up to the root.
      // If we encounter folderId along the way, the move would create a cycle.
      let ancestorId: string | null = targetParentId;
      const visited = new Set<string>();
      while (ancestorId) {
        if (ancestorId === folderId) {
          throw new ValidationError(
            `Cannot move folder '${folder.name}' into one of its own descendants. This would create a cycle.`
          );
        }
        if (visited.has(ancestorId)) break; // Existing (pre-existing) cycle guard
        visited.add(ancestorId);
        const ancestor = db.folders.get(ancestorId);
        ancestorId = ancestor?.parentId ?? null;
      }
    }

    this.checkOptimisticLock(folder, expectedVersion);

    folder.parentId = targetParentId;
    folder.version += 1;
    folder.updatedAt = new Date().toISOString();

    db.folders.set(folderId, folder);
    await postgresRepo.saveFolder(folder);
    await redisCacheManager.del(`cache:meta:folder:${folderId}`);
    return folder;
  }

  async copy(folderId: string, userId: string, userRole: string | undefined, targetParentId: string | null, newName?: string): Promise<Folder> {
    const sourceFolder = db.folders.get(folderId);
    if (!sourceFolder || sourceFolder.isTrashed) {
      throw new NotFoundError('Folder');
    }
    assertPermission(userId, userRole, sourceFolder.id, 'folder', sourceFolder.ownerId, 'VIEWER');

    if (targetParentId) {
      const targetParent = db.folders.get(targetParentId);
      if (!targetParent || targetParent.isTrashed) {
        throw new NotFoundError('Target Parent Folder');
      }
      assertPermission(userId, userRole, targetParent.id, 'folder', targetParent.ownerId, 'EDITOR');
    }

    const copiedFolder: Folder = {
      id: `fld-${uuidv4().substring(0, 8)}`,
      name: newName ? newName.trim() : `Copy of ${sourceFolder.name}`,
      parentId: targetParentId,
      ownerId: userId,
      isStarred: false,
      isTrashed: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.folders.set(copiedFolder.id, copiedFolder);
    await postgresRepo.saveFolder(copiedFolder);
    return copiedFolder;
  }
}

export const foldersService = new FoldersService();
