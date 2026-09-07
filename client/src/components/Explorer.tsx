import React, { useState, useCallback } from 'react';
import { PdfThumbnail } from './PdfThumbnail';
import {
  Folder as FolderIcon,
  File as FileIcon,
  FileText,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  Video,
  Music,
  Star,
  Download,
  Trash2,
  Share2,
  Edit2,
  Grid,
  List,
  ChevronRight,
  Home,
  History,
  MoreVertical,
  Copy,
  CheckCircle,
  Filter,
  Eye,
} from 'lucide-react';
import { FileMetadata, Folder } from '../types/index.js';
import { ApiClient } from '../api/client.js';
import { ContextMenu, ContextMenuItem } from './ContextMenu.js';
import { VersionHistoryPanel } from './VersionHistoryPanel.js';
import { PreviewModal } from './PreviewModal.js';
import { useToast } from '../context/ToastContext.js';

interface ExplorerProps {
  files: FileMetadata[];
  folders: Folder[];
  breadcrumbs: Array<{ id: string | null; name: string }>;
  currentFolderId: string | null;
  onNavigateFolder: (folderId: string | null) => void;
  onRefresh: () => void;
  onOpenShareModal: (resourceId: string, resourceType: 'file' | 'folder') => void;
  starredOnly?: boolean;
}

type SortKey = 'name' | 'size' | 'date';
type FilterType = 'all' | 'images' | 'videos' | 'documents' | 'archives' | 'code';

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
};

const getFileIcon = (mimeType: string, size = 22) => {
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon size={size} color="#ec4899" />;
  if (m.startsWith('video/')) return <Video size={size} color="#f59e0b" />;
  if (m.startsWith('audio/')) return <Music size={size} color="#10b981" />;
  if (m.includes('json') || m.includes('javascript') || m.includes('typescript') || m.includes('html') || m.includes('css'))
    return <FileCode size={size} color="#3b82f6" />;
  if (m.includes('zip') || m.includes('tar') || m.includes('rar') || m.includes('7z') || m.includes('gzip'))
    return <FileArchive size={size} color="#f97316" />;
  if (m.includes('pdf') || m.includes('word') || m.includes('text') || m.includes('plain'))
    return <FileText size={size} color="#8b5cf6" />;
  return <FileIcon size={size} color="#6b7280" />;
};

const getFileColor = (mimeType: string): string => {
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return '#ec4899';
  if (m.startsWith('video/')) return '#f59e0b';
  if (m.startsWith('audio/')) return '#10b981';
  if (m.includes('json') || m.includes('javascript') || m.includes('typescript') || m.includes('html'))
    return '#3b82f6';
  if (m.includes('zip') || m.includes('tar') || m.includes('rar')) return '#f97316';
  if (m.includes('pdf') || m.includes('word') || m.includes('text')) return '#8b5cf6';
  return '#6b7280';
};

const matchesFilter = (file: FileMetadata, filter: FilterType): boolean => {
  if (filter === 'all') return true;
  const m = file.mimeType.toLowerCase();
  if (filter === 'images') return m.startsWith('image/');
  if (filter === 'videos') return m.startsWith('video/');
  if (filter === 'documents') return m.includes('pdf') || m.includes('text') || m.includes('word') || m.includes('plain');
  if (filter === 'archives') return m.includes('zip') || m.includes('tar') || m.includes('rar') || m.includes('7z');
  if (filter === 'code') return m.includes('json') || m.includes('javascript') || m.includes('typescript') || m.includes('html') || m.includes('css');
  return true;
};

