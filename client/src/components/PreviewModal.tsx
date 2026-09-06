import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Share2,
  FileText,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Video,
  Music,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Info,
  Calendar,
  HardDrive,
  Hash,
  Eye,
} from 'lucide-react';
import { FileMetadata } from '../types/index.js';
import { useToast } from '../context/ToastContext.js';

interface PreviewModalProps {
  file: FileMetadata | null;
  isOpen: boolean;
  onClose: () => void;
  onDownload: (fileId: string, fileName: string) => void;
  onShare?: (fileId: string) => void;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

export const PreviewModal: React.FC<PreviewModalProps> = ({
  file,
  isOpen,
  onClose,
  onDownload,
  onShare,
}) => {
  const { showToast } = useToast();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isOpen || !file) {
      setTextContent(null);
      setTextError(null);
      setZoom(1);
      setRotation(0);
      setIsFullscreen(false);
      return;
    }

    const mime = file.mimeType.toLowerCase();
    const isText =
      mime.startsWith('text/') ||
      mime.includes('json') ||
      mime.includes('javascript') ||
      mime.includes('typescript') ||
      mime.includes('html') ||
      mime.includes('css') ||
      mime.includes('xml') ||
      file.name.endsWith('.md') ||
      file.name.endsWith('.txt') ||
      file.name.endsWith('.env') ||
      file.name.endsWith('.yml') ||
      file.name.endsWith('.yaml');

