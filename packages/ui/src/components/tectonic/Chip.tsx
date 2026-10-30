import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  count?: React.ReactNode;
  icon?: IconName;
  children?: React.ReactNode;
}

export const Chip: React.FC<ChipProps> = ({
  selected = false,
  count,
  icon,
  children,
  className,
  ...props
}) => {
  return (
    <button
      type="button"
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-medium transition-all duration-150 select-none cursor-pointer focus-visible:outline-none focus-ring whitespace-nowrap',
          selected
            ? 'bg-[var(--inverse,#f3f3f3)] text-[var(--on-inverse,#0b0b0b)] border border-transparent shadow-xs font-semibold'
            : 'bg-transparent text-[var(--ink,#f5f5f5)] border border-[var(--line-strong,#6b6b6b)] hover:bg-[var(--surface-strong,#2b2b2b)]',
          className,
        ),
      )}
      aria-pressed={selected}
      {...props}
    >
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
      {count !== undefined && count !== null && (
        <span
          className={clsx(
            'text-[10px] px-1.5 py-0.2 rounded-full font-bold ml-0.5 leading-none',
            selected
              ? 'bg-[var(--on-inverse,#0b0b0b)] text-[var(--inverse,#f3f3f3)]'
              : 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
};
