export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  createdAt: string;
  updatedAt: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  folderId: string | null;
  ownerId: string;
  isStarred: boolean;
  isTrashed: boolean;
  trashedAt?: string;
  tags: string[];
  version: number;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  isStarred: boolean;
  isTrashed: boolean;
  trashedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareLink {
  id: string;
  resourceId: string;
  resourceType: 'file' | 'folder';
  token: string;
  permission: 'view' | 'edit';
  expiresAt?: string;
  accessCount: number;
  isRevoked?: boolean;
  createdAt: string;
}

export interface FileVersion {
  id: string;
  fileId: string;
  version: number;
  size: number;
  checksum: string;
  createdAt: string;
  createdBy?: string;
}

export interface Job {
  id: string;
  type: 'zip_bundle' | 'virus_scan' | 'trash_cleanup' | 'thumbnail_gen';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  payload: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
  requestId: string;
  createdAt: string;
}

export interface QuotaInfo {
  userId: string;
  usedBytes: number;
  totalQuotaBytes: number;
  fileCount: number;
  folderCount: number;
  breakdown: {
    documents: number;
    media: number;
    archives: number;
    code: number;
    other: number;
  };
}

export interface AuditLog {
  id: string;
  action: string;
  category: 'auth' | 'file' | 'folder' | 'share' | 'trash' | 'quota' | 'job';
  actorId: string;
  actorEmail?: string;
  resourceId?: string;
  resourceType?: string;
  details?: Record<string, any>;
  requestId: string;
  ip: string;
  timestamp: string;
}
