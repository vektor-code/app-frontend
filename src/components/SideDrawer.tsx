import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './SideDrawer.css';

interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  minWidth?: number;
  children: React.ReactNode;
  ariaLabel?: string;
}

export default function SideDrawer({
  open,
  onClose,
  width = 480,
  onWidthChange,
  minWidth = 320,
  children,
  ariaLabel = 'Details',
}: SideDrawerProps) {
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.classList.add('drawer-open');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const startResize = (event: React.MouseEvent) => {
    if (!onWidthChange) return;
    event.preventDefault();
    setDragging(true);
    const originX = event.clientX;
    const originWidth = widthRef.current;

    const onMove = (move: MouseEvent) => {
      const next = originWidth - (move.clientX - originX);
      const max = Math.floor(window.innerWidth * 0.85);
      onWidthChange(Math.min(max, Math.max(minWidth, next)));
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return createPortal(
    <div className="side-drawer" role="presentation">
      <button type="button" className="side-drawer-backdrop" aria-label="Close details" onClick={onClose} />
      <aside
        className="side-drawer-panel"
        style={{ width, minWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={event => event.stopPropagation()}
      >
        {onWidthChange && (
          <div
            className={`side-drawer-resizer ${dragging ? 'is-active' : ''}`}
            onMouseDown={startResize}
          >
            <span className="side-drawer-grip" aria-hidden="true">
              <svg width="10" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="5" r="2" />
                <circle cx="8" cy="12" r="2" />
                <circle cx="8" cy="19" r="2" />
                <circle cx="16" cy="5" r="2" />
                <circle cx="16" cy="12" r="2" />
                <circle cx="16" cy="19" r="2" />
              </svg>
            </span>
          </div>
        )}
        {children}
      </aside>
    </div>,
    document.body,
  );
}
