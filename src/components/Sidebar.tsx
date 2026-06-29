import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { NamespaceStats } from '../api/client';

interface SidebarProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: any;
}

export default function Sidebar({
  namespaces,
  selectedNamespace,
  onNamespaceChange,
  collapsed,
  onToggleCollapse,
  user
}: SidebarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [generalViewsExpanded, setGeneralViewsExpanded] = useState(true);
  const [servicesExpanded, setServicesExpanded] = useState(true);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const selectedNsStats = namespaces.find(ns => ns.namespace === selectedNamespace);
  const activeNamespaceLabel = selectedNamespace || 'All Namespaces';

  // De-duplicate services across all namespaces when 'All Namespaces' is selected
  const allServicesMap = new Map<string, { serviceName: string; errorCount: number }>();
  namespaces.forEach(ns => {
    ns.services.forEach(svc => {
      const existing = allServicesMap.get(svc.serviceName);
      if (existing) {
        existing.errorCount += svc.errorCount;
      } else {
        allServicesMap.set(svc.serviceName, {
          serviceName: svc.serviceName,
          errorCount: svc.errorCount
        });
      }
    });
  });
  const allServices = Array.from(allServicesMap.values());

  const servicesList = selectedNamespace
    ? (selectedNsStats?.services || [])
    : allServices;

  // Active status color helper
  const getStatusColor = (errorCount: number) => {
    return errorCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)';
  };

  const location = useLocation();
  const isExplorer = location.pathname.startsWith('/traces');
  const showSecondary = isExplorer || hoveredItem === 'explorer';

  return (
    <aside 
      className={`app-sidebar ${showSecondary ? 'has-secondary' : ''}`}
      onMouseLeave={() => setHoveredItem(null)}
    >
      {/* 1st Column: Thin Sidebar */}
      <div className="primary-sidebar">
        {/* Logo */}
        <div className="primary-sidebar-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="logo-svg">
            <path d="M5 5l7 14 7-14" />
            <path d="M16 5h3v3" />
          </svg>
        </div>

        {/* Global Navigation Links (Aligned to actual pages) */}
        <div className="primary-sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Dashboard" onMouseEnter={() => setHoveredItem(null)}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
            </span>
            <span className="primary-nav-label">Dashboard</span>
          </NavLink>

          <NavLink to="/traces" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Trace Explorer" onMouseEnter={() => setHoveredItem('explorer')}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <span className="primary-nav-label">Explorer</span>
          </NavLink>

          <NavLink to="/servicemap" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Service Map" onMouseEnter={() => setHoveredItem(null)}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </span>
            <span className="primary-nav-label">Service Map</span>
          </NavLink>

          <NavLink to="/dependencies" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Dependencies" onMouseEnter={() => setHoveredItem(null)}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="16" y="16" width="6" height="6" rx="1" />
                <rect x="2" y="16" width="6" height="6" rx="1" />
                <rect x="9" y="2" width="6" height="6" rx="1" />
                <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
                <line x1="12" y1="12" x2="12" y2="8" />
              </svg>
            </span>
            <span className="primary-nav-label">Dependencies</span>
          </NavLink>

          <NavLink to="/database" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Database Analytics" onMouseEnter={() => setHoveredItem(null)}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
              </svg>
            </span>
            <span className="primary-nav-label">Database</span>
          </NavLink>

          <NavLink to="/live" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Live Stream" onMouseEnter={() => setHoveredItem(null)}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </span>
            <span className="primary-nav-label">Live</span>
          </NavLink>

          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title="Admin Panel" onMouseEnter={() => setHoveredItem(null)}>
              <span className="primary-nav-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
              <span className="primary-nav-label">Admin</span>
            </NavLink>
          )}
        </div>
      </div>

      {/* 2nd Column: Sub Sidebar (Wide Pane) */}
      {showSecondary && (
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
                          background: getStatusColor(ns.errorCount)
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
                <span>Views</span>
                <span className={`accordion-arrow ${generalViewsExpanded ? 'expanded' : ''}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>

              {generalViewsExpanded && (
                <div className="secondary-section-links">
                  <NavLink to="/traces" end className={`secondary-nav-link ${location.pathname === '/traces' && !location.search ? 'active' : ''}`}>
                    <span className="secondary-link-icon-wrapper">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </span>
                    <span className="secondary-link-text">All Traces</span>
                  </NavLink>

                  <NavLink to="/traces?hasError=true" className={`secondary-nav-link ${location.search.includes('hasError=true') ? 'active' : ''}`}>
                    <span className="secondary-link-icon-wrapper" style={{ color: 'var(--accent-rose)' }}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </span>
                    <span className="secondary-link-text">Failed Traces</span>
                  </NavLink>

                  <NavLink to="/traces?minDuration=500" className={`secondary-nav-link ${location.search.includes('minDuration=500') ? 'active' : ''}`}>
                    <span className="secondary-link-icon-wrapper" style={{ color: 'var(--accent-amber)' }}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </span>
                    <span className="secondary-link-text">Slow Traces (&gt;500ms)</span>
                  </NavLink>
                </div>
              )}
            </div>

            <hr className="secondary-sidebar-divider" />

            {/* ACTIVE SERVICES Accordion */}
            <div className="secondary-section">
              <div
                className="secondary-section-header"
                onClick={() => setServicesExpanded(!servicesExpanded)}
              >
                <span>Services</span>
                <span className={`accordion-arrow ${servicesExpanded ? 'expanded' : ''}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>

              {servicesExpanded && (
                <div className="secondary-section-links">
                  {servicesList.length > 0 ? (
                    servicesList.map((svc, idx) => {
                      const isSvcActive = location.search.includes(`service=${svc.serviceName}`);
                      return (
                        <NavLink 
                          key={idx} 
                          to={`/traces?service=${svc.serviceName}`} 
                          className={`secondary-nav-link ${isSvcActive ? 'active' : ''}`}
                        >
                          <span className="secondary-link-icon-wrapper" style={{ color: getStatusColor(svc.errorCount) }}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="2" y="2" width="20" height="8" rx="2" />
                              <rect x="2" y="14" width="20" height="8" rx="2" />
                              <circle cx="6" cy="6" r="1" fill="currentColor" />
                              <circle cx="6" cy="18" r="1" fill="currentColor" />
                            </svg>
                          </span>
                          <span className="secondary-link-text truncate" title={svc.serviceName}>
                            {svc.serviceName}
                          </span>
                          {svc.errorCount > 0 && (
                            <span className="badge-errors" style={{ padding: '1px 5px', fontSize: '9px' }}>
                              {svc.errorCount}
                            </span>
                          )}
                        </NavLink>
                      );
                    })
                  ) : (
                    <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      No services detected
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Get Started Card (Customized to Tracing) */}
          <div className="get-started-card">
            <span className="get-started-badge">Get Started</span>
            <p className="get-started-text">
              Select a namespace above to filter traces, maps, and database analytics dynamically.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
