import React, { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Bell,
  Broadcast,
  Database,
  GearSix,
  GitFork,
  Graph,
  HardDrives,
  SquaresFour,
  type Icon,
} from '@phosphor-icons/react';
import SidebarUnion from './SidebarUnion';
import { useTranslation } from '../utils/i18n';

interface SidebarProps {
  user: { role?: string; name?: string; username?: string; displayName?: string } | null;
}

type NavItem = {
  label: string;
  to: string;
  icon: Icon;
  end?: boolean;
  adminOnly?: boolean;
};

const iconWeight = 'light' as const;

const mainItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: SquaresFour, end: true },
  { label: 'Service Map', to: '/servicemap', icon: Graph },
  { label: 'Database', to: '/database', icon: Database },
  { label: 'Infrastructure', to: '/infrastructure', icon: HardDrives },
  { label: 'Dependencies', to: '/dependencies', icon: GitFork },
  { label: 'Live Stream', to: '/live', icon: Broadcast },
  { label: 'Alerts', to: '/alerts', icon: Bell },
  { label: 'Admin', to: '/admin', icon: GearSix, adminOnly: true },
];

const dashboardFlyout: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: SquaresFour, end: true },
  { label: 'Services', to: '/services', icon: SquaresFour },
  { label: 'Traces', to: '/traces', icon: SquaresFour },
];

function isPathActive(pathname: string, to: string, end?: boolean) {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function isDashboardFamily(pathname: string) {
  return pathname === '/' || pathname.startsWith('/services') || pathname.startsWith('/traces');
}

function flyoutFor(item: NavItem): NavItem[] {
  return item.to === '/' ? dashboardFlyout : [item];
}

export default function Sidebar({
  user,
}: SidebarProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const visibleMain = useMemo(
    () => mainItems.filter(item => !(item.adminOnly && user?.role !== 'admin')),
    [user?.role],
  );

  const initials = useMemo(() => {
    const displayName = user?.name || user?.displayName || user?.username || t('User');
    return String(displayName)
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(word => word[0]?.toUpperCase() || '')
      .join('') || 'AP';
  }, [t, user?.displayName, user?.name, user?.username]);

  const dashboardFamilyActive = isDashboardFamily(pathname);

  return (
    <aside className="app-sidebar apm-sidebar" aria-label={t('Primary navigation')}>
      <div className="apm-rail">
        <div className="apm-rail-header">
          <div className="apm-rail-avatar" title="APM" aria-label="APM">
            {initials}
          </div>
        </div>

        <div className="apm-rail-section apm-rail-section-main">
          <div className="apm-rail-kicker">{t('Main')}</div>
          <div className="apm-rail-stack">
            {visibleMain.map(item => {
              const Icon = item.icon;
              const links = flyoutFor(item);
              const parentActive = item.to === '/' ? dashboardFamilyActive : isPathActive(pathname, item.to);
              return (
                <div
                  key={item.to}
                  className={`apm-rail-slot ${parentActive ? 'is-active is-family-active' : ''}`}
                >
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={`apm-rail-icon ${parentActive ? 'is-active' : ''}`}
                    title={t(item.label)}
                  >
                    <Icon size={20} weight={iconWeight} />
                  </NavLink>
                  <div className={`apm-rail-flyout ${links.length === 1 ? 'is-single' : 'is-branch'}`} role="group" aria-label={t(item.label)}>
                    {links.length === 1 ? (
                      <span className="apm-rail-union apm-rail-union-single" aria-hidden="true" />
                    ) : (
                      <SidebarUnion className="apm-rail-union" />
                    )}
                    <div className="apm-rail-flyout-panel">
                      {links.map(link => (
                        <NavLink
                          key={link.to}
                          to={link.to}
                          end={link.end}
                          className={({ isActive }) =>
                            `apm-rail-flyout-link ${isActive ? 'is-active' : ''}`
                          }
                        >
                          {t(link.label)}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
