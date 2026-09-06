import React, { useState, useEffect } from 'react';
import { Share2, X, Copy, Check, Lock, Clock, Eye, Edit, Trash2, ExternalLink, Globe, Users } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { ShareLink } from '../types/index.js';
import { useToast } from '../context/ToastContext.js';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  resourceId: string | null;
  resourceType: 'file' | 'folder' | null;
}

const formatDate = (d: string) => new Date(d).toLocaleString();

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  resourceId,
  resourceType,
}) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'create' | 'existing'>('create');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [password, setPassword] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [createdLink, setCreatedLink] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [existingLinks, setExistingLinks] = useState<ShareLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isOpen || !resourceId) return;
    if (tab === 'existing') {
      setLoadingLinks(true);
      ApiClient.get<{ success: boolean; shareLinks: ShareLink[] }>(
        `/api/v1/sharing/resource/${resourceId}`
      )
        .then((res) => setExistingLinks(res.shareLinks || []))
        .catch(() => setExistingLinks([]))
        .finally(() => setLoadingLinks(false));
    }
  }, [isOpen, resourceId, tab]);

  if (!isOpen || !resourceId || !resourceType) return null;

  const handleCreateShareLink = async () => {
    setCreating(true);
    try {
      const res = await ApiClient.post<{ success: boolean; shareLink: ShareLink }>('/api/v1/sharing', {
        resourceId,
        resourceType,
        permission,
        password: password.trim() || undefined,
        expiresInHours,
      });
      setCreatedLink(res.shareLink);
      showToast('Share link created', 'success');
    } catch (err: any) {
      showToast(err.message || 'Share link generation failed', 'error');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/api/v1/sharing/public/${token}`);
    setCopied(true);
    showToast('Link copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (linkId: string) => {
    try {
      await ApiClient.delete(`/api/v1/sharing/${linkId}`);
      setExistingLinks((prev) => prev.filter((l) => l.id !== linkId));
      showToast('Link revoked', 'info');
    } catch (err: any) {
      showToast(err.message || 'Revoke failed', 'error');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box animate-fade-in"
        style={{ maxWidth: '500px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">
            <Share2 size={20} color="var(--accent-primary)" />
            Share {resourceType === 'file' ? 'File' : 'Folder'}
          </h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="tab-bar">
          <button
            className={`tab-btn${tab === 'create' ? ' active' : ''}`}
            onClick={() => { setTab('create'); setCreatedLink(null); }}
          >
            <Globe size={14} style={{ display: 'inline', marginRight: '6px' }} />
            Create Link
          </button>
          <button
            className={`tab-btn${tab === 'existing' ? ' active' : ''}`}
            onClick={() => setTab('existing')}
          >
            <Users size={14} style={{ display: 'inline', marginRight: '6px' }} />
            Active Links
          </button>
        </div>

        {tab === 'create' && (
          <>
            {createdLink ? (
              <div>
                <div
                  className="badge badge-success"
                  style={{ width: '100%', padding: '11px 14px', marginBottom: '18px', fontSize: '0.84rem', borderRadius: 'var(--radius-md)' }}
                >
                  <Check size={16} /> Share link is live and ready
                </div>

                <div className="copy-link-row" style={{ marginBottom: '14px' }}>
                  <input
                    className="copy-link-url"
                    type="text"
                    readOnly
                    value={`${window.location.origin}/api/v1/sharing/public/${createdLink.token}`}
                  />
                  <button
                    className={`btn btn-sm${copied ? ' btn-success' : ' btn-primary'}`}
                    onClick={() => copyLink(createdLink.token)}
                    style={{ flexShrink: 0 }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                    fontSize: '0.78rem',
                    color: 'var(--text-subtle)',
                    marginBottom: '18px',
                    padding: '12px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 700, marginBottom: '3px' }}>Permission</div>
                    <div>{createdLink.permission === 'view' ? '👁 View only' : '✏️ Edit access'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 700, marginBottom: '3px' }}>Expires</div>
                    <div>{createdLink.expiresAt ? formatDate(createdLink.expiresAt) : 'Never'}</div>
                  </div>
                </div>

                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setCreatedLink(null)}>
                  Create Another Link
                </button>
              </div>
            ) : (
              <div>
                <div className="form-group">
                  <label className="form-label">Permission Level</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {(['view', 'edit'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPermission(p)}
                        style={{
                          flex: 1,
                          padding: '10px',
                          borderRadius: 'var(--radius-md)',
                          border: `1px solid ${permission === p ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: permission === p ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                          color: permission === p ? '#a5b4fc' : 'var(--text-muted)',
                          fontWeight: 600,
                          fontSize: '0.84rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '7px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {p === 'view' ? <Eye size={15} /> : <Edit size={15} />}
                        {p === 'view' ? 'View Only' : 'Can Edit'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <Lock size={12} style={{ display: 'inline', marginRight: '5px' }} />
                    Password Protection (optional)
                  </label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Leave empty for no password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <Clock size={12} style={{ display: 'inline', marginRight: '5px' }} />
                    Expiration
                  </label>
                  <select
                    className="form-select"
                    value={expiresInHours}
                    onChange={(e) => setExpiresInHours(parseInt(e.target.value, 10))}
                  >
                    <option value={1}>1 Hour</option>
                    <option value={24}>24 Hours</option>
                    <option value={72}>3 Days</option>
                    <option value={168}>7 Days</option>
                    <option value={720}>30 Days</option>
                  </select>
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px', justifyContent: 'center' }}
                  onClick={handleCreateShareLink}
                  disabled={creating}
                >
                  <Share2 size={16} />
                  {creating ? 'Generating…' : 'Generate Share Link'}
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'existing' && (
          <div>
            {loadingLinks ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-subtle)', fontSize: '0.84rem' }}>
                Loading links…
              </div>
            ) : existingLinks.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon"><Share2 size={24} /></div>
                <div className="empty-state-title">No active share links</div>
                <div className="empty-state-desc">Create a link to share this resource.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {existingLinks.map((link) => (
                  <div key={link.id} className="share-row">
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span
                          className={`badge ${link.permission === 'view' ? 'badge-info' : 'badge-warning'}`}
                        >
                          {link.permission === 'view' ? <Eye size={10} /> : <Edit size={10} />}
                          {link.permission}
                        </span>
                        {link.isRevoked && <span className="badge badge-danger">Revoked</span>}
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                          {link.accessCount} access{link.accessCount !== 1 ? 'es' : ''}
                        </span>
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        /api/v1/sharing/public/{link.token.substring(0, 20)}…
                      </div>
                      {link.expiresAt && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', marginTop: '3px' }}>
                          Expires: {formatDate(link.expiresAt)}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      {!link.isRevoked && (
                        <>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => copyLink(link.token)}
                            title="Copy link"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            className="btn btn-danger btn-icon btn-sm"
                            onClick={() => handleRevoke(link.id)}
                            title="Revoke"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
