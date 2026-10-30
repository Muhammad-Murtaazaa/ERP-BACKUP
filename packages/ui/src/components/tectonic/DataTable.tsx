import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Checkbox } from './Checkbox.js';
import { IconButton } from './IconButton.js';

export interface Column<R> {
  key: string;
  header: React.ReactNode;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  render?: (row: R) => React.ReactNode;
}

export interface DataTableProps<R = Record<string, unknown>> {
  columns: Column<R>[];
  rows: R[];
  rowKey?: keyof R & string;
  selectable?: boolean;
  selected?: unknown[];
  onSelect?: (keys: unknown[]) => void;
  footer?: React.ReactNode;
  page?: number;
  pages?: number;
  onPage?: (page: number) => void;
  caption?: string;
  className?: string;
  onRowClick?: (row: R) => void;
}

export function DataTable<R extends Record<string, any>>({
  columns,
  rows = [],
  rowKey = 'id' as keyof R & string,
  selectable = false,
  selected = [],
  onSelect,
  footer,
  page = 1,
  pages = 1,
  onPage,
  caption,
  className,
  onRowClick,
}: DataTableProps<R>) {
  const isAllSelected =
    rows.length > 0 && rows.every((r) => selected.includes(r[rowKey]));

  const toggleAll = () => {
    if (isAllSelected) {
      onSelect?.([]);
    } else {
      onSelect?.(rows.map((r) => r[rowKey]));
    }
  };

  const toggleRow = (k: unknown) => {
    if (selected.includes(k)) {
      onSelect?.(selected.filter((item) => item !== k));
    } else {
      onSelect?.([...selected, k]);
    }
  };

  return (
    <div
      className={twMerge(
        clsx(
          'w-full rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] overflow-hidden flex flex-col transition-all duration-150',
          className,
        ),
      )}
    >
      <div className="overflow-x-auto w-full">
        <table className="w-full border-collapse text-left text-sm select-none">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="bg-[var(--surface-strong,#2b2b2b)] border-b border-[var(--line,#262626)] text-xs font-semibold text-[var(--ink-muted,#a3a3a3)] uppercase tracking-wider">
              {selectable && (
                <th className="w-12 px-4 py-3 text-center">
                  <Checkbox
                    label="Select all rows"
                    hideLabel
                    checked={isAllSelected}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={clsx(
                    'px-4 py-3 text-xs font-medium text-[var(--ink-muted,#a3a3a3)]',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line,#262626)]">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="px-4 py-12 text-center text-sm text-[var(--ink-muted,#a3a3a3)]"
                >
                  No records to display
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const k = row[rowKey] ?? idx;
                const isSelected = selected.includes(k);

                return (
                  <tr
                    key={String(k)}
                    onClick={() => onRowClick?.(row)}
                    className={clsx(
                      'transition-colors duration-100',
                      isSelected
                        ? 'bg-[var(--lime-tint,#1c2b12)] text-[var(--ink,#f5f5f5)]'
                        : 'hover:bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)]',
                      onRowClick && 'cursor-pointer',
                    )}
                  >
                    {selectable && (
                      <td
                        className="px-4 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          label={`Select row ${idx + 1}`}
                          hideLabel
                          checked={isSelected}
                          onChange={() => toggleRow(k)}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={clsx(
                          'px-4 py-3 text-sm text-[var(--ink,#f5f5f5)]',
                          col.align === 'right' && 'text-right tabular-nums',
                          col.align === 'center' && 'text-center',
                        )}
                      >
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with counts and pagination */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--line,#262626)] bg-[var(--surface-raised,#171717)] text-xs text-[var(--ink-muted,#a3a3a3)] select-none">
        <div>{footer || `${rows.length} records shown`}</div>

        <div className="flex items-center gap-2">
          <IconButton
            icon="chevron-left"
            label="Previous page"
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => onPage?.(page - 1)}
          />
          <span className="font-mono tabular-nums text-[var(--ink,#f5f5f5)] px-1">
            {page} / {pages || 1}
          </span>
          <IconButton
            icon="chevron-right"
            label="Next page"
            size="sm"
            variant="ghost"
            disabled={page >= pages}
            onClick={() => onPage?.(page + 1)}
          />
        </div>
      </div>
    </div>
  );
}
