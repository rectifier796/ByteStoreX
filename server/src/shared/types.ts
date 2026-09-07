export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'admin' | 'user';
  storageUsedBytes: number;
  quotaBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface RefreshToken {
  id: string;
  tokenHash: string;
  userId: string;
  isRevoked: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number; // in bytes
  storagePath: string;
  thumbnailPath?: string; // MinIO S3 object storage path
  folderId: string | null; // null = root
  ownerId: string;
  isStarred: boolean;
  isTrashed: boolean;
  trashedAt?: string;
  tags: string[];
  version: number;
  checksum: string;
  activeBlobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersion {
  id: string;
  fileId: string;
  blobId: string;
  versionNumber: number;
  sizeBytes: number;
  mimeType: string;
  checksum: string;
  createdBy: string;
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null; // null = root
  ownerId: string;
  isStarred: boolean;
  isTrashed: boolean;
  trashedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FilePermission {
  id: string;
  resourceId: string;
  resourceType: 'file' | 'folder';
  granteeId: string;
  permissionLevel: 'OWNER' | 'EDITOR' | 'VIEWER';
  grantedBy: string;
  createdAt: string;
}

export interface ShareLink {
  id: string;
  resourceId: string;
  resourceType: 'file' | 'folder';
  token: string;
  tokenHash: string;
  permission: 'view' | 'edit';
  passwordHash?: string;
  expiresAt?: string;
  isRevoked: boolean;
  accessCount: number;
  createdBy: string;
  createdAt: string;
}

export interface UploadSession {
  id: string;
  fileName: string;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  folderId: string | null;
  ownerId: string;
  fileId?: string;
  status: 'pending' | 'uploading' | 'completed' | 'cancelled' | 'expired';
  createdAt: string;
  updatedAt: string;
}

export interface UploadChunkRecord {
  id: string;
  uploadId: string;
  chunkIndex: number;
  sizeBytes: number;
  checksum: string;
  uploadedAt: string;
}

export interface IdempotencyKeyRecord {
  id: string;
  key: string;
  userId: string;
  requestHash: string;
  requestPath: string;
  responseCode: number;
  responseBody: any;
  expiresAt: string;
  createdAt: string;
}

export interface BlobRecord {
  id: string; // sha256 checksum or unique blob key
  checksum: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  referenceCount: number;
  createdAt: string;
}

export interface Job {
  id: string;
  type: 'zip_bundle' | 'virus_scan' | 'trash_cleanup' | 'thumbnail_gen';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'queued';
  progress: number; // 0 - 100
  payload: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lockedAt?: string | null;
  lockedBy?: string | null;
  requestId: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
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
