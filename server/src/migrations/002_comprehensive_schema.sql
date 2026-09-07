-- Pre-migration column additions to upgrade 001 tables if they exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_bytes BIGINT NOT NULL DEFAULT 10737418240;

ALTER TABLE files ADD COLUMN IF NOT EXISTS active_blob_id VARCHAR(128);
ALTER TABLE files ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1;
ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

ALTER TABLE share_links ADD COLUMN IF NOT EXISTS token_hash VARCHAR(255);
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS permission_level VARCHAR(32) NOT NULL DEFAULT 'view';
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS max_access_count INT;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    quota_bytes BIGINT NOT NULL DEFAULT 10737418240, -- 10 GB
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_user_role CHECK (role IN ('admin', 'user', 'guest')),
    CONSTRAINT check_user_status CHECK (status IN ('active', 'suspended', 'deactivated')),
    CONSTRAINT check_user_storage_used_non_negative CHECK (storage_used_bytes >= 0),
    CONSTRAINT check_user_quota_positive CHECK (quota_bytes > 0)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. FOLDERS TABLE
CREATE TABLE IF NOT EXISTS folders (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id VARCHAR(64) REFERENCES folders(id) ON DELETE CASCADE,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_folder_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_folders_owner_parent ON folders(owner_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_trashed ON folders(is_trashed);

-- 3. BLOBS TABLE (Deduplicated Content-Addressed Physical Storage)
CREATE TABLE IF NOT EXISTS blobs (
    id VARCHAR(128) PRIMARY KEY, -- sha256 checksum or unique blob key
    storage_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    reference_count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_blob_size_non_negative CHECK (size_bytes >= 0),
    CONSTRAINT check_blob_ref_count_non_negative CHECK (reference_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_blobs_checksum ON blobs(checksum);

-- 4. FILES TABLE (Logical File Records)
CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    folder_id VARCHAR(64) REFERENCES folders(id) ON DELETE SET NULL,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_blob_id VARCHAR(128) REFERENCES blobs(id) ON DELETE RESTRICT,
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at TIMESTAMP WITH TIME ZONE,
    current_version INT NOT NULL DEFAULT 1,
    thumbnail_path TEXT,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_file_name_not_empty CHECK (length(trim(name)) > 0),
    CONSTRAINT check_file_version_positive CHECK (current_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_files_owner_folder ON files(owner_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_files_active_blob ON files(active_blob_id);
CREATE INDEX IF NOT EXISTS idx_files_trashed ON files(is_trashed);
CREATE INDEX IF NOT EXISTS idx_files_fts ON files USING gin(to_tsvector('english', name));

-- 5. FILE_VERSIONS TABLE (Historical File Revisions)
CREATE TABLE IF NOT EXISTS file_versions (
    id VARCHAR(64) PRIMARY KEY,
    file_id VARCHAR(64) NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    blob_id VARCHAR(128) NOT NULL REFERENCES blobs(id) ON DELETE RESTRICT,
    version_number INT NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_file_version_number UNIQUE (file_id, version_number),
    CONSTRAINT check_version_number_positive CHECK (version_number >= 1),
    CONSTRAINT check_version_size_non_negative CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id);

-- 6. UPLOADS TABLE (Chunked Upload Sessions)
CREATE TABLE IF NOT EXISTS uploads (
    id VARCHAR(64) PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    total_size_bytes BIGINT NOT NULL,
    chunk_size_bytes INT NOT NULL,
    total_chunks INT NOT NULL,
    folder_id VARCHAR(64) REFERENCES folders(id) ON DELETE SET NULL,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_upload_status CHECK (status IN ('pending', 'uploading', 'completed', 'cancelled', 'expired')),
    CONSTRAINT check_upload_total_size_non_negative CHECK (total_size_bytes >= 0),
    CONSTRAINT check_upload_chunk_size_positive CHECK (chunk_size_bytes > 0),
    CONSTRAINT check_upload_total_chunks_positive CHECK (total_chunks > 0)
);

CREATE INDEX IF NOT EXISTS idx_uploads_owner_status ON uploads(owner_id, status);

-- 7. UPLOAD_CHUNKS TABLE (Individual Upload Chunks)
CREATE TABLE IF NOT EXISTS upload_chunks (
    id VARCHAR(64) PRIMARY KEY,
    upload_id VARCHAR(64) NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    size_bytes INT NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_upload_chunk_index UNIQUE (upload_id, chunk_index),
    CONSTRAINT check_chunk_index_non_negative CHECK (chunk_index >= 0),
    CONSTRAINT check_chunk_size_non_negative CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_upload_chunks_upload ON upload_chunks(upload_id);

-- 8. FILE_PERMISSIONS TABLE (Direct User ACL Grants)
CREATE TABLE IF NOT EXISTS file_permissions (
    id VARCHAR(64) PRIMARY KEY,
    resource_id VARCHAR(64) NOT NULL,
    resource_type VARCHAR(32) NOT NULL,
    grantee_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level VARCHAR(32) NOT NULL DEFAULT 'read',
    granted_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_resource_permission UNIQUE (resource_id, resource_type, grantee_id),
    CONSTRAINT check_permission_resource_type CHECK (resource_type IN ('file', 'folder')),
    CONSTRAINT check_permission_level CHECK (permission_level IN ('read', 'write', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_permissions_grantee ON file_permissions(grantee_id);
CREATE INDEX IF NOT EXISTS idx_permissions_resource ON file_permissions(resource_id, resource_type);

-- 9. SHARE_LINKS TABLE (Public Share Links)
CREATE TABLE IF NOT EXISTS share_links (
    id VARCHAR(64) PRIMARY KEY,
    resource_id VARCHAR(64) NOT NULL,
    resource_type VARCHAR(32) NOT NULL,
    token VARCHAR(128) NOT NULL,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    permission_level VARCHAR(32) NOT NULL DEFAULT 'view',
    password_hash VARCHAR(255),
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    access_count INT NOT NULL DEFAULT 0,
    max_access_count INT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_share_resource_type CHECK (resource_type IN ('file', 'folder')),
    CONSTRAINT check_share_permission_level CHECK (permission_level IN ('view', 'edit')),
    CONSTRAINT check_share_access_count_non_negative CHECK (access_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_token_hash ON share_links(token_hash);

-- 10. JOBS TABLE (In-Process & Worker Background Queue)
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(64) PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    progress INT NOT NULL DEFAULT 0,
    payload JSONB DEFAULT '{}',
    result JSONB,
    error_message TEXT,
    request_id VARCHAR(64) NOT NULL,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    next_run_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_job_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'queued', 'retrying')),
    CONSTRAINT check_job_progress_bounds CHECK (progress >= 0 AND progress <= 100),
    CONSTRAINT check_job_attempts_non_negative CHECK (attempts >= 0),
    CONSTRAINT check_job_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_jobs_owner_status ON jobs(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_request_id ON jobs(request_id);

-- 11. IDEMPOTENCY_KEYS TABLE (API Request Deduplication)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id VARCHAR(64) PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_hash VARCHAR(255) NOT NULL,
    request_path VARCHAR(255) NOT NULL,
    response_code INT NOT NULL,
    response_body JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_response_code_valid CHECK (response_code >= 100 AND response_code <= 599)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys(key, user_id);

-- 12. REFRESH_TOKENS TABLE (JWT Refresh Token Revocation Vault)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id VARCHAR(64) PRIMARY KEY,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- 13. AUDIT_LOGS TABLE (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    action VARCHAR(128) NOT NULL,
    category VARCHAR(32) NOT NULL,
    actor_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    resource_id VARCHAR(64),
    resource_type VARCHAR(32),
    details JSONB,
    request_id VARCHAR(64) NOT NULL,
    ip_address VARCHAR(64) NOT NULL,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_audit_category CHECK (category IN ('auth', 'file', 'folder', 'share', 'trash', 'quota', 'job', 'permission'))
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_category_timestamp ON audit_logs(category, timestamp);
