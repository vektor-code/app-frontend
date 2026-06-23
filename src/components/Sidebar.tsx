import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { NamespaceStats } from '../api/client';

interface SidebarProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  namespaces,
  selectedNamespace,
  onNamespaceChange,
  collapsed,
  onToggleCollapse
}: SidebarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [generalViewsExpanded, setGeneralViewsExpanded] = useState(true);
  const [modulesExpanded, setModulesExpanded] = useState(true);

  const selectedNsStats = namespaces.find(ns => ns.namespace === selectedNamespace);
  const activeNamespaceLabel = selectedNamespace || 'All Namespaces';

  // Fallback modules for 'All Namespaces' view to match the screenshot
  const fallbackModules = [
    { name: 'ADLC Security', icon: 'shield' },
    { name: 'Secrets', icon: 'key' },
    { name: 'Leaks', icon: 'leaks' },
    { name: 'CI/CD Security', icon: 'cicd' },
    { name: 'SCA', icon: 'sca' },
    { name: 'SAST', icon: 'sast' },
    { name: 'IaC', icon: 'iac' },
    { name: 'Container Security', icon: 'container' },
    { name: 'Cloud Security', icon: 'cloud' }
  ];

  // Map service stats to a displayable module
  const servicesToDisplay = selectedNsStats
    ? selectedNsStats.services.map((svc, idx) => {
        // Cycle icons for variation
        const icons = ['shield', 'key', 'leaks', 'cicd', 'sca', 'sast', 'iac', 'container', 'cloud'];
        return {
          name: svc.serviceName,
          icon: icons[idx % icons.length]
        };
      })
    : [];

  const modulesList = selectedNamespace ? servicesToDisplay : fallbackModules;

  // Helpers to render matching module SVGs
  const renderModuleIcon = (iconName: string) => {
    switch (iconName) {
      case 'shield':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        );
      case 'key':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
        );
      case 'leaks':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="12" cy="12" r="4" />
            <line x1="12" y1="3" x2="12" y2="21" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
        );
      case 'cicd':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
          </svg>
        );
      case 'sca':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            <path d="M2 12h20" />
          </svg>
        );
      case 'sast':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
            <line x1="10" y1="18" x2="14" y2="6" />
          </svg>
        );
      case 'iac':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        );
      case 'container':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="6" y1="5" x2="6" y2="19" />
            <line x1="10" y1="5" x2="10" y2="19" />
            <line x1="14" y1="5" x2="14" y2="19" />
            <line x1="18" y1="5" x2="18" y2="19" />
          </svg>
        );
      case 'cloud':
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="10" />
          </svg>
        );
    }
  };

  return (
    <aside className="app-sidebar">
      {/* 1st Column: Thin Sidebar */}
      <div className="primary-sidebar">
        {/* Logo */}
        <div className="primary-sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="logo-svg">
            <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" />
            <line x1="12" y1="2" x2="12" y2="12" />
            <line x1="12" y1="12" x2="2" y2="17" />
            <line x1="12" y1="12" x2="22" y2="17" />
          </svg>
        </div>

        {/* Toggle Button */}
        <button
          className="sidebar-toggle-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>

        {/* Global Navigation Links */}
        <div className="primary-sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Dashboards">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                <path d="M22 12A10 10 0 0 0 12 2v10z" />
              </svg>
            </span>
            <span className="primary-nav-label">Dashboards</span>
          </NavLink>

          <NavLink to="/traces" className={({ isActive }) => `primary-nav-item item-violations ${isActive ? 'active' : ''}`} title="Violations">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
            </span>
            <span className="primary-nav-label">Violations</span>
          </NavLink>

          <NavLink to="/dependencies" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Projects">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" />
                <line x1="7" y1="9" x2="17" y2="9" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="7" y1="15" x2="17" y2="15" />
              </svg>
            </span>
            <span className="primary-nav-label">Projects</span>
          </NavLink>

          {/* Placeholder Campaigns */}
          <div className="primary-nav-item placeholder" title="Campaigns">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </span>
            <span className="primary-nav-label">Campaigns</span>
          </div>

          {/* Placeholder Inventory */}
          <div className="primary-nav-item placeholder" title="Inventory">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </span>
            <span className="primary-nav-label">Inventory</span>
          </div>

          <NavLink to="/servicemap" className={({ isActive }) => `primary-nav-item item-graph ${isActive ? 'active' : ''}`} title="Graph">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="12" rx="3" ry="9" transform="rotate(45 12 12)" />
                <ellipse cx="12" cy="12" rx="3" ry="9" transform="rotate(-45 12 12)" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </span>
            <span className="primary-nav-label">Graph</span>
          </NavLink>

          {/* Placeholder Compliance */}
          <div className="primary-nav-item placeholder" title="Compliance">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </span>
            <span className="primary-nav-label">Compliance</span>
          </div>

          {/* Placeholder Policies */}
          <div className="primary-nav-item placeholder" title="Policies">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 11 11 13 15 9" />
              </svg>
            </span>
            <span className="primary-nav-label">Policies</span>
          </div>

          <NavLink to="/live" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Automation">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </span>
            <span className="primary-nav-label">Automation</span>
          </NavLink>

          <NavLink to="/database" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Reports">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
            </span>
            <span className="primary-nav-label">Reports</span>
          </NavLink>

          <div className="primary-nav-item placeholder" title="More">
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </span>
            <span className="primary-nav-label">More</span>
          </div>
        </div>

        {/* Bottom Maestro Button */}
        <div className="primary-sidebar-bottom">
          <div className="maestro-badge" title="Maestro">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <span className="primary-nav-label" style={{ color: 'var(--text-secondary)' }}>Maestro</span>
        </div>
      </div>

      {/* 2nd Column: Sub Sidebar (Wide Pane) */}
      <div className={`secondary-sidebar ${collapsed ? 'collapsed' : ''}`}>
        {/* Workspace Dropdown Selector */}
        <div className="workspace-selector-container">
          <div
            className={`workspace-selector-header ${dropdownOpen ? 'active' : ''}`}
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className="workspace-home-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </span>
            <span className="workspace-name">{activeNamespaceLabel}</span>
            <span className="workspace-chevron">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
            <span className="workspace-slash">/</span>
          </div>

          {dropdownOpen && (
            <div className="workspace-dropdown-menu">
              <div
                className={`workspace-dropdown-item ${selectedNamespace === '' ? 'selected' : ''}`}
                onClick={() => {
                  onNamespaceChange('');
                  setDropdownOpen(false);
                }}
              >
                All Namespaces
              </div>
              {namespaces.map(ns => (
                <div
                  key={ns.namespace}
                  className={`workspace-dropdown-item ${selectedNamespace === ns.namespace ? 'selected' : ''}`}
                  onClick={() => {
                    onNamespaceChange(ns.namespace);
                    setDropdownOpen(false);
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span 
                      style={{ 
                        width: '6px', 
                        height: '6px', 
                        borderRadius: '50%', 
                        background: ns.errorCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'
                      }} 
                    />
                    {ns.namespace}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scrollable Content Pane */}
        <div className="secondary-sidebar-content">
          {/* GENERAL VIEWS Accordion */}
          <div className="secondary-section">
            <div
              className="secondary-section-header"
              onClick={() => setGeneralViewsExpanded(!generalViewsExpanded)}
            >
              <span>General Views</span>
              <span className={`accordion-arrow ${generalViewsExpanded ? 'expanded' : ''}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>

            {generalViewsExpanded && (
              <div className="secondary-section-links">
                <NavLink to="/traces" className={({ isActive }) => `secondary-nav-link ${isActive ? 'active' : ''}`}>
                  <span className="secondary-link-icon-wrapper">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                    </svg>
                  </span>
                  <span className="secondary-link-text">All Violations</span>
                  {selectedNamespace && selectedNsStats && selectedNsStats.errorCount > 0 && (
                    <span className="badge-errors">{selectedNsStats.errorCount}</span>
                  )}
                </NavLink>

                <div className="secondary-nav-link placeholder-link">
                  <span className="secondary-link-icon-wrapper">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <span className="secondary-link-text">Assigned to me</span>
                  <span className="badge-count">0</span>
                </div>
              </div>
            )}
          </div>

          <hr className="secondary-sidebar-divider" />

          {/* MODULES / SERVICES Accordion */}
          <div className="secondary-section">
            <div
              className="secondary-section-header"
              onClick={() => setModulesExpanded(!modulesExpanded)}
            >
              <span>{selectedNamespace ? 'Services' : 'Modules'}</span>
              <span className={`accordion-arrow ${modulesExpanded ? 'expanded' : ''}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>

            {modulesExpanded && (
              <div className="secondary-section-links">
                {modulesList.map((mod, idx) => (
                  <div key={idx} className="secondary-nav-link placeholder-link">
                    <span className="secondary-link-icon-wrapper">
                      {renderModuleIcon(mod.icon)}
                    </span>
                    <span className="secondary-link-text truncate" title={mod.name}>
                      {mod.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Get Started Card */}
        <div className="get-started-card">
          <span className="get-started-badge">Get Started</span>
          <p className="get-started-text">
            Use the <span className="star-icon">☆</span> icon to save your favorite violation views
          </p>
        </div>
      </div>
    </aside>
  );
}
