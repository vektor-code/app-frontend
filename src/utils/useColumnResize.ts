import { useState, type MouseEvent as ReactMouseEvent } from 'react';

/**
 * Column resize that keeps the table within its border.
 *
 * Dragging a column's right-edge handle transfers width to/from the *next*
 * column, so the sum of all column widths never changes — the table can't grow
 * past its container or shrink into nothing. The last column has no right
 * neighbour, so its handle is a no-op (and is hidden via CSS).
 */
export function useColumnResize<T extends Record<string, number>>(initial: T, minWidth = 60) {
  const [widths, setWidths] = useState<T>(initial);
  const order = Object.keys(initial) as (keyof T)[];

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
      if (startW + delta < minWidth) delta = minWidth - startW;
      if (startN - delta < minWidth) delta = startN - minWidth;
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

  return { widths, setWidths, startResize };
}
