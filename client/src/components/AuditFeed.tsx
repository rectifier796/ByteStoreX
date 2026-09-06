import React, { useState, useEffect } from 'react';
import { Shield, RefreshCw, Filter } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { AuditLog } from '../types/index.js';

const categoryColors: Record<string, string> = {
  auth: 'badge-info',
  file: 'badge-primary',
  folder: 'badge-warning',
  share: 'badge-success',
  trash: 'badge-danger',
  quota: 'badge-warning',
  job: 'badge-primary',
};

export const AuditFeed: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const url = filterCategory ? `/api/v1/audit?category=${filterCategory}` : '/api/v1/audit';
      const res = await ApiClient.get<{ success: boolean; logs: AuditLog[] }>(url);
      setLogs(res.logs || []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [filterCategory]);

  return (
    <div className="view-area animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Shield size={22} color="var(--accent-primary)" />
            Audit Trail
          </h1>
          <p className="page-subtitle">
            Structured activity logs correlated by X-Request-ID across all operations.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <select
            className="form-select"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{ width: 'auto', padding: '8px 12px', fontSize: '0.84rem' }}
          >
            <option value="">All Categories</option>
            <option value="auth">Auth</option>
            <option value="file">File</option>
            <option value="folder">Folder</option>
            <option value="share">Share</option>
            <option value="trash">Trash</option>
            <option value="quota">Quota</option>
            <option value="job">Job</option>
          </select>
          <button className="btn btn-ghost btn-icon" onClick={fetchLogs} title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
          Loading audit logs…
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Shield size={28} /></div>
          <div className="empty-state-title">No audit logs</div>
          <div className="empty-state-desc">Events will appear here as you use the system.</div>
        </div>
      ) : (
        <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Category</th>
                  <th>Request ID</th>
                  <th>Actor</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.84rem' }}>
                      {log.action}
                    </td>
                    <td>
                      <span className={`badge ${categoryColors[log.category] || 'badge-primary'}`}>
                        {log.category}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: '0.72rem', color: 'var(--accent-primary)' }}>
                      {log.requestId}
                    </td>
                    <td className="mono" style={{ fontSize: '0.72rem' }}>
                      {log.actorEmail || log.actorId.substring(0, 12) + '…'}
                    </td>
                    <td className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                      {log.ip}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
