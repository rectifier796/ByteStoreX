import bcrypt from 'bcryptjs';
import { User, RefreshToken, FileMetadata, FileVersion, Folder, FilePermission, ShareLink, UploadSession, UploadChunkRecord, IdempotencyKeyRecord, BlobRecord, Job, AuditLog } from './types.js';
import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';

import { postgresRepo } from './postgres.repo.js';

class InMemoryDB {
  public users: Map<string, User> = new Map();
  public refreshTokens: Map<string, RefreshToken> = new Map();
  public permissions: Map<string, FilePermission> = new Map();
  public files: Map<string, FileMetadata> = new Map();
  public fileVersions: Map<string, FileVersion> = new Map();
  public folders: Map<string, Folder> = new Map();
  public shareLinks: Map<string, ShareLink> = new Map();
  public uploadSessions: Map<string, UploadSession> = new Map();
  public uploadChunks: Map<string, UploadChunkRecord> = new Map();
  public idempotencyKeys: Map<string, IdempotencyKeyRecord> = new Map();
  public blobs: Map<string, BlobRecord> = new Map();
  public jobs: Map<string, Job> = new Map();
  public auditLogs: AuditLog[] = [];

  constructor() {
    this.seedDefaults();
    this.initPostgresSync();
  }

  private async initPostgresSync() {
    try {
      // 1. Seed defaults into PostgreSQL database if users table is empty
      const existingUsers = await postgresRepo.getAllUsers();
      if (existingUsers.length === 0) {
        for (const u of this.users.values()) {
          await postgresRepo.saveUser(u);
        }
        for (const fld of this.folders.values()) {
          await postgresRepo.saveFolder(fld);
        }
        for (const b of this.blobs.values()) {
          await postgresRepo.saveBlob(b);
        }
        for (const f of this.files.values()) {
          await postgresRepo.saveFile(f);
        }
      } else {
        // Load existing PostgreSQL records into in-memory cache maps
        for (const u of existingUsers) {
          this.users.set(u.id, u);
        }
        const pgFolders = await postgresRepo.getAllFolders();
        for (const fld of pgFolders) {
          this.folders.set(fld.id, fld);
        }
        const pgBlobs = await postgresRepo.getAllBlobs();
        for (const b of pgBlobs) {
          this.blobs.set(b.id, b);
        }
        const pgFiles = await postgresRepo.getAllFiles();
        for (const f of pgFiles) {
          this.files.set(f.id, f);
        }
        const pgShareLinks = await postgresRepo.getAllShareLinks();
        for (const sl of pgShareLinks) {
          this.shareLinks.set(sl.id, sl);
        }
        const pgPermissions = await postgresRepo.getAllFilePermissions();
        for (const perm of pgPermissions) {
          this.permissions.set(perm.id, perm);
        }
      }
    } catch {
      // Fall back smoothly if PostgreSQL is offline
    }
  }

