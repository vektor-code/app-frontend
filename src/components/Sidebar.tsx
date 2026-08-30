import React from 'react';
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
  IconNetwork,
  IconServer,
  IconSettings,
  IconStack2,
  type Icon,
} from '@tabler/icons-react';
import CrnetApmMark from './CrnetApmMark';
import { useTranslation } from '../utils/i18n';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: { role?: string } | null;
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
}: SidebarProps) {
  const { t } = useTranslation();

  const visibleItems = navigationItems.filter(item => {
    if (item.adminOnly && user?.role !== 'admin') return false;
    return true;
  });

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
      </div>
    </aside>
  );
}
