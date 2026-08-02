import React, { type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-react';

export type StandardSortDirection = 'asc' | 'desc';

export function StandardTableToolbar({
  title,
  count,
  onReset,
  resetLabel,
  resizeHint,
}: {
  title?: string;
  count?: string;
  onReset: () => void;
  resetLabel: string;
  resizeHint: string;
}) {
  return (
    <div className="standard-table-toolbar">
      {(title || count) && (
        <div className="standard-table-title">
          {title && <strong>{title}</strong>}
          {count && <span>{count}</span>}
        </div>
      )}
      <div className="standard-table-tools">
        <span><GripVertical size={13} /> {resizeHint}</span>
        <button type="button" onClick={onReset}>
          <RotateCcw size={13} />
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

export function StandardColumnHeader<C extends string, S extends string>({
  column,
  label,
  sortField,
  activeSort,
  direction = 'asc',
  onSort,
  onResize,
  onResizeKey,
  onReset,
  isLast = false,
  align = 'left',
}: {
  column: C;
  label: string;
  sortField?: S;
  activeSort?: S;
  direction?: StandardSortDirection;
  onSort?: (field: S) => void;
  onResize: (event: React.MouseEvent, column: C) => void;
  onResizeKey: (event: KeyboardEvent<HTMLButtonElement>, column: C) => void;
  onReset: () => void;
  isLast?: boolean;
  align?: 'left' | 'right';
}) {
  const active = Boolean(sortField && activeSort === sortField);
  const ariaSort = sortField
    ? (active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none')
    : undefined;

  return (
    <div
      className={`standard-column-head ${active ? 'active' : ''} align-${align}`}
      role="columnheader"
      aria-sort={ariaSort}
    >
      {sortField && onSort ? (
        <button type="button" className="standard-column-sort" onClick={() => onSort(sortField)}>
          <span>{label}</span>
          {active && (direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      ) : (
        <span className="standard-column-label">{label}</span>
      )}
      {!isLast && (
        <button
          type="button"
          className="standard-column-resizer"
          aria-label={`Resize ${label} column`}
          title="Drag to resize · Arrow keys resize · Double click resets"
          onMouseDown={event => onResize(event, column)}
          onKeyDown={event => onResizeKey(event, column)}
          onDoubleClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onReset();
          }}
        >
          <GripVertical size={13} />
        </button>
      )}
    </div>
  );
}
