import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  /** @deprecated alias of `render` (older views used it; previously ignored, so those cells rendered raw fields). */
  accessor?: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  className?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  isLoading?: boolean;
  /** Error message; renders an error state (role=alert) with an optional retry. */
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  /** Short heading for the empty state (defaults to "Nothing here yet"). */
  emptyTitle?: string;
  /** Optional call to action rendered in the empty state (e.g. a "Create" button). */
  emptyAction?: React.ReactNode;
  /** Accessible table name (visually hidden caption). */
  caption?: string;
  /** Sticky column headers inside a vertically scrolling body (default true). */
  stickyHeader?: boolean;
  /** Tailwind max-height class for the scroll container when stickyHeader is on. */
  maxHeightClassName?: string;
  dense?: boolean;
  className?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
}

const SKELETON_ROWS = 4;

/**
 * Data table (design-system.md §Tables): sticky header, tabular numerals for right-aligned
 * money columns, explicit loading / empty / error states, keyboard-activatable rows
 * (Enter/Space) with a visible focus ring.
 */
export function Table<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  error,
  onRetry,
  emptyMessage = 'No records found.',
  emptyTitle = 'Nothing here yet',
  emptyAction,
  caption,
  stickyHeader = true,
  maxHeightClassName = 'max-h-[70vh]',
  dense = false,
  className,
  onRowClick,
  rowClassName,
}: TableProps<T>) {
  const cellPad = dense ? 'py-2 px-3' : 'py-3 px-4';
  const state: 'loading' | 'error' | 'empty' | 'rows' = isLoading ? 'loading' : error ? 'error' : data.length === 0 ? 'empty' : 'rows';
  return (
    <div
      className={twMerge(
        clsx('w-full overflow-x-auto border border-[#D9DFEA] rounded-[10px] bg-white', stickyHeader && ['overflow-y-auto', maxHeightClassName], className),
      )}
      aria-busy={state === 'loading' || undefined}
    >
      <table className="w-full text-left border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className={clsx(stickyHeader && 'sticky top-0 z-[1]')}>
          <tr className="bg-[#F1F4F9] text-xs font-semibold text-[#46536B] shadow-[inset_0_-1px_0_#D9DFEA]">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{ width: col.width }}
                className={clsx(cellPad, 'whitespace-nowrap', col.align === 'right' && 'text-right', col.align === 'center' && 'text-center', col.className)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#D9DFEA]">
          {state === 'loading' &&
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <tr key={`sk-${i}`} aria-hidden="true">
                {columns.map((col) => (
                  <td key={col.key} className={cellPad}>
                    <span className="block h-3 rounded bg-[#F1F4F9] animate-pulse" style={{ width: `${55 + ((i * 17 + col.key.length * 7) % 40)}%` }} />
                  </td>
                ))}
              </tr>
            ))}
          {state === 'loading' && (
            <tr className="sr-only">
              <td colSpan={columns.length} role="status">Loading…</td>
            </tr>
          )}
          {state === 'error' && (
            <tr>
              <td colSpan={columns.length} className="py-10 px-4 text-center">
                <div role="alert" className="inline-flex flex-col items-center gap-2 max-w-md">
                  <span className="text-sm font-semibold text-[#A82430]">Couldn’t load this table</span>
                  <span className="text-[13px] text-[#46536B]">{error}</span>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-1 h-8 px-3 rounded-md border border-[#7D8799] text-[13px] font-semibold text-[#182235] hover:bg-[#F1F4F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3CC4]"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )}
          {state === 'empty' && (
            <tr>
              <td colSpan={columns.length} className="py-10 px-4 text-center">
                <div className="inline-flex flex-col items-center gap-1.5 max-w-md">
                  <span className="text-sm font-semibold text-[#182235]">{emptyTitle}</span>
                  <span className="text-[13px] text-[#5E6A7D]">{emptyMessage}</span>
                  {emptyAction && <div className="mt-2">{emptyAction}</div>}
                </div>
              </td>
            </tr>
          )}
          {state === 'rows' &&
            data.map((row) => (
              <tr
                key={keyExtractor(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={clsx(
                  'hover:bg-[#F7F8FC] transition-colors',
                  onRowClick && 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5B3CC4]',
                  rowClassName?.(row),
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={clsx(
                      cellPad,
                      'text-[#182235] align-middle',
                      col.align === 'right' && 'text-right font-mono tabular-nums whitespace-nowrap',
                      col.align === 'center' && 'text-center',
                      col.className,
                    )}
                  >
                    {col.render ? col.render(row) : col.accessor ? col.accessor(row) : (row as any)[col.key]}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
