import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { ToastProvider } from './context/ToastContext.js';
import { Sidebar, ActiveTab } from './components/Sidebar.js';
import { Navbar } from './components/Navbar.js';
import { Explorer } from './components/Explorer.js';
import { UploadModal } from './components/UploadModal.js';
import { ShareModal } from './components/ShareModal.js';
import { SharedLinksView } from './components/SharedLinksView.js';
import { TrashView } from './components/TrashView.js';
import { JobsMonitor } from './components/JobsMonitor.js';
import { AuditFeed } from './components/AuditFeed.js';
import { QuotaWidget } from './components/QuotaWidget.js';
import { AuthModal } from './components/AuthModal.js';
import { CreateFolderModal } from './components/CreateFolderModal.js';
import { PublicSharePortal } from './components/PublicSharePortal.js';
import { ApiClient } from './api/client.js';
import { FileMetadata, Folder, QuotaInfo } from './types/index.js';
import { FolderGit2 } from 'lucide-react';

const MainWorkspace: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('explorer');

  // Check public share token in URL path (/share/:token or /public/:token)
  const path = window.location.pathname;
  const match = path.match(/^\/(share|public)\/([^\/]+)/);
  const shareToken = match ? match[2] : null;

  if (shareToken) {
    return <PublicSharePortal token={shareToken} />;
  }

  // File / Folder State
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string | null; name: string }>>([
    { id: null, name: 'Home' },
  ]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  // Misc state
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [trashCount, setTrashCount] = useState(0);

  // Modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [shareModalState, setShareModalState] = useState<{
    isOpen: boolean;
    resourceId: string | null;
    resourceType: 'file' | 'folder' | null;
  }>({ isOpen: false, resourceId: null, resourceType: null });

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      if (searchQuery.trim()) {
        const res = await ApiClient.get<{ success: boolean; files: FileMetadata[]; folders: Folder[] }>(
          `/api/v1/search?q=${encodeURIComponent(searchQuery)}`
        );
        setFiles(res.files || []);
        setFolders(res.folders || []);
        setBreadcrumbs([{ id: null, name: 'Home' }, { id: null, name: `Search: "${searchQuery}"` }]);
      } else {
        const folderUrl = currentFolderId ? `/api/v1/folders?parentId=${currentFolderId}` : '/api/v1/folders';
        const fileUrl = currentFolderId ? `/api/v1/files?folderId=${currentFolderId}` : '/api/v1/files?all=true';

        const [foldersRes, filesRes] = await Promise.all([
          ApiClient.get<{ success: boolean; folders: Folder[]; breadcrumbs: Array<{ id: string | null; name: string }> }>(
            folderUrl
          ),
          ApiClient.get<{ success: boolean; files: FileMetadata[] }>(fileUrl),
        ]);

        setFolders(foldersRes.folders || []);
        setBreadcrumbs(foldersRes.breadcrumbs || [{ id: null, name: 'Home' }]);
        setFiles(filesRes.files || []);
      }

      // Quota (non-blocking)
      ApiClient.get<{ success: boolean; quota: QuotaInfo }>('/api/v1/quota/usage')
        .then((res) => setQuota(res.quota))
        .catch(() => {});

      // Trash count (non-blocking)
      ApiClient.get<{ success: boolean; files: FileMetadata[]; folders: Folder[] }>('/api/v1/trash')
        .then((res) => setTrashCount((res.files?.length || 0) + (res.folders?.length || 0)))
        .catch(() => {});
    } catch (err) {
      console.error('Fetch error', err);
    }
  }, [isAuthenticated, currentFolderId, searchQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleNavigateFolder = (id: string | null) => {
    setCurrentFolderId(id);
    setSearchQuery('');
  };

  const handleCreateFolder = async (name: string) => {
    await ApiClient.post('/api/v1/folders', { name, parentId: currentFolderId });
    fetchData();
  };

  const currentFolderName =
    breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 1].name : undefined;

  if (isLoading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          gap: '16px',
        }}
      >
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '14px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--accent-glow)',
          }}
        >
          <FolderGit2 size={28} color="#fff" />
        </div>
        <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.95rem' }}>
          Loading ByteStoreX…
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthModal />;
  }

  const isExplorer = activeTab === 'explorer' || activeTab === 'starred';

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        quota={quota}
        trashCount={trashCount}
      />

      {/* Main Content */}
      <div className="main-content">
        {/* Navbar — only for explorer views */}
        {isExplorer && (
          <Navbar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onOpenUpload={() => setIsUploadOpen(true)}
            onOpenCreateFolder={() => setIsCreateFolderOpen(true)}
            currentFolderName={currentFolderId ? currentFolderName : undefined}
          />
        )}

        {/* Views */}
        {activeTab === 'explorer' && (
          <Explorer
            files={files}
            folders={folders}
            breadcrumbs={breadcrumbs}
            currentFolderId={currentFolderId}
            onNavigateFolder={handleNavigateFolder}
            onRefresh={fetchData}
            onOpenShareModal={(id, type) =>
              setShareModalState({ isOpen: true, resourceId: id, resourceType: type })
            }
          />
        )}

        {activeTab === 'starred' && (
          <Explorer
            files={files}
            folders={folders}
            breadcrumbs={[{ id: null, name: 'Starred' }]}
            currentFolderId={null}
            onNavigateFolder={handleNavigateFolder}
            onRefresh={fetchData}
            onOpenShareModal={(id, type) =>
              setShareModalState({ isOpen: true, resourceId: id, resourceType: type })
            }
            starredOnly
          />
        )}

        {activeTab === 'shared' && <SharedLinksView />}
        {activeTab === 'trash' && <TrashView />}
        {activeTab === 'jobs' && <JobsMonitor />}
        {activeTab === 'audit' && <AuditFeed />}
        {activeTab === 'quota' && <QuotaWidget quota={quota} />}
      </div>

      {/* Modals */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        currentFolderId={currentFolderId}
        onUploadSuccess={fetchData}
      />

      <CreateFolderModal
        isOpen={isCreateFolderOpen}
        onClose={() => setIsCreateFolderOpen(false)}
        onConfirm={handleCreateFolder}
      />

      <ShareModal
        isOpen={shareModalState.isOpen}
        onClose={() => setShareModalState({ isOpen: false, resourceId: null, resourceType: null })}
        resourceId={shareModalState.resourceId}
        resourceType={shareModalState.resourceType}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <ToastProvider>
        <MainWorkspace />
      </ToastProvider>
    </AuthProvider>
  );
};
