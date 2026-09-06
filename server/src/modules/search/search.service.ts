import { db } from '../../shared/db.js';
import { FileMetadata, Folder } from '../../shared/types.js';
import { auditService } from '../audit/audit.service.js';
import { ValidationError } from '../../core/errors.js';

export interface SearchQueryDTO {
  query?: string;
  mimeType?: string;
  tags?: string[];
  isStarred?: boolean;
  minSize?: number;
  maxSize?: number;
  folderId?: string | null;
  createdAfter?: string;
  createdBefore?: string;
  sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  ownerId: string;
}

export class SearchService {
  async search(dto: SearchQueryDTO): Promise<{ files: FileMetadata[]; folders: Folder[]; totalCount: number }> {
    // Input validation: unbounded strings fed into .includes() are a linear-scan DoS vector
    if (dto.query && dto.query.length > 256) {
      throw new ValidationError('Search query must not exceed 256 characters.');
    }
    if (dto.mimeType && dto.mimeType.length > 128) {
      throw new ValidationError('mimeType filter must not exceed 128 characters.');
    }
    if (dto.minSize !== undefined && (isNaN(dto.minSize) || dto.minSize < 0)) {
      throw new ValidationError('minSize must be a non-negative number.');
    }
    if (dto.maxSize !== undefined && (isNaN(dto.maxSize) || dto.maxSize < 0)) {
      throw new ValidationError('maxSize must be a non-negative number.');
    }
    if (dto.minSize !== undefined && dto.maxSize !== undefined && dto.minSize > dto.maxSize) {
      throw new ValidationError('minSize cannot be greater than maxSize.');
    }

    const q = dto.query ? dto.query.toLowerCase().trim() : '';

    const matchingFiles = Array.from(db.files.values()).filter((f) => {
      if (f.ownerId !== dto.ownerId || f.isTrashed) return false;

      // Search term query match (name or tags)
      if (q) {
        const nameMatch = f.name.toLowerCase().includes(q);
        const tagMatch = f.tags.some((t) => t.toLowerCase().includes(q));
        if (!nameMatch && !tagMatch) return false;
      }

      // MimeType filter
      if (dto.mimeType && !f.mimeType.toLowerCase().includes(dto.mimeType.toLowerCase())) {
        return false;
      }

      // Tags filter array
      if (dto.tags && dto.tags.length > 0) {
        const hasAllTags = dto.tags.every((tag) =>
          f.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        );
        if (!hasAllTags) return false;
      }

      // Starred filter
      if (dto.isStarred !== undefined && f.isStarred !== dto.isStarred) {
        return false;
      }

      // Size bounds
      if (dto.minSize !== undefined && f.size < dto.minSize) return false;
      if (dto.maxSize !== undefined && f.size > dto.maxSize) return false;

      // Folder scoping
      if (dto.folderId !== undefined && f.folderId !== dto.folderId) return false;

      // Date range filtering
      if (dto.createdAfter && new Date(f.createdAt).getTime() < new Date(dto.createdAfter).getTime()) {
        return false;
      }
      if (dto.createdBefore && new Date(f.createdAt).getTime() > new Date(dto.createdBefore).getTime()) {
        return false;
      }

      return true;
    });

    const matchingFolders = Array.from(db.folders.values()).filter((f) => {
      if (f.ownerId !== dto.ownerId || f.isTrashed) return false;

      if (q && !f.name.toLowerCase().includes(q)) {
        return false;
      }

      if (dto.isStarred !== undefined && f.isStarred !== dto.isStarred) {
        return false;
      }

      if (dto.folderId !== undefined && f.parentId !== dto.folderId) {
        return false;
      }

      if (dto.createdAfter && new Date(f.createdAt).getTime() < new Date(dto.createdAfter).getTime()) {
        return false;
      }
      if (dto.createdBefore && new Date(f.createdAt).getTime() > new Date(dto.createdBefore).getTime()) {
        return false;
      }

      return true;
    });

    // Sorting
    const sortBy = dto.sortBy || 'createdAt';
    const sortOrder = dto.sortOrder || 'desc';

    matchingFiles.sort((a, b) => {
      let valA: any = a[sortBy as keyof FileMetadata];
      let valB: any = b[sortBy as keyof FileMetadata];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    matchingFolders.sort((a, b) => {
      let valA: any = a[sortBy === 'size' ? 'name' : (sortBy as keyof Folder)];
      let valB: any = b[sortBy === 'size' ? 'name' : (sortBy as keyof Folder)];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    const totalCount = matchingFiles.length + matchingFolders.length;

    // Only audit non-trivial searches (non-empty query term) to avoid flooding the
    // audit log with every browse/list call that goes through the search endpoint.
    if (q) {
      await auditService.record({
        action: 'SEARCH_QUERY',
        category: 'file',
        actorId: dto.ownerId,
        details: {
          query: dto.query,
          mimeType: dto.mimeType,
          tags: dto.tags,
          minSize: dto.minSize,
          maxSize: dto.maxSize,
          resultFilesCount: matchingFiles.length,
          resultFoldersCount: matchingFolders.length,
          totalCount,
        }
      });
    }

    return { files: matchingFiles, folders: matchingFolders, totalCount };
  }
}

export const searchService = new SearchService();