export const Explorer: React.FC<ExplorerProps> = ({
  files,
  folders,
  breadcrumbs,
  currentFolderId,
  onNavigateFolder,
  onRefresh,
  onOpenShareModal,
  starredOnly = false,
}) => {
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [versionFile, setVersionFile] = useState<FileMetadata | null>(null);
  const [previewFile, setPreviewFile] = useState<FileMetadata | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    []
  );

  const handleToggleStarFile = async (fileId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await ApiClient.patch(`/api/v1/files/${fileId}/star`);
    onRefresh();
  };

  const handleToggleStarFolder = async (folderId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await ApiClient.patch(`/api/v1/folders/${folderId}/star`);
    onRefresh();
  };

  const handleSoftDelete = async (id: string, type: 'file' | 'folder', e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await ApiClient.post('/api/v1/trash/soft-delete', { resourceId: id, resourceType: type });
      showToast(`Moved to trash`, 'info');
      onRefresh();
    } catch (err: any) {
      showToast(err.message || 'Failed to trash item', 'error');
    }
  };

  const handleRenameSubmit = async (id: string, type: 'file' | 'folder') => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      if (type === 'file') {
        await ApiClient.patch(`/api/v1/files/${id}/rename`, { name: renameValue });
      } else {
        await ApiClient.patch(`/api/v1/folders/${id}/rename`, { name: renameValue });
      }
      showToast('Renamed successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Rename failed', 'error');
    }
    setRenamingId(null);
    onRefresh();
  };

  const handleDownload = (fileId: string, fileName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const token = localStorage.getItem('bytestore_access_token');
    fetch(`/api/v1/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Download started', 'success');
      })
      .catch((err: any) => {
        console.error('Download error:', err);
        showToast('Download failed: ' + (err.message || 'Error'), 'error');
      });
  };

  // Sort & Filter
  const filteredFiles = files
    .filter((f) => (starredOnly ? f.isStarred : true))
    .filter((f) => matchesFilter(f, filterType))
    .sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'size') return b.size - a.size;
      const dateA = new Date(a.createdAt || a.updatedAt).getTime();
      const dateB = new Date(b.createdAt || b.updatedAt).getTime();
      return dateB - dateA;
    });

  const filteredFolders = folders
    .filter((f) => (starredOnly ? f.isStarred : true))
    .sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      const dateA = new Date(a.createdAt || a.updatedAt).getTime();
      const dateB = new Date(b.createdAt || b.updatedAt).getTime();
      return dateB - dateA;
    });

  const buildFileContextMenu = (file: FileMetadata): ContextMenuItem[] => [
    {
      label: 'Preview File',
      icon: <Eye size={15} />,
      onClick: () => setPreviewFile(file),
    },
    {
      label: 'Download',
      icon: <Download size={15} />,
      onClick: () => handleDownload(file.id, file.name),
    },
    {
      label: file.isStarred ? 'Remove Star' : 'Star File',
      icon: <Star size={15} />,
      onClick: () => handleToggleStarFile(file.id),
    },
    {
      label: 'Share',
      icon: <Share2 size={15} />,
      onClick: () => onOpenShareModal(file.id, 'file'),
    },
    {
      label: 'Version History',
      icon: <History size={15} />,
      onClick: () => setVersionFile(file),
    },
    {
      label: 'Rename',
      icon: <Edit2 size={15} />,
      onClick: () => { setRenamingId(file.id); setRenameValue(file.name); },
      separator: true,
    },
    {
      label: 'Move to Trash',
      icon: <Trash2 size={15} />,
      onClick: () => handleSoftDelete(file.id, 'file'),
      danger: true,
    },
  ];

  const buildFolderContextMenu = (folder: Folder): ContextMenuItem[] => [
    {
      label: folder.isStarred ? 'Remove Star' : 'Star Folder',
      icon: <Star size={15} />,
      onClick: () => handleToggleStarFolder(folder.id),
    },
    {
      label: 'Share',
      icon: <Share2 size={15} />,
      onClick: () => onOpenShareModal(folder.id, 'folder'),
    },
    {
      label: 'Rename',
      icon: <Edit2 size={15} />,
      onClick: () => { setRenamingId(folder.id); setRenameValue(folder.name); },
      separator: true,
    },
    {
      label: 'Move to Trash',
      icon: <Trash2 size={15} />,
      onClick: () => handleSoftDelete(folder.id, 'folder'),
      danger: true,
    },
  ];

  const filterOptions: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'images', label: '🖼 Images' },
    { key: 'videos', label: '🎬 Videos' },
    { key: 'documents', label: '📄 Docs' },
    { key: 'archives', label: '🗜 Archives' },
    { key: 'code', label: '💻 Code' },
  ];

  const isEmpty = filteredFiles.length === 0 && filteredFolders.length === 0;

  return (
    <div className="view-area animate-fade-in">
      {/* Breadcrumbs */}
      <div className="breadcrumbs">
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.id ?? 'root'}>
            {idx > 0 && <ChevronRight size={14} className="breadcrumb-sep" />}
            <button
              className={`breadcrumb-item${idx === breadcrumbs.length - 1 ? ' current' : ''}`}
              onClick={() => onNavigateFolder(crumb.id)}
            >
              {crumb.id === null && <Home size={14} />}
              {crumb.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Filter & Sort Bar */}
      <div className="filter-bar">
        {filterOptions.map((f) => (
          <button
            key={f.key}
            className={`filter-chip${filterType === f.key ? ' active' : ''}`}
            onClick={() => setFilterType(f.key)}
          >
            {f.label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Sort */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            style={{
              padding: '5px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            <option value="date">Date</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>

          {/* View Toggle */}
          <div className="view-toggle">
            <button
              className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <Grid size={15} />
            </button>
            <button
              className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {isEmpty && filterType !== 'all' && (
        <div className="empty-state">
          <div className="empty-state-icon"><Filter size={28} /></div>
          <div className="empty-state-title">No matching files</div>
          <div className="empty-state-desc">
            Try changing the filter or upload files of this type.
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setFilterType('all')}>
            Clear Filter
          </button>
        </div>
      )}

      {isEmpty && filterType === 'all' && (
        <div className="empty-state">
          <div className="empty-state-icon"><FileIcon size={28} /></div>
          <div className="empty-state-title">
            {starredOnly ? 'No starred items' : 'This folder is empty'}
          </div>
          <div className="empty-state-desc">
            {starredOnly
              ? 'Star files and folders to find them here quickly.'
              : 'Upload files or create a new folder to get started.'}
          </div>
        </div>
      )}

      {/* Folders Section */}
      {filteredFolders.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div className="section-label">
            <FolderIcon size={14} color="var(--status-warning)" />
            Folders ({filteredFolders.length})
          </div>
          <div className={`file-grid${viewMode === 'list' ? ' list' : ''}`}>
            {filteredFolders.map((folder) => (
              <div
                key={folder.id}
                className={`file-card folder-card${viewMode === 'list' ? ' list-mode' : ''}`}
                onClick={() => onNavigateFolder(folder.id)}
                onContextMenu={(e) => handleContextMenu(e, buildFolderContextMenu(folder))}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '9px',
                    background: 'rgba(245,158,11,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FolderIcon size={20} color="#f59e0b" />
                </div>

                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {renamingId === folder.id ? (
                    <input
                      className="inline-rename"
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(folder.id, 'folder');
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => handleRenameSubmit(folder.id, 'folder')}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="file-name">{folder.name}</div>
                  )}
                  {viewMode === 'list' && (
                    <div className="file-meta">{formatDate(folder.updatedAt)}</div>
                  )}
                </div>

                {viewMode === 'list' && (
                  <div className="list-meta-row">
                    <span>{formatDate(folder.updatedAt)}</span>
                  </div>
                )}

                <div className="file-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`file-card-action-btn star${folder.isStarred ? ' starred' : ''}`}
                    onClick={(e) => handleToggleStarFolder(folder.id, e)}
                    title="Star"
                  >
                    <Star size={15} fill={folder.isStarred ? '#f59e0b' : 'none'} />
                  </button>
                  <button
                    className="file-card-action-btn"
                    onClick={(e) => { e.stopPropagation(); onOpenShareModal(folder.id, 'folder'); }}
                    title="Share"
                  >
                    <Share2 size={15} />
                  </button>
                  <button
                    className="file-card-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(folder.id);
                      setRenameValue(folder.name);
                    }}
                    title="Rename"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    className="file-card-action-btn danger"
                    onClick={(e) => { e.stopPropagation(); handleSoftDelete(folder.id, 'folder'); }}
                    title="Trash"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files Section */}
      {filteredFiles.length > 0 && (
        <div>
          <div className="section-label">
            <FileIcon size={14} />
            Files ({filteredFiles.length})
          </div>
          <div className={`file-grid${viewMode === 'list' ? ' list' : ''}`}>
            {filteredFiles.map((file) => {
              const color = getFileColor(file.mimeType);
              const token = localStorage.getItem('bytestore_access_token') || '';
              const thumbnailUrl = `/api/v1/files/${file.id}/thumbnail?token=${encodeURIComponent(token)}&v=${encodeURIComponent(file.updatedAt || file.id)}`;

              return (
                <div
                  key={file.id}
                  className={`file-card${viewMode === 'list' ? ' list-mode' : ''}`}
                  onDoubleClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                  onContextMenu={(e) => handleContextMenu(e, buildFileContextMenu(file))}
                >
                  {/* Grid Thumbnail Box */}
                  {viewMode === 'grid' && (
                    <div className="file-card-thumbnail">
                      {file.mimeType.includes('pdf') || /\.pdf$/i.test(file.name) ? (
                        <PdfThumbnail fileId={file.id} token={token} fallbackUrl={thumbnailUrl} />
                      ) : (
                        <>
                          <img
                            src={thumbnailUrl}
                            alt={file.name}
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                              const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                          <div className="file-card-thumbnail-fallback" style={{ display: 'none', background: `${color}15` }}>
                            <div className="file-card-thumbnail-icon" style={{ background: `${color}25` }}>
                              {getFileIcon(file.mimeType, 26)}
                            </div>
                            <span className="file-card-thumbnail-ext" style={{ color }}>
                              {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="file-card-body">
                    {/* Icon */}
                    <div
                      style={{
                        width: viewMode === 'grid' ? '28px' : '38px',
                        height: viewMode === 'grid' ? '28px' : '38px',
                        borderRadius: '8px',
                        background: `${color}18`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {getFileIcon(file.mimeType, viewMode === 'grid' ? 15 : 19)}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                      {renamingId === file.id ? (
                        <input
                          className="inline-rename"
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameSubmit(file.id, 'file');
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          onBlur={() => handleRenameSubmit(file.id, 'file')}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <div className="file-name">{file.name}</div>
                          <div className="file-meta">
                            {formatSize(file.size)}
                            {viewMode === 'list' && ` • ${file.mimeType.split('/').pop()?.toUpperCase()}`}
                          </div>
                        </>
                      )}
                    </div>

                    {/* List mode metadata */}
                    {viewMode === 'list' && (
                      <div className="list-meta-row">
                        {file.version > 1 && (
                          <span className="file-version-badge">v{file.version}</span>
                        )}
                        <span>{formatDate(file.updatedAt)}</span>
                      </div>
                    )}

                    {/* Grid mode version badge */}
                    {viewMode === 'grid' && file.version > 1 && renamingId !== file.id && (
                      <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10 }}>
                        <span className="file-version-badge">v{file.version}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="file-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="file-card-action-btn"
                        onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                        title="Preview"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        className={`file-card-action-btn star${file.isStarred ? ' starred' : ''}`}
                        onClick={(e) => handleToggleStarFile(file.id, e)}
                        title="Star"
                      >
                        <Star size={15} fill={file.isStarred ? '#f59e0b' : 'none'} />
                      </button>
                      <button
                        className="file-card-action-btn"
                        onClick={(e) => handleDownload(file.id, file.name, e)}
                        title="Download"
                      >
                        <Download size={15} />
                      </button>
                      <button
                        className="file-card-action-btn"
                        onClick={(e) => { e.stopPropagation(); onOpenShareModal(file.id, 'file'); }}
                        title="Share"
                      >
                        <Share2 size={15} />
                      </button>
                      <button
                        className="file-card-action-btn"
                        onClick={(e) => { e.stopPropagation(); setVersionFile(file); }}
                        title="Version History"
                      >
                        <History size={15} />
                      </button>
                      <button
                        className="file-card-action-btn danger"
                        onClick={(e) => handleSoftDelete(file.id, 'file', e)}
                        title="Trash"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Version History Panel */}
      <VersionHistoryPanel
        file={versionFile}
        onClose={() => setVersionFile(null)}
        onRestored={onRefresh}
      />

      {/* File Preview Modal */}
      <PreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={(id, name) => handleDownload(id, name)}
        onShare={(id) => onOpenShareModal(id, 'file')}
      />
    </div>
  );
};
