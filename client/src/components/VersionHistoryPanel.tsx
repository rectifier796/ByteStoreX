import React, { useState, useEffect } from 'react';
import { History, X, Download, RotateCcw, CheckCircle, Hash, Calendar, HardDrive } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { FileMetadata, FileVersion } from '../types/index.js';
import { useToast } from '../context/ToastContext.js';

interface VersionHistoryPanelProps {
  file: FileMetadata | null;
  onClose: () => void;
  onRestored: () => void;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({
  file,
  onClose,
  onRestored,
}) => {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!file) return;
    setLoading(true);
    ApiClient.get<{ success: boolean; versions: FileVersion[] }>(
      `/api/v1/files/${file.id}/versions`
    )
      .then((res) => setVersions(res.versions || []))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [file]);

  const handleRestore = async (version: FileVersion) => {
    if (!file) return;
    setRestoringId(version.id);
    try {
      await ApiClient.post(`/api/v1/files/${file.id}/restore`, { versionId: version.id });
      showToast(`Restored to version ${version.version}`, 'success');
      onRestored();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Restore failed', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  const handleDownloadVersion = (version: FileVersion) => {
    if (!file) return;
    const token = localStorage.getItem('bytestore_access_token');
    fetch(`/api/v1/files/${file.id}/versions/${version.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file.name} (v${version.version})`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => showToast('Download failed', 'error'));
  };

  if (!file) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        className="animate-slide-down"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '420px',
          height: '100vh',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animationName: 'slideInRight',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '22px 22px 18px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'rgba(99,102,241,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <History size={20} color="var(--accent-primary)" />
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)' }}>
              Version History
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-subtle)',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.name}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Current Version Banner */}
        <div
          style={{
            margin: '16px 18px 0',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(16,185,129,0.07)',
            border: '1px solid rgba(16,185,129,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <CheckCircle size={16} color="var(--status-success)" />
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6ee7b7' }}>
              Current Version: v{file.version}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginTop: '1px' }}>
              {formatSize(file.size)} • {new Date(file.updatedAt).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Version List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-subtle)', fontSize: '0.85rem' }}>
              Loading history...
            </div>
          ) : versions.length === 0 ? (
            <div className="empty-state" style={{ padding: '48px 24px' }}>
              <div className="empty-state-icon">
                <History size={28} />
              </div>
              <div className="empty-state-title">No previous versions</div>
              <div className="empty-state-desc">
                Version history is created when you upload a replacement file.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {versions.map((v) => (
                <div key={v.id} className="version-row">
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(99,102,241,0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      color: 'var(--text-accent)',
                    }}
                  >
                    v{v.version}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <HardDrive size={12} color="var(--text-subtle)" />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {formatSize(v.size)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginTop: '3px',
                      }}
                    >
                      <Calendar size={11} color="var(--text-subtle)" />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        marginTop: '4px',
                      }}
                    >
                      <Hash size={10} color="var(--text-subtle)" />
                      <span
                        className="mono"
                        style={{ fontSize: '0.65rem', color: 'var(--text-subtle)', letterSpacing: '0.3px' }}
                      >
                        {v.checksum.substring(0, 16)}…
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDownloadVersion(v)}
                      title="Download this version"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => handleRestore(v)}
                      disabled={restoringId === v.id}
                      title="Restore to this version"
                      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
