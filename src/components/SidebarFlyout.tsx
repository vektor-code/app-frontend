import React from 'react';
import { NavLink } from 'react-router-dom';

export type SidebarFlyoutLink = {
  label: string;
  to: string;
  end?: boolean;
};

export default function SidebarFlyout({
  label,
  links,
}: {
  label: string;
  links: SidebarFlyoutLink[];
}) {
  return (
    <div className="apm-rail-flyout" role="menu" aria-label={label}>
      <div className="apm-rail-flyout-panel">
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            role="menuitem"
            className={({ isActive }) =>
              `apm-rail-flyout-link ${isActive ? 'is-active' : ''}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
