import React, { useRef, useState } from 'react';
import { Search, Upload, FolderPlus, X, SortAsc, Filter } from 'lucide-react';

interface NavbarProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenUpload: () => void;
  onOpenCreateFolder: () => void;
  currentFolderName?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  searchQuery,
  setSearchQuery,
  onOpenUpload,
  onOpenCreateFolder,
  currentFolderName,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="navbar">
      {/* Search */}
      <div className="search-wrap">
        <Search size={16} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search files, folders, tags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-subtle)',
              padding: '2px',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {currentFolderName && (
        <div
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-subtle)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ opacity: 0.5 }}>in</span>
          <span style={{ color: 'var(--text-muted)' }}>{currentFolderName}</span>
        </div>
      )}

      <div className="navbar-spacer" />

      <div className="navbar-actions">
        <button className="btn btn-ghost" onClick={onOpenCreateFolder} id="create-folder-btn">
          <FolderPlus size={16} />
          <span style={{ display: window.innerWidth > 900 ? 'inline' : 'none' }}>New Folder</span>
        </button>

        <button className="btn btn-primary" onClick={onOpenUpload} id="upload-btn">
          <Upload size={16} />
          Upload
        </button>
      </div>
    </header>
  );
};
