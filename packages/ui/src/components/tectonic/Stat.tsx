import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type StatTone = 'positive' | 'warning' | 'caution' | 'danger' | 'lime';

export interface StatProps {
  value: React.ReactNode;
  label: React.ReactNode;
  delta?: React.ReactNode;
  tone?: StatTone;
  className?: string;
}

export const Stat: React.FC<StatProps> = ({
  value,
  label,
  delta,
  tone = 'positive',
  className,
}) => {
  const deltaToneStyles: Record<StatTone, string> = {
    positive: 'bg-[var(--positive-fill,#2f4a1c)] text-[var(--positive-text,#c2f59a)]',
    lime: 'bg-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)]',
    caution: 'bg-[var(--caution-fill,#4a4b12)] text-[var(--caution-text,#eef07a)]',
    warning: 'bg-[var(--warning-fill,#4d3110)] text-[var(--warning-text,#ffbe73)]',
    danger: 'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)]',
  };

  return (
    <div
      className={twMerge(
        clsx('inline-flex items-baseline gap-2 select-none', className),
      )}
    >
      <span className="font-sans font-medium text-4xl lg:text-[44px] leading-none tracking-[-0.03em] tabular-nums text-[var(--ink,#f5f5f5)]">
        {value}
      </span>
      <div className="flex flex-col items-start leading-tight">
        {delta && (
          <span
            className={clsx(
              'text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-[4px] leading-none mb-0.5',
              deltaToneStyles[tone] || deltaToneStyles.positive,
            )}
          >
            {delta}
          </span>
        )}
        <span className="text-xs font-normal text-[var(--ink-muted,#a3a3a3)] lowercase tracking-tight">
          {label}
        </span>
      </div>
    </div>
  );
};
