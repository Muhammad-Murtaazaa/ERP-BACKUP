import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export type Tone =
  | 'positive'
  | 'caution'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'lime';

export interface StatusPillProps {
  tone?: Tone;
  icon?: IconName;
  children: React.ReactNode;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  tone = 'neutral',
  icon,
  children,
  className,
}) => {
  const toneStyles: Record<Tone, string> = {
    positive:
      'bg-[var(--positive-fill,#2f4a1c)] text-[var(--positive-text,#c2f59a)] border-[var(--positive-fill,#2f4a1c)]',
    caution:
      'bg-[var(--caution-fill,#4a4b12)] text-[var(--caution-text,#eef07a)] border-[var(--caution-fill,#4a4b12)]',
    warning:
      'bg-[var(--warning-fill,#4d3110)] text-[var(--warning-text,#ffbe73)] border-[var(--warning-fill,#4d3110)]',
    danger:
      'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)] border-[var(--danger-fill,#4f2219)]',
    neutral:
      'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)] border-[var(--line,#262626)]',
    lime:
      'bg-[var(--lime-tint,#1c2b12)] text-[var(--lime,#9df747)] border-[var(--lime-tint,#1c2b12)]',
  };

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium border select-none whitespace-nowrap leading-none',
          toneStyles[tone] || toneStyles.neutral,
          className,
        ),
      )}
    >
      {icon && <Icon name={icon} size={12} />}
      {tone === 'lime' && !icon && <Icon name="spark" size={11} />}
      <span>{children}</span>
    </span>
  );
};
