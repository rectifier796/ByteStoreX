import React, { useRef } from 'react';
import { Search, Upload, FolderPlus, X, LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

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
  const { user, logout } = useAuth();

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

        {user && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              paddingLeft: '12px',
              borderLeft: '1px solid var(--border-color)',
              marginLeft: '4px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px 4px 6px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div className="user-avatar" style={{ width: '28px', height: '28px', fontSize: '0.75rem' }}>
                {(user.name || user.email || 'U').charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {user.name || user.email}
              </span>
            </div>

            <button
              className="btn btn-danger btn-sm"
              onClick={logout}
              title="Sign Out"
              style={{ padding: '6px 12px' }}
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
