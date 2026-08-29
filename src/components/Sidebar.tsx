import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  IconActivity,
  IconBell,
  IconChartHistogram,
  IconDatabase,
  IconGitFork,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconNetwork,
  IconServer,
  IconSettings,
  IconStack2,
  type Icon,
} from '@tabler/icons-react';
import CrnetApmMark from './CrnetApmMark';
import { ThemeSwapper } from './ThemeSwapper';
import { useTranslation } from '../utils/i18n';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: any;
  onLogout: () => void;
  isDark: boolean;
  onThemeChange: (dark: boolean) => void;
}

type NavigationItem = {
  label: string;
  to: string;
  icon: Icon;
  end?: boolean;
  adminOnly?: boolean;
};

const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', to: '/', icon: IconLayoutDashboard, end: true },
  { label: 'Services', to: '/services', icon: IconStack2 },
  { label: 'Traces', to: '/traces', icon: IconChartHistogram },
  { label: 'Service Map', to: '/servicemap', icon: IconNetwork },
  { label: 'Dependencies', to: '/dependencies', icon: IconGitFork },
  { label: 'Database', to: '/database', icon: IconDatabase },
  { label: 'Infrastructure', to: '/infrastructure', icon: IconServer },
  { label: 'Live Stream', to: '/live', icon: IconActivity },
  { label: 'Alerts', to: '/alerts', icon: IconBell },
  { label: 'Admin', to: '/admin', icon: IconSettings, adminOnly: true },
];

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  user,
  onLogout,
  isDark,
  onThemeChange,
}: SidebarProps) {
  const { t } = useTranslation();

  const visibleItems = useMemo(() => {
    return navigationItems.filter(item => {
      if (item.adminOnly && user?.role !== 'admin') return false;
      return true;
    });
  }, [user?.role]);

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

  return (
    <aside className="app-sidebar" aria-label={t('Primary navigation')}>
      <div className="primary-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <CrnetApmMark size={40} />
          </div>
          <div className="sidebar-brand-copy">
            <strong>APM</strong>
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
            title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
          >
            {collapsed ? (
              <IconLayoutSidebarLeftExpand size={16} stroke={1.8} />
            ) : (
              <IconLayoutSidebarLeftCollapse size={16} stroke={1.8} />
            )}
          </button>
        </div>

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
                  <Icon size={20} stroke={1.8} />
                </span>
                <span className="primary-nav-label">{t(item.label)}</span>
              </NavLink>
            );
          })}
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

          <div className="sidebar-theme-row">
            <ThemeSwapper
              dark={isDark}
              onChange={onThemeChange}
              variant={collapsed ? 'icon' : 'segmented'}
            />
          </div>

          <button
            type="button"
            className="sidebar-utility-item logout"
            onClick={onLogout}
            title={t('Sign out')}
          >
            <span className="sidebar-utility-icon">
              <IconLogout size={18} stroke={1.8} />
            </span>
            <span className="sidebar-utility-label">{t('Sign out')}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
