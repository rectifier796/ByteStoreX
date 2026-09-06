import React, { useState, useEffect } from 'react';
import { Share2, Copy, Trash2, Eye, Edit, Clock, ExternalLink, Globe, Check, Shield } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { ShareLink } from '../types/index.js';
import { useToast } from '../context/ToastContext.js';

const formatDate = (d?: string) => (d ? new Date(d).toLocaleString() : '—');

export const SharedLinksView: React.FC = () => {
  const { showToast } = useToast();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked'>('all');

  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await ApiClient.get<{ success: boolean; shareLinks: ShareLink[] }>('/api/v1/sharing/my-links');
      setLinks(res.shareLinks || []);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLinks(); }, []);

  const copyLink = (link: ShareLink) => {
    navigator.clipboard.writeText(`${window.location.origin}/api/v1/sharing/public/${link.token}`);
    setCopiedId(link.id);
    showToast('Copied to clipboard', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const revokeLink = async (linkId: string) => {
    try {
      await ApiClient.delete(`/api/v1/sharing/${linkId}`);
      showToast('Link revoked', 'info');
      fetchLinks();
    } catch (err: any) {
      showToast(err.message || 'Revoke failed', 'error');
    }
  };

  const isExpired = (link: ShareLink) =>
    !!link.expiresAt && new Date(link.expiresAt) < new Date();

  const getLinkStatus = (link: ShareLink): 'active' | 'expired' | 'revoked' => {
    if (link.isRevoked) return 'revoked';
    if (isExpired(link)) return 'expired';
    return 'active';
  };

  const filteredLinks = links.filter((l) => {
    if (filter === 'all') return true;
    return getLinkStatus(l) === filter;
  });

  const stats = {
    total: links.length,
    active: links.filter((l) => getLinkStatus(l) === 'active').length,
    expired: links.filter((l) => getLinkStatus(l) === 'expired').length,
    revoked: links.filter((l) => getLinkStatus(l) === 'revoked').length,
    totalAccesses: links.reduce((s, l) => s + (l.accessCount || 0), 0),
  };

  const statusBadge = (link: ShareLink) => {
    const s = getLinkStatus(link);
    if (s === 'active') return <span className="badge badge-success">Active</span>;
    if (s === 'expired') return <span className="badge badge-warning">Expired</span>;
    return <span className="badge badge-danger">Revoked</span>;
  };

  return (
    <div className="view-area animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Globe size={22} color="var(--accent-primary)" />
            Shared Links
          </h1>
          <p className="page-subtitle">
            Manage public access links you've created for files and folders.
          </p>
        </div>
      </div>

      {/* Stats Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '12px',
          marginBottom: '24px',
        }}
      >
        {[
          { label: 'Total Links', value: stats.total, color: 'var(--accent-primary)' },
          { label: 'Active', value: stats.active, color: 'var(--status-success)' },
          { label: 'Expired', value: stats.expired, color: 'var(--status-warning)' },
          { label: 'Revoked', value: stats.revoked, color: 'var(--status-danger)' },
          { label: 'Total Opens', value: stats.totalAccesses, color: 'var(--status-info)' },
        ].map((s) => (
          <div
            key={s.label}
            className="glass-card"
            style={{ padding: '14px 16px', textAlign: 'center' }}
          >
            <div
              style={{
                fontSize: '1.6rem',
                fontWeight: 800,
                color: s.color,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', fontWeight: 600, marginTop: '3px' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="filter-bar" style={{ marginBottom: '16px' }}>
        {(['all', 'active', 'expired', 'revoked'] as const).map((f) => (
          <button
            key={f}
            className={`filter-chip${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Links Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
          Loading shared links…
        </div>
      ) : filteredLinks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Share2 size={28} /></div>
          <div className="empty-state-title">No share links found</div>
          <div className="empty-state-desc">
            Create share links by right-clicking files or using the Share button in the file explorer.
          </div>
        </div>
      ) : (
        <div
          className="glass-panel"
          style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Permission</th>
                  <th>Status</th>
                  <th>Accesses</th>
                  <th>Expires</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredLinks.map((link) => {
                  const active = getLinkStatus(link) === 'active';
                  return (
                    <tr key={link.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {link.resourceType === 'file' ? (
                            <Share2 size={14} color="var(--text-subtle)" />
                          ) : (
                            <Globe size={14} color="var(--text-subtle)" />
                          )}
                          <div>
                            <div
                              className="mono"
                              style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}
                            >
                              {link.token.substring(0, 14)}…
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', textTransform: 'capitalize' }}>
                              {link.resourceType}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${link.permission === 'view' ? 'badge-info' : 'badge-warning'}`}>
                          {link.permission === 'view' ? <Eye size={10} /> : <Edit size={10} />}
                          {link.permission}
                        </span>
                      </td>
                      <td>{statusBadge(link)}</td>
                      <td>
                        <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                          {link.accessCount}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>
                        {link.expiresAt ? formatDate(link.expiresAt) : <span style={{ color: 'var(--text-subtle)' }}>Never</span>}
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>{formatDate(link.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          {active && (
                            <>
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => copyLink(link)}
                                title="Copy link"
                              >
                                {copiedId === link.id ? <Check size={14} color="var(--status-success)" /> : <Copy size={14} />}
                              </button>
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => window.open(`/api/v1/sharing/public/${link.token}`, '_blank')}
                                title="Open link"
                              >
                                <ExternalLink size={14} />
                              </button>
                              <button
                                className="btn btn-danger btn-icon btn-sm"
                                onClick={() => revokeLink(link.id)}
                                title="Revoke"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
