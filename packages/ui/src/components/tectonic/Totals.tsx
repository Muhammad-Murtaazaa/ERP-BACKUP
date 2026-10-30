import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface TotalsRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface TotalsProps {
  rows?: TotalsRow[];
  total?: React.ReactNode;
  totalLabel?: React.ReactNode;
  className?: string;
}

export const Totals: React.FC<TotalsProps> = ({
  rows = [],
  total,
  totalLabel = 'Total',
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'w-full flex flex-col gap-2 pt-2 border-t border-[var(--line,#262626)] text-sm select-none',
          className,
        ),
      )}
    >
      {rows.map((row, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between text-xs text-[var(--ink-muted,#a3a3a3)]"
        >
          <span>{row.label}</span>
          <span className="font-mono tabular-nums text-[var(--ink,#f5f5f5)]">
            {row.value}
          </span>
        </div>
      ))}

      {total !== undefined && total !== null && (
        <div className="flex items-baseline justify-between pt-2 border-t border-[var(--line,#262626)]">
          <span className="font-sans font-semibold text-base text-[var(--ink,#f5f5f5)]">
            {totalLabel}
          </span>
          <span className="font-sans font-bold text-2xl text-[var(--ink,#f5f5f5)] tabular-nums tracking-tight">
            {total}
          </span>
        </div>
      )}
    </div>
  );
};
