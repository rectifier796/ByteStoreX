import React, { useState, useEffect } from 'react';
import {
  FolderGit2,
  Download,
  Eye,
  Lock,
  Globe,
  Clock,
  ShieldAlert,
  FileText,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Video,
  Music,
  Check,
  Share2,
} from 'lucide-react';
import { ShareLink, FileMetadata, Folder } from '../types/index.js';
import { PreviewModal } from './PreviewModal.js';
import { useToast } from '../context/ToastContext.js';

interface PublicSharePortalProps {
  token: string;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

const getFileIcon = (mimeType: string = '', size = 32) => {
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon size={size} color="#ec4899" />;
  if (m.startsWith('video/')) return <Video size={size} color="#f59e0b" />;
  if (m.startsWith('audio/')) return <Music size={size} color="#10b981" />;
  if (m.includes('json') || m.includes('javascript') || m.includes('typescript') || m.includes('html'))
    return <FileCode size={size} color="#3b82f6" />;
  if (m.includes('zip') || m.includes('tar') || m.includes('rar'))
    return <FileArchive size={size} color="#f97316" />;
  if (m.includes('pdf') || m.includes('word') || m.includes('text'))
    return <FileText size={size} color="#8b5cf6" />;
  return <FileText size={size} color="#6b7280" />;
};

export const PublicSharePortal: React.FC<PublicSharePortalProps> = ({ token }) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [shareData, setShareData] = useState<{
    shareLink: ShareLink;
    resource: FileMetadata | Folder;
  } | null>(null);

  const [previewFile, setPreviewFile] = useState<FileMetadata | null>(null);

  const resolveToken = (password?: string) => {
    setLoading(true);
    setPasswordError(null);
    setError(null);

    const query = password ? `?password=${encodeURIComponent(password)}` : '';
    fetch(`/api/v1/sharing/public/${token}${query}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.status === 401 && data.error?.message?.toLowerCase().includes('password')) {
          setRequiresPassword(true);
          if (password) setPasswordError('Incorrect password');
          setLoading(false);
          return;
        }
        if (!res.ok || !data.success) {
          throw new Error(data.error?.message || 'Failed to load shared link');
        }
        setShareData({ shareLink: data.shareLink, resource: data.resource });
        setRequiresPassword(false);
        setLoading(false);
      })
      .catch((err: any) => {
        setError(err.message || 'Link expired or unavailable');
        setLoading(false);
      });
  };

  useEffect(() => {
    resolveToken();
  }, [token]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    resolveToken(passwordInput.trim());
  };

  const handleDownloadFile = (fileId: string, fileName: string) => {
    const query = passwordInput ? `?password=${encodeURIComponent(passwordInput)}` : '';
    const downloadUrl = `/api/v1/sharing/public/${token}/download${query}`;
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download started', 'success');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        position: 'relative',
      }}
    >
      {/* Background Radial Glow */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '500px',
          height: '500px',
          background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Brand Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '32px',
        }}
      >
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--accent-glow)',
          }}
        >
          <FolderGit2 size={24} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ByteStoreX
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
            Public Share Portal
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div
        className="glass-panel animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '540px',
          borderRadius: 'var(--radius-xl)',
          padding: '36px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          boxShadow: 'var(--shadow-lg)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {loading ? (
          <div style={{ padding: '40px 0', color: 'var(--text-muted)', fontSize: '0.92rem' }}>
            Loading shared resource…
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: 'var(--radius-xl)',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ef4444',
              }}
            >
              <ShieldAlert size={32} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>
                Access Unavailable
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>
                {error}
              </p>
            </div>
          </div>
        ) : requiresPassword ? (
          <form onSubmit={handlePasswordSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: 'var(--radius-xl)',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-accent)',
              }}
            >
              <Lock size={30} />
            </div>

            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>
                Protected Resource
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>
                Enter the password provided by the uploader to unlock access.
              </p>
            </div>

            <div style={{ width: '100%' }}>
              <input
                className="form-input"
                type="password"
                placeholder="Enter password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
                style={{ textAlign: 'center', fontSize: '1rem', padding: '12px' }}
              />
              {passwordError && (
                <div style={{ color: '#fca5a5', fontSize: '0.78rem', marginTop: '6px' }}>
                  {passwordError}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', justifyContent: 'center' }}
            >
              Unlock Access
            </button>
          </form>
        ) : shareData ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
            {/* Icon */}
            <div
              style={{
                width: '76px',
                height: '76px',
                borderRadius: 'var(--radius-xl)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {getFileIcon(
                shareData.shareLink.resourceType === 'file'
                  ? (shareData.resource as FileMetadata).mimeType
                  : ''
              )}
            </div>

            {/* Title */}
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px' }}>
                {shareData.resource.name}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                {shareData.shareLink.resourceType === 'file' && (
                  <span>{formatSize((shareData.resource as FileMetadata).size)}</span>
                )}
                <span>•</span>
                <span style={{ textTransform: 'capitalize' }}>
                  {shareData.shareLink.permission === 'view' ? '👁 View Only' : '✏️ Can Edit'}
                </span>
                {shareData.shareLink.expiresAt && (
                  <>
                    <span>•</span>
                    <span><Clock size={12} style={{ display: 'inline', marginRight: '3px' }} /> Expires {formatDate(shareData.shareLink.expiresAt)}</span>
                  </>
                )}
              </div>
            </div>

            {/* File Action Buttons */}
            {shareData.shareLink.resourceType === 'file' ? (
              <div style={{ width: '100%', display: 'flex', gap: '12px' }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1, padding: '12px', justifyContent: 'center' }}
                  onClick={() => setPreviewFile(shareData.resource as FileMetadata)}
                >
                  <Eye size={16} />
                  <span>Preview File</span>
                </button>

                <button
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '12px', justifyContent: 'center' }}
                  onClick={() => handleDownloadFile(shareData.resource.id, shareData.resource.name)}
                >
                  <Download size={16} />
                  <span>Download</span>
                </button>
              </div>
            ) : (
              <div style={{ width: '100%', textAlign: 'center', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', color: 'var(--text-subtle)', fontSize: '0.84rem' }}>
                Shared Folder: {shareData.resource.name}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Preview Modal for Public Shared File */}
      {previewFile && (
        <PreviewModal
          file={previewFile}
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={(id, name) => handleDownloadFile(id, name)}
        />
      )}
    </div>
  );
};
