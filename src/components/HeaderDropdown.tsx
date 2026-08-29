import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChevronDown, IconSearch } from '@tabler/icons-react';

export type HeaderDropdownOption = {
  value: string;
  label: string;
};

export default function HeaderDropdown({
  label,
  value,
  options,
  icon,
  onChange,
}: {
  label: string;
  value: string;
  options: HeaderDropdownOption[];
  icon?: React.ReactNode;
  onChange: (value: string) => void;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selected = options.find(option => option.value === value) || options[0];
  const showSearch = options.length > 2;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(option => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 8;
    const width = Math.round(rect.width);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    );
    setMenuPosition({
      top: rect.bottom + 4,
      left,
      width,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    rootRef.current?.querySelector<HTMLButtonElement>('.header-dropdown-trigger')?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery('');
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

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, options.findIndex(option => option.value === value)));
    const frame = requestAnimationFrame(() => {
      if (searchRef.current) searchRef.current.focus();
      else menuRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Focus only when the menu opens — options is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectOption = (option: HeaderDropdownOption) => {
    onChange(option.value);
    close();
  };

  const moveActive = (delta: number) => {
    if (filtered.length === 0) return;
    setActiveIndex(current => (current + delta + filtered.length) % filtered.length);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Enter' && filtered[activeIndex]) {
      event.preventDefault();
      selectOption(filtered[activeIndex]);
    }
  };

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      className="header-dropdown-menu"
      role="listbox"
      tabIndex={-1}
      aria-label={label}
      style={menuPosition ? { top: menuPosition.top, left: menuPosition.left, width: menuPosition.width } : undefined}
      onKeyDown={onMenuKeyDown}
    >
      {showSearch && (
        <div className="header-dropdown-search">
          <IconSearch size={15} stroke={1.8} aria-hidden />
          <input
            ref={searchRef}
            type="text"
            autoComplete="off"
            value={query}
            placeholder={`Filter ${label.toLowerCase()}…`}
            aria-label={`Filter ${label}`}
            onChange={event => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
        </div>
      )}
      <div className="header-dropdown-list">
        {filtered.length === 0 && (
          <div className="header-dropdown-empty">No matches</div>
        )}
        {filtered.map((option, index) => {
          const isSelected = option.value === value;
          const isActive = index === activeIndex;
          return (
            <button
              key={`${option.value || '__all__'}-${index}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={[isSelected ? 'selected' : '', isActive ? 'active' : ''].filter(Boolean).join(' ')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              <span title={option.label}>{option.label}</span>
              {isSelected && <IconCheck size={15} stroke={2.2} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className={`header-filter header-dropdown ${open ? 'open' : ''}`}
      ref={rootRef}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          close();
        }
      }}
    >
      <button
        type="button"
        className="header-dropdown-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!open) updateMenuPosition();
          setOpen(current => !current);
        }}
      >
        {icon && <span className="header-filter-icon" aria-hidden="true">{icon}</span>}
        <span className="header-dropdown-copy">
          <span className="header-filter-label">{label}</span>
          <span className="header-dropdown-value" title={selected?.label}>{selected?.label}</span>
        </span>
        <IconChevronDown className="header-dropdown-chevron" size={15} stroke={2} aria-hidden />
      </button>
      {open && createPortal(menu, document.body)}
    </div>
  );
}
