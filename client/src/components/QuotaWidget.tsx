import React from 'react';
import { HardDrive, PieChart, FileText, Image as ImageIcon, FileArchive, FileCode, Video, TrendingUp, Folder } from 'lucide-react';
import { QuotaInfo } from '../types/index.js';

interface QuotaWidgetProps {
  quota: QuotaInfo | null;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

export const QuotaWidget: React.FC<QuotaWidgetProps> = ({ quota }) => {
  if (!quota) return null;

  const usedPct = Math.min(Math.round((quota.usedBytes / quota.totalQuotaBytes) * 100), 100);
  const freePct = 100 - usedPct;

  const categories = [
    { name: 'Documents', bytes: quota.breakdown.documents, color: '#8b5cf6', icon: FileText },
    { name: 'Media', bytes: quota.breakdown.media, color: '#ec4899', icon: ImageIcon },
    { name: 'Archives', bytes: quota.breakdown.archives, color: '#f97316', icon: FileArchive },
    { name: 'Code', bytes: quota.breakdown.code, color: '#3b82f6', icon: FileCode },
    { name: 'Other', bytes: quota.breakdown.other, color: '#6b7280', icon: HardDrive },
  ];

  const totalUsed = quota.usedBytes || 1;

  // SVG donut ring
  const RADIUS = 70;
  const CIRC = 2 * Math.PI * RADIUS;
  const fillOffset = CIRC - (usedPct / 100) * CIRC;

  return (
    <div className="view-area animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <PieChart size={22} color="var(--accent-primary)" />
            Storage Quota
          </h1>
          <p className="page-subtitle">
            Atomic per-user storage boundaries with real-time byte accounting.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          marginBottom: '24px',
        }}
      >
        {/* Donut Chart Card */}
        <div
          className="glass-panel"
          style={{
            borderRadius: 'var(--radius-lg)',
            padding: '28px',
            display: 'flex',
            alignItems: 'center',
            gap: '28px',
          }}
        >
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <svg width="180" height="180" viewBox="0 0 180 180">
              <defs>
                <linearGradient id="quotaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="50%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#d946ef" />
                </linearGradient>
              </defs>
              {/* BG ring */}
              <circle
                cx="90"
                cy="90"
                r={RADIUS}
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="14"
              />
              {/* Fill ring */}
              <circle
                cx="90"
                cy="90"
                r={RADIUS}
                fill="none"
                stroke="url(#quotaGrad)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={fillOffset}
                transform="rotate(-90 90 90)"
                style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.34,1.56,0.64,1)' }}
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '2rem',
                  fontWeight: 900,
                  background: 'var(--accent-gradient)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  lineHeight: 1,
                }}
              >
                {usedPct}%
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', fontWeight: 600, marginTop: '4px' }}>
                USED
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                Used Storage
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {formatSize(quota.usedBytes)}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                of {formatSize(quota.totalQuotaBytes)} total
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                Available
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--status-success)' }}>
                {formatSize(quota.totalQuotaBytes - quota.usedBytes)}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border-color)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {quota.fileCount}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Files</div>
              </div>
              <div
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border-color)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {quota.folderCount}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Folders</div>
              </div>
            </div>
          </div>
        </div>

        {/* Stacked Bar Card */}
        <div
          className="glass-panel"
          style={{ borderRadius: 'var(--radius-lg)', padding: '28px' }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '16px' }}>
            Storage Breakdown
          </div>

          {/* Stacked bar */}
          <div
            style={{
              height: '12px',
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 'var(--radius-full)',
              display: 'flex',
              overflow: 'hidden',
              marginBottom: '20px',
            }}
          >
            {categories.map((cat) => {
              const pct = (cat.bytes / totalUsed) * usedPct;
              if (pct <= 0) return null;
              return (
                <div
                  key={cat.name}
                  style={{
                    width: `${pct}%`,
                    background: cat.color,
                    height: '100%',
                    transition: 'width 0.5s ease',
                  }}
                  title={`${cat.name}: ${formatSize(cat.bytes)}`}
                />
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {categories.map((cat) => {
              const Icon = cat.icon;
              const pct = Math.round((cat.bytes / totalUsed) * 100);
              return (
                <div
                  key={cat.name}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '7px',
                      background: `${cat.color}1a`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={14} color={cat.color} />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                        fontSize: '0.8rem',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{cat.name}</span>
                      <span style={{ color: cat.color, fontWeight: 700 }}>{formatSize(cat.bytes)}</span>
                    </div>
                    <div className="stat-bar">
                      <div
                        className="stat-bar-fill"
                        style={{ width: `${pct}%`, background: cat.color }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
