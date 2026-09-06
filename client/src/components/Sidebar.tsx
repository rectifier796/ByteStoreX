import React from 'react';
import {
  HardDrive,
  FolderGit2,
  Trash2,
  Cpu,
  FileText,
  Share2,
  Shield,
  LogOut,
  PieChart,
  Star,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { QuotaInfo } from '../types/index.js';

export type ActiveTab = 'explorer' | 'starred' | 'shared' | 'trash' | 'jobs' | 'audit' | 'quota';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  quota: QuotaInfo | null;
  trashCount?: number;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  quota,
  trashCount = 0,
}) => {
  const { user, logout } = useAuth();

  const mainNav = [
    { id: 'explorer' as ActiveTab, label: 'My Files', icon: HardDrive },
    { id: 'starred' as ActiveTab, label: 'Starred', icon: Star },
  ];

  const sharingNav = [
    { id: 'shared' as ActiveTab, label: 'Shared Links', icon: Share2 },
  ];

  const systemNav = [
    { id: 'trash' as ActiveTab, label: 'Trash Bin', icon: Trash2, badge: trashCount > 0 ? trashCount : 0 },
    { id: 'jobs' as ActiveTab, label: 'Background Jobs', icon: Cpu },
    { id: 'audit' as ActiveTab, label: 'Audit Trail', icon: Shield },
    { id: 'quota' as ActiveTab, label: 'Storage', icon: PieChart },
  ];

  const usedPercent = quota
    ? Math.min(Math.round((quota.usedBytes / quota.totalQuotaBytes) * 100), 100)
    : 0;

  const NavItem = ({ item }: { item: typeof mainNav[0] & { badge?: number } }) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button className={`nav-btn${isActive ? ' active' : ''}`} onClick={() => setActiveTab(item.id)}>
        <Icon size={17} className="nav-icon" />
        <span>{item.label}</span>
        {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
      </button>
    );
  };

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <FolderGit2 size={22} color="#ffffff" />
        </div>
        <div className="sidebar-logo-text">
          <h2>ByteStoreX</h2>
          <span>Cloud Drive</span>
        </div>
      </div>

      {/* Main Nav */}
      <div className="sidebar-section-label">Storage</div>
      <nav className="sidebar-nav">
        {mainNav.map((item) => <NavItem key={item.id} item={item} />)}
      </nav>

      {/* Sharing Nav */}
      <div className="sidebar-section-label" style={{ marginTop: '12px' }}>Sharing</div>
      <nav className="sidebar-nav">
        {sharingNav.map((item) => <NavItem key={item.id} item={item} />)}
      </nav>

      {/* System Nav */}
      <div className="sidebar-section-label" style={{ marginTop: '12px' }}>System</div>
      <nav className="sidebar-nav">
        {systemNav.map((item) => <NavItem key={item.id} item={item as any} />)}
      </nav>

      <div className="sidebar-spacer" />

      {/* Storage Mini */}
      {quota && (
        <div className="storage-card">
          <div className="storage-card-header">
            <span className="storage-label">Storage</span>
            <span className="storage-pct">{usedPercent}%</span>
          </div>
          <div className="storage-track">
            <div
              className={`storage-fill${usedPercent > 85 ? ' danger' : ''}`}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
          <div className="storage-info">
            <span>{formatSize(quota.usedBytes)} used</span>
            <span>{formatSize(quota.totalQuotaBytes)}</span>
          </div>
        </div>
      )}

      {/* User */}
      {user && (
        <div className="user-footer">
          <div className="user-avatar">{(user.name || user.email || 'User').charAt(0).toUpperCase()}</div>
          <div className="user-info">
            <div className="user-name">{user.name || user.email || 'User'}</div>
            <div className="user-role">{user.role}</div>
          </div>
          <button className="logout-btn" onClick={logout} title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      )}
    </aside>
  );
};