    if (isText && file.size < 5 * 1024 * 1024) { // Only fetch if under 5MB
      setLoadingText(true);
      setTextError(null);
      const token = localStorage.getItem('bytestore_access_token');
      fetch(`/api/v1/files/${file.id}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load text content');
          return res.text();
        })
        .then((text) => {
          setTextContent(text);
          setLoadingText(false);
        })
        .catch((err) => {
          setTextError(err.message || 'Error loading text');
          setLoadingText(false);
        });
    }
  }, [isOpen, file]);

  if (!isOpen || !file) return null;

  const token = localStorage.getItem('bytestore_access_token') || '';
  const streamUrl = `/api/v1/files/${file.id}/stream?token=${encodeURIComponent(token)}`;

  const mime = file.mimeType.toLowerCase();
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  const isPdf = mime === 'application/pdf';
  const isText =
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('html') ||
    mime.includes('css') ||
    mime.includes('xml') ||
    file.name.endsWith('.md') ||
    file.name.endsWith('.txt') ||
    file.name.endsWith('.env') ||
    file.name.endsWith('.yml') ||
    file.name.endsWith('.yaml');

  const handleCopyText = () => {
    if (textContent !== null) {
      navigator.clipboard.writeText(textContent);
      setCopiedCode(true);
      showToast('Text copied to clipboard', 'success');
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const getHeaderIcon = () => {
    if (isImage) return <ImageIcon size={20} color="#ec4899" />;
    if (isVideo) return <Video size={20} color="#f59e0b" />;
    if (isAudio) return <Music size={20} color="#10b981" />;
    if (isText) return <FileCode size={20} color="#3b82f6" />;
    if (isPdf) return <FileText size={20} color="#8b5cf6" />;
    return <FileArchive size={20} color="#6b7280" />;
  };

  return (
    <div
      className="modal-overlay animate-fade-in"
      style={{
        zIndex: 1000,
        padding: isFullscreen ? 0 : '20px',
      }}
      onClick={onClose}
    >
      <div
        className="modal-box glass-panel"
        style={{
          width: isFullscreen ? '100vw' : '90vw',
          maxWidth: isFullscreen ? '100vw' : '1100px',
          height: isFullscreen ? '100vh' : '88vh',
          borderRadius: isFullscreen ? 0 : 'var(--radius-xl)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: 0,
          background: 'rgba(8, 11, 18, 0.95)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 22px',
            borderBottom: '1px solid var(--border-color)',
            background: 'rgba(14, 20, 34, 0.8)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {getHeaderIcon()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '0.98rem',
                  color: 'var(--text-main)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {file.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                <span>{formatSize(file.size)}</span>
                <span>•</span>
                <span style={{ textTransform: 'uppercase' }}>{file.mimeType}</span>
                {file.version > 1 && (
                  <>
                    <span>•</span>
                    <span className="file-version-badge">v{file.version}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {isImage && (
              <>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  title="Zoom Out"
                >
                  <ZoomOut size={16} />
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', minWidth: '40px', textAlign: 'center' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                  title="Zoom In"
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  title="Rotate"
                >
                  <RotateCw size={16} />
                </button>
              </>
            )}

            {isText && textContent !== null && (
              <button
                className={`btn btn-sm ${copiedCode ? 'btn-success' : 'btn-ghost'}`}
                onClick={handleCopyText}
                title="Copy Text"
              >
                {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                {copiedCode ? 'Copied' : 'Copy'}
              </button>
            )}

            {onShare && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => onShare(file.id)}
                title="Share File"
              >
                <Share2 size={16} />
              </button>
            )}

            <button
              className="btn btn-primary btn-sm"
              onClick={() => onDownload(file.id, file.name)}
              title="Download File"
            >
              <Download size={15} />
              <span>Download</span>
            </button>

            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setIsFullscreen((f) => !f)}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={onClose}
              title="Close Preview"
              style={{ color: '#fca5a5' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: isImage ? '24px' : '0',
            position: 'relative',
            background: 'rgba(4, 6, 12, 0.6)',
          }}
        >
          {/* Image Preview */}
          {isImage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                overflow: 'auto',
              }}
            >
              <img
                src={streamUrl}
                alt={file.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                }}
              />
            </div>
          )}

          {/* Video Preview */}
          {isVideo && (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
              <video
                src={streamUrl}
                controls
                autoPlay={false}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-lg)',
                  outline: 'none',
                }}
              />
            </div>
          )}

          {/* Audio Preview */}
          {isAudio && (
            <div
              className="glass-card"
              style={{
                padding: '40px 48px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '24px',
                borderRadius: 'var(--radius-xl)',
                maxWidth: '460px',
                width: '90%',
                textAlign: 'center',
                boxShadow: 'var(--shadow-main)',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10b981',
                  boxShadow: '0 0 30px rgba(16, 185, 129, 0.2)',
                }}
              >
                <Music size={40} />
              </div>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                  {file.name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                  Audio Track • {formatSize(file.size)}
                </div>
              </div>
              <audio
                src={streamUrl}
                controls
                style={{ width: '100%', outline: 'none' }}
              />
            </div>
          )}

          {/* PDF Preview */}
          {isPdf && (
            <iframe
              src={streamUrl}
              title={file.name}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
              }}
            />
          )}

          {/* Text / Code Preview */}
          {isText && (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: '#070a10',
              }}
            >
              {loadingText ? (
                <div style={{ margin: 'auto', color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
                  Loading code content…
                </div>
              ) : textError ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: '#fca5a5' }}>
                  <Info size={28} style={{ marginBottom: '8px' }} />
                  <div>{textError}</div>
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: '20px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.84rem',
                    lineHeight: '1.6',
                    color: '#e2e8f0',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <code>{textContent}</code>
                </div>
              )}
            </div>
          )}

          {/* Fallback Details View for Unsupported Binary Files */}
          {!isImage && !isVideo && !isAudio && !isPdf && !isText && (
            <div
              className="glass-card"
              style={{
                padding: '40px',
                maxWidth: '520px',
                width: '90%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '20px',
                textAlign: 'center',
                borderRadius: 'var(--radius-xl)',
              }}
            >
              <div
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: 'var(--radius-xl)',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {getHeaderIcon()}
              </div>

              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px' }}>
                  {file.name}
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-subtle)' }}>
                  Preview is not available for this file format ({file.mimeType}).
                </p>
              </div>

              {/* Detail Table */}
              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: 'rgba(255,255,255,0.02)',
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  textAlign: 'left',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-subtle)' }}>File Size:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{formatSize(file.size)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-subtle)' }}>MIME Type:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{file.mimeType}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-subtle)' }}>Version:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>v{file.version}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-subtle)' }}>Last Modified:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{formatDate(file.updatedAt)}</span>
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => onDownload(file.id, file.name)}
                style={{ width: '100%', padding: '12px', justifyContent: 'center' }}
              >
                <Download size={16} />
                <span>Download File</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
