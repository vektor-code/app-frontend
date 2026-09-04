import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SidebarSimple } from '@phosphor-icons/react';
import { useTranslation } from '../utils/i18n';
import './SideDrawer.css';

export type DrawerSide = 'left' | 'right';

const SIDE_KEY = 'apm.drawer.side';
const widthKey = (persistKey: string) => `apm.drawer.width.${persistKey}`;

function readStoredSide(): DrawerSide {
  try {
    return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
}

function readStoredWidth(persistKey: string, fallback: number) {
  try {
    const value = Number(localStorage.getItem(widthKey(persistKey)));
    return Number.isFinite(value) && value >= 280 ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredSide(side: DrawerSide) {
  try {
    localStorage.setItem(SIDE_KEY, side);
  } catch {
    /* ignore quota / private mode */
  }
}

function writeStoredWidth(persistKey: string, width: number) {
  try {
    localStorage.setItem(widthKey(persistKey), String(Math.round(width)));
  } catch {
    /* ignore quota / private mode */
  }
}

type DrawerLayoutValue = {
  side: DrawerSide;
  setSide: (side: DrawerSide) => void;
};

const DrawerLayoutContext = createContext<DrawerLayoutValue | null>(null);

export function useDrawerLayout() {
  return useContext(DrawerLayoutContext);
}

export function DrawerDockControls() {
  const { t } = useTranslation();
  const layout = useDrawerLayout();
  if (!layout) return null;

  return (
    <div className="side-drawer-dock" role="group" aria-label={t('Dock drawer')}>
      <button
        type="button"
        className={layout.side === 'left' ? 'active' : ''}
        aria-pressed={layout.side === 'left'}
        title={t('Dock left')}
        onClick={() => layout.setSide('left')}
      >
        <SidebarSimple size={16} weight="regular" />
      </button>
      <button
        type="button"
        className={layout.side === 'right' ? 'active' : ''}
        aria-pressed={layout.side === 'right'}
        title={t('Dock right')}
        onClick={() => layout.setSide('right')}
      >
        <SidebarSimple size={16} weight="regular" className="side-drawer-dock-right" />
      </button>
    </div>
  );
}

interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  defaultWidth?: number;
  minWidth?: number;
  persistKey?: string;
  panelClassName?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}

export default function SideDrawer({
  open,
  onClose,
  width,
  onWidthChange,
  defaultWidth = 480,
  minWidth = 320,
  persistKey = 'default',
  panelClassName,
  children,
  ariaLabel = 'Details',
}: SideDrawerProps) {
  const { t } = useTranslation();
  const [side, setSideState] = useState<DrawerSide>(readStoredSide);
  const [internalWidth, setInternalWidth] = useState(() => readStoredWidth(persistKey, defaultWidth));
  const [dragging, setDragging] = useState(false);
  const sideRef = useRef(side);
  const widthRef = useRef(width ?? internalWidth);
  sideRef.current = side;
  widthRef.current = width ?? internalWidth;

  const setSide = useCallback((next: DrawerSide) => {
    setSideState(next);
    writeStoredSide(next);
  }, []);

  const applyWidth = useCallback((next: number) => {
    const max = Math.floor(window.innerWidth * 0.88);
    const clamped = Math.min(max, Math.max(minWidth, Math.round(next)));
    writeStoredWidth(persistKey, clamped);
    if (onWidthChange) onWidthChange(clamped);
    else setInternalWidth(clamped);
  }, [minWidth, onWidthChange, persistKey]);

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

  useEffect(() => {
    document.body.classList.toggle('drawer-resizing', dragging);
    return () => document.body.classList.remove('drawer-resizing');
  }, [dragging]);

  if (!open) return null;

  const panelWidth = width ?? internalWidth;

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const originX = event.clientX;
    const originWidth = widthRef.current;
    const originSide = sideRef.current;

    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - originX;
      applyWidth(originSide === 'right' ? originWidth - delta : originWidth + delta);
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return createPortal(
    <DrawerLayoutContext.Provider value={{ side, setSide }}>
      <div className={`side-drawer is-${side}${dragging ? ' is-dragging' : ''}`} role="presentation">
        <button type="button" className="side-drawer-backdrop" aria-label={t('Close details')} onClick={onClose} />
        <aside
          className={['side-drawer-panel', panelClassName].filter(Boolean).join(' ')}
          style={{ width: panelWidth }}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onClick={event => event.stopPropagation()}
        >
          <div
            className={`side-drawer-resizer ${dragging ? 'is-active' : ''}`}
            onPointerDown={startResize}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('Resize drawer')}
            title={t('Drag to resize')}
          >
            <span className="side-drawer-sash" aria-hidden="true">
              <i /><i /><i />
            </span>
          </div>
          {children}
        </aside>
      </div>
    </DrawerLayoutContext.Provider>,
    document.body,
  );
}
