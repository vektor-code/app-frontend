import React from 'react';
import { NavLink } from 'react-router-dom';
import type { NamespaceStats } from '../api/client';

interface SidebarProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
}

export default function Sidebar({ namespaces, selectedNamespace, onNamespaceChange }: SidebarProps) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">◈</div>
        <span className="sidebar-logo-text">KubeTrace</span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Navigation</div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📊</span> Dashboard
          </NavLink>
          <NavLink to="/traces" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">🔍</span> Trace Explorer
          </NavLink>
          <NavLink to="/servicemap" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">🕸️</span> Service Map
          </NavLink>
          <NavLink to="/database" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">🗄️</span> Database Analytics
          </NavLink>
          <NavLink to="/live" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">⚡</span> Live Stream
          </NavLink>
        </nav>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Namespaces</div>
        <div className="sidebar-namespace-list">
          <div
            className={`sidebar-ns-item ${selectedNamespace === '' ? 'active' : ''}`}
            onClick={() => onNamespaceChange('')}
          >
            <span>All Namespaces</span>
            <span className="sidebar-ns-badge">{namespaces.length}</span>
          </div>
          {namespaces.map(ns => (
            <div
              key={ns.namespace}
              className={`sidebar-ns-item ${selectedNamespace === ns.namespace ? 'active' : ''}`}
              onClick={() => onNamespaceChange(ns.namespace)}
            >
              <span>{ns.namespace}</span>
              <span className="sidebar-ns-badge">{ns.traceCount}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
