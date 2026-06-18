import React from 'react';
import { NavLink } from 'react-router-dom';
import type { NamespaceStats } from '../api/client';

interface SidebarProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({ namespaces, selectedNamespace, onNamespaceChange, collapsed, onToggleCollapse }: SidebarProps) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo" style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: collapsed ? 'center' : 'space-between', 
        padding: collapsed ? '12px 0' : '16px 16px 16px 20px', 
        borderBottom: '1px solid var(--border-primary)', 
        height: collapsed ? '80px' : '64px', 
        flexDirection: collapsed ? 'column' : 'row',
        gap: collapsed ? '8px' : '0',
        boxSizing: 'border-box',
        transition: 'all 0.2s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img 
            src="/logo.png" 
            alt="Vektor Logo" 
            style={{ 
              width: '38px', 
              height: '38px', 
              flexShrink: 0,
              objectFit: 'contain'
            }} 
          />
          {!collapsed && (
            <span className="sidebar-logo-text" style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Vektor
            </span>
          )}
        </div>
        
        <button 
          className="btn btn-ghost" 
          onClick={onToggleCollapse}
          style={{ 
            padding: '4px', 
            borderRadius: 'var(--radius-sm)', 
            color: 'var(--text-secondary)', 
            display: 'inline-flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s',
            width: '28px',
            height: '28px',
            flexShrink: 0
          }}
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div className="sidebar-section" style={{ padding: collapsed ? '12px 8px' : '16px' }}>
        {!collapsed && <div className="sidebar-section-title">Navigation</div>}
        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={collapsed ? "Dashboard" : undefined}>
            <span className="sidebar-link-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" />
                <rect x="14" y="3" width="7" height="5" />
                <rect x="14" y="12" width="7" height="9" />
                <rect x="3" y="16" width="7" height="5" />
              </svg>
            </span>
            {!collapsed && "Dashboard"}
          </NavLink>
          <NavLink to="/traces" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={collapsed ? "Trace Explorer" : undefined}>
            <span className="sidebar-link-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
                <line x1="11" y1="8" x2="11" y2="14" />
              </svg>
            </span>
            {!collapsed && "Trace Explorer"}
          </NavLink>
          <NavLink to="/servicemap" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={collapsed ? "Service Map" : undefined}>
            <span className="sidebar-link-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </span>
            {!collapsed && "Service Map"}
          </NavLink>
          <NavLink to="/database" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={collapsed ? "Database Analytics" : undefined}>
            <span className="sidebar-link-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
              </svg>
            </span>
            {!collapsed && "Database Analytics"}
          </NavLink>
          <NavLink to="/live" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={collapsed ? "Live Stream" : undefined}>
            <span className="sidebar-link-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </span>
            {!collapsed && "Live Stream"}
          </NavLink>
        </nav>
      </div>

      {!collapsed && (
        <div className="sidebar-section" style={{ flex: '1', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="sidebar-section-title">Namespaces</div>
          <div className="sidebar-namespace-list" style={{ flex: '1', overflowY: 'auto' }}>
            <div
              className={`sidebar-ns-item ${selectedNamespace === '' ? 'active' : ''}`}
              onClick={() => onNamespaceChange('')}
            >
              <span>All Namespaces</span>
              <span className="sidebar-ns-badge" style={{ background: 'var(--border-secondary)', color: 'var(--text-secondary)' }}>{namespaces.length}</span>
            </div>
            {namespaces.map(ns => (
              <div
                key={ns.namespace}
                className={`sidebar-ns-item ${selectedNamespace === ns.namespace ? 'active' : ''}`}
                onClick={() => onNamespaceChange(ns.namespace)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span 
                    style={{ 
                      width: '6px', 
                      height: '6px', 
                      borderRadius: '50%', 
                      background: ns.errorCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                      boxShadow: ns.errorCount > 0 ? '0 0 6px var(--accent-rose)' : '0 0 6px var(--accent-emerald)'
                    }} 
                  />
                  {ns.namespace}
                </span>
                <span className="sidebar-ns-badge" style={{ background: ns.errorCount > 0 ? 'rgba(244, 63, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)', color: ns.errorCount > 0 ? 'var(--accent-rose)' : 'var(--accent-indigo)' }}>
                  {ns.traceCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </aside>
  );
}
