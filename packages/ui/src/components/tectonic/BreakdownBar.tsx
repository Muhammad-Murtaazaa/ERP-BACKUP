import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CHART_COLORS } from './chartUtils.js';

export interface BreakdownItem {
  label: string;
  value: number;
  color?: string;
}

export interface BreakdownBarProps {
  items: BreakdownItem[];
  title?: string;
  total?: React.ReactNode;
  format?: (v: number) => string;
  className?: string;
}

export const BreakdownBar: React.FC<BreakdownBarProps> = ({
  items = [],
  title,
  total,
  format = (v) => `$${v.toLocaleString()}`,
  className,
}) => {
  const sum = items.reduce((acc, curr) => acc + curr.value, 0) || 1;

  return (
    <div
      className={twMerge(
        clsx(
          'w-full p-4 rounded-[16px] bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] flex flex-col gap-3 select-none text-left',
          className,
        ),
      )}
    >
      {(title || total) && (
        <div className="flex items-center justify-between">
          {title && (
            <span className="text-xs font-semibold text-[var(--ink,#f5f5f5)]">
              {title}
            </span>
          )}
          {total && (
            <span className="font-mono text-sm font-bold text-[var(--ink,#f5f5f5)] tabular-nums">
              {total}
            </span>
          )}
        </div>
      )}

      {/* Segmented bar (12px height with 2px gap) */}
      <div className="w-full h-3 flex gap-0.5 rounded-full overflow-hidden bg-[var(--surface-strong,#2b2b2b)]">
        {items.map((item, idx) => {
          const pct = Math.max(0, (item.value / sum) * 100);
          const barColor = item.color || CHART_COLORS[idx % CHART_COLORS.length];
          return (
            <div
              key={idx}
              title={`${item.label}: ${pct.toFixed(1)}%`}
              style={{ width: `${pct}%`, backgroundColor: barColor }}
              className="h-full transition-all duration-300"
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 pt-1">
        {items.map((item, idx) => {
          const pct = ((item.value / sum) * 100).toFixed(0);
          const barColor = item.color || CHART_COLORS[idx % CHART_COLORS.length];
          return (
            <div
              key={idx}
              className="flex items-center justify-between text-xs text-[var(--ink-muted,#a3a3a3)]"
            >
              <div className="flex items-center gap-2">
                <span
                  style={{ backgroundColor: barColor }}
                  className="w-2.5 h-2.5 rounded-[2px]"
                />
                <span className="text-[var(--ink,#f5f5f5)] font-medium">
                  {item.label}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono tabular-nums">
                <span>{pct}%</span>
                <span className="text-[var(--ink,#f5f5f5)] font-semibold">
                  {format(item.value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
