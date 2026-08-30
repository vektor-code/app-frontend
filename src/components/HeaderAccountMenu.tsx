import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconLogout } from '@tabler/icons-react';
import { useTranslation } from '../utils/i18n';

export default function HeaderAccountMenu({
  user,
  onLogout,
}: {
  user: { name?: string; username?: string; email?: string; role?: string } | null;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 8;
    const width = 240;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    setMenuPosition({
      top: rect.bottom + 4,
      left,
      width,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>('.header-account-trigger')?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const reposition = () => updateMenuPosition();
    updateMenuPosition();
    document.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, updateMenuPosition]);

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      className="header-dropdown-menu header-account-menu"
      role="menu"
      tabIndex={-1}
      aria-label={t('Account')}
      style={menuPosition ? { top: menuPosition.top, left: menuPosition.left, width: menuPosition.width } : undefined}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="header-account-identity">
        <span className="header-account-avatar" aria-hidden="true">{initials}</span>
        <span className="header-account-copy">
          <strong>{displayName}</strong>
          {secondaryIdentity ? <small>{secondaryIdentity}</small> : null}
        </span>
      </div>
      <button type="button" role="menuitem" className="header-account-signout" onClick={onLogout}>
        <IconLogout size={16} stroke={1.8} aria-hidden />
        <span>{t('Sign out')}</span>
      </button>
    </div>
  );

  return (
    <div className={`header-account ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="header-account-trigger"
        aria-label={t('Account')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={displayName}
        onClick={() => {
          if (!open) updateMenuPosition();
          setOpen(current => !current);
        }}
      >
        <span className="header-account-avatar" aria-hidden="true">{initials}</span>
      </button>
      {open && createPortal(menu, document.body)}
    </div>
  );
}
