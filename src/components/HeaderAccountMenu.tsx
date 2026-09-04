import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SignOut } from '@phosphor-icons/react';
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

  const close = useCallback(() => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>('.header-account-trigger')?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [close, open]);

  return (
    <div className={`header-account ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="header-account-trigger"
        aria-label={t('Account')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={displayName}
        onClick={() => setOpen(current => !current)}
      >
        <span className="header-account-avatar" aria-hidden="true">{initials}</span>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className="header-dropdown-menu header-account-menu is-attached"
        role="menu"
        tabIndex={-1}
        aria-label={t('Account')}
        aria-hidden={!open}
        data-align="end"
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
          <SignOut size={16} weight="bold" aria-hidden />
          <span>{t('Sign out')}</span>
        </button>
      </div>
    </div>
  );
}