  private seedDefaults() {
    // Seed initial users
    const salt = bcrypt.genSaltSync(10);
    const demoPasswordHash = bcrypt.hashSync('bytestore123', salt);

    const adminUser: User = {
      id: 'usr-admin-001',
      email: 'admin@bytestorex.io',
      name: 'Alex Mercer (Admin)',
      passwordHash: demoPasswordHash,
      role: 'admin',
      storageUsedBytes: 0,
      quotaBytes: config.defaultQuota,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const demoUser: User = {
      id: 'usr-demo-002',
      email: 'demo@bytestorex.io',
      name: 'Sarah Connor',
      passwordHash: demoPasswordHash,
      role: 'user',
      storageUsedBytes: 0,
      quotaBytes: config.defaultQuota,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.users.set(adminUser.id, adminUser);
    this.users.set(demoUser.id, demoUser);

    // Seed initial folder hierarchy
    const rootDocsFolder: Folder = {
      id: 'fld-docs-01',
      name: 'Project Specifications',
      parentId: null,
      ownerId: demoUser.id,
      isStarred: true,
      isTrashed: false,
      version: 1,
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    };

    const rootMediaFolder: Folder = {
      id: 'fld-media-02',
      name: 'Brand Assets & Media',
      parentId: null,
      ownerId: demoUser.id,
      isStarred: false,
      isTrashed: false,
      version: 1,
      createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    };

    const nestedFolder: Folder = {
      id: 'fld-arch-03',
      name: 'Architecture Diagrams',
      parentId: rootDocsFolder.id,
      ownerId: demoUser.id,
      isStarred: false,
      isTrashed: false,
      version: 1,
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    };

    this.folders.set(rootDocsFolder.id, rootDocsFolder);
    this.folders.set(rootMediaFolder.id, rootMediaFolder);
    this.folders.set(nestedFolder.id, nestedFolder);

    // Seed sample physical file contents in local storage directory
    const storageDir = config.storagePath;
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const sampleFile1Path = path.join(storageDir, 'sample_arch.json');
    fs.writeFileSync(sampleFile1Path, JSON.stringify({ project: 'ByteStoreX', architecture: 'Modular Monolith', version: '1.0' }, null, 2));

    const sampleFile2Path = path.join(storageDir, 'sample_guide.txt');
    fs.writeFileSync(sampleFile2Path, 'Welcome to ByteStoreX Enterprise Storage Platform.\nEngineered with Node.js Express & React TypeScript.');

    const blob1: BlobRecord = {
      id: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      storagePath: sampleFile1Path,
      sizeBytes: fs.statSync(sampleFile1Path).size,
      mimeType: 'application/json',
      referenceCount: 1,
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    };

    const blob2: BlobRecord = {
      id: 'f4b1c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856',
      checksum: 'f4b1c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856',
      storagePath: sampleFile2Path,
      sizeBytes: fs.statSync(sampleFile2Path).size,
      mimeType: 'text/plain',
      referenceCount: 1,
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    };

    this.blobs.set(blob1.id, blob1);
    this.blobs.set(blob2.id, blob2);

    const file1: FileMetadata = {
      id: 'fil-arch-101',
      name: 'monolith_spec.json',
      originalName: 'monolith_spec.json',
      mimeType: 'application/json',
      size: fs.statSync(sampleFile1Path).size,
      storagePath: sampleFile1Path,
      folderId: rootDocsFolder.id,
      ownerId: demoUser.id,
      isStarred: true,
      isTrashed: false,
      tags: ['architecture', 'json', 'spec'],
      version: 1,
      checksum: blob1.checksum,
      activeBlobId: blob1.id,
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    };

    const file2: FileMetadata = {
      id: 'fil-guide-102',
      name: 'getting_started.txt',
      originalName: 'getting_started.txt',
      mimeType: 'text/plain',
      size: fs.statSync(sampleFile2Path).size,
      storagePath: sampleFile2Path,
      folderId: null,
      ownerId: demoUser.id,
      isStarred: false,
      isTrashed: false,
      tags: ['guide', 'doc'],
      version: 1,
      checksum: blob2.checksum,
      activeBlobId: blob2.id,
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
    };

    this.files.set(file1.id, file1);
    this.files.set(file2.id, file2);

    const ver1: FileVersion = {
      id: `ver-${file1.id}-1`,
      fileId: file1.id,
      blobId: blob1.id,
      versionNumber: 1,
      sizeBytes: file1.size,
      mimeType: file1.mimeType,
      checksum: blob1.checksum,
      createdBy: demoUser.id,
      createdAt: file1.createdAt,
    };

    const ver2: FileVersion = {
      id: `ver-${file2.id}-1`,
      fileId: file2.id,
      blobId: blob2.id,
      versionNumber: 1,
      sizeBytes: file2.size,
      mimeType: file2.mimeType,
      checksum: blob2.checksum,
      createdBy: demoUser.id,
      createdAt: file2.createdAt,
    };

    this.fileVersions.set(ver1.id, ver1);
    this.fileVersions.set(ver2.id, ver2);

    // Seed sample audit log
    this.auditLogs.push({
      id: 'aud-001',
      action: 'SYSTEM_BOOT',
      category: 'auth',
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      details: { message: 'ByteStoreX Modular Monolith initialized' },
      requestId: 'req-sys-init',
      ip: '127.0.0.1',
      timestamp: new Date().toISOString(),
    });
  }
}

export const db = new InMemoryDB();
