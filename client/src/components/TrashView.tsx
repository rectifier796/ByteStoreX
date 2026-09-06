import React, { useState, useEffect } from 'react';
import { Trash2, RotateCcw, XCircle, Folder as FolderIcon, FileText, AlertTriangle, Clock } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { FileMetadata, Folder } from '../types/index.js';
import { useToast } from '../context/ToastContext.js';

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : '—');
const daysLeft = (trashedAt?: string) => {
  if (!trashedAt) return null;
  const diff = 30 - Math.floor((Date.now() - new Date(trashedAt).getTime()) / 86400000);
  return Math.max(0, diff);
};

export const TrashView: React.FC = () => {
  const { showToast } = useToast();
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [emptyConfirm, setEmptyConfirm] = useState(false);

  const fetchTrash = async () => {
    setLoading(true);
    try {
      const res = await ApiClient.get<{ success: boolean; files: FileMetadata[]; folders: Folder[] }>('/api/v1/trash');
      setFiles(res.files || []);
      setFolders(res.folders || []);
    } catch {
      setFiles([]);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTrash(); }, []);

  const handleRestore = async (id: string, type: 'file' | 'folder') => {
    try {
      await ApiClient.post('/api/v1/trash/restore', { resourceId: id, resourceType: type });
      showToast('Restored successfully', 'success');
      fetchTrash();
    } catch (err: any) {
      showToast(err.message || 'Restore failed', 'error');
    }
  };

  const handlePurge = async (id: string, type: 'file' | 'folder') => {
    try {
      await ApiClient.delete('/api/v1/trash/purge', { resourceId: id, resourceType: type });
      showToast('Permanently deleted', 'info');
      fetchTrash();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error');
    }
  };

  const handleEmptyTrash = async () => {
    try {
      await ApiClient.delete('/api/v1/trash/empty');
      showToast('Trash emptied', 'info');
      setEmptyConfirm(false);
      fetchTrash();
    } catch (err: any) {
      showToast(err.message || 'Failed to empty trash', 'error');
    }
  };

  const hasItems = files.length > 0 || folders.length > 0;

  return (
    <div className="view-area animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Trash2 size={22} color="var(--status-danger)" />
            Trash Bin
          </h1>
          <p className="page-subtitle">
            Items are permanently deleted after 30 days. Restore them before then.
          </p>
        </div>
        {hasItems && !emptyConfirm && (
          <button className="btn btn-danger" onClick={() => setEmptyConfirm(true)}>
            <Trash2 size={15} />
            Empty Trash
          </button>
        )}
        {emptyConfirm && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.82rem', color: '#fca5a5', fontWeight: 600 }}>
              Are you sure? This cannot be undone.
            </span>
            <button className="btn btn-danger btn-sm" onClick={handleEmptyTrash}>Yes, Empty</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEmptyConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>

      {/* Retention notice */}
      {hasItems && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(245,158,11,0.07)',
            border: '1px solid rgba(245,158,11,0.2)',
            marginBottom: '20px',
            fontSize: '0.82rem',
            color: '#fcd34d',
          }}
        >
          <Clock size={16} />
          <span>
            Items in trash will be automatically purged after 30 days. Restore to keep them.
          </span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
          Loading trash…
        </div>
      ) : !hasItems ? (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ opacity: 0.4 }}>
            <Trash2 size={32} />
          </div>
          <div className="empty-state-title">Trash is empty</div>
          <div className="empty-state-desc">
            Items you delete from My Files appear here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Folders */}
          {folders.map((folder) => {
            const days = daysLeft(folder.trashedAt);
            return (
              <div
                key={folder.id}
                className="glass-card"
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px' }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '9px',
                    background: 'rgba(245,158,11,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FolderIcon size={20} color="#f59e0b" />
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {folder.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', display: 'flex', gap: '10px', marginTop: '2px' }}>
                    <span>Folder</span>
                    <span>Deleted: {formatDate(folder.trashedAt)}</span>
                    {days !== null && (
                      <span style={{ color: days < 5 ? '#fca5a5' : '#fcd34d', fontWeight: 600 }}>
                        {days}d until purge
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    className="btn btn-success btn-sm"
                    onClick={() => handleRestore(folder.id, 'folder')}
                  >
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handlePurge(folder.id, 'folder')}
                  >
                    <XCircle size={13} /> Delete
                  </button>
                </div>
              </div>
            );
          })}

          {/* Files */}
          {files.map((file) => {
            const days = daysLeft(file.trashedAt);
            return (
              <div
                key={file.id}
                className="glass-card"
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px' }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '9px',
                    background: 'rgba(139,92,246,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FileText size={20} color="#8b5cf6" />
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', display: 'flex', gap: '10px', marginTop: '2px' }}>
                    <span>{formatSize(file.size)}</span>
                    <span>Deleted: {formatDate(file.trashedAt)}</span>
                    {days !== null && (
                      <span style={{ color: days < 5 ? '#fca5a5' : '#fcd34d', fontWeight: 600 }}>
                        {days}d until purge
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    className="btn btn-success btn-sm"
                    onClick={() => handleRestore(file.id, 'file')}
                  >
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handlePurge(file.id, 'file')}
                  >
                    <XCircle size={13} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
