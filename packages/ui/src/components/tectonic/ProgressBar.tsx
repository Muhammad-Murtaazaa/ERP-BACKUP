import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type ProgressTone = 'lime' | 'warning' | 'danger' | 'neutral';

export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  valueLabel?: React.ReactNode;
  tone?: ProgressTone;
  size?: 'sm' | 'md';
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  label,
  valueLabel,
  tone,
  size = 'sm',
  className,
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  let resolvedTone: ProgressTone = tone || 'lime';
  if (!tone) {
    if (percentage > 100) resolvedTone = 'danger';
    else if (percentage >= 90) resolvedTone = 'warning';
  }

  const toneFills: Record<ProgressTone, string> = {
    lime: 'bg-[var(--lime,#9df747)]',
    warning: 'bg-[var(--warning-text,#ffbe73)]',
    danger: 'bg-[var(--danger-text,#ff9f87)]',
    neutral: 'bg-[var(--ink-muted,#a3a3a3)]',
  };

  const heightClass = size === 'sm' ? 'h-2' : 'h-3';

  return (
    <div className={twMerge(clsx('w-full flex flex-col gap-1.5 select-none', className))}>
      {(label || valueLabel) && (
        <div className="flex items-center justify-between text-xs font-medium text-[var(--ink-muted,#a3a3a3)]">
          {label && <span>{label}</span>}
          <span className="font-mono tabular-nums text-[var(--ink,#f5f5f5)] font-semibold">
            {valueLabel !== undefined ? valueLabel : `${Math.round(percentage)}%`}
          </span>
        </div>
      )}

      <div className={`w-full ${heightClass} rounded-full bg-[var(--surface-strong,#2b2b2b)] overflow-hidden`}>
        <div
          style={{ width: `${percentage}%` }}
          className={`h-full rounded-full transition-all duration-300 ${toneFills[resolvedTone]}`}
        />
      </div>
    </div>
  );
};
