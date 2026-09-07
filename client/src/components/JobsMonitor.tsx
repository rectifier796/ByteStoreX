import React, { useState, useEffect } from 'react';
import { Cpu, Loader2, RefreshCw, Zap, Shield, Package, FileText } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { Job } from '../types/index.js';

const statusConfig: Record<string, { label: string; badgeClass: string }> = {
  completed: { label: 'Completed', badgeClass: 'badge-success' },
  processing: { label: 'Processing', badgeClass: 'badge-primary' },
  pending: { label: 'Pending', badgeClass: 'badge-warning' },
  queued: { label: 'Queued', badgeClass: 'badge-warning' },
  failed: { label: 'Failed', badgeClass: 'badge-danger' },
};

const getJobTypeIcon = (type: string) => {
  switch (type) {
    case 'zip_bundle':
    case 'compress_archive':
      return <Package size={16} color="#10b981" />;
    case 'virus_scan':
    case 'integrity_check':
      return <Shield size={16} color="#3b82f6" />;
    case 'trash_cleanup':
    case 'temp_cleanup':
      return <Zap size={16} color="#f59e0b" />;
    case 'thumbnail_gen':
    case 'generate_thumbnail':
      return <Cpu size={16} color="#d946ef" />;
    default:
      return <FileText size={16} color="var(--accent-primary)" />;
  }
};

export const JobsMonitor: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [enqueueing, setEnqueueing] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const res = await ApiClient.get<{ success: boolean; jobs: Job[] }>('/api/v1/jobs');
      setJobs(res.jobs || []);
    } catch (e) {
      console.error('Fetch jobs error:', e);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleEnqueueJob = async (type: string) => {
    setEnqueueing(type);
    try {
      await ApiClient.post('/api/v1/jobs/enqueue', {
        type,
        payload: { trigger: 'Manual Dashboard', timestamp: new Date().toISOString() },
      });
      fetchJobs();
    } catch {
      // silent
    } finally {
      setEnqueueing(null);
    }
  };

  const activeCount = jobs.filter((j) => {
    const st = (j.status || '').toLowerCase();
    return st === 'processing' || st === 'pending' || st === 'queued';
  }).length;

  return (
    <div className="view-area animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {activeCount > 0 ? (
              <Loader2 size={22} color="var(--accent-primary)" style={{ animation: 'spin 1.5s linear infinite' }} />
            ) : (
              <Cpu size={22} color="var(--accent-primary)" />
            )}
            Background Jobs
            {activeCount > 0 && (
              <span className="badge badge-primary" style={{ marginLeft: '6px' }}>{activeCount} active</span>
            )}
          </h1>
          <p className="page-subtitle">
            Event-driven background worker queue. Real-time status and task execution tracking.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {['thumbnail_gen', 'integrity_check', 'trash_cleanup', 'zip_bundle'].map((type) => (
            <button
              key={type}
              className="btn btn-ghost btn-sm"
              onClick={() => handleEnqueueJob(type)}
              disabled={enqueueing === type}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {getJobTypeIcon(type)}
              {type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={fetchJobs} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
          <Loader2 size={28} style={{ animation: 'spin 1.5s linear infinite', marginBottom: '12px' }} />
          <div>Loading jobs…</div>
        </div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Cpu size={28} /></div>
          <div className="empty-state-title">No jobs in queue</div>
          <div className="empty-state-desc">Click one of the buttons above to enqueue a background task.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {jobs.map((job) => {
            const rawStatus = (job.status || 'pending').toLowerCase();
            const cfg = statusConfig[rawStatus] || {
              label: rawStatus.toUpperCase(),
              badgeClass: 'badge-primary',
            };
            const isProcessing = rawStatus === 'processing';
            const isCompleted = rawStatus === 'completed';
            const isFailed = rawStatus === 'failed';

            return (
              <div key={job.id} className="glass-card" style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '9px',
                      background: 'rgba(255,255,255,0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {getJobTypeIcon(job.type)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {(job.type || 'Job').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                      <span className={`badge ${cfg.badgeClass}`}>
                        {isProcessing && (
                          <Loader2 size={10} style={{ animation: 'spin 1.5s linear infinite' }} />
                        )}
                        {cfg.label}
                        {isProcessing && ` ${job.progress || 0}%`}
                      </span>
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginTop: '2px' }}
                    >
                      {job.id}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', textAlign: 'right', flexShrink: 0 }}>
                    {job.createdAt ? new Date(job.createdAt).toLocaleTimeString() : ''}
                  </div>
                </div>

                {/* Progress */}
                <div
                  style={{
                    height: '5px',
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden',
                    marginBottom: '8px',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${isCompleted ? 100 : job.progress || 0}%`,
                      background:
                        isCompleted
                          ? 'var(--status-success)'
                          : isFailed
                          ? 'var(--status-danger)'
                          : 'var(--accent-gradient)',
                      borderRadius: 'var(--radius-full)',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>

                <div
                  className="mono"
                  style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>Req: {job.requestId || 'sys'}</span>
                  {job.error && <span style={{ color: '#fca5a5' }}>{job.error}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
