import React, { useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  BellRing,
  Boxes,
  ChevronLeft,
  Database,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Moon,
  Radio,
  Search,
  Server,
  ShieldCheck,
  Sun,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react';
import CrnetApmMark from './CrnetApmMark';
import { useTranslation } from '../utils/i18n';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: any;
  onLogout: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

type NavigationItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
};

const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  { label: 'Services', to: '/services', icon: Boxes },
  { label: 'Traces', to: '/traces', icon: Activity },
  { label: 'Service Map', to: '/servicemap', icon: Waypoints },
  { label: 'Dependencies', to: '/dependencies', icon: GitBranch },
  { label: 'Database', to: '/database', icon: Database },
  { label: 'Infrastructure', to: '/infrastructure', icon: Server },
  { label: 'Live Stream', to: '/live', icon: Radio },
  { label: 'Alerts', to: '/alerts', icon: BellRing },
  { label: 'Admin', to: '/admin', icon: ShieldCheck, adminOnly: true },
];

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  user,
  onLogout,
  isDark,
  onToggleTheme,
}: SidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return navigationItems.filter(item => {
      if (item.adminOnly && user?.role !== 'admin') return false;
      return !normalizedQuery || t(item.label).toLowerCase().includes(normalizedQuery);
    });
  }, [query, t, user?.role]);

  const displayName = user?.name || user?.username || t('User');
  const secondaryIdentity = user?.email || (
    user?.role === 'admin' ? t('Administrator') : t('Viewer')
  );
  const initials = String(displayName)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() || '')
    .join('') || 'U';

  const expandAndFocusSearch = () => {
    if (collapsed) {
      onToggleCollapse();
      window.requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    searchRef.current?.focus();
  };

  return (
    <aside className="app-sidebar" aria-label={t('Primary navigation')}>
      <div className="primary-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <CrnetApmMark size={40} />
          </div>
          <div className="sidebar-brand-lockup">
            <img className="light" src="/branding/crnet-apm-light.png" alt="CRNET APM" />
            <img className="dark" src="/branding/crnet-apm-dark.png" alt="CRNET APM" />
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
            title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
          >
            <ChevronLeft size={16} strokeWidth={2.4} />
          </button>
        </div>

        {collapsed ? (
          <button
            type="button"
            className="sidebar-search-collapsed"
            onClick={expandAndFocusSearch}
            aria-label={t('Search navigation')}
            title={t('Search navigation')}
          >
            <Search size={19} />
          </button>
        ) : (
          <label className="sidebar-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('Search navigation…')}
              aria-label={t('Search navigation')}
            />
            {query && (
              <button
                type="button"
                className="sidebar-search-clear"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label={t('Clear search')}
              >
                <X size={15} />
              </button>
            )}
          </label>
        )}

        <div className="sidebar-section-label">{t('Workspace')}</div>
        <nav className="primary-sidebar-nav">
          {visibleItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `primary-nav-item ${isActive ? 'active' : ''}`}
                title={t(item.label)}
              >
                <span className="primary-nav-icon">
                  <Icon size={20} strokeWidth={1.9} />
                </span>
                <span className="primary-nav-label">{t(item.label)}</span>
              </NavLink>
            );
          })}
          {!collapsed && visibleItems.length === 0 && (
            <div className="sidebar-search-empty">{t('No navigation items found')}</div>
          )}
        </nav>

        <div className="primary-sidebar-footer">
          <div
            className="sidebar-profile"
            title={`${displayName}${secondaryIdentity ? ` · ${secondaryIdentity}` : ''}`}
          >
            <span className="sidebar-profile-avatar" aria-hidden="true">{initials}</span>
            <span className="sidebar-profile-copy">
              <strong>{displayName}</strong>
              <small>{secondaryIdentity}</small>
            </span>
            <span className="sidebar-profile-status" aria-hidden="true" />
          </div>

          <button
            type="button"
            className="sidebar-utility-item"
            onClick={onToggleTheme}
            aria-label={isDark ? t('Switch to light mode') : t('Switch to dark mode')}
            aria-pressed={isDark}
            title={isDark ? t('Switch to light mode') : t('Switch to dark mode')}
          >
            <span className="sidebar-utility-icon">
              {isDark ? <Moon size={19} /> : <Sun size={19} />}
            </span>
            <span className="sidebar-utility-label">{t('Dark mode')}</span>
            <span className={`sidebar-theme-switch ${isDark ? 'active' : ''}`} aria-hidden="true">
              <span />
            </span>
          </button>

          <button
            type="button"
            className="sidebar-utility-item logout"
            onClick={onLogout}
            title={t('Sign out')}
          >
            <span className="sidebar-utility-icon">
              <LogOut size={19} />
            </span>
            <span className="sidebar-utility-label">{t('Sign out')}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
