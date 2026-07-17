import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { NamespaceStats } from '../entities';
import VektorMark from './VektorMark';
import { useTranslation } from '../utils/i18n';

interface SidebarProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: any;
  onLogout: () => void;
}

export default function Sidebar({
  namespaces,
  selectedNamespace,
  onNamespaceChange,
  collapsed,
  onToggleCollapse,
  user,
  onLogout
}: SidebarProps) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [generalViewsExpanded, setGeneralViewsExpanded] = useState(true);
  const [servicesExpanded, setServicesExpanded] = useState(true);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const selectedNsStats = namespaces.find(ns => ns.namespace === selectedNamespace);
  const activeNamespaceLabel = selectedNamespace || t('All Namespaces');

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

  return (
    <aside className="app-sidebar">
      {/* 1st Column: Thin Sidebar */}
      <div className="primary-sidebar">
        {/* Logo */}
        <div className="primary-sidebar-logo" title={t("Vektor Trace")}>
          <VektorMark size={42} />
        </div>

        {/* Global Navigation Links (Aligned to actual pages) */}
        <div className="primary-sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Dashboard")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Dashboard")}</span>
          </NavLink>

          <NavLink to="/services" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Services")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Services")}</span>
          </NavLink>

          <NavLink to="/traces" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Traces")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Traces")}</span>
          </NavLink>

          <NavLink to="/servicemap" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Service Map")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Service Map")}</span>
          </NavLink>

          <NavLink to="/dependencies" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Dependencies")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="16" y="16" width="6" height="6" rx="1" />
                <rect x="2" y="16" width="6" height="6" rx="1" />
                <rect x="9" y="2" width="6" height="6" rx="1" />
                <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
                <line x1="12" y1="12" x2="12" y2="8" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Dependencies")}</span>
          </NavLink>

          <NavLink to="/database" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Database")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Database")}</span>
          </NavLink>

          <NavLink to="/live" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Live Stream")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Live Stream")}</span>
          </NavLink>

          <NavLink to="/alerts" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Alerts")}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Alerts")}</span>
          </NavLink>

          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`} title={t("Admin")}>
              <span className="primary-nav-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
              <span className="primary-nav-label">{t("Admin")}</span>
            </NavLink>
          )}
        </div>

        {/* Bottom section: sign out, styled like every other nav item */}
        <div className="primary-sidebar-footer">
          <button type="button" className="primary-nav-item logout" onClick={onLogout} title={`${t("Sign out")}${user?.username ? ` (${user.username})` : ''}`}>
            <span className="primary-nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            <span className="primary-nav-label">{t("Sign out")}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
