import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';

export type HeaderDropdownOption = {
  value: string;
  label: string;
  shortLabel?: string;
};

export default function HeaderDropdown({
  label,
  value,
  options,
  icon,
  className,
  align = 'start',
  onChange,
}: {
  label: string;
  value: string;
  options: HeaderDropdownOption[];
  icon?: React.ReactNode;
  className?: string;
  align?: 'start' | 'end';
  onChange: (value: string) => void;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find(option => option.value === value) || options[0];

  const close = useCallback(() => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>('.header-dropdown-trigger')?.focus();
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

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, options.findIndex(option => option.value === value)));
    const frame = requestAnimationFrame(() => {
      menuRef.current?.focus();
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
    if (options.length === 0) return;
    setActiveIndex(current => (current + delta + options.length) % options.length);
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
    if (event.key === 'Enter' && options[activeIndex]) {
      event.preventDefault();
      selectOption(options[activeIndex]);
    }
  };

  return (
    <div
      className={['header-filter', 'header-dropdown', open ? 'open' : '', className].filter(Boolean).join(' ')}
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
        aria-controls={menuId}
        onClick={() => setOpen(current => !current)}
      >
        {icon && <span className="header-filter-icon" aria-hidden="true">{icon}</span>}
        <span className="header-dropdown-copy">
          <span className="header-filter-label">{label}</span>
          <span className="header-dropdown-value" title={selected?.label}>{selected?.shortLabel || selected?.label}</span>
        </span>
        <CaretDown className="header-dropdown-chevron" size={12} weight="bold" aria-hidden />
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className="header-dropdown-menu is-attached"
        role="listbox"
        tabIndex={-1}
        aria-label={label}
        aria-hidden={!open}
        data-align={align}
        onKeyDown={onMenuKeyDown}
      >
        <div className="header-dropdown-list">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                key={`${option.value || '__all__'}-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={open ? 0 : -1}
                className={[isSelected ? 'selected' : '', isActive ? 'active' : ''].filter(Boolean).join(' ')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span title={option.label}>{option.label}</span>
                {isSelected && <Check size={14} weight="bold" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
