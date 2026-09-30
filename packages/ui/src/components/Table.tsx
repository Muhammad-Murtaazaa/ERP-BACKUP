import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  className?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  onRowClick?: (row: T) => void;
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyMessage = 'No records found.',
  className,
  onRowClick,
}: TableProps<T>) {
  return (
    <div className={twMerge(clsx('w-full overflow-x-auto border border-[#D9DFEA] rounded-lg bg-white', className))}>
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="bg-[#F1F4F9] border-b border-[#D9DFEA] text-xs font-semibold text-[#46536B]">
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={clsx(
                  'py-3 px-4',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#D9DFEA]">
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-[#5E6A7D]">
                <div className="flex items-center justify-center gap-2">
                  <span className="inline-block animate-spin h-4 w-4 border-2 border-[#5940B8] border-t-transparent rounded-full" />
                  <span>Loading table data...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-[#5E6A7D]">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={keyExtractor(row)}
                onClick={() => onRowClick?.(row)}
                className={clsx(
                  'hover:bg-[#F7F8FC] transition-colors',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={clsx(
                      'py-3 px-4 text-[#182235]',
                      col.align === 'right' && 'text-right font-mono tabular-nums',
                      col.align === 'center' && 'text-center',
                      col.className,
                    )}
                  >
                    {col.render ? col.render(row) : (row as any)[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
