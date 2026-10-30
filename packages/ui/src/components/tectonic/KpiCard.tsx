import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';
import { Sparkline } from './Sparkline.js';

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon?: IconName;
  delta?: React.ReactNode;
  deltaTone?: 'positive' | 'warning' | 'caution' | 'danger' | 'lime';
  direction?: 'up' | 'down';
  caption?: React.ReactNode;
  trend?: number[];
  trendColor?: string;
  className?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  icon,
  delta,
  deltaTone = 'positive',
  direction,
  caption,
  trend,
  trendColor = 'var(--chart-1,#62a802)',
  className,
}) => {
  const deltaStyles: Record<string, string> = {
    positive: 'bg-[var(--positive-fill,#2f4a1c)] text-[var(--positive-text,#c2f59a)]',
    lime: 'bg-[var(--lime-tint,#1c2b12)] text-[var(--lime-text,#9df747)]',
    caution: 'bg-[var(--caution-fill,#4a4b12)] text-[var(--caution-text,#eef07a)]',
    warning: 'bg-[var(--warning-fill,#4d3110)] text-[var(--warning-text,#ffbe73)]',
    danger: 'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)]',
  };

  const arrowIcon = direction === 'down' ? 'trend-down' : 'trend-up';

  return (
    <div
      className={twMerge(
        clsx(
          'p-5 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] flex flex-col justify-between gap-3 text-left select-none transition-all duration-150 shadow-xs',
          className,
        ),
      )}
    >
      {/* Label and optional icon */}
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink-muted,#a3a3a3)]">
        {icon && <Icon name={icon} size={15} />}
        <span>{label}</span>
      </div>

      {/* Metric value and trend Sparkline */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans font-medium text-3xl lg:text-[38px] text-[var(--ink,#f5f5f5)] tabular-nums tracking-tight leading-none">
          {value}
        </span>
        {trend && trend.length > 1 && (
          <Sparkline values={trend} width={76} height={28} color={trendColor} />
        )}
      </div>

      {/* Delta badge + comparison caption */}
      {(delta || caption) && (
        <div className="flex items-center gap-2 pt-1 border-t border-[var(--line,#262626)] text-xs text-[var(--ink-muted,#a3a3a3)]">
          {delta && (
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-[4px] leading-none',
                deltaStyles[deltaTone] || deltaStyles.positive,
              )}
            >
              <Icon name={arrowIcon} size={11} strokeWidth={2} />
              <span>{delta}</span>
            </span>
          )}
          {caption && <span className="text-[11px] truncate">{caption}</span>}
        </div>
      )}
    </div>
  );
};
