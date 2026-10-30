import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  /** @deprecated alias of `render` */
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
 * Data table (Tectonic Design System): sticky header, tabular numerals for right-aligned
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
        clsx(
          'w-full overflow-x-auto border border-[var(--line)] rounded-xl bg-[var(--surface)] text-[var(--ink)]',
          stickyHeader && ['overflow-y-auto', maxHeightClassName],
          className
        ),
      )}
      aria-busy={state === 'loading' || undefined}
    >
      <table className="w-full text-left border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className={clsx(stickyHeader && 'sticky top-0 z-[1]')}>
          <tr className="bg-[var(--surface-strong)] text-xs font-semibold text-[var(--ink-muted)] shadow-[inset_0_-1px_0_var(--line)]">
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
        <tbody className="divide-y divide-[var(--line)]">
          {state === 'loading' &&
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <tr key={`sk-${i}`} aria-hidden="true">
                {columns.map((col) => (
                  <td key={col.key} className={cellPad}>
                    <span className="block h-3 rounded bg-[var(--surface-raised)] animate-pulse" style={{ width: `${55 + ((i * 17 + col.key.length * 7) % 40)}%` }} />
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
                  <span className="text-sm font-semibold text-[var(--danger)]">Couldn’t load this table</span>
                  <span className="text-[13px] text-[var(--ink-muted)]">{error}</span>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-1 h-8 px-3 rounded-full border border-[var(--line-strong)] text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime)]"
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
                  <span className="text-sm font-semibold text-[var(--ink)]">{emptyTitle}</span>
                  <span className="text-[13px] text-[var(--ink-muted)]">{emptyMessage}</span>
                  {emptyAction && <div className="mt-3">{emptyAction}</div>}
                </div>
              </td>
            </tr>
          )}
          {state === 'rows' &&
            data.map((row) => {
              const isInteractive = Boolean(onRowClick);
              const customCls = rowClassName ? rowClassName(row) : undefined;
              return (
                <tr
                  key={keyExtractor(row)}
                  tabIndex={isInteractive ? 0 : undefined}
                  role={isInteractive ? 'button' : undefined}
                  aria-label={isInteractive ? 'View details' : undefined}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={
                    isInteractive
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick?.(row);
                          }
                        }
                      : undefined
                  }
                  className={clsx(
                    'transition-colors',
                    isInteractive &&
                      'cursor-pointer hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lime)]',
                    customCls,
                  )}
                >
                  {columns.map((col) => {
                    const content = col.render ? col.render(row) : col.accessor ? col.accessor(row) : (row as any)[col.key];
                    return (
                      <td
                        key={col.key}
                        className={clsx(
                          cellPad,
                          'text-[var(--ink)]',
                          col.align === 'right' && 'text-right tabular-nums font-mono',
                          col.align === 'center' && 'text-center',
                          col.className,
                        )}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
