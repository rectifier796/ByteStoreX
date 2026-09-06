import React, { useState, useEffect, useCallback } from 'react';
import {
  Upload, X, CheckCircle, AlertCircle, File, Play, Pause, RotateCcw, XCircle, CloudUpload, Zap
} from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { BoundedChunkUploader, UploaderStatus } from '../utils/chunkUploader.js';
import { useToast } from '../context/ToastContext.js';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFolderId: string | null;
  onUploadSuccess: () => void;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatSpeed = (bytesPerSec: number) => {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
};

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  currentFolderId,
  onUploadSuccess,
}) => {
  const { showToast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<'direct' | 'chunked'>('chunked');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [uploader, setUploader] = useState<BoundedChunkUploader | null>(null);
  const [status, setStatus] = useState<UploaderStatus>('idle');
  const [progressBytes, setProgressBytes] = useState(0);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const lastProgressRef = React.useRef<{ bytes: number; time: number } | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setSelectedFile(null);
    setUploader(null);
    setStatus('idle');
    setProgressBytes(0);
    setProgressPercentage(0);
    setErrorMsg(null);
    setUploadSpeed(0);
    lastProgressRef.current = null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      resetState();
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (status === 'uploading') return;
    const f = e.dataTransfer.files?.[0];
    if (f) { resetState(); setSelectedFile(f); }
  };

  const handleStartUpload = async () => {
    if (!selectedFile) return;
    setErrorMsg(null);

    if (uploadMode === 'direct') {
      setStatus('uploading');
      try {
        await ApiClient.uploadFile('/api/v1/uploads/direct', selectedFile, currentFolderId);
        setStatus('completed');
        setProgressPercentage(100);
        showToast(`${selectedFile.name} uploaded successfully`, 'success');
        setTimeout(() => { onUploadSuccess(); onClose(); resetState(); }, 900);
      } catch (err: any) {
        setStatus('failed');
        setErrorMsg(err.message || 'Direct upload failed');
        showToast('Upload failed', 'error');
      }
      return;
    }

    try {
      const chunkSize = 1024 * 1024;
      const initRes = await ApiClient.post<{ success: boolean; session: any }>('/api/v1/uploads/sessions', {
        fileName: selectedFile.name,
        mimeType: selectedFile.type || 'application/octet-stream',
        totalSize: selectedFile.size,
        chunkSize,
        folderId: currentFolderId,
      });

      const session = initRes.session;
      const stored = JSON.parse(localStorage.getItem('bytestore_active_uploads') || '[]');
      stored.push({ sessionId: session.id, fileName: selectedFile.name, totalSize: selectedFile.size });
      localStorage.setItem('bytestore_active_uploads', JSON.stringify(stored));

      const instance = new BoundedChunkUploader({
        file: selectedFile,
        sessionId: session.id,
        chunkSize: session.chunkSize,
        totalChunks: session.totalChunks,
        concurrency: 3,
        maxRetries: 3,
        onProgress: (uploadedBytes, _total, pct) => {
          const now = Date.now();
          if (lastProgressRef.current) {
            const dt = (now - lastProgressRef.current.time) / 1000;
            const db = uploadedBytes - lastProgressRef.current.bytes;
            if (dt > 0) setUploadSpeed(db / dt);
          }
          lastProgressRef.current = { bytes: uploadedBytes, time: now };
          setProgressBytes(uploadedBytes);
          setProgressPercentage(pct);
        },
        onStateChange: (newStatus) => setStatus(newStatus),
        onError: (err) => { setErrorMsg(err.message || 'Chunk upload failed'); },
        onComplete: () => {
          const list = JSON.parse(localStorage.getItem('bytestore_active_uploads') || '[]');
          localStorage.setItem('bytestore_active_uploads', JSON.stringify(list.filter((s: any) => s.sessionId !== session.id)));
          showToast(`${selectedFile.name} uploaded successfully`, 'success');
          setTimeout(() => { onUploadSuccess(); onClose(); resetState(); }, 900);
        },
      });

      setUploader(instance);
      await instance.start();
    } catch (err: any) {
      setStatus('failed');
      setErrorMsg(err.message || 'Upload initialization failed');
    }
  };

  const statusColor: Record<UploaderStatus, string> = {
    idle: 'var(--accent-primary)',
    uploading: 'var(--accent-primary)',
    paused: 'var(--status-warning)',
    completed: 'var(--status-success)',
    failed: 'var(--status-danger)',
    cancelled: 'var(--text-subtle)',
  };

  const statusLabel: Partial<Record<UploaderStatus, string>> = {
    uploading: 'Uploading…',
    paused: 'Paused',
    completed: '✓ Complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box animate-fade-in" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            <CloudUpload size={20} color="var(--accent-primary)" />
            Upload File
          </h3>
          <button className="modal-close" onClick={onClose} disabled={status === 'uploading'}>
            <X size={18} />
          </button>
        </div>

        {/* Mode Toggle */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '3px',
            marginBottom: '18px',
            gap: '3px',
          }}
        >
          {(['chunked', 'direct'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setUploadMode(mode)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: uploadMode === mode ? 'var(--accent-gradient)' : 'transparent',
                color: uploadMode === mode ? '#fff' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              {mode === 'chunked' ? (
                <><Zap size={13} /> Chunked (3× concurrency)</>
              ) : (
                <><Upload size={13} /> Direct Stream</>
              )}
            </button>
          ))}
        </div>

        {/* Drop Zone */}
        <div
          className={`drop-zone${isDragOver ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => status !== 'uploading' && document.getElementById('upload-file-input')?.click()}
          style={{ cursor: status === 'uploading' ? 'default' : 'pointer', marginBottom: '16px' }}
        >
          <input
            id="upload-file-input"
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={status === 'uploading'}
          />
          {selectedFile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(99,102,241,0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <File size={24} color="var(--accent-primary)" />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {selectedFile.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '3px' }}>
                  {formatSize(selectedFile.size)} • {selectedFile.type || 'application/octet-stream'}
                </div>
              </div>
              {status === 'idle' && (
                <button
                  onClick={(e) => { e.stopPropagation(); resetState(); }}
                  style={{ marginLeft: 'auto', color: 'var(--text-subtle)', padding: '4px' }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <CloudUpload size={38} color="var(--accent-primary)" style={{ opacity: 0.7 }} />
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  Drop a file here, or click to browse
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                  SHA-256 checksums • Zero whole-file buffering • Resumable
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {errorMsg && (
          <div
            className="badge badge-danger"
            style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: '14px', fontSize: '0.82rem' }}
          >
            <AlertCircle size={15} />
            <span style={{ flex: 1 }}>{errorMsg}</span>
          </div>
        )}

        {/* Progress */}
        {status !== 'idle' && (
          <div className="upload-item" style={{ marginBottom: '16px' }}>
            <div className="upload-item-header">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: statusColor[status] }}>
                  {statusLabel[status] || status}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {status === 'uploading' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => uploader?.pause()}
                    style={{ color: '#fcd34d', borderColor: 'rgba(245,158,11,0.3)' }}
                  >
                    <Pause size={13} /> Pause
                  </button>
                )}
                {(status === 'paused' || status === 'failed') && (
                  <button
                    className="btn btn-success btn-sm"
                    onClick={() => uploader?.resume()}
                  >
                    <Play size={13} /> Resume
                  </button>
                )}
                {status !== 'completed' && status !== 'cancelled' && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => { uploader?.cancel(); resetState(); }}
                  >
                    <XCircle size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="upload-progress-track">
              <div
                className={`upload-progress-fill${status === 'completed' ? ' complete' : status === 'failed' ? ' error' : ''}`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>

            <div className="upload-item-meta">
              <span>
                {selectedFile ? `${formatSize(progressBytes)} / ${formatSize(selectedFile.size)}` : ''}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {status === 'uploading' && uploadSpeed > 0 && (
                  <span style={{ color: 'var(--text-accent)' }}>{formatSpeed(uploadSpeed)}</span>
                )}
                <span style={{ fontWeight: 700 }}>{progressPercentage}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            className="btn btn-ghost"
            onClick={() => { onClose(); resetState(); }}
            disabled={status === 'uploading'}
          >
            {status === 'completed' ? 'Done' : 'Cancel'}
          </button>
          {status === 'idle' && (
            <button
              className="btn btn-primary"
              onClick={handleStartUpload}
              disabled={!selectedFile}
            >
              <Upload size={15} />
              Start Upload
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
