import React, { useState, useEffect } from 'react';
import { Cpu, Loader2, RefreshCw, Zap, Shield, Package, FileText, CheckSquare, Square, Filter, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { Job, FileMetadata } from '../types/index.js';

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
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [targetMode, setTargetMode] = useState<'all' | 'specific'>('all');
  const [fileSearch, setFileSearch] = useState('');
  const [showFileSelector, setShowFileSelector] = useState(false);
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

  const fetchFiles = async () => {
    try {
      const res = await ApiClient.get<{ success: boolean; files: FileMetadata[] }>('/api/v1/files');
      setFiles(res.files || []);
    } catch {
      setFiles([]);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchFiles();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const selectAllFiles = () => {
    const visibleIds = filteredFiles.map((f) => f.id);
    setSelectedFileIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const clearSelectedFiles = () => {
    setSelectedFileIds([]);
  };

  const handleEnqueueJob = async (type: string) => {
    setEnqueueing(type);
    try {
      const isSpecific = targetMode === 'specific' && selectedFileIds.length > 0;
      const payload = isSpecific
        ? {
            fileIds: selectedFileIds,
            fileId: selectedFileIds.length === 1 ? selectedFileIds[0] : undefined,
            itemCount: selectedFileIds.length,
            trigger: 'Manual Selected Files',
            timestamp: new Date().toISOString(),
          }
        : {
            target: 'all',
            trigger: 'Manual Dashboard',
            timestamp: new Date().toISOString(),
          };

      await ApiClient.post('/api/v1/jobs/enqueue', {
        type,
        payload,
      });
      fetchJobs();
    } catch {
      // silent
    } finally {
      setEnqueueing(null);
    }
  };

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(fileSearch.toLowerCase())
  );

  const activeCount = jobs.filter((j) => {
    const st = (j.status || '').toLowerCase();
    return st === 'processing' || st === 'pending' || st === 'queued';
  }).length;

  return (
    <div className="view-area animate-fade-in">
      <div className="page-header" style={{ marginBottom: '16px' }}>
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
            Event-driven background worker queue. Execute tasks globally or for specific files.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={fetchJobs} title="Refresh Queue">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Target File Selection Card */}
      <div className="glass-card" style={{ padding: '18px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>Target Scope:</span>
            <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.06)', padding: '3px', borderRadius: '8px' }}>
              <button
                className={`btn btn-xs ${targetMode === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTargetMode('all')}
                style={{ borderRadius: '6px' }}
              >
                All Files ({files.length})
              </button>
              <button
                className={`btn btn-xs ${targetMode === 'specific' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => {
                  setTargetMode('specific');
                  setShowFileSelector(true);
                }}
                style={{ borderRadius: '6px' }}
              >
                Select Files {selectedFileIds.length > 0 && `(${selectedFileIds.length})`}
              </button>
            </div>
          </div>

          {targetMode === 'specific' && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setShowFileSelector(!showFileSelector)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Filter size={13} />
              {showFileSelector ? 'Hide Selector' : 'Show File List'}
              {showFileSelector ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>

        {/* Action Enqueue Buttons */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: targetMode === 'specific' && showFileSelector ? '16px' : '0' }}>
          {['thumbnail_gen', 'integrity_check', 'trash_cleanup', 'zip_bundle'].map((type) => {
            const isSpecific = targetMode === 'specific' && selectedFileIds.length > 0;
            return (
              <button
                key={type}
                className="btn btn-primary btn-sm"
                onClick={() => handleEnqueueJob(type)}
                disabled={enqueueing === type || (targetMode === 'specific' && selectedFileIds.length === 0)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {getJobTypeIcon(type)}
                Run {type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                {isSpecific ? ` (${selectedFileIds.length})` : ' (All)'}
              </button>
            );
          })}
        </div>

        {/* Multi-Select File List Drawer */}
        {targetMode === 'specific' && showFileSelector && (
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '320px', background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <Search size={14} color="var(--text-subtle)" />
                <input
                  type="text"
                  placeholder="Search files..."
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '0.82rem', outline: 'none', width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn btn-ghost btn-xs" onClick={selectAllFiles}>Select All</button>
                <button className="btn btn-ghost btn-xs" onClick={clearSelectedFiles}>Clear ({selectedFileIds.length})</button>
              </div>
            </div>

            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '4px' }}>
              {filteredFiles.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', padding: '12px', textAlign: 'center' }}>
                  No matching files found.
                </div>
              ) : (
                filteredFiles.map((file) => {
                  const isChecked = selectedFileIds.includes(file.id);
                  const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE';

                  return (
                    <div
                      key={file.id}
                      onClick={() => toggleSelectFile(file.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: isChecked ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255,255,255,0.02)',
                        border: isChecked ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ color: isChecked ? '#38bdf8' : 'var(--text-subtle)', display: 'flex', alignItems: 'center' }}>
                        {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </span>
                        <span className="badge badge-ghost" style={{ fontSize: '0.65rem' }}>{ext}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                        {(file.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Jobs List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
          <Loader2 size={28} style={{ animation: 'spin 1.5s linear infinite', marginBottom: '12px' }} />
          <div>Loading background queue…</div>
        </div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Cpu size={28} /></div>
          <div className="empty-state-title">No jobs in queue</div>
          <div className="empty-state-desc">Select target files or click Run to trigger a background worker task.</div>
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

            const payloadCount = job.payload?.itemCount || (job.payload?.fileIds ? job.payload.fileIds.length : (job.payload?.fileId ? 1 : null));

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
                      {payloadCount && (
                        <span className="badge badge-ghost" style={{ fontSize: '0.7rem' }}>
                          Target: {payloadCount} {payloadCount === 1 ? 'file' : 'files'}
                        </span>
                      )}
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

                {/* Progress Bar */}
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
