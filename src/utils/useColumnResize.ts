import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';

interface ColumnResizeOptions<T> {
  minWidths?: Partial<Record<keyof T, number>>;
  storageKey?: string;
}

/**
 * Column resize that keeps the table within its border.
 *
 * Dragging a column's right-edge handle transfers width to/from the *next*
 * column, so the sum of all column widths never changes — the table can't grow
 * past its container or shrink into nothing. The last column has no right
 * neighbour, so its handle is a no-op (and is hidden via CSS).
 */
export function useColumnResize<T extends Record<string, number>>(
  initial: T,
  options: number | ColumnResizeOptions<T> = 60,
) {
  const config: ColumnResizeOptions<T> & { minWidth: number } = typeof options === 'number'
    ? { minWidths: {}, minWidth: options }
    : { ...options, minWidth: 60 };
  const order = useMemo(() => Object.keys(initial) as (keyof T)[], [initial]);
  const [widths, setWidths] = useState<T>(() => {
    if (typeof window === 'undefined' || !config.storageKey) return initial;
    try {
      const saved = JSON.parse(localStorage.getItem(config.storageKey) || '{}') as Partial<T>;
      const next: Record<string, number> = { ...initial };
      order.forEach(key => {
        const savedWidth = Number(saved[key]);
        const minimum = config.minWidths?.[key] ?? config.minWidth;
        next[String(key)] = Number.isFinite(savedWidth) ? Math.max(minimum, savedWidth) : initial[key];
      });
      return next as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (!config.storageKey) return;
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(widths));
    } catch {
      // Column preferences are an enhancement; resizing still works without storage.
    }
  }, [config.storageKey, widths]);

  const resizeBy = (col: keyof T, requestedDelta: number) => {
    const idx = order.indexOf(col);
    const neighbor = order[idx + 1];
    if (!neighbor) return;

    setWidths(previous => {
      const startW = previous[col];
      const startN = previous[neighbor];
      const minimum = config.minWidths?.[col] ?? config.minWidth;
      const neighborMinimum = config.minWidths?.[neighbor] ?? config.minWidth;
      const delta = Math.max(minimum - startW, Math.min(requestedDelta, startN - neighborMinimum));

      return {
        ...previous,
        [col]: startW + delta,
        [neighbor]: startN - delta,
      };
    });
  };

  const startResize = (e: ReactMouseEvent, col: keyof T) => {
    e.preventDefault();
    e.stopPropagation();

    const idx = order.indexOf(col);
    const neighbor = order[idx + 1];
    if (!neighbor) return; // last column: nothing to steal from

    const startX = e.clientX;
    const startW = widths[col];
    const startN = widths[neighbor];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      let delta = moveEvent.clientX - startX;
      // Clamp so neither the dragged column nor its neighbour drops below min.
      const minimum = config.minWidths?.[col] ?? config.minWidth;
      const neighborMinimum = config.minWidths?.[neighbor] ?? config.minWidth;
      if (startW + delta < minimum) delta = minimum - startW;
      if (startN - delta < neighborMinimum) delta = startN - neighborMinimum;
      setWidths(prev => ({
        ...prev,
        [col]: startW + delta,
        [neighbor]: startN - delta,
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  };

  const resetWidths = () => setWidths(initial);

  return { widths, setWidths, startResize, resizeBy, resetWidths };
}
